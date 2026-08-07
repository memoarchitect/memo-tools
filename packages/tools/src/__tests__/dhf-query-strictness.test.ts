// A `where:` the query engine could not parse used to return the FULL element
// set — so a compliance table that was meant to show, say, only software
// requirements silently showed every requirement in the model, and looked
// entirely plausible in the exported DHF. These tests pin the opposite
// behaviour: an unexecutable directive fails, and nothing widens silently.

import { describe, it, expect } from 'vitest';
import {
    parseMemoQuery,
    parseWhereClause,
    validateQuerySpec,
    executeQuery,
    renderQueryResult,
    processMemoQueryBlocks,
    unqualifyEnum,
    MemoQueryError,
    type MemoQuerySpec,
} from '../dhf/query-executor.js';
import { createQueryContext } from '../dhf/query-engine.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeElement(overrides: Partial<MemoElement> = {}): MemoElement {
    return {
        id: 'el-1', name: 'TestElement', kind: 'Requirement', construct: 'part',
        layer: 'implementation', file: 'test.sysml', attributes: {}, ...overrides,
    };
}

function makeModel(elements: MemoElement[] = [], relationships: MemoRelationship[] = []): MemoModel {
    const elementMap = new Map(elements.map(e => [e.id, e]));
    const elementsByKind = new Map<string, MemoElement[]>();
    const elementsByLayer = new Map<string, MemoElement[]>();
    for (const el of elements) {
        if (!elementsByKind.has(el.kind)) elementsByKind.set(el.kind, []);
        elementsByKind.get(el.kind)!.push(el);
        if (!elementsByLayer.has(el.layer)) elementsByLayer.set(el.layer, []);
        elementsByLayer.get(el.layer)!.push(el);
    }
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of relationships) {
        if (!relationshipsByType.has(rel.type)) relationshipsByType.set(rel.type, []);
        relationshipsByType.get(rel.type)!.push(rel);
        if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
        outgoing.get(rel.sourceId)!.push(rel);
        if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
        incoming.get(rel.targetId)!.push(rel);
    }
    return { elements: elementMap, relationships, errors: [], elementsByKind, elementsByLayer, relationshipsByType, outgoing, incoming };
}

const validation: ValidationResult = { violations: [], rulesEvaluated: 0, rulesPassed: 0, timestamp: 0 };
const completeness: CompletenessReport = { layers: [], overall: 100, totalElements: 0, completeElements: 0, elementStatus: {} };

function makeCtx(elements: MemoElement[], relationships: MemoRelationship[] = []) {
    return createQueryContext(
        makeModel(elements, relationships),
        validation,
        completeness,
        { projectName: 'Test Project' },
    );
}

const THREE_REQUIREMENTS = [
    makeElement({ id: 'r1', name: 'Pump rate accuracy', layer: 'implementation' }),
    makeElement({ id: 'r2', name: 'Enclosure ingress', layer: 'logical' }),
    makeElement({ id: 'r3', name: 'Alarm latency', layer: 'functional' }),
];

// ─── where: parsing ──────────────────────────────────────────────────────────

describe('parseWhereClause', () => {
    it('parses the three supported comparisons', () => {
        expect(parseWhereClause('layer == "logical"')).toEqual({ field: 'layer', op: '==', value: 'logical' });
        expect(parseWhereClause('layer != "logical"')).toEqual({ field: 'layer', op: '!=', value: 'logical' });
        expect(parseWhereClause('doc contains "shall"')).toEqual({ field: 'doc', op: 'contains', value: 'shall' });
    });

    it.each([
        ['boolean and', 'layer == "software" and name contains "emc"'],
        ['boolean or', 'name contains "emc" or name contains "electromagnetic"'],
        ['parenthesised group', 'layer == "hardware" and (name contains "emc" or name contains "power")'],
        ['starts with', 'target.clauseNumber starts with "62304"'],
    ])('refuses %s', (_label, expr) => {
        expect(parseWhereClause(expr)).toBeNull();
    });

    // A dotted path parses — it means something on a relationship row. Whether
    // it is legal is `validateQuerySpec`'s call, not the parser's.
    it('parses a dotted endpoint path', () => {
        expect(parseWhereClause('target.layer == "hardware"'))
            .toEqual({ field: 'target.layer', op: '==', value: 'hardware' });
    });
});

describe('executeQuery — the silent-unfilter regression', () => {
    it('does not return every element when the filter cannot be parsed', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const spec: MemoQuerySpec = {
            kind: 'Requirement',
            where: 'layer == "hardware" and (name contains "emc" or name contains "power")',
        };
        expect(() => executeQuery(spec, ctx)).toThrow(MemoQueryError);
    });

    it('still filters correctly when the filter is supported', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const result = executeQuery({ kind: 'Requirement', where: 'layer == "logical"' }, ctx);
        expect(result.map(e => e.id)).toEqual(['r2']);
    });

    it('names the source in the error so the block is locatable', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        expect(() => executeQuery({ where: 'a and b' }, ctx, 'iec-60601/hrs'))
            .toThrow(/iec-60601\/hrs/);
    });
});

// ─── spec validation ─────────────────────────────────────────────────────────

describe('validateQuerySpec', () => {
    it('accepts an executable spec', () => {
        expect(validateQuerySpec({ kind: 'Requirement', where: 'layer == "logical"', display: 'table', columns: 'name, doc' })).toEqual([]);
    });

    it('rejects sort directions, which were silently ignored', () => {
        expect(validateQuerySpec({ sort: 'severity desc' })).toHaveLength(1);
        expect(validateQuerySpec({ sort: 'severity desc' })[0]).toMatch(/desc/);
    });

    it('rejects column aliases, and dotted columns on an element query', () => {
        expect(validateQuerySpec({ columns: 'target.clauseNumber as Clause' })).not.toHaveLength(0);
        expect(validateQuerySpec({ columns: 'target.clauseNumber' })[0]).toMatch(/select: relationships/);
    });

    it('rejects an unknown display mode instead of falling back to a table', () => {
        expect(validateQuerySpec({ display: 'chart' as never })[0]).toMatch(/unknown `display/);
    });

    it('rejects an unknown directive, catching typos', () => {
        expect(validateQuerySpec({ 'group-by': 'layer' } as never)[0]).toMatch(/unknown directive/);
    });

    it('rejects a PascalCase traverse type, which matches nothing at runtime', () => {
        const problems = validateQuerySpec({ traverse: 'outgoing ConformsTo' });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/conformsTo/);
    });

    it('accepts a lower-camel traverse type', () => {
        expect(validateQuerySpec({ traverse: 'outgoing conformsTo' })).toEqual([]);
    });
});

// ─── select: relationships ───────────────────────────────────────────────────
//
// `kind:` used to resolve only against the element index, so `kind: ConformsTo`
// selected nothing — silently. Every clause-conformance and allocation table in
// the shipped DHF templates has that shape, which made them structurally
// unrenderable rather than merely empty.

describe('select: relationships', () => {
    const CLAUSES = [
        makeElement({ id: 'c8', name: 'IEC60601_1Clause8', kind: 'StandardClause', layer: 'artifacts',
            package: 'memo_artifacts_standards_iec_60601_1',
            attributes: { clauseNumber: '8', title: 'protection against electrical hazards' } }),
        makeElement({ id: 'c14', name: 'IEC60601_1Clause14', kind: 'StandardClause', layer: 'artifacts',
            package: 'memo_artifacts_standards_iec_60601_1',
            attributes: { clauseNumber: '14', title: 'programmable electrical medical systems' } }),
        makeElement({ id: 'c522', name: 'IEC62304Clause5_2_2', kind: 'StandardClause', layer: 'artifacts',
            package: 'memo_artifacts_standards_iec_62304',
            attributes: { clauseNumber: '5.2.2', title: 'software requirements content' } }),
    ];
    const CLAIMANTS = [
        makeElement({ id: 'battery', name: 'BatteryPack', kind: 'HardwareAssembly', layer: 'implementation' }),
        makeElement({ id: 'sw', name: 'GPCA_Software', kind: 'SoftwareSystem', layer: 'implementation' }),
        makeElement({ id: 'r1', name: 'OcclusionDetection', kind: 'Requirement', layer: 'implementation' }),
    ];
    const doc = makeElement({ id: 'docSrs', name: 'SoftwareRequirementsSpecification', kind: 'MarkdownDocumentSource', layer: 'artifacts' });

    function rel(id: string, type: string, sourceId: string, targetId: string, attributes: Record<string, string> = {}): MemoRelationship {
        return { id, type, sourceId, sourceEnd: 'a', targetId, targetEnd: 'b', file: 'x.sysml', attributes };
    }
    const RELS = [
        rel('l1', 'conformsTo', 'battery', 'c8'),
        rel('l2', 'conformsTo', 'sw', 'c14'),
        rel('l3', 'conformsTo', 'r1', 'c522'),
        rel('l4', 'tracesToDocument', 'c522', 'docSrs', { sectionReference: '3' }),
        rel('l5', 'allocatedTo', 'sw', 'battery'),
    ];
    const ctx = () => makeCtx([...CLAUSES, ...CLAIMANTS, doc], RELS);

    it('selects links by relationship type, which an element query never could', () => {
        const rows = executeQuery({ select: 'relationships', kind: 'conformsTo' }, ctx());
        expect(rows.map(r => r.id)).toEqual(['l1', 'l2', 'l3']);
    });

    it('selects every link when no kind is given', () => {
        expect(executeQuery({ select: 'relationships' }, ctx())).toHaveLength(5);
    });

    it('rejects the PascalCase type instead of matching nothing', () => {
        // `AllocatedTo` is stored as `allocatedTo`; the def-name spelling is a
        // silent empty table, so it is an error naming the fix.
        const problems = validateQuerySpec({ select: 'relationships', kind: 'ConformsTo' });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/use `conformsTo`/);
    });

    it('filters on an endpoint field through a dotted path', () => {
        const rows = executeQuery({
            select: 'relationships', kind: 'conformsTo',
            where: 'target.package == "memo_artifacts_standards_iec_60601_1"',
        }, ctx());
        expect(rows.map(r => r.id)).toEqual(['l1', 'l2']);
    });

    it('renders both ends, and reads a column off the link itself', () => {
        const out = renderQueryResult(
            { select: 'relationships', kind: 'tracesToDocument', columns: 'source.clauseNumber, target, sectionReference' },
            executeQuery({ select: 'relationships', kind: 'tracesToDocument' }, ctx()),
            ctx(),
        );
        expect(out).toContain('| 5.2.2 | SoftwareRequirementsSpecification | 3 |');
    });

    it('names the endpoints when no columns are given', () => {
        const out = renderQueryResult(
            { select: 'relationships', kind: 'allocatedTo' },
            executeQuery({ select: 'relationships', kind: 'allocatedTo' }, ctx()),
            ctx(),
        );
        expect(out).toContain('| GPCA_Software | allocatedTo | BatteryPack |');
    });

    // Clause 14 sorted above clause 8 under a plain string compare, which reads
    // as a broken conformance matrix.
    it('sorts numbered fields numerically', () => {
        const rows = executeQuery({
            select: 'relationships', kind: 'conformsTo',
            where: 'target.package == "memo_artifacts_standards_iec_60601_1"',
            sort: 'target.clauseNumber',
        }, ctx());
        expect(rows.map(r => r.id)).toEqual(['l1', 'l2']);
    });

    it('groups by an endpoint field', () => {
        const out = renderQueryResult(
            { select: 'relationships', kind: 'conformsTo', display: 'grouped', group_by: 'source.kind' },
            executeQuery({ select: 'relationships', kind: 'conformsTo' }, ctx()),
            ctx(),
        );
        expect(out).toContain('**HardwareAssembly** (1)');
        expect(out).toContain('**Requirement** (1)');
    });

    it('refuses traverse, which has no seed to walk from', () => {
        expect(validateQuerySpec({ select: 'relationships', kind: 'conformsTo', traverse: 'outgoing composes' })[0])
            .toMatch(/cannot be combined with `select: relationships`/);
    });

    it('refuses a dotted path that names neither end', () => {
        expect(validateQuerySpec({ select: 'relationships', where: 'clause.clauseNumber == "8"' })[0])
            .toMatch(/must start with `source\.` or `target\.`/);
    });

    it('refuses an unknown select value rather than falling back to elements', () => {
        expect(validateQuerySpec({ select: 'links' as never })[0]).toMatch(/unknown `select/);
    });

    it('still rejects dotted paths on an element query', () => {
        expect(validateQuerySpec({ kind: 'Requirement', where: 'target.layer == "logical"' })[0])
            .toMatch(/add `select: relationships`/);
    });

    // The enum spelling rule is about the value, not about which side of a link
    // it sits on.
    it('reports an unqualified enum value on an endpoint field', () => {
        const el = makeElement({ id: 'r2', name: 'Req', attributes: { requirementKind: 'RequirementKind::software' } });
        const c = makeCtx([el, ...CLAUSES], [rel('l9', 'conformsTo', 'r2', 'c522')]);
        expect(() => executeQuery(
            { select: 'relationships', kind: 'conformsTo', where: 'source.requirementKind == "software"' }, c))
            .toThrow(/write `source.requirementKind == "RequirementKind::software"`/);
    });
});

// ─── enum-qualified values ───────────────────────────────────────────────────

describe('enum-qualified comparison', () => {
    // Every enum-typed attribute in the ontology and its exemplars is written
    // qualified, so the model holds "RequirementKind::software" and that is THE
    // spelling a template uses. Accepting the bare member name too would mean
    // two spellings for one value, and would cost the reader the only clue to
    // which enum is meant: `criticality == "high"` and `severity == "high"` are
    // indistinguishable, `CriticalityKind::high` is not.
    const MIXED_KINDS = [
        makeElement({ id: 'q1', name: 'Alarm latency', attributes: { requirementKind: 'RequirementKind::software' } }),
        makeElement({ id: 'q2', name: 'Enclosure ingress', attributes: { requirementKind: 'RequirementKind::hardware' } }),
        makeElement({ id: 'q3', name: 'Dose accuracy', attributes: { requirementKind: 'RequirementKind::system' } }),
    ];

    it('filters on the qualified value', () => {
        const ctx = makeCtx(MIXED_KINDS);
        const result = executeQuery(
            { kind: 'Requirement', where: 'requirementKind == "RequirementKind::software"' }, ctx);
        expect(result.map(e => e.id)).toEqual(['q1']);
    });

    it('inverts correctly, so != is the complement and not everything', () => {
        const ctx = makeCtx(MIXED_KINDS);
        const result = executeQuery(
            { kind: 'Requirement', where: 'requirementKind != "RequirementKind::software"' }, ctx);
        expect(result.map(e => e.id)).toEqual(['q2', 'q3']);
    });

    // The bare form matched nothing and rendered the `empty:` message. Exact
    // comparison alone would keep that silence, so it is an error naming the
    // spelling the author meant — the filter is never evaluated on a guess.
    it('rejects a bare member name and names the qualified spelling', () => {
        const ctx = makeCtx(MIXED_KINDS);
        expect(() => executeQuery({ kind: 'Requirement', where: 'requirementKind == "software"' }, ctx))
            .toThrow(/write `requirementKind == "RequirementKind::software"`/);
    });

    it('rejects a bare member name on != too, where the silence looks like everything', () => {
        const ctx = makeCtx(MIXED_KINDS);
        expect(() => executeQuery({ kind: 'Requirement', where: 'requirementKind != "software"' }, ctx))
            .toThrow(MemoQueryError);
    });

    // A value that is no member of anything stored is an ordinary miss, not a
    // spelling problem — the lint catches the typo against the ontology.
    it('leaves a non-enum comparison alone', () => {
        const ctx = makeCtx(MIXED_KINDS);
        expect(executeQuery({ kind: 'Requirement', where: 'requirementKind == "firmware"' }, ctx)).toEqual([]);
        expect(executeQuery({ kind: 'Requirement', where: 'layer == "implementation"' }, ctx)).toHaveLength(3);
    });

    it('unqualifies only when there is a qualifier', () => {
        expect(unqualifyEnum('RequirementKind::software')).toBe('software');
        expect(unqualifyEnum('software')).toBe('software');
    });
});

// ─── block processing ────────────────────────────────────────────────────────

describe('processMemoQueryBlocks', () => {
    const block = [
        '```memo-query',
        'kind: Requirement',
        'where: layer == "hardware" and name contains "emc"',
        '```',
    ].join('\n');

    it('throws by default, so a bad table cannot reach an exported document', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        expect(() => processMemoQueryBlocks(block, ctx, { source: 'iec-60601/hrs' })).toThrow(MemoQueryError);
    });

    it('annotates in-place when asked, for previews', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const out = processMemoQueryBlocks(block, ctx, { source: 'iec-60601/hrs', onError: 'annotate' });
        expect(out).toMatch(/⚠️/);
        expect(out).toMatch(/boolean composition/);
        // The unfiltered table must not appear in its place.
        expect(out).not.toMatch(/Enclosure ingress/);
    });

    it('numbers blocks so a multi-query template points at the right one', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const twoBlocks = [
            '```memo-query',
            'kind: Requirement',
            '```',
            '',
            block,
        ].join('\n');
        const out = processMemoQueryBlocks(twoBlocks, ctx, { source: 'x', onError: 'annotate' });
        expect(out).toMatch(/memo-query block 2/);
    });

    it('renders normally when every block is executable', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const good = ['```memo-query', 'kind: Requirement', 'where: layer == "logical"', 'columns: name', '```'].join('\n');
        const out = processMemoQueryBlocks(good, ctx, { source: 'x' });
        expect(out).toMatch(/Enclosure ingress/);
        expect(out).not.toMatch(/Alarm latency/);
    });

    // A relationship-shaped table cannot render until `select: relationships`
    // exists. Parking it behind an HTML comment with a visible TODO is the
    // honest way to ship the section — so the executor must leave it alone
    // rather than throwing on it or, worse, rendering a table inside a comment.
    const parked = [
        '<!-- _[TODO: requires `select: relationships`]_',
        block,
        '-->',
        '',
        '_[TODO: requires `select: relationships`]_',
    ].join('\n');

    it('leaves a parked block untouched instead of throwing', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const out = processMemoQueryBlocks(parked, ctx, { source: 'system/standards-traceability' });
        expect(out).toBe(parked);
    });

    it('numbers only live blocks, so the reported index matches the document', () => {
        const ctx = makeCtx(THREE_REQUIREMENTS);
        const out = processMemoQueryBlocks(
            parked + '\n\n' + block, ctx,
            { source: 'x', onError: 'annotate' },
        );
        expect(out).toMatch(/memo-query block 1/);
        expect(out).not.toMatch(/memo-query block 2/);
    });
});

// ─── the block parser itself ─────────────────────────────────────────────────

describe('parseMemoQuery', () => {
    it('returns null for a block that is not YAML', () => {
        expect(parseMemoQuery(':::not: [valid')).toBeNull();
    });
});
