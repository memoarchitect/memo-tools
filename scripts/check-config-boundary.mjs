#!/usr/bin/env node
// ─── Configuration boundary check ─────────────────────────────────────────────
//
// Section 19 requires this to be a *structural* property, not a grep: the
// semantic model builder must have no dependency edge to the application
// settings layer, and the build must fail if one appears.
//
// So the check is an import-graph walk. Starting from the modules that decide
// what the model means, it follows every relative import transitively. If that
// closure reaches a settings module, the boundary is broken and the build
// fails — regardless of what any individual file looks like.
//
// A repository search is a supplementary check and is run at the end, because
// text cannot verify a behavioural property. It reports rather than fails.
//
//   node scripts/check-config-boundary.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../packages/tools/src');

/**
 * The semantic side of the boundary: what a model means.
 *
 * If any of these reaches a settings module, a YAML field can change the
 * model — which is exactly the property the flip removed.
 */
const SEMANTIC_ROOTS = [
    'model/native-project.ts',
    'model/methodology-resolver.ts',
    'model/effective-scope.ts',
    'model/builder.ts',
    'model/kind-registry.ts',
    'model/relationship-registry.ts',
    'validator/constraint-loader.ts',
    'validator/constraint-eval.ts',
    'validator/rule-engine.ts',
];

/**
 * The application side of the boundary.
 *
 * `model/package-manifest.ts` is deliberately NOT here. It is the locator: it
 * reads a package's name, version, and source directory so a resolver can find
 * the artifact an import refers to, which section 5.3 permits and the resolver
 * needs. What makes that safe is structural rather than a promise — the
 * `MemoManifest` shape below is checked to expose no semantic field, so there
 * is nothing for a caller to read even if one tried.
 */
const SETTINGS_MODULES = [
    'model/config.ts',
    'model/config-loader.ts',
    'model/settings-boundary.ts',
    'model/toolchain.ts',
];

/**
 * Fields the locator must not expose.
 *
 * Each one used to select model content. If one reappears on `MemoManifest`,
 * the locator has become a settings reader again and the walk above would not
 * notice, because the dependency edge is legitimate.
 */
const FORBIDDEN_LOCATOR_FIELDS = [
    'methodology', 'extends', 'ontologies', 'modules', 'optionalModules',
    'type', 'projectType', 'usage', 'kinds', 'relationshipTypes', 'viewpoints',
];

/**
 * `model/config.ts` is types only, and a type-only import cannot carry a value
 * across the boundary at runtime. It is still listed above so that a *value*
 * import of it fails; the walk below distinguishes the two.
 */
const IMPORT_RE = /^\s*import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;

function moduleFile(fromFile, spec) {
    const raw = resolve(dirname(fromFile), spec.replace(/\.js$/, '.ts'));
    for (const candidate of [raw, `${raw}.ts`, join(raw, 'index.ts')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return undefined;
}

/** Walk value imports transitively from one root. */
function valueClosure(rootFile) {
    const seen = new Set();
    const stack = [rootFile];
    const edges = new Map();
    while (stack.length > 0) {
        const file = stack.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        let source = '';
        try { source = readFileSync(file, 'utf-8'); } catch { continue; }
        IMPORT_RE.lastIndex = 0;
        for (const match of source.matchAll(IMPORT_RE)) {
            const [, isType, spec] = match;
            if (isType) continue;               // types vanish at runtime
            const target = moduleFile(file, spec);
            if (!target) continue;
            if (!edges.has(target)) edges.set(target, file);
            stack.push(target);
        }
    }
    return { seen, edges };
}

/** Reconstruct the import path that reached a forbidden module. */
function pathTo(edges, rootFile, target) {
    const chain = [target];
    let current = target;
    while (current !== rootFile && edges.has(current)) {
        current = edges.get(current);
        chain.unshift(current);
    }
    return chain.map(f => relative(srcRoot, f)).join('\n           → ');
}

let failures = 0;

console.log('── configuration boundary: import-graph walk ──\n');
for (const rootRel of SEMANTIC_ROOTS) {
    const rootFile = resolve(srcRoot, rootRel);
    if (!existsSync(rootFile)) {
        console.error(`  ✖ ${rootRel} does not exist — update SEMANTIC_ROOTS`);
        failures++;
        continue;
    }
    const { seen, edges } = valueClosure(rootFile);
    const breaches = SETTINGS_MODULES
        .map(m => resolve(srcRoot, m))
        .filter(m => m !== rootFile && seen.has(m));
    if (breaches.length === 0) {
        console.log(`  ✔ ${rootRel}`);
        continue;
    }
    failures++;
    for (const breach of breaches) {
        console.error(`  ✖ ${rootRel} reaches ${relative(srcRoot, breach)}:`);
        console.error(`           → ${pathTo(edges, rootFile, breach)}`);
    }
}

// ─── The locator exposes no semantic field ───────────────────────────────────
{
    const locator = resolve(srcRoot, 'model/package-manifest.ts');
    const source = readFileSync(locator, 'utf-8');
    const shape = source.slice(
        source.indexOf('export interface MemoManifest'),
        source.indexOf('}', source.indexOf('export interface MemoManifest')),
    );
    const declared = [...shape.matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1]);
    const leaked = declared.filter(f => FORBIDDEN_LOCATOR_FIELDS.includes(f));
    console.log('\n── locator surface: model/package-manifest.ts ──\n');
    if (leaked.length === 0) {
        console.log(`  ✔ exposes only ${declared.join(', ')}`);
    } else {
        console.error(`  ✖ exposes semantic field(s): ${leaked.join(', ')}`);
        failures++;
    }
}

// ─── Supplementary: no semantic field name is read anywhere outside the
// boundary module. This reports; it does not gate, because a matching string
// is not the same thing as a dependency.
const SEMANTIC_FIELD_READS = [
    /\.methodology\b(?!\w)/, /\bconfig\.extends\b/, /\bconfig\.ontologies\b/,
    /\bconfig\.kinds\b/, /\bconfig\.relationshipTypes\b/, /\bconfig\.viewpoints\b/,
    /\bconfig\.architectureLayers\b/, /\bconfig\.projectType\b/, /\bconfig\.ontologyMetadata\b/,
];

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'generated' || entry.name === '__tests__') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, out);
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const mentions = [];
for (const file of walkFiles(srcRoot)) {
    if (SETTINGS_MODULES.some(m => file === resolve(srcRoot, m))) continue;
    const source = readFileSync(file, 'utf-8');
    const lines = source.split('\n');
    for (const pattern of SEMANTIC_FIELD_READS) {
        // Prose about the removed behaviour is not the removed behaviour, and
        // most of what remains is exactly that: comments explaining why a field
        // is gone. Skip comment lines so a real read is not buried in them.
        const line = lines.findIndex(l => pattern.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
        if (line >= 0) mentions.push(`${relative(srcRoot, file)}:${line + 1}  ${pattern}`);
    }
}

console.log('\n── supplementary: semantic field reads outside the settings layer ──\n');
if (mentions.length === 0) {
    console.log('  ✔ none');
} else {
    for (const m of mentions) console.log(`  ⚠ ${m}`);
}

console.log('');
if (failures > 0) {
    console.error(`✖ configuration boundary BROKEN — ${failures} semantic root(s) reach application settings.`);
    process.exit(1);
}
console.log('✔ configuration boundary intact — no semantic root depends on application settings.');
