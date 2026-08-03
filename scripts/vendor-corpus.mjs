#!/usr/bin/env node
// ─── Vendor the SysML v2 Release conformance corpus ───────────────────────────
//
// Materializes `corpus/sysml-v2-release/` from a pinned commit of
// `Systems-Modeling/SysML-v2-Release` and writes the manifest that records the
// pin and a SHA-256 for every vendored file.
//
//   node scripts/vendor-corpus.mjs                 # re-vendor at the pinned commit
//   node scripts/vendor-corpus.mjs --commit <sha>  # move the pin
//   node scripts/vendor-corpus.mjs --verify        # checksums only, no network
//
// The corpus is checked in, not fetched at test time. That is the whole point:
// a conformance oracle whose content depends on when CI ran is not an oracle.
// Upstream paths are preserved verbatim, so every manifest entry can be checked
// against the Release repo by path and commit without consulting this script.
//
// Re-vendoring is a deliberate act with a visible diff. Moving the pin changes
// what conformance means, so it changes the baseline too — see
// `corpus/README.md`.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const corpusRoot = resolve(toolsRoot, 'corpus/sysml-v2-release');
const manifestPath = join(corpusRoot, 'manifest.json');

const REPOSITORY = 'https://github.com/Systems-Modeling/SysML-v2-Release';

/**
 * The pinned commit.
 *
 * Recorded here as well as in the manifest so a re-vendor is reproducible from
 * the script alone. `--commit` overrides it; the manifest is what everything
 * else reads.
 */
const PINNED_COMMIT = 'de1070ae8e79c21532b8004fc663d47b35d0e9fa';

/**
 * What is vendored, and why.
 *
 * `include` narrows a tree to the files worth carrying — `bnf/` also holds
 * rendered HTML and 2.1 MB of images that no oracle reads.
 */
const TREES = [
    {
        id: 'library-source',
        path: 'sysml.library',
        role: 'Positive parse+link corpus — the normative libraries in textual form.',
    },
    {
        id: 'library-xmi',
        path: 'sysml.library.xmi',
        role: 'Declared-semantics reference, before implication.',
    },
    {
        id: 'library-xmi-implied',
        path: 'sysml.library.xmi.implied',
        role: "Differential oracle for derived semantics — the Pilot's own computed output, published as data.",
    },
    {
        id: 'library-kpar',
        path: 'sysml.library.kpar',
        role: 'Bundled-library input (Session 4).',
    },
    {
        id: 'grammar',
        path: 'bnf',
        include: name => name.endsWith('.kebnf') || name.endsWith('.kgbnf'),
        role: 'Parser conformance target (textual) and notation conformance target (graphical).',
    },
    {
        id: 'examples-sysml',
        path: 'sysml/src',
        role: 'Regression corpus — the Release SysML examples.',
    },
    {
        id: 'examples-kerml',
        path: 'kerml/src',
        role: 'Regression corpus — the Release KerML examples.',
    },
];

function walk(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, base));
        else out.push(relative(base, full).split(sep).join(posix.sep));
    }
    return out;
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * A single digest over the whole corpus.
 *
 * Ordering is the sorted relative path, so the roll-up is stable across
 * filesystems that enumerate differently. This is what a caller checks when it
 * wants "is this the corpus the baseline was taken against?" in one comparison
 * rather than 600.
 */
function rollUp(files) {
    const hash = createHash('sha256');
    for (const path of Object.keys(files).sort()) hash.update(`${path} ${files[path].sha256}\n`);
    return hash.digest('hex');
}

/** `SysML_Systems_Library-2.1.0-dev.20260501.kpar` → the version segment. */
function libraryVersions(dir) {
    if (!existsSync(dir)) return {};
    const versions = {};
    for (const name of readdirSync(dir).sort()) {
        const match = /^(.+)-(\d+\.\d+\.\d+[^.]*(?:\.\d+)?)\.kpar$/.exec(name);
        if (match) versions[match[1]] = match[2];
    }
    return versions;
}

function fetchInto(commit, dest) {
    const scratch = mkdtempSync(join(tmpdir(), 'memo-corpus-'));
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: ['ignore', 'pipe', 'inherit'] });
    try {
        execFileSync('git', ['init', '-q', scratch], { stdio: 'inherit' });
        git('remote', 'add', 'origin', REPOSITORY);
        git('sparse-checkout', 'init', '--cone');
        git('sparse-checkout', 'set', ...new Set(TREES.map(t => t.path.split('/')[0])));
        git('fetch', '--depth', '1', '--filter=blob:none', 'origin', commit);
        git('checkout', '-q', 'FETCH_HEAD');
        const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', 'FETCH_HEAD'], { cwd: scratch })
            .toString().trim();

        rmSync(dest, { recursive: true, force: true });
        for (const tree of TREES) {
            const from = join(scratch, tree.path);
            const to = join(dest, tree.path);
            if (!existsSync(from)) throw new Error(`Tree "${tree.path}" is not present at ${commit}.`);
            mkdirSync(to, { recursive: true });
            cpSync(from, to, {
                recursive: true,
                filter: src => statSync(src).isDirectory() || !tree.include || tree.include(src),
            });
        }
        return commitDate;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

function inventory(dest) {
    const files = {};
    const trees = [];
    for (const tree of TREES) {
        const dir = join(dest, tree.path);
        const relPaths = walk(dir);
        let bytes = 0;
        for (const rel of relPaths) {
            const full = join(dir, rel.split(posix.sep).join(sep));
            const size = statSync(full).size;
            bytes += size;
            files[posix.join(tree.path, rel)] = { sha256: sha256(full), bytes: size };
        }
        trees.push({ id: tree.id, path: tree.path, role: tree.role, files: relPaths.length, bytes });
    }
    return { files, trees };
}

function main() {
    const argv = process.argv.slice(2);
    const verifyOnly = argv.includes('--verify');
    const commitArg = argv.indexOf('--commit');
    const commit = commitArg >= 0 ? argv[commitArg + 1] : PINNED_COMMIT;

    if (verifyOnly) {
        if (!existsSync(manifestPath)) {
            console.error(`No manifest at ${manifestPath}. Run without --verify to vendor.`);
            process.exit(1);
        }
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        let bad = 0;
        for (const [rel, entry] of Object.entries(manifest.files)) {
            const full = join(corpusRoot, rel.split(posix.sep).join(sep));
            if (!existsSync(full)) { console.error(`MISSING  ${rel}`); bad++; continue; }
            if (sha256(full) !== entry.sha256) { console.error(`CHANGED  ${rel}`); bad++; }
        }
        console.log(bad === 0
            ? `OK  ${Object.keys(manifest.files).length} files match the manifest (commit ${manifest.commit}).`
            : `${bad} file(s) do not match the manifest.`);
        process.exit(bad === 0 ? 0 : 1);
    }

    console.log(`Vendoring ${REPOSITORY} @ ${commit} …`);
    const commitDate = fetchInto(commit, corpusRoot);
    const { files, trees } = inventory(corpusRoot);

    const manifest = {
        repository: REPOSITORY,
        commit,
        commitDate,
        vendoredAt: new Date().toISOString().slice(0, 10),
        libraryVersions: libraryVersions(join(corpusRoot, 'sysml.library.kpar')),
        digest: rollUp(files),
        trees,
        files,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const total = trees.reduce((n, t) => n + t.files, 0);
    console.log(`Wrote ${relative(toolsRoot, manifestPath)} — ${total} files, digest ${manifest.digest.slice(0, 12)}…`);
    for (const tree of trees) {
        console.log(`  ${tree.path.padEnd(28)} ${String(tree.files).padStart(4)} files  ${(tree.bytes / 1e6).toFixed(1)} MB`);
    }
}

main();
