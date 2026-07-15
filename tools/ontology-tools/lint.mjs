// ─── Ontology Lint ──────────────────────────────────────────────────────────
//
// Enforces P1 (no empty subclasses), P2 (no duplicate simple names across
// packages without an `:>` link), P5 (no unsupported kernel-path standard
// library imports — ADR-1-13), and P6 (naming/casing
// conventions per ADR-1-12: PascalCase defs, camelCase attributes, snake_case
// filenames).
//
// P1 rejects every empty `def X :> Y { }`; the canonical ontology has no
// package-specific exception file.
//
// Also emits warnings for:
//   - labels-only bodies (just `attribute name : String;` — inherited already)
//   - P4: `Requirement` instances whose `text` doesn't match an EARS template
//     and whose `syntaxStyle` isn't `FreeForm`.
//
// Exit code 1 on any P1/P2 failure; 0 otherwise (warnings don't fail).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { parseAllOntologyDefinitions, collectSysmlFiles, REPO_ROOT } from './sysml-reader.mjs';

const COLORS = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// EARS templates — approximate regexes (case-insensitive, allow leading "The ").
const EARS_PATTERNS = [
    /\bshall\b/i,                                   // Ubiquitous "... shall ..."
    /^\s*when\b.+\bshall\b/is,                      // Event-driven
    /^\s*while\b.+\bshall\b/is,                     // State-driven
    /^\s*where\b.+\bshall\b/is,                     // Optional feature
    /^\s*if\b.+\bthen\b.+\bshall\b/is,              // Unwanted behaviour
];
function matchesEars(text) {
    return EARS_PATTERNS.some((re) => re.test(text));
}

function findRequirementUsageFiles() {
    const roots = [join(REPO_ROOT, 'examples')];
    const out = [];
    const walk = (dir) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.sysml')) out.push(p);
        }
    };
    for (const r of roots) walk(r);
    return out;
}

function lintP4(failures, warnings) {
    const files = findRequirementUsageFiles();
    for (const f of files) {
        let text;
        try { text = readFileSync(f, 'utf-8'); } catch { continue; }
        // Find `requirement R { ... }` style usages (instances, not definitions).
        // Match the body, then look for `text = "..."` and `syntaxStyle = ...`.
        const usageRe = /requirement\s+(?:def\s+)?([A-Za-z_][\w]*)\s*(?::>\s*\w+\s*)?\{/g;
        let m;
        while ((m = usageRe.exec(text)) !== null) {
            const openIdx = text.indexOf('{', m.index);
            if (openIdx < 0) continue;
            let depth = 1;
            let i = openIdx + 1;
            while (i < text.length && depth > 0) {
                if (text[i] === '{') depth++;
                else if (text[i] === '}') depth--;
                i++;
            }
            if (depth !== 0) continue;
            const body = text.slice(openIdx + 1, i - 1);
            const textMatch = body.match(/attribute\s+text\s*(?:=|:=)\s*"([^"]+)"/)
                || body.match(/text\s*(?:=|:=)\s*"([^"]+)"/);
            const styleMatch = body.match(/syntaxStyle\s*(?:=|:=)\s*(?:EARSTemplate::)?(\w+)/);
            if (!textMatch) continue;
            const reqText = textMatch[1];
            const style = styleMatch ? styleMatch[1] : null;
            if (matchesEars(reqText)) continue;
            if (style === 'FreeForm') continue;
            const line = text.slice(0, m.index).split('\n').length;
            warnings.push({
                level: 'warn',
                rule: 'P4',
                file: f.replace(REPO_ROOT + '/', ''),
                line,
                message: `Requirement '${m[1]}' text doesn't match any EARS template and syntaxStyle != FreeForm`,
            });
        }
    }
}

// SysML v2 standard library packages that must be accessed through MEMO's
// wrappers. ScalarValues is intentionally absent: each independent source
// package imports it directly so SysIDE can resolve scalar types in that file.
const KERNEL_LIBRARY_PACKAGES = [
    'BaseFunctions', 'Collections',
    'ISQBase', 'ISQ', 'SI', 'USCustomary',
    'MeasurementReferences', 'Quantities',
    'Time', 'Duration',
    'Performances', 'Actions', 'Calculations',
    'ControlPerformances', 'TransitionPerformances',
    'StatePerformances', 'Triggers',
    'KerML', 'SysML',
];

const KERNEL_IMPORT_RE = new RegExp(
    String.raw`^\s*(?:private\s+|public\s+)?import\s+(?:all\s+)?(${KERNEL_LIBRARY_PACKAGES.join('|')})(?:::|;|\s)`,
    'gm',
);

const STDLIB_WRAPPER_DIR = join(REPO_ROOT, 'memo', 'src', 'core', 'stdlib');

// The memo-sysmlv2 submodule carries its own tooling scaffold (per-package
// dirs, installed deps, build output). Only the flattened ontology content
// at the submodule root is linted; skip the rest to avoid false positives on
// hyphenated package/dep directory names.
// dhf-templates holds markdown document templates, not SysML namespace segments
const VENDOR_SKIP_SEGMENTS = new Set(['node_modules', '.git', 'output', 'packages', 'examples', 'docs', 'site', 'dhf-templates']);
function isVendorContentFile(absPath) {
    return !relative(REPO_ROOT, absPath).split('/').some((seg) => VENDOR_SKIP_SEGMENTS.has(seg));
}

function lintP5(failures) {
    const roots = [
        join(REPO_ROOT, 'memo'),
        join(REPO_ROOT, 'feedback'),
        join(REPO_ROOT, 'examples'),
    ];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        const files = collectSysmlFiles(root).filter(isVendorContentFile);
        for (const f of files) {
            if (f.startsWith(STDLIB_WRAPPER_DIR)) continue;
            let text;
            try { text = readFileSync(f, 'utf-8'); } catch { continue; }
            let m;
            KERNEL_IMPORT_RE.lastIndex = 0;
            while ((m = KERNEL_IMPORT_RE.exec(text)) !== null) {
                const line = text.slice(0, m.index).split('\n').length;
                failures.push({
                    rule: 'P5',
                    file: relative(REPO_ROOT, f),
                    line,
                    message: `Unsupported direct standard-library import of '${m[1]}' — use the MEMO stdlib wrapper instead (ADR-1-13).`,
                });
            }
        }
    }
}

// ─── P6: Naming + casing lint (ADR-1-12, DD-6) ─────────────────────────────

const PASCAL_CASE_RE = /^[A-Z][a-zA-Z0-9]*$/;
const CAMEL_CASE_RE = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const DEF_CONSTRUCTS = ['part', 'item', 'enum', 'requirement', 'action', 'port', 'connection', 'attribute', 'view', 'viewpoint'];
const DEF_RE = new RegExp(
    String.raw`(?:^|\n)\s*(?:${DEF_CONSTRUCTS.join('|')})\s+def\s+(\w+)`,
    'g',
);
const ATTR_RE = /(?:^|\n)\s*attribute\s+(\w+)\s*(?::|;|=)/g;

function lintP6(failures) {
    const roots = [
        join(REPO_ROOT, 'memo'),
        join(REPO_ROOT, 'examples'),
    ];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        const files = collectSysmlFiles(root).filter(isVendorContentFile);
        for (const f of files) {
            const rel = relative(REPO_ROOT, f);
            const filename = basename(f, '.sysml');

            // P6-file: snake_case filenames (no hyphens checked by C5 already)
            if (!SNAKE_CASE_RE.test(filename)) {
                failures.push({
                    rule: 'P6-file',
                    file: rel,
                    line: 1,
                    message: `Filename "${filename}.sysml" is not snake_case (ADR-1-12 §5).`,
                });
            }

            let text;
            try { text = readFileSync(f, 'utf-8'); } catch { continue; }

            // P6-def: PascalCase for type definitions
            DEF_RE.lastIndex = 0;
            let m;
            while ((m = DEF_RE.exec(text)) !== null) {
                const name = m[1];
                if (!PASCAL_CASE_RE.test(name)) {
                    const line = text.slice(0, m.index).split('\n').length;
                    failures.push({
                        rule: 'P6-def',
                        file: rel,
                        line,
                        message: `Definition "${name}" is not PascalCase (ADR-1-12 §5).`,
                    });
                }
            }

            // P6-attr: camelCase for attribute names
            ATTR_RE.lastIndex = 0;
            while ((m = ATTR_RE.exec(text)) !== null) {
                const name = m[1];
                // Skip `attribute def` (those are type defs, checked by P6-def)
                const preceding = text.slice(Math.max(0, m.index - 4), m.index + m[0].length);
                if (/attribute\s+def\s/.test(preceding)) continue;
                if (!CAMEL_CASE_RE.test(name)) {
                    const line = text.slice(0, m.index).split('\n').length;
                    failures.push({
                        rule: 'P6-attr',
                        file: rel,
                        line,
                        message: `Attribute "${name}" is not camelCase (ADR-1-12 §5).`,
                    });
                }
            }
        }
    }

    // P6-dir: snake_case directory segments in the canonical ontology source tree.
    const ontRoot = join(REPO_ROOT, 'memo', 'src');
    if (existsSync(ontRoot)) {
        const containsSysml = (dir) => readdirSync(dir, { withFileTypes: true }).some((entry) =>
            entry.isFile() ? entry.name.endsWith('.sysml') : containsSysml(join(dir, entry.name)),
        );
        const walkDirs = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                if (VENDOR_SKIP_SEGMENTS.has(entry.name) || entry.name.startsWith('.')) continue;
                if (!containsSysml(join(dir, entry.name))) continue;
                if (!SNAKE_CASE_RE.test(entry.name)) {
                    failures.push({
                        rule: 'P6-dir',
                        file: relative(REPO_ROOT, join(dir, entry.name)) + '/',
                        line: 1,
                        message: `Directory segment "${entry.name}" is not snake_case (ADR-1-12 §5).`,
                    });
                }
                walkDirs(join(dir, entry.name));
            }
        };
        walkDirs(ontRoot);
    }
}

function main() {
    const { packages, definitions } = parseAllOntologyDefinitions();

    const failures = [];
    const warnings = [];

    // P1: empty subclass
    for (const d of definitions) {
        if (!d.superType) continue;
        if (!d.bodyIsEmpty) continue;
        failures.push({
            rule: 'P1',
            file: d.relPath,
            line: d.line,
            message: `${d.construct} def ${d.name} :> ${d.superType} { } — empty subclass (OWL anti-pattern). Collapse into ${d.superType} or add meaningful semantics.`,
        });
    }

    // Labels-only warning
    for (const d of definitions) {
        if (!d.labelsOnlyBody) continue;
        warnings.push({
            rule: 'labels-only',
            file: d.relPath,
            line: d.line,
            message: `${d.construct} def ${d.name}${d.superType ? ` :> ${d.superType}` : ''} has only 'attribute name : String;' — likely redundant (name is inherited).`,
        });
    }

    // P2: duplicate simple name across packages without `:>` linking them
    const byName = new Map();
    for (const d of definitions) {
        if (!byName.has(d.name)) byName.set(d.name, []);
        byName.get(d.name).push(d);
    }
    for (const [name, occurrences] of byName) {
        if (occurrences.length < 2) continue;
        // A duplicate is a problem only if multiple distinct packages declare `def X`
        // AND none of them extends another via `:>`.
        const pkgSet = new Set(occurrences.map((o) => o.packageName));
        if (pkgSet.size < 2) continue;
        const anyExtendsPeer = occurrences.some((o) =>
            o.superType && occurrences.some((other) => other !== o && other.name === o.superType),
        );
        if (anyExtendsPeer) continue;
        // All occurrences where `superType` is null are the parallel declarations
        const bareDecls = occurrences.filter((o) => !o.superType);
        if (bareDecls.length < 2) continue;
        for (const d of bareDecls) {
            failures.push({
                rule: 'P2',
                file: d.relPath,
                line: d.line,
                message: `${d.construct} def ${name} declared in multiple packages without an :> link (also in ${bareDecls.filter((x) => x !== d).map((x) => x.packageName).join(', ')}).`,
            });
        }
    }

    // P4
    lintP4(failures, warnings);

    // P5: kernel-path standard library import enforcement (ADR-1-13, DD-2)
    lintP5(failures);

    // P6: naming + casing lint (ADR-1-12, DD-6)
    lintP6(failures);

    // Render report
    const header = COLORS.bold('memo ontology:lint');
    console.log(`${header}`);
    console.log(COLORS.gray(`  packages:    ${packages.length}`));
    console.log(COLORS.gray(`  definitions: ${definitions.length}`));
    console.log('');

    const byFile = new Map();
    for (const item of [...failures, ...warnings]) {
        if (!byFile.has(item.file)) byFile.set(item.file, []);
        byFile.get(item.file).push(item);
    }
    for (const [file, items] of [...byFile.entries()].sort()) {
        console.log(COLORS.bold(file));
        items.sort((a, b) => a.line - b.line);
        for (const it of items) {
            const isFail = failures.includes(it);
            const tag = isFail
                ? COLORS.red(`error[${it.rule}]`)
                : COLORS.yellow(`warn [${it.rule}]`);
            console.log(`  ${tag} ${COLORS.gray(`line ${it.line}`)}  ${it.message}`);
        }
    }

    console.log('');
    const summary = `${failures.length} error(s), ${warnings.length} warning(s)`;
    if (failures.length > 0) {
        console.log(COLORS.red(`${summary} — lint failed`));
        process.exit(1);
    }
    console.log(COLORS.green(`${summary} — lint passed`));
}

main();
