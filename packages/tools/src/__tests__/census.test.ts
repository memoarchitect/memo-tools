import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCensus, compareCensus, formatCensusFindings, type ProjectCensus } from '../model/census.js';
import { censusSubjects, censusOf } from '../model/census-projects.js';
import { toElementIndex } from '../model/element-index.js';
import type { MemoElement, MemoModel, MemoRelationship } from '../model/semantic.js';

// ─── The unit half: the comparison's rules ──────────────────────────────────

function element(id: string, kind: string, file: string, isDefinition = false): MemoElement {
    return { id, name: id, kind, construct: 'part', layer: 'logical', file, attributes: {}, isDefinition } as MemoElement;
}

function relationship(type: string, file: string): MemoRelationship {
    return { id: `rel-${type}-${file}`, type, sourceId: 'a', targetId: 'b', sourceEnd: '', targetEnd: '', file } as MemoRelationship;
}

function modelOf(options: {
    elements?: MemoElement[];
    relationships?: MemoRelationship[];
    packages?: { file: string }[];
    errors?: { file: string; message: string; code?: string }[];
}): MemoModel {
    return {
        elements: toElementIndex(options.elements ?? []),
        relationships: options.relationships ?? [],
        packages: options.packages ?? [],
        errors: options.errors ?? [],
    } as unknown as MemoModel;
}

const root = '/checkout/project';

describe('computeCensus', () => {
    it('counts elements per file and per kind, with paths relative to the project', () => {
        const census = computeCensus(modelOf({
            elements: [
                element('a', 'Hazard', `${root}/model/risk.sysml`),
                element('b', 'Hazard', `${root}/model/risk.sysml`),
                element('c', 'Requirement', `${root}/model/reqs.sysml`),
                element('Pump', 'LogicalComponent', `${root}/model/reqs.sysml`, true),
            ],
        }), { project: 'p', projectRoot: root });

        expect(Object.keys(census.files)).toEqual(['model/reqs.sysml', 'model/risk.sysml']);
        expect(census.files['model/risk.sysml']).toMatchObject({ elements: 2, kinds: { Hazard: 2 } });
        expect(census.files['model/reqs.sysml']).toMatchObject({ elements: 2, definitions: 1 });
        expect(census.totals).toMatchObject({ files: 2, elements: 4, definitions: 1 });
    });

    it('counts relationships by type, packages, and the two error classes apart', () => {
        const census = computeCensus(modelOf({
            relationships: [relationship('flow', `${root}/model/arch.sysml`), relationship('composes', `${root}/model/arch.sysml`)],
            packages: [{ file: `${root}/model/arch.sysml` }],
            errors: [
                { file: `${root}/model/arch.sysml`, message: 'unexpected token' },
                { file: `${root}/model/arch.sysml`, message: 'two elements named p', code: 'element-name-collision' },
                // No code, and still the builder's: this is the shape 73 of
                // gpca-pump's findings have.
                { file: `${root}/model/arch.sysml`, message: '[well-formedness] Relationship "conformsTo" expects …' },
            ],
        }), { project: 'p', projectRoot: root });

        expect(census.files['model/arch.sysml']).toMatchObject({
            relationships: 2,
            relationshipTypes: { composes: 1, flow: 1 },
            packages: 1,
            parseErrors: 1,
            builderFindings: 2,
        });
    });
});

describe('compareCensus', () => {
    const baseline = computeCensus(modelOf({
        elements: [
            element('a', 'Hazard', `${root}/model/risk.sysml`),
            element('b', 'Hazard', `${root}/model/risk.sysml`),
            element('c', 'Requirement', `${root}/model/reqs.sysml`),
        ],
    }), { project: 'p', projectRoot: root });

    it('passes an unchanged model', () => {
        expect(compareCensus(baseline, baseline)).toEqual([]);
    });

    it('reports a file that lost elements as a drop, naming the kind', () => {
        const current = computeCensus(modelOf({
            elements: [
                element('a', 'Hazard', `${root}/model/risk.sysml`),
                element('c', 'Requirement', `${root}/model/reqs.sysml`),
            ],
        }), { project: 'p', projectRoot: root });

        const findings = compareCensus(baseline, current);

        expect(findings.filter(f => f.severity === 'rise')).toEqual([]);
        expect(findings).toContainEqual(expect.objectContaining({
            severity: 'drop', file: 'model/risk.sysml', measure: 'kind:Hazard', baseline: 2, current: 1,
        }));
        expect(findings).toContainEqual(expect.objectContaining({
            severity: 'drop', file: '(totals)', measure: 'elements', baseline: 3, current: 2,
        }));
    });

    it('reports a file gone from the model as one finding, not one per kind', () => {
        const current = computeCensus(modelOf({
            elements: [element('c', 'Requirement', `${root}/model/reqs.sysml`)],
        }), { project: 'p', projectRoot: root });

        const findings = compareCensus(baseline, current).filter(f => f.file === 'model/risk.sysml');

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: 'drop', measure: 'file', baseline: 2, current: 0 });
        expect(findings[0].message).toContain('gone from the model');
    });

    // The 2026-09-19 measurement, in miniature: the file still parses into
    // SOMETHING, so nothing else in the build says a word about it.
    it('fails a 124 → 2 collapse', () => {
        const many = Array.from({ length: 124 }, (_, i) => element(`e${i}`, 'Requirement', `${root}/model/srs.sysml`));
        const before = computeCensus(modelOf({ elements: many }), { project: 'p', projectRoot: root });
        const after = computeCensus(modelOf({ elements: many.slice(0, 2) }), { project: 'p', projectRoot: root });

        const findings = compareCensus(before, after);

        expect(findings.some(f => f.severity === 'drop')).toBe(true);
        expect(formatCensusFindings(findings)).toContain('model/srs.sysml: elements 124 → 2');
    });

    it('treats a rise in elements as reportable and a rise in parse errors as a failure', () => {
        const grown = computeCensus(modelOf({
            elements: [
                element('a', 'Hazard', `${root}/model/risk.sysml`),
                element('b', 'Hazard', `${root}/model/risk.sysml`),
                element('d', 'Hazard', `${root}/model/risk.sysml`),
                element('c', 'Requirement', `${root}/model/reqs.sysml`),
            ],
            errors: [{ file: `${root}/model/reqs.sysml`, message: 'unexpected token' }],
        }), { project: 'p', projectRoot: root });

        const findings = compareCensus(baseline, grown);

        expect(findings).toContainEqual(expect.objectContaining({
            severity: 'rise', file: 'model/risk.sysml', measure: 'kind:Hazard', baseline: 2, current: 3,
        }));
        expect(findings).toContainEqual(expect.objectContaining({
            severity: 'drop', file: 'model/reqs.sysml', measure: 'parseErrors', baseline: 0, current: 1,
        }));
    });
});

// ─── The gate half: the shipped examples against their frozen counts ────────

const EXAMPLES = resolve(__dirname, '../../../../../memo/examples');
const BASELINES = resolve(__dirname, 'fixtures/census');
const REFREEZE = 'Re-freeze deliberately with `pnpm census:capture`, and say in the commit what left the model and why.';

/**
 * Drops a compiler's API JSON causes, by compiler and project: counts the model
 * holds less of than the baseline, because that compiler writes the construct
 * with another metaclass than the OMG grammar gives it. Exactly these drops, and
 * still there: when the compiler conforms the entry fails and goes.
 *
 * OpenSysML (develop, 2026-10-04), `sysml-diagram-samples`:
 * - `action x accept p : T;` and `action x send e to r;` are one
 *   `AcceptActionUsage` and one `SendActionUsage` (`SysML-textual-bnf.kebnf:1006-1011`,
 *   `:1056-1063`); it writes a plain `ActionUsage` (the send node as a nameless
 *   child of it), so both kinds and the succession into the send are lost.
 * - `include u;` is an `IncludeUseCaseUsage` related to the included use case by a
 *   `ReferenceSubsetting` (the metamodel's documentation of `IncludeUseCaseUsage`);
 *   it writes a non-standard `includes` property, so no `includesStep` is built.
 */
const KNOWN_UPSTREAM_DROPS: Record<string, Record<string, string[]>> = {
    opensysml: {
        'sysml-diagram-samples': [
            '(totals): relationships',
            'model/catalog/viewpoints/unassigned/views/use_case_view.sysml: relationships',
            'model/catalog/viewpoints/unassigned/views/use_case_view.sysml: relationshipType:includesStep',
            'model/sysml_v2_activity_example.sysml: relationships',
            'model/sysml_v2_activity_example.sysml: kind:AcceptActionUsage',
            'model/sysml_v2_activity_example.sysml: kind:SendActionUsage',
            'model/sysml_v2_activity_example.sysml: relationshipType:succession',
        ],
    },
};

describe('the shipped examples still contain what the baseline recorded', () => {
    const subjects = censusSubjects(EXAMPLES);

    // The sibling ontology checkout is not present in every consumer install.
    // Skipping there is correct; failing would be noise.
    if (subjects.length === 0) {
        it.skip('no example projects found — the memo checkout is not beside this one', () => { });
        return;
    }

    it('every frozen baseline still has a project to count', () => {
        const frozen = existsSync(BASELINES)
            ? readdirSync(BASELINES).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
            : [];
        const ids = new Set(subjects.map(s => s.id));
        // A baseline whose project disappeared is the whole drop, one directory
        // up: the per-file comparison below never runs for a project that is no
        // longer a subject, so nothing else would notice.
        expect(frozen.filter(id => !ids.has(id)), `Frozen census with no project left to count. ${REFREEZE}`)
            .toEqual([]);
    });

    for (const subject of subjects) {
        it(`${subject.id}`, async () => {
            const baselinePath = resolve(BASELINES, `${subject.id}.json`);
            expect(existsSync(baselinePath),
                `No census baseline for ${subject.id}. Capture one with \`pnpm census:capture\`.`).toBe(true);
            const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as ProjectCensus;

            const findings = compareCensus(baseline, await censusOf(subject));
            const known = KNOWN_UPSTREAM_DROPS[process.env.MEMO_TOOLCHAIN_COMPILER ?? '']?.[subject.id];
            const dropped = findings.filter(f => f.severity === 'drop');
            if (known) {
                // Exactly the recorded gap, and still there.
                expect(dropped.map(f => `${f.file}: ${f.measure}`).sort(),
                    `${subject.id}'s recorded upstream gap changed; update or remove KNOWN_UPSTREAM_DROPS`).toEqual([...known].sort());
                return;
            }
            const drops = dropped;

            // `expect.fail` rather than an assertion on the array: a
            // shared-definition change moves hundreds of counts, and the
            // formatted report is what a reader needs — not a structural diff
            // of every finding object below it.
            if (drops.length > 0) {
                expect.fail(`${subject.id} lost model content:\n${formatCensusFindings(findings)}\n\n${REFREEZE}\n`);
            }
            if (findings.length > 0) {
                console.warn(`census: ${subject.id} gained content\n${formatCensusFindings(findings)}`);
            }
            expect(drops).toEqual([]);
        }, 120_000);
    }
});
