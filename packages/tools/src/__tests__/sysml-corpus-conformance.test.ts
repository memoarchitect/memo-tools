// ─── The conformance corpus, its oracles, and its isolation ──────────────────
//
// Three things are under test here, and the third is as important as the other
// two:
//
// 1. The vendored corpus is what the manifest says it is, at the pinned commit.
// 2. `conformance run` and `conformance diff-xmi` produce what §5.1 asks for —
//    counts by diagnostic domain, and classified differences against the
//    reference implementation's own computed output.
// 3. Nothing else runs them. A conformance sweep reading 150 MB of vendored
//    corpus from inside `memo validate` would be a defect nobody notices until
//    a `dev` server takes ten seconds to come up.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CONFORMANCE_REPORT_VERSION,
    DIFFERENCE_CLASSES,
    LIBRARY_SOURCE_TREE,
    LIBRARY_XMI_IMPLIED_TREE,
    compareConformanceBaseline,
    compareDiffXmiBaseline,
    corpusUnits,
    decodeEntities,
    defaultCorpusDir,
    derivedValuesAgree,
    diffLibrary,
    emptyDifferenceCounts,
    emptyDomainCounts,
    loadCorpus,
    memoQualifiedName,
    normalizeMessage,
    provenanceOf,
    readXmi,
    runConformance,
    selectLibraries,
    selectUnits,
    verifyCorpus,
    xmiCounterpart,
    type ConformanceReport,
    type DiffXmiReport,
} from '../conformance/index.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { memoVersion } from '../version.js';
import type { MEMOConfig } from '../model/config.js';

const CORPUS_DIR = defaultCorpusDir();
const HAS_CORPUS = existsSync(join(CORPUS_DIR, 'manifest.json'));
const SRC = resolve(__dirname, '..');

/**
 * A corpus run needs no project settings — it is grading MEMO against the OMG's
 * files, not against a project. Minimal config, so nothing in a developer's
 * working tree can change what the sweep reports.
 */
const CONFIG = { projectName: 'conformance', kinds: {} } as unknown as MEMOConfig;

// The corpus is vendored, not fetched, so it is present in a normal checkout.
// Skipping rather than failing keeps a sparse checkout usable; the vendoring
// script is the thing that guarantees it is there in CI.
const withCorpus = HAS_CORPUS ? describe : describe.skip;

describe('XMI reader', () => {
    it('decodes the entity forms EMF emits', () => {
        expect(decodeEntities('a&#xA;b')).toBe('a\nb');
        expect(decodeEntities('&lt;p&gt; &amp; &quot;x&quot; &apos;y&apos;')).toBe(`<p> & "x" 'y'`);
        expect(decodeEntities('&#65;')).toBe('A');
        expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
    });

    it('does not end a tag at a > inside an attribute value', () => {
        // Not hypothetical: the libraries' documentation bodies carry HTML, and
        // XML only requires `<` and `&` to be escaped. A naive indexOf('>')
        // cut the first Kernel library in half.
        const dir = mkdtemp();
        const path = join(dir, 'inline.sysmlx');
        writeFileSync(path, [
            '<?xml version="1.0" encoding="ASCII"?>',
            '<sysml:Namespace xmlns:sysml="x" xmlns:xsi="y">',
            '  <ownedRelatedElement xsi:type="sysml:LibraryPackage" declaredName="P">',
            '    <ownedRelationship body="text &lt;/p>&#xA;more"/>',
            '    <ownedRelatedElement xsi:type="sysml:PartUsage" declaredName="Q" isImpliedIncluded="true"/>',
            '  </ownedRelatedElement>',
            '</sysml:Namespace>',
        ].join('\n'));

        const document = readXmi(path);
        expect(document.elements.map(element => element.qualifiedName)).toEqual(['P', 'P::Q']);
        expect(document.elements[0].metatype).toBe('LibraryPackage');
        expect(document.elements[1].implied).toBe(true);
        expect(document.elements[0].implied).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    it('rejects an unbalanced document rather than guessing', () => {
        const dir = mkdtemp();
        const path = join(dir, 'broken.sysmlx');
        writeFileSync(path, '<a><b declaredName="x"></a>');
        expect(() => readXmi(path)).toThrow(/malformed XMI/);
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('report helpers', () => {
    it('normalizes a message so one defect is not counted as ten', () => {
        expect(normalizeMessage("Expecting token of type '}' but found 'accept'."))
            .toBe("Expecting token of type '…' but found '…'.");
        expect(normalizeMessage('line 12 column 4')).toBe('line N column N');
    });

    it('matches a MEMO construct against a reference metaclass', () => {
        expect(derivedValuesAgree('PartUsage', 'part')).toBe(true);
        expect(derivedValuesAgree('PartDefinition', 'part')).toBe(true);
        expect(derivedValuesAgree('ActionUsage', 'part')).toBe(false);
        // Nothing to disagree with is not a disagreement.
        expect(derivedValuesAgree('PartUsage', undefined)).toBe(true);
    });

    it('qualifies a MEMO element by its package', () => {
        expect(memoQualifiedName({ id: 'Part', package: 'Parts' } as never)).toBe('Parts::Part');
        expect(memoQualifiedName({ id: 'Part' } as never)).toBe('Part');
    });

    it('states every domain and every difference class, including the zeros', () => {
        expect(Object.keys(emptyDomainCounts()).sort())
            .toEqual(['memo-ingest', 'memo-methodology', 'sysml']);
        expect(Object.keys(emptyDifferenceCounts()).sort()).toEqual([...DIFFERENCE_CLASSES].sort());
    });
});

describe('baseline comparison', () => {
    const base = (): ConformanceReport => ({
        reportVersion: CONFORMANCE_REPORT_VERSION,
        memoVersion: '0.0.0',
        corpus: {
            repository: 'r', commit: 'aaa', commitDate: 'd', digest: 'ddd',
            libraryVersions: {}, root: '.', verified: 'sources',
        },
        toolchain: { validator: 'internal', lowering: 'internal' },
        totals: {
            units: 1, files: 3, bytes: 1, outsideUnit: 0,
            byDomain: { 'sysml': 5, 'memo-ingest': 0, 'memo-methodology': 0 },
            bySeverity: { error: 5, warning: 0, info: 0 },
        },
        units: [{
            id: 'u', path: 'p', kind: 'library', files: 3, bytes: 1, filesWithDiagnostics: 1,
            outsideUnit: 0,
            byDomain: { 'sysml': 5, 'memo-ingest': 0, 'memo-methodology': 0 },
            bySeverity: { error: 5, warning: 0, info: 0 },
            topFindings: [], roles: [],
        }],
    });

    it('passes an identical report', () => {
        const comparison = compareConformanceBaseline(base(), base());
        expect(comparison.comparable).toBe(true);
        expect(comparison.differences).toEqual([]);
    });

    it('fails an improvement too, so progress is re-frozen deliberately', () => {
        const better = base();
        better.totals.byDomain.sysml = 2;
        better.units[0].byDomain.sysml = 2;
        const comparison = compareConformanceBaseline(base(), better);
        expect(comparison.comparable).toBe(true);
        expect(comparison.differences.map(d => d.path))
            .toEqual(['totals.byDomain.sysml', 'units.u.byDomain.sysml']);
    });

    it('refuses to compare across corpus pins rather than calling it a regression', () => {
        const moved = base();
        moved.corpus.commit = 'bbb';
        const comparison = compareConformanceBaseline(base(), moved);
        expect(comparison.comparable).toBe(false);
        expect(comparison.reason).toMatch(/Corpus pin/);
        expect(comparison.differences).toEqual([]);
    });

    it('reports a unit that appeared or vanished', () => {
        const fewer = base();
        fewer.units = [];
        expect(compareConformanceBaseline(base(), fewer).differences)
            .toContainEqual({ path: 'units.u', baseline: 'present', current: 'absent' });
    });

    it('gates diff-xmi on classified counts, not on the sample', () => {
        const diff = (counts: Partial<Record<string, number>>): DiffXmiReport => ({
            reportVersion: '1.0.0',
            memoVersion: '0.0.0',
            corpus: { repository: 'r', commit: 'aaa', commitDate: 'd', digest: 'ddd', libraryVersions: {}, root: '.' },
            toolchain: { lowering: 'internal' },
            totals: { libraries: 1, counts: { ...emptyDifferenceCounts(), ...counts } as never },
            libraries: [{
                source: 's', referenceDeclared: 1, referenceImplied: 2, memo: 0, referenceAnonymous: 3,
                counts: { ...emptyDifferenceCounts(), ...counts } as never,
                differences: [],
            }],
        });
        expect(compareDiffXmiBaseline(diff({ extra: 1 }), diff({ extra: 1 })).differences).toEqual([]);
        expect(compareDiffXmiBaseline(diff({ extra: 1 }), diff({ extra: 2 })).differences.length)
            .toBeGreaterThan(0);
    });
});

withCorpus('the vendored corpus', () => {
    const corpus = HAS_CORPUS ? loadCorpus(CORPUS_DIR) : undefined!;

    it('is pinned to a commit and records a checksum for every file', () => {
        expect(corpus.manifest.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(corpus.manifest.repository).toContain('SysML-v2-Release');
        expect(corpus.manifest.digest).toMatch(/^[0-9a-f]{64}$/);
        const entries = Object.entries(corpus.manifest.files);
        expect(entries.length).toBeGreaterThan(600);
        for (const [, entry] of entries) expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('carries every tree §5.1 names', () => {
        const paths = corpus.manifest.trees.map(tree => tree.path);
        expect(paths).toEqual(expect.arrayContaining([
            'sysml.library', 'sysml.library.xmi', 'sysml.library.xmi.implied',
            'sysml.library.kpar', 'bnf', 'sysml/src', 'kerml/src',
        ]));
        for (const name of [
            'KerML-textual-bnf.kebnf', 'SysML-textual-bnf.kebnf', 'SysML-graphical-bnf.kgbnf',
        ]) {
            expect(existsSync(join(corpus.root, 'bnf', name))).toBe(true);
        }
        expect(readdirSync(join(corpus.root, 'sysml.library.kpar')).filter(n => n.endsWith('.kpar')).length)
            .toBeGreaterThan(0);
    });

    it('matches its manifest on disk', () => {
        // Sources and examples only: hashing the 150 MB of XMI on every unit
        // run costs more than the run. `--verify full` and the vendoring
        // script's `--verify` cover the rest.
        expect(verifyCorpus(corpus, [LIBRARY_SOURCE_TREE, 'sysml/src', 'kerml/src', 'bnf'])).toEqual([]);
    });

    it('records the library version every result is stamped with', () => {
        const provenance = provenanceOf(corpus);
        expect(Object.keys(provenance.libraryVersions).length).toBeGreaterThan(0);
        for (const version of Object.values(provenance.libraryVersions)) {
            expect(version).toMatch(/^\d+\.\d+\.\d+/);
        }
    });

    it('partitions into units that include the .kerml Kernel libraries', () => {
        const units = corpusUnits(corpus);
        const ids = units.map(unit => unit.id);
        expect(ids).toContain('library/systems-library');
        expect(ids).toContain('library/kernel-libraries/kernel-semantic-library');
        expect(ids).toContain('examples/sysml');
        expect(ids).toContain('examples/kerml');

        // The load-bearing one. A project walker collects `.sysml` and would
        // report a clean pass on sixteen Kernel files it never opened.
        const kernel = units.find(unit => unit.id === 'library/kernel-libraries/kernel-semantic-library')!;
        expect(kernel.files.length).toBeGreaterThan(0);
        expect(kernel.files.every(file => file.endsWith('.kerml'))).toBe(true);
    });

    it('refuses a unit selector that matches nothing', () => {
        const units = corpusUnits(corpus);
        expect(selectUnits(units, ['library']).length).toBeGreaterThan(1);
        expect(() => selectUnits(units, ['no-such-unit'])).toThrow(/No corpus unit matches/);
    });

    it('pairs a library source with its XMI counterpart', () => {
        const parts = join(corpus.root, LIBRARY_SOURCE_TREE, 'Systems Library', 'Parts.sysml');
        expect(xmiCounterpart(corpus, parts, LIBRARY_XMI_IMPLIED_TREE)).toMatch(/Parts\.sysmlx$/);
        expect(xmiCounterpart(corpus, join(corpus.root, 'nowhere.sysml'), LIBRARY_XMI_IMPLIED_TREE))
            .toBeUndefined();
    });
});

withCorpus('memo conformance run', () => {
    it('reports counts by diagnostic domain, stamped with the Release commit', async () => {
        const report = await runConformance({
            config: CONFIG,
            projectDir: CORPUS_DIR,
            corpusDir: CORPUS_DIR,
            units: ['library/kernel-libraries/kernel-data-type-library'],
            registry: defaultRegistry,
            memoVersion: memoVersion(),
            verify: 'skipped',
        });

        expect(report.corpus.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(report.corpus.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(report.units).toHaveLength(1);

        const unit = report.units[0];
        expect(unit.files).toBeGreaterThan(0);
        expect(Object.keys(unit.byDomain).sort()).toEqual(['memo-ingest', 'memo-methodology', 'sysml']);
        // Both roles ran, and each says which provider answered for it. Without
        // this the domain split is a label rather than a measurement.
        expect(unit.roles.map(role => role.role).sort()).toEqual(['lowering', 'validator']);
        for (const role of unit.roles) expect(role.provider).toBeTruthy();
        expect(report.totals.byDomain.sysml).toBe(unit.byDomain.sysml);
    }, 60_000);

    it('files every diagnostic under the unit whose sources it is about', async () => {
        const report = await runConformance({
            config: CONFIG,
            projectDir: CORPUS_DIR,
            corpusDir: CORPUS_DIR,
            units: ['library/kernel-libraries'],
            registry: defaultRegistry,
            memoVersion: memoVersion(),
            verify: 'skipped',
        });

        // Three Kernel libraries share a directory tree and an include path. If
        // attribution were by run rather than by file, each would report the
        // same total and the per-unit numbers would be one number three times —
        // which is exactly what a provider given include paths produces.
        const counts = report.units.map(unit => unit.byDomain.sysml);
        expect(counts.length).toBe(3);
        expect(new Set(counts).size).toBeGreaterThan(1);
        // With MEMO in both roles nothing outside a unit is even opened.
        expect(report.totals.outsideUnit).toBe(0);
        expect(report.totals.byDomain.sysml).toBe(counts.reduce((a, b) => a + b, 0));
    }, 60_000);

    it('refuses to report against a corpus that does not match its manifest', async () => {
        const dir = mkdtemp();
        const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf-8'));
        // One tree, one file, one deliberate corruption — enough to prove the
        // check is real without copying 150 MB.
        const [firstPath] = Object.keys(manifest.files).filter(p => p.startsWith(`${LIBRARY_SOURCE_TREE}/`));
        mkdirSync(dirname(join(dir, firstPath)), { recursive: true });
        writeFileSync(join(dir, firstPath), 'not the normative library');
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
            ...manifest,
            trees: manifest.trees.filter((t: { path: string }) => t.path === LIBRARY_SOURCE_TREE),
            files: { [firstPath]: manifest.files[firstPath] },
        }));

        await expect(runConformance({
            config: CONFIG,
            projectDir: dir,
            corpusDir: dir,
            registry: defaultRegistry,
            memoVersion: memoVersion(),
        })).rejects.toThrow(/does not match its manifest/);
        rmSync(dir, { recursive: true, force: true });
    });
});

withCorpus('memo conformance diff-xmi', () => {
    it('classifies a Kernel library against the reference implied output', async () => {
        const corpus = loadCorpus(CORPUS_DIR);
        const [source] = selectLibraries(corpus, ['ScalarValues.kerml']);
        const diff = await diffLibrary(source, corpus, {
            config: CONFIG,
            projectDir: CORPUS_DIR,
            corpusDir: CORPUS_DIR,
            registry: defaultRegistry,
            memoVersion: memoVersion(),
        });

        expect(diff.failure).toBeUndefined();
        expect(diff.impliedXmi).toMatch(/^sysml\.library\.xmi\.implied\//);
        expect(diff.declaredXmi).toMatch(/^sysml\.library\.xmi\//);
        expect(diff.referenceImplied).toBeGreaterThan(0);
        // Green-or-classified: every difference lands in a named class, and no
        // element on either side falls outside the accounting.
        for (const difference of diff.differences) {
            expect(DIFFERENCE_CLASSES).toContain(difference.class);
            expect(difference.qualifiedName).toBeTruthy();
        }
        const unmatched = diff.counts['missing-declared']
            + diff.counts['missing-implied']
            + diff.counts['qualified-name'];
        expect(unmatched).toBeLessThanOrEqual(diff.referenceImplied);
        expect(diff.counts.extra).toBeLessThanOrEqual(diff.memo);
        expect(diff.counts['differing-derived']).toBeLessThanOrEqual(diff.memo);
        // Nothing MEMO produced is left unclassified: whatever it did not match
        // to a reference element is `extra`.
        expect(diff.memo - diff.counts.extra - diff.counts['qualified-name'])
            .toBeGreaterThanOrEqual(0);
        // The internal grammar does not accept `standard library package`, so
        // today MEMO reads nothing here and the whole reference file is
        // missing. That is the measurement Track B B3 works against, not a
        // broken harness — so the identity is asserted, not the number.
        if (diff.memo === 0) expect(unmatched).toBe(diff.referenceImplied);
    }, 60_000);

    it('separates implied elements from declared ones', async () => {
        const corpus = loadCorpus(CORPUS_DIR);
        const [source] = selectLibraries(corpus, ['Parts.sysml']);
        const diff = await diffLibrary(source, corpus, {
            config: CONFIG,
            projectDir: CORPUS_DIR,
            corpusDir: CORPUS_DIR,
            registry: defaultRegistry,
            memoVersion: memoVersion(),
        });
        // `Parts` gains `*_snapshots` features only in the implied pass — the
        // exact thing `xmi.implied` exists to expose, and the reason the two
        // XMI trees are both vendored.
        expect(diff.referenceImplied).toBeGreaterThan(diff.referenceDeclared);
        expect(diff.counts['missing-implied']).toBeGreaterThan(0);
        expect(diff.counts['missing-declared']).toBeGreaterThan(0);
    }, 60_000);

    it('refuses a library selector that matches nothing', () => {
        const corpus = loadCorpus(CORPUS_DIR);
        expect(() => selectLibraries(corpus, ['NoSuchLibrary.sysml'])).toThrow(/No library source matches/);
    });
});

describe('conformance stays out of the interactive commands', () => {
    // §5.1: neither command runs inside validate, dev, build, or an Architect
    // refresh. Enforced by looking at the imports rather than by intent — this
    // is the kind of coupling that arrives by autocomplete.
    const ENTRY_POINTS = [
        'commands/validate.ts',
        'commands/dev.ts',
        'commands/pack.ts',
        'commands/check.ts',
        'operations/project-snapshot.ts',
        'server/dev-server.ts',
        'toolchain/lowering.ts',
        'toolchain/operations.ts',
    ];

    for (const entry of ENTRY_POINTS) {
        const path = join(SRC, entry);
        if (!existsSync(path)) continue;
        it(`${entry} does not import conformance`, () => {
            const source = readFileSync(path, 'utf-8');
            expect(source).not.toMatch(/from\s+['"][^'"]*conformance\/[^'"]*['"]/);
        });
    }

    it('the corpus is not reachable from the model file walkers', () => {
        // A directory named `corpus/` next to the sources would otherwise be
        // walked into by anything pointed at the repository root.
        expect(existsSync(join(SRC, 'corpus'))).toBe(false);
        expect(CORPUS_DIR).not.toContain(`${join('packages', 'tools', 'src')}`);
    });
});

function mkdtemp(): string {
    const dir = join(tmpdir(), `memo-conformance-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}
