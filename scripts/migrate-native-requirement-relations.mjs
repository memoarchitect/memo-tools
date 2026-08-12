#!/usr/bin/env node
// One-shot R2-S2 migration. It is deliberately fail-closed: a relation whose
// endpoints or verification case cannot be located aborts before writing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: migrate-native-requirement-relations.mjs <examples-root>');
const paths = walk(root);
const docs = new Map(paths.map(path => [path, readFileSync(path, 'utf8')]));
const elements = new Map(), cases = new Map();
const bare = ref => ref.split('::').at(-1);
for (const [file, text] of docs) {
    const pkg = text.match(/^\s*package\s+([\w:]+)/m)?.[1];
    if (!pkg) continue;
    for (const [, kind, id] of text.matchAll(/\b(requirement|part|action|item|port|verification)\s+(\w+)\b/g)) {
        elements.set(id, { file, pkg, requirement: kind === 'requirement' });
        if (kind === 'verification') cases.set(id, { file, pkg });
    }
}
const satisfies = new Map(), verifies = new Map();
const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
const qualified = (ref, pkg) => {
    const found = elements.get(bare(ref));
    if (!found) throw new Error(`unresolved endpoint ${ref}`);
    return found.pkg === pkg ? bare(ref) : `${found.pkg}::${bare(ref)}`;
};
for (const [file, before] of docs) {
    let text = before;
    text = text.replace(/^(\s*)connection(?:\s+\w+)?\s*:\s*SatisfiedBy\s+connect\s+\w+\s*::>\s*([\w:]+)\s+to\s+\w+\s*::>\s*([\w:]+);\s*$/gm,
        (_line, indent, requirement, satisfying) => {
            const owner = elements.get(bare(satisfying));
            if (!owner) throw new Error(`unresolved satisfying element ${satisfying}`);
            push(satisfies, owner.file, `${indent}satisfy ${qualified(requirement, owner.pkg)} by ${qualified(satisfying, owner.pkg)};`);
            return '';
        });
    text = text.replace(/^(\s*)connection(?:\s+(\w+))?\s*:\s*AllocatedTo\s+connect\s+\w+\s*::>\s*([\w:]+)\s+to\s+\w+\s*::>\s*([\w:]+);\s*$/gm,
        (_line, indent, name, source, target) => `${indent}allocation${name ? ` ${name}` : ''} : AllocatedTo allocate ${source} to ${target};`);
    text = text.replace(/^(\s*)connection(?:\s+\w+)?\s*:\s*VerifiedBy\s+connect\s+(\w+)\s*::>\s*([\w:]+)\s+to\s+(\w+)\s*::>\s*([\w:]+);\s*$/gm,
        (_line, _indent, firstEnd, firstRef, secondEnd, secondRef) => {
            const [source, target] = firstEnd === 'verificationCase'
                ? [secondRef, firstRef] : [firstRef, secondRef];
            const owner = cases.get(bare(target));
            const sourceInfo = elements.get(bare(source));
            if (!owner || !sourceInfo) throw new Error(`unresolved verification ${source} → ${target}`);
            const entry = verifies.get(owner.file) ?? new Map();
            const links = entry.get(bare(target)) ?? { requirements: [], subjects: [] };
            (sourceInfo.requirement ? links.requirements : links.subjects).push(qualified(source, owner.pkg));
            entry.set(bare(target), links); verifies.set(owner.file, entry);
            return '';
        });
    docs.set(file, text);
}
for (const [file, text] of docs) {
    let updated = text;
    for (const [caseId, links] of verifies.get(file) ?? []) {
        const marker = new RegExp(`\\bverification\\s+${caseId}\\b[^\\{]*\\{`);
        const match = marker.exec(updated);
        if (!match) throw new Error(`cannot locate verification case ${caseId}`);
        const start = match.index + match[0].length - 1;
        let depth = 0, end = -1;
        for (let i = start; i < updated.length; i++) {
            if (updated[i] === '{') depth++;
            else if (updated[i] === '}' && --depth === 0) { end = i; break; }
        }
        if (end < 0) throw new Error(`unclosed verification case ${caseId}`);
        const members = [
            ...(links.requirements.length ? [`        objective { ${links.requirements.map(ref => `verify ${ref};`).join(' ')} }`] : []),
            ...(links.subjects.length ? [`        subject verified : Base::Anything[*] = (${links.subjects.join(', ')});`] : []),
        ].join('\n');
        updated = `${updated.slice(0, end)}${members ? `\n${members}\n    ` : ''}${updated.slice(end)}`;
    }
    const ownedSatisfies = satisfies.get(file) ?? [];
    if (ownedSatisfies.length) updated = updated.replace(/\n}\s*$/, `\n${ownedSatisfies.join('\n')}\n}\n`);
    updated = normaliseObjectives(updated).replaceAll('subject verified : Anything[*]', 'subject verified : Base::Anything[*]');
    // SysIDE resolves a package only after it is imported; a qualified name is
    // not an implicit import. Bring the owners into the case package, then use
    // the ordinary local spelling the rest of each example already uses.
    const ownPackage = updated.match(/^\s*package\s+(\w+)/m)?.[1];
    const imports = [...new Set([...updated.matchAll(/\b(memo_examples_[A-Za-z0-9_]+)::\w+/g)]
        .map(match => match[1]).filter(pkg => pkg !== ownPackage))];
    if (imports.length) {
        const missing = imports.filter(pkg => !new RegExp(`import\\s+${pkg.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}::\\*`).test(updated));
        if (missing.length) updated = updated.replace(/^(\s*package\s+\w+\s*\{)/m,
            `$1\n${missing.map(pkg => `    private import ${pkg}::*;`).join('\n')}`);
        updated = updated.replace(/\bmemo_examples_[A-Za-z0-9_]+::(\w+)/g, '$1');
    }
    if (updated !== readFileSync(file, 'utf8')) writeFileSync(file, updated);
}

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? walk(join(dir, entry.name)) : entry.name.endsWith('.sysml') ? [join(dir, entry.name)] : []);
}

function normaliseObjectives(text) {
    return text.replace(/objective\s*\{([^}]*)\}(\s*objective\s*\{([^}]*)\})+/g,
        (all) => `objective { ${[...all.matchAll(/objective\s*\{([^}]*)\}/g)].map(match => match[1].trim()).join(' ')} }`);
}
