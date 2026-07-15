// ─── SysML Reader ───────────────────────────────────────────────────────────
//
// Minimal SysML v2 reader used by the ontology lint and drawio generator.
// Discovers the canonical MEMO package plus supported extension packages and
// parses each `.sysml` file into a flat list of definitions.
//
// This deliberately does not depend on @memo/core — the lint and generator
// must run before the monorepo's TS build to be useful in CI.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CONSTRUCT_KINDS = ['part', 'requirement', 'action', 'port', 'connection'];

/** Layer id derived from the first directory segment under `sysml/`. */
export function resolveLayer(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    const idx = norm.indexOf('/sysml/');
    const tail = idx >= 0 ? norm.slice(idx + '/sysml/'.length) : norm;
    const seg = tail.split('/')[0];
    if (!seg || seg.endsWith('.sysml')) return 'unknown';
    return seg === 'relationships' ? 'crosscutting' : seg;
}

/** Collect every `*.sysml` file under a directory, excluding `index.sysml`. */
function collectSysmlFiles(dir) {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectSysmlFiles(p));
        else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') out.push(p);
    }
    return out;
}

function readPackageManifest(pkgDir) {
    const candidates = ['memo.package.yaml', 'memo.package.yml', 'memo.config.yaml', 'memo.config.yml'];
    for (const name of candidates) {
        const p = join(pkgDir, name);
        if (existsSync(p)) {
            const content = readFileSync(p, 'utf-8');
            const nameMatch = content.match(/^name:\s*["']?([^"'\n]+)["']?/m);
            const versionMatch = content.match(/^version:\s*["']?([^"'\n]+)["']?/m);
            const sysmlDirMatch = content.match(/^sysmlDir:\s*["']?([^"'\n]+)["']?/m);
            return {
                name: nameMatch ? nameMatch[1].trim() : `@memo/${basename(pkgDir)}`,
                version: versionMatch ? versionMatch[1].trim() : '0.0.0',
                sysmlDir: sysmlDirMatch ? sysmlDirMatch[1].trim() : 'sysml',
            };
        }
    }
    return { name: `@memo/${basename(pkgDir)}`, version: '0.0.0', sysmlDir: 'sysml' };
}

/** Enumerate every ontology package directory with a `sysml/` subtree. */
export function findOntologyPackages() {
    const pkgs = [];
    const packageRoots = [
        join(REPO_ROOT, 'memo', 'packages'),
        join(REPO_ROOT, 'packages'),
    ];
    for (const pkgsDir of packageRoots) {
        if (!existsSync(pkgsDir)) continue;
        for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pkgDir = join(pkgsDir, entry.name);
            if (entry.name !== 'ontology' && !entry.name.startsWith('ontology-')) continue;
            const pkg = makePackage(pkgDir);
            if (existsSync(pkg.sysmlDir)) pkgs.push(pkg);
        }
    }

    pkgs.sort((a, b) => a.name.localeCompare(b.name));
    return pkgs;
}

function makePackage(pkgDir) {
    const manifest = readPackageManifest(pkgDir);
    return {
        dir: pkgDir,
        dirName: basename(pkgDir),
        name: manifest.name,
        version: manifest.version,
        sysmlDir: resolve(pkgDir, manifest.sysmlDir),
    };
}

/**
 * Definition extracted from a `.sysml` file.
 *
 * construct: `part` | `requirement` | `action` | `port` | `connection`
 * name: simple name of the definition
 * superType: name after `:>`, if any
 * body: raw text between the outermost `{ ... }` (may be empty)
 * bodyIsEmpty: true if body contains only whitespace and comments
 * labelsOnlyBody: true if body contains only an inherited `attribute name : String;`
 * filePath: absolute path
 * relPath: path relative to repo root
 * packageName: `@memo/...` name of the owning package
 * layer: Arcadia layer derived via first-segment rule
 * line: 1-based line number where the definition starts
 */
function stripComments(src) {
    // /* ... */ and // ...
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function extractDefinitions(text, pkg, filePath) {
    const defs = [];
    const relPath = relative(REPO_ROOT, filePath);
    const layer = resolveLayer(relPath);

    const defRegex = new RegExp(
        String.raw`(^|\n)([ \t]*)(${CONSTRUCT_KINDS.join('|')})\s+def\s+(\w+)(?:\s*:>\s*(\w+))?\s*\{`,
        'g',
    );

    let m;
    while ((m = defRegex.exec(text)) !== null) {
        const construct = m[3];
        const name = m[4];
        const superType = m[5];
        // Find matching close brace starting from the `{`
        const openIdx = text.indexOf('{', m.index);
        if (openIdx < 0) continue;
        let depth = 1;
        let i = openIdx + 1;
        while (i < text.length && depth > 0) {
            const ch = text[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            i++;
        }
        if (depth !== 0) continue; // unbalanced — skip silently
        const body = text.slice(openIdx + 1, i - 1);
        const cleanBody = stripComments(body).trim();
        const bodyIsEmpty = cleanBody.length === 0;
        const labelsOnlyBody =
            !bodyIsEmpty &&
            /^attribute\s+name\s*:\s*String\s*;$/.test(cleanBody.replace(/\s+/g, ' ').trim());

        // Line number of the definition
        const prefix = text.slice(0, m.index + (m[1] ? m[1].length : 0));
        const line = prefix.split('\n').length;

        defs.push({
            construct,
            name,
            superType: superType || null,
            body,
            bodyIsEmpty,
            labelsOnlyBody,
            filePath,
            relPath,
            packageName: pkg.name,
            packageDir: pkg.dir,
            layer,
            line,
        });
    }
    return defs;
}

/** Parse every ontology file and return { packages, definitions }. */
export function parseAllOntologyDefinitions() {
    const packages = findOntologyPackages();
    const definitions = [];
    for (const pkg of packages) {
        const files = collectSysmlFiles(pkg.sysmlDir);
        for (const f of files) {
            try {
                const text = readFileSync(f, 'utf-8');
                definitions.push(...extractDefinitions(text, pkg, f));
            } catch {
                // skip unreadable
            }
        }
    }
    return { packages, definitions };
}

/** Parse a raw snippet — used by unit-style smoke tests. */
export function parseSnippet(text) {
    const pkg = { name: '@memo/test', dir: '', sysmlDir: '' };
    return extractDefinitions(text, pkg, 'inline.sysml');
}

export { REPO_ROOT, collectSysmlFiles };
