// ─── Syside Compatibility Check ─────────────────────────────────────────────
//
// Verifies structural invariants required by Syside (Sensmetry) and other
// standard SysML v2 tools for indexing and cross-package import resolution.
//
// Checks:
//   C1: Every source is namespaced by a package declaration
//   C2: Every import target resolves to a declared package
//   C3: No Langium-only syntax that standard tools cannot parse
//   C4: Directory path structurally consistent with namespace (ADR-1-12 §4)
//   C5: No hyphens in path segments (SysML v2 qualified names forbid them)
//
// Exit code 0 = all pass; 1 = at least one failure.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSysmlFiles, REPO_ROOT } from './sysml-reader.mjs';

const ONTOLOGY_DIR = join(REPO_ROOT, 'memo', 'src');

const COLORS = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function scanFiles() {
    const files = collectSysmlFiles(ONTOLOGY_DIR);
    const results = [];
    for (const f of files) {
        const text = readFileSync(f, 'utf-8');
        const relPath = relative(REPO_ROOT, f);

        const { allPackages, leafPackages } = extractPackages(text);

        const imports = [];
        const importRe = /(?:private|public)?\s*import\s+([\w:]+)::\*/g;
        let m;
        while ((m = importRe.exec(text)) !== null) {
            imports.push(m[1]);
        }

        results.push({ file: f, relPath, text, allPackages, leafPackages, imports });
    }
    return results;
}

// Parse package declarations with brace nesting. MEMO source documents normally
// contain one flat, path-derived package; memo_namespaces.sysml additionally
// contains the canonical alias facade packages.
function extractPackages(text) {
    const clean = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const tokenRe = /(?:library\s+)?package\s+([A-Za-z_]\w*)\s*\{|\{|\}/g;
    const allPackages = [];
    const stack = [];
    const hasChild = new Map();
    let m;
    while ((m = tokenRe.exec(clean)) !== null) {
        if (m[1]) {
            const parentSegments = stack.filter(segment => segment !== null);
            const fqn = [...parentSegments, m[1]].join('::');
            allPackages.push(fqn);
            if (parentSegments.length > 0) hasChild.set(parentSegments.join('::'), true);
            if (!hasChild.has(fqn)) hasChild.set(fqn, false);
            stack.push(m[1]);
        } else if (m[0] === '{') {
            stack.push(null);
        } else {
            stack.pop();
        }
    }
    const leafPackages = allPackages.filter(fqn => !hasChild.get(fqn));
    return { allPackages, leafPackages };
}

function checkC1PackageDeclarations(entries) {
    const errors = entries
        .filter(entry => entry.allPackages.length === 0)
        .map(entry => `No package declaration in ${entry.relPath}`);
    const seen = new Map();
    for (const entry of entries) {
        for (const packageName of entry.allPackages) {
            if (seen.has(packageName)) {
                errors.push(`Duplicate package "${packageName}" in ${seen.get(packageName)} and ${entry.relPath}`);
            } else {
                seen.set(packageName, entry.relPath);
            }
        }
    }
    return errors;
}

function checkC2ImportResolution(entries) {
    const declared = new Set(entries.flatMap(e => e.allPackages));
    const standardLibraryPackages = new Set([
        'ScalarValues', 'BaseFunctions', 'Collections', 'Time', 'Duration',
    ]);
    const errors = [];
    for (const e of entries) {
        for (const imp of e.imports) {
            if (!declared.has(imp) && !standardLibraryPackages.has(imp)) {
                errors.push(`Unresolved import "${imp}::*" in ${e.relPath}`);
            }
        }
    }
    return errors;
}

const LANGIUM_ONLY_PATTERNS = [
    { pattern: /\bentry\s+:/, label: 'Langium entry keyword' },
    { pattern: /\bterminal\s+/, label: 'Langium terminal rule' },
    { pattern: /\bfragment\s+/, label: 'Langium fragment rule' },
    { pattern: /\bhidden\s*\(/, label: 'Langium hidden terminal' },
    { pattern: /\breturns\s+\w+/, label: 'Langium returns clause' },
];

function checkC3NoLangiumSyntax(entries) {
    const errors = [];
    for (const e of entries) {
        const stripped = e.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        for (const { pattern, label } of LANGIUM_ONLY_PATTERNS) {
            if (pattern.test(stripped)) {
                errors.push(`${label} found in ${e.relPath}`);
            }
        }
    }
    return errors;
}

function checkC4DirectoryNamespaceMapping(entries) {
    const errors = [];
    for (const e of entries) {
        const ONTOLOGY_PREFIX = 'memo/src/';
        if (!e.relPath.startsWith(ONTOLOGY_PREFIX) || e.relPath.endsWith('/memo_namespaces.sysml')) continue;
        const innerPath = e.relPath.slice(ONTOLOGY_PREFIX.length);
        const innerDir = dirname(innerPath);
        const normalizedDir = innerDir === '.' ? '' : innerDir.replace(/[^A-Za-z0-9]+/g, '_');
        const expectedBase = normalizedDir ? `memo_${normalizedDir}` : 'memo';
        for (const packageName of e.allPackages) {
            if (packageName !== expectedBase && !packageName.startsWith(`${expectedBase}_`)) {
                errors.push(`Directory/package mismatch: ${e.relPath} declares ${packageName} (expected "${expectedBase}" or that prefix)`);
            }
        }
    }
    return errors;
}

function checkC5NoHyphensInPaths(entries) {
    const errors = [];
    for (const e of entries) {
        if (e.relPath.match(/[^/]+-[^/]+\.sysml/)) {
            errors.push(`Hyphen in filename: ${e.relPath} (SysML v2 qualified names forbid hyphens)`);
        }
    }
    return errors;
}

export function runAllChecks() {
    const entries = scanFiles();
    const checks = [
        { id: 'C1', name: 'Package declarations present and unique', fn: () => checkC1PackageDeclarations(entries) },
        { id: 'C2', name: 'Import target resolution', fn: () => checkC2ImportResolution(entries) },
        { id: 'C3', name: 'No Langium-only syntax', fn: () => checkC3NoLangiumSyntax(entries) },
        { id: 'C4', name: 'Directory↔namespace mapping', fn: () => checkC4DirectoryNamespaceMapping(entries) },
        { id: 'C5', name: 'No hyphens in path segments', fn: () => checkC5NoHyphensInPaths(entries) },
    ];

    let totalErrors = 0;
    const results = [];

    for (const check of checks) {
        const errors = check.fn();
        totalErrors += errors.length;
        results.push({ ...check, errors });
    }

    return { entries, results, totalErrors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { entries, results, totalErrors } = runAllChecks();

    console.log(COLORS.bold(`\nSyside Compatibility Check — ${entries.length} files\n`));

    for (const { id, name, errors } of results) {
        if (errors.length === 0) {
            console.log(`  ${COLORS.green('✓')} ${id}: ${name}`);
        } else {
            console.log(`  ${COLORS.red('✗')} ${id}: ${name} (${errors.length} error${errors.length > 1 ? 's' : ''})`);
            for (const err of errors) {
                console.log(`      ${COLORS.red(err)}`);
            }
        }
    }

    console.log();
    if (totalErrors === 0) {
        console.log(COLORS.green('All Syside compatibility checks passed.'));
    } else {
        console.log(COLORS.red(`${totalErrors} error(s) found.`));
    }
    process.exit(totalErrors > 0 ? 1 : 0);
}
