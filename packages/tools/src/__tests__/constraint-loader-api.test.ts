import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ConstraintDiagnostic } from '../validator/constraint-loader.js';

// A rule definition as a stage 1 compiler's API JSON states it (the shape of
// the ontology's `constraint def …Rule`): attributes valued by FeatureValues,
// an enumeration literal by a FeatureReferenceExpression, the authored id on a
// `@MemoIdentity` application, a doc comment, and a `constraint { true }` body.
let next = 0;
const ref = (id: string) => ({ '@id': id });

function attribute(owner: string, name: string, value: ApiElement, kind = 'AttributeUsage'): ApiElement[] {
    const id = `${owner}__${name}`;
    const valueId = `${id}_value`;
    return [
        { '@type': 'FeatureMembership', '@id': `${id}_om`, ownedRelatedElement: [ref(id)] },
        { '@type': kind, '@id': id, declaredName: name, ownedRelationship: [ref(`${id}_fv`)] },
        { '@type': 'FeatureValue', '@id': `${id}_fv`, ownedRelatedElement: [ref(valueId)] },
        { ...value, '@id': valueId },
    ];
}

const literal = (value: string): ApiElement => ({ '@type': 'LiteralString', '@id': '', value });
const enumLiteral = (target: string): ApiElement => ({
    '@type': 'FeatureReferenceExpression', '@id': '', ownedRelationship: [ref(`${target}_m${++next}`)],
});

function rule(id: string, opts: { providedId: string; body?: ApiElement; doc?: string }): ApiElement[] {
    const members: ApiElement[] = [
        ...attribute(id, 'appliesTo', literal('Hazard')),
        ...attribute(id, 'severity', enumLiteral('Kinds__RuleSeverityKind__error')),
        ...attribute(id, 'tailoring', enumLiteral('Kinds__RuleTailoringKind__invariant')),
        ...attribute(id, 'predicateExpression', literal('mitigates->size() >= 1')),
        // `@MemoIdentity { :>> providedId = "…"; }`
        { '@type': 'OwningMembership', '@id': `${id}_md_om`, ownedRelatedElement: [ref(`${id}_md`)] },
        { '@type': 'MetadataUsage', '@id': `${id}_md`, ownedRelationship: attribute(`${id}_md`, 'providedId', literal(opts.providedId), 'ReferenceUsage').slice(0, 1).map(m => ref(m['@id'])) },
        ...attribute(`${id}_md`, 'providedId', literal(opts.providedId), 'ReferenceUsage'),
        // `constraint { … }`
        { '@type': 'FeatureMembership', '@id': `${id}_c_om`, ownedRelatedElement: [ref(`${id}_c`)] },
        { '@type': 'ConstraintUsage', '@id': `${id}_c`, ownedRelationship: [ref(`${id}_c_rem`)] },
        { '@type': 'ResultExpressionMembership', '@id': `${id}_c_rem`, ownedRelatedElement: [ref(`${id}_c_result`)] },
        { ...(opts.body ?? { '@type': 'LiteralBoolean', '@id': '', value: true }), '@id': `${id}_c_result` },
    ];
    if (opts.doc) {
        members.push(
            { '@type': 'OwningMembership', '@id': `${id}_doc_om`, ownedRelatedElement: [ref(`${id}_doc`)] },
            { '@type': 'Documentation', '@id': `${id}_doc`, body: opts.doc },
        );
    }
    const memberships = members.filter(m => m['@id'] && !m['@id'].includes('_md__') && /_om$/.test(m['@id']) && !m['@id'].startsWith(`${id}_md__`));
    return [
        { '@type': 'ConstraintDefinition', '@id': id, declaredName: id.split('__').pop(), ownedRelationship: memberships.map(m => ref(m['@id'])) },
        ...members,
    ];
}

// The enumeration literals the severity and tailoring attributes reference.
const kinds: ApiElement[] = [
    { '@type': 'EnumerationDefinition', '@id': 'Kinds__RuleSeverityKind', declaredName: 'RuleSeverityKind', ownedRelationship: [ref('Kinds__RuleSeverityKind__error_om')] },
    { '@type': 'OwningMembership', '@id': 'Kinds__RuleSeverityKind__error_om', ownedRelatedElement: [ref('Kinds__RuleSeverityKind__error')], owningRelatedElement: ref('Kinds__RuleSeverityKind') },
    { '@type': 'EnumerationUsage', '@id': 'Kinds__RuleSeverityKind__error', declaredName: 'error', owningRelationship: ref('Kinds__RuleSeverityKind__error_om') },
    { '@type': 'EnumerationDefinition', '@id': 'Kinds__RuleTailoringKind', declaredName: 'RuleTailoringKind', ownedRelationship: [ref('Kinds__RuleTailoringKind__invariant_om')] },
    { '@type': 'OwningMembership', '@id': 'Kinds__RuleTailoringKind__invariant_om', ownedRelatedElement: [ref('Kinds__RuleTailoringKind__invariant')], owningRelatedElement: ref('Kinds__RuleTailoringKind') },
    { '@type': 'EnumerationUsage', '@id': 'Kinds__RuleTailoringKind__invariant', declaredName: 'invariant', owningRelationship: ref('Kinds__RuleTailoringKind__invariant_om') },
];

function handoff(rules: { file: string; elements: ApiElement[] }[]): ApiModel {
    const elements = [...kinds, ...rules.flatMap(r => r.elements)];
    // Each FeatureReferenceExpression names its literal through a Membership.
    const memberships: ApiElement[] = [];
    for (const element of elements) {
        for (const r of (element.ownedRelationship as { '@id': string }[] | undefined) ?? []) {
            const match = /^(Kinds__\w+?)_m\d+$/.exec(r['@id']);
            if (match) memberships.push({ '@type': 'Membership', '@id': r['@id'], memberElement: ref(match[1]) });
        }
    }
    const index: Stage1Output['index'] = {};
    for (const element of kinds) index[element['@id']] = { file: 'kinds.sysml', role: 'library', qualifiedName: element['@id'].replace(/__/g, '::') };
    for (const r of rules) {
        for (const element of r.elements) index[element['@id']] = { file: r.file, role: 'library', qualifiedName: element['@id'].replace(/__/g, '::') };
    }
    return new ApiModel({
        format: 'memo-stage1/1', provider: 'test', clean: true, index,
        documents: [{ file: 'all.sysml', role: 'library', elements: [...elements, ...memberships] }],
    });
}

describe('rules read from a stage 1 handoff', () => {
    it('compiles a rule as the parse loader does: id from metadata, bare enumeration members, doc, absolute file', () => {
        const api = handoff([{ file: 'rules/closure.sysml', elements: rule('Rules__HazardRule', { providedId: 'CR-T-001', doc: '/* Every hazard is mitigated. */' }) }]);
        const diagnostics: ConstraintDiagnostic[] = [];
        const [compiled, ...rest] = collectApiConstraints(api, diagnostics, new Map([['/lib/memo/src/rules/closure.sysml', 'Rules']]));
        expect(diagnostics).toEqual([]);
        expect(rest).toEqual([]);
        expect(compiled).toMatchObject({
            id: 'CR-T-001',
            typeName: 'HazardRule',
            appliesToKind: 'Hazard',
            severity: 'error',
            tailoring: 'invariant',
            description: 'Every hazard is mitigated.',
            sourceFile: '/lib/memo/src/rules/closure.sysml',
        });
        // `true` stands in for the ontology-owned predicate, which is what runs.
        expect(compiled.ast.kind).not.toBe('bool');
    });

    it('reports a rule whose body is an expression it does not compile, rather than skipping it', () => {
        const body: ApiElement = { '@type': 'OperatorExpression', '@id': '', operator: '>=' };
        const api = handoff([{ file: 'r.sysml', elements: rule('Rules__ExprRule', { providedId: 'CR-T-002', body }) }]);
        const diagnostics: ConstraintDiagnostic[] = [];
        expect(collectApiConstraints(api, diagnostics)).toEqual([]);
        expect(diagnostics).toEqual([expect.objectContaining({ kind: 'compile-failed', ruleId: 'CR-T-002' })]);
        expect(diagnostics[0].message).toContain('OperatorExpression');
    });

    it('reports two definitions sharing a rule id', () => {
        const api = handoff([
            { file: 'a.sysml', elements: rule('A__One', { providedId: 'CR-T-003' }) },
            { file: 'b.sysml', elements: rule('B__Two', { providedId: 'CR-T-003' }) },
        ]);
        const diagnostics: ConstraintDiagnostic[] = [];
        collectApiConstraints(api, diagnostics);
        expect(diagnostics).toEqual([expect.objectContaining({ kind: 'duplicate-id', ruleId: 'CR-T-003' })]);
    });
});
