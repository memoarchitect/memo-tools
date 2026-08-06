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
    processMemoQueryBlocks,
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
        ['dotted path', 'target.layer == "hardware"'],
    ])('refuses %s', (_label, expr) => {
        expect(parseWhereClause(expr)).toBeNull();
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

    it('rejects column aliases and dotted columns', () => {
        expect(validateQuerySpec({ columns: 'target.clauseNumber as Clause' })).not.toHaveLength(0);
        expect(validateQuerySpec({ columns: 'target.clauseNumber' })[0]).toMatch(/dotted path/);
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
