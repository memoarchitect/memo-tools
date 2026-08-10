import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { collectNativeConstraints } from '../validator/constraint-loader.js';
import { evaluateConstraintNode, type CompiledConstraint } from '../validator/constraint-eval.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Track A0: the relation-end rules must actually fire ─────────────────────
//
// A0 removed the TYPES from the ends of SatisfiedBy, VerifiedBy, AllocatedTo,
// Composes, Precedes, Performs, Enables, BindsToInterface,
// CrossesTrustBoundary, and ComponentExchange's endpoint refs, because a
// part-typed end cannot admit a port or a behaviour and that is what blocks the
// whole of Track A. The constraints those types carried moved into
// CR-ONT-060..073 in memo/src/rules/ontology/ontology_invariants.sysml.
//
// That trade is only sound if the rules are real constraints. A rule that never
// fires is not a constraint — it is a comment that costs CPU — and a green
// suite proves nothing here, because every model in the tree is valid. So each
// rule is exercised twice: once against a model it must accept, and once
// against a model it must reject.
//
// The rule TEXT is the shipped ontology's, read from memo/src at test time and
// never restated here. If someone weakens CR-ONT-064 to `true`, this test goes
// red on the invalid model rather than passing against a copy that still says
// the right thing.
// ─────────────────────────────────────────────────────────────────────────────

const GPCA_PROJECT = resolve(__dirname, '../../../../../memo/examples/gpca-pump');

/** The rules A0 introduced, in declaration order. */
const A0_RULES = [
    'CR-ONT-060', 'CR-ONT-061', 'CR-ONT-062', 'CR-ONT-063', 'CR-ONT-064',
    'CR-ONT-065', 'CR-ONT-066', 'CR-ONT-067', 'CR-ONT-068', 'CR-ONT-069',
    'CR-ONT-070', 'CR-ONT-071', 'CR-ONT-072', 'CR-ONT-073',
];

/**
 * The functional-chain rules, which exist because A0 made an action-def
 * function possible at all. They are what makes ComponentFunction a definition
 * rather than an enum member: an enum value cannot change a multiplicity.
 */
const FUNCTION_RULES = ['CR-ONT-074', 'CR-ONT-075'];

/**
 * Elements typed with REAL ontology kinds, because `conformsTo` resolves
 * through the real specialization graph. A made-up kind would conform to
 * nothing and every rule would "fire" for the wrong reason.
 */
const ELEMENTS: Array<[id: string, kind: string, construct: string]> = [
    ['req', 'Requirement', 'requirement'],
    ['mod', 'SoftwareModule', 'part'],
    ['fn', 'SystemFunction', 'action'],
    ['cfn', 'ComponentFunction', 'action'],
    ['act', 'OperationalActivity', 'action'],
    ['act2', 'OperationalActivity', 'action'],
    ['user', 'User', 'part'],
    // `port`, not `part`, since Track A1: PhysicalPort is a `port def`. The
    // rules that accept it (CR-ONT-066, CR-ONT-070) already read
    // `construct == 'port'` — A0 wrote them for the metaclass A1 delivers.
    ['port', 'PhysicalPort', 'port'],
    ['iface', 'Interface', 'interface'],
    ['vcase', 'VerificationCase', 'verification'],
    ['boundary', 'TrustBoundary', 'part'],
    ['asset', 'CybersecurityAsset', 'part'],
];

interface RelSpec { type: string; from: string; to: string }

/** Links every A0 rule must accept. */
const VALID_LINKS: RelSpec[] = [
    { type: 'satisfiedBy', from: 'req', to: 'mod' },            // 060 source, 061 target
    { type: 'verifiedBy', from: 'req', to: 'vcase' },           // 062
    { type: 'allocatedTo', from: 'fn', to: 'mod' },             // 063, 064
    { type: 'composes', from: 'mod', to: 'port' },              // 065, 066
    { type: 'precedes', from: 'act', to: 'act2' },              // 067
    { type: 'performs', from: 'user', to: 'act' },              // 068
    { type: 'enables', from: 'mod', to: 'act' },                // 069
    { type: 'bindsToInterface', from: 'port', to: 'iface' },    // 070
    { type: 'crossesTrustBoundary', from: 'boundary', to: 'asset' }, // 071
    // The functional chain: a system function decomposes into a component
    // function, which is allocated to exactly one component. 074 and 075.
    { type: 'composes', from: 'fn', to: 'cfn' },
    { type: 'allocatedTo', from: 'cfn', to: 'mod' },
];

/**
 * One deliberately wrong link per rule, and the rule it must be caught by.
 *
 * Each is a statement a modeller could plausibly write and that the removed end
 * type used to refuse: a module "satisfied by" nothing sensible, a requirement
 * allocated somewhere, an interface being verified.
 */
const INVALID_LINKS: Array<{ rule: string; link: RelSpec }> = [
    { rule: 'CR-ONT-060', link: { type: 'satisfiedBy', from: 'mod', to: 'fn' } },
    { rule: 'CR-ONT-061', link: { type: 'satisfiedBy', from: 'req', to: 'req' } },
    { rule: 'CR-ONT-062', link: { type: 'verifiedBy', from: 'iface', to: 'vcase' } },
    { rule: 'CR-ONT-063', link: { type: 'allocatedTo', from: 'req', to: 'mod' } },
    { rule: 'CR-ONT-064', link: { type: 'allocatedTo', from: 'fn', to: 'req' } },
    { rule: 'CR-ONT-065', link: { type: 'composes', from: 'req', to: 'mod' } },
    { rule: 'CR-ONT-066', link: { type: 'composes', from: 'mod', to: 'req' } },
    { rule: 'CR-ONT-067', link: { type: 'precedes', from: 'req', to: 'act' } },
    { rule: 'CR-ONT-068', link: { type: 'performs', from: 'req', to: 'act' } },
    { rule: 'CR-ONT-069', link: { type: 'enables', from: 'req', to: 'act' } },
    { rule: 'CR-ONT-070', link: { type: 'bindsToInterface', from: 'mod', to: 'iface' } },
    { rule: 'CR-ONT-071', link: { type: 'crossesTrustBoundary', from: 'mod', to: 'asset' } },
];

function buildModel(links: RelSpec[], exchangeEndpoints?: { source: string; target: string }): MemoModel {
    const elements = new Map<string, MemoElement>();
    for (const [id, kind, construct] of ELEMENTS) {
        elements.set(id, { id, name: id, kind, construct, layer: 'test', file: '', attributes: {} } as MemoElement);
    }
    if (exchangeEndpoints) {
        elements.set('exch', {
            id: 'exch', name: 'exch', kind: 'ComponentExchange', construct: 'part', layer: 'test', file: '',
            attributes: { sourceEndpoint: exchangeEndpoints.source, targetEndpoint: exchangeEndpoints.target },
        } as MemoElement);
    }

    const elementsByKind = new Map<string, MemoElement[]>();
    for (const element of elements.values()) {
        elementsByKind.set(element.kind, [...(elementsByKind.get(element.kind) ?? []), element]);
    }

    const relationships: MemoRelationship[] = links.map((link, index) => ({
        id: `rel-${index}`, type: link.type, sourceId: link.from, targetId: link.to,
    } as MemoRelationship));
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    for (const relationship of relationships) {
        outgoing.set(relationship.sourceId, [...(outgoing.get(relationship.sourceId) ?? []), relationship]);
        incoming.set(relationship.targetId, [...(incoming.get(relationship.targetId) ?? []), relationship]);
        relationshipsByType.set(relationship.type, [...(relationshipsByType.get(relationship.type) ?? []), relationship]);
    }
    return { elements, elementsByKind, relationships, relationshipsByType, outgoing, incoming } as MemoModel;
}

let rules: Map<string, CompiledConstraint>;
let kindRegistry: KindRegistry | undefined;
const available = existsSync(GPCA_PROJECT);

beforeAll(async () => {
    if (!available) return;
    const loaded = await loadOntologyRegistries(GPCA_PROJECT);
    kindRegistry = loaded.registries.kindRegistry;
    const diagnostics: Parameters<typeof collectNativeConstraints>[1] = [];
    const constraints = collectNativeConstraints(loaded.parsedDocuments ?? [], diagnostics);
    // A rule that fails to COMPILE is skipped by the loader and reported. That
    // failure mode is exactly how a strictness rule silently stops constraining
    // anything, so it fails the test rather than reducing the rule set.
    const broken = diagnostics.filter(d => A0_RULES.includes(d.ruleId));
    expect(broken.map(d => `${d.ruleId}: ${d.message}`), 'A0 rules failed to compile').toEqual([]);
    rules = new Map(constraints.map(constraint => [constraint.id, constraint]));
}, 120_000);

describe('Track A0 relation-end rules', () => {
    it('all sixteen are declared in the ontology', () => {
        if (!available) return;
        expect([...A0_RULES, ...FUNCTION_RULES].filter(id => !rules.has(id))).toEqual([]);
    });

    it('accepts a model whose ends are all well typed', () => {
        if (!available) return;
        const model = buildModel(VALID_LINKS, { source: 'mod', target: 'port' });
        const raised = [...A0_RULES, ...FUNCTION_RULES].flatMap(id =>
            evaluateConstraintNode(rules.get(id)!, rules.get(id)!.ast, model, kindRegistry));
        const detail = raised.map(v => `${v.ruleId}: ${v.description}`).join('\n  ');
        expect(raised.map(v => v.ruleId), `Valid model rejected:\n  ${detail}\n`).toEqual([]);
    });

    for (const { rule, link } of INVALID_LINKS) {
        it(`${rule} rejects ${link.type} ${link.from} → ${link.to}`, () => {
            if (!available) return;
            const constraint = rules.get(rule)!;
            const model = buildModel([...VALID_LINKS, link]);
            const raised = evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry);
            expect(raised.map(v => v.ruleId)).toContain(rule);
        });
    }

    // CR-ONT-072/073 replace CR-ONT-002. ComponentExchange's endpoints are
    // `ref` features rather than links, so they are checked over the exchange
    // element itself and never appear in `relationships` at all.
    it('CR-ONT-072 rejects a source endpoint that is not a component or a port', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-072')!;
        const model = buildModel(VALID_LINKS, { source: 'req', target: 'port' });
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.ruleId)).toContain('CR-ONT-072');
    });

    it('CR-ONT-073 rejects a target endpoint that is not a component or a port', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-073')!;
        const model = buildModel(VALID_LINKS, { source: 'mod', target: 'req' });
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.ruleId)).toContain('CR-ONT-073');
    });

    // ─── The functional chain ────────────────────────────────────────────

    it('CR-ONT-074 rejects a component function allocated to nothing', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-074')!;
        // Every valid link except the one that gives cfn its component.
        const model = buildModel(VALID_LINKS.filter(l => !(l.type === 'allocatedTo' && l.from === 'cfn')));
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.elementId)).toContain('cfn');
    });

    it('CR-ONT-074 rejects a component function allocated to two components', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-074')!;
        const model = buildModel([...VALID_LINKS, { type: 'allocatedTo', from: 'cfn', to: 'port' }]);
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.elementId)).toContain('cfn');
    });

    it('CR-ONT-074 leaves an unallocated SYSTEM function alone', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-074')!;
        // A system responsibility no single component owns is a normal state of
        // the chain. If this ever fires, the two definitions have collapsed
        // into one and ComponentFunction has stopped meaning anything.
        const model = buildModel(VALID_LINKS.filter(l => !(l.type === 'allocatedTo' && l.from === 'fn')));
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.elementId)).not.toContain('fn');
    });

    it('CR-ONT-075 rejects a function decomposed into a component', () => {
        if (!available) return;
        const constraint = rules.get('CR-ONT-075')!;
        // Confusing allocation with decomposition: the component belongs on
        // AllocatedTo, never on Composes.
        const model = buildModel([...VALID_LINKS, { type: 'composes', from: 'fn', to: 'mod' }]);
        expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)
            .map(v => v.elementId)).toContain('fn');
    });

    it('CR-ONT-072/073 accept an exchange with no endpoints declared', () => {
        if (!available) return;
        const model = buildModel(VALID_LINKS, { source: '', target: '' });
        for (const id of ['CR-ONT-072', 'CR-ONT-073']) {
            const constraint = rules.get(id)!;
            expect(evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry)).toEqual([]);
        }
    });
});
