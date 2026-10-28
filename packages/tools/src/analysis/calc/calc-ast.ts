// ─── The expressions of a calculation, read from the compiler's handoff ──────
//
// A `calc def` is a KerML expression tree in the handoff (Invocation, Operator, FeatureChain,
// FeatureReference, literal). This reads it into a small tree the evaluator walks, resolving each
// invoked function and each chained feature to its qualified name. It reads the tree as written and
// knows nothing of any calculation in particular.

import type { ApiElement, ApiModel } from '../../stage2/api-model.js';

export type Expr =
    | { k: 'lit'; v: number | string | boolean }
    | { k: 'ref'; feature: string }
    | { k: 'chain'; target: Expr; features: string[] }
    | { k: 'op'; op: string; args: Expr[]; type?: string }
    | { k: 'call'; fn: string; args: { name?: string; value: Expr }[] }
    | { k: 'lambda'; params: string[]; body: Expr }
    | { k: 'thunk'; body: Expr }
    | { k: 'unknown'; what: string };

export interface CalcParameter { name: string; direction: 'in' | 'out' }

export interface CalcDefinition {
    qualifiedName: string;
    name: string;
    parameters: CalcParameter[];
    /** The name the returned value is given (`return cost : …`), for `calc.cost` on a usage. */
    returnName?: string;
    body?: Expr;
}

const idOf = (reference: unknown): string => {
    const value = reference as { '@id'?: string } | string;
    return typeof value === 'string' ? value : value?.['@id'] ?? '';
};

export class CalcReader {
    constructor(private readonly api: ApiModel) {}

    private qn(id: string): string { return this.api.qualifiedName(id) ?? this.api.name(id) ?? id; }
    private rels(id: string) { return this.api.ownedRelationships(id); }
    private owned(rel: ApiElement): string { return idOf(((rel.ownedRelatedElement as unknown[]) ?? [])[0]); }

    /** The expression a feature is bound to (`= expr`). */
    valueOf(featureId: string): Expr | undefined {
        const featureValue = this.rels(featureId).find(r => r['@type'] === 'FeatureValue');
        return featureValue ? this.expr(this.owned(featureValue)) : undefined;
    }

    private args(nodeId: string): { name?: string; feature: string }[] {
        return this.rels(nodeId).filter(r => r['@type'] === 'ParameterMembership')
            .map(r => ({ name: r.memberName as string | undefined, feature: this.owned(r) }));
    }

    expr(nodeId: string): Expr {
        const element = this.api.element(nodeId);
        if (!element) return { k: 'unknown', what: nodeId };
        switch (element['@type']) {
            case 'LiteralInteger': case 'LiteralRational': case 'LiteralBoolean': case 'LiteralString':
                return { k: 'lit', v: element.value as number };
            case 'LiteralInfinity': return { k: 'lit', v: Infinity };
            case 'OperatorExpression': {
                const operator = element.operator as string;
                const args = this.args(nodeId);
                if (['istype', 'hastype', 'as', '@', 'meta'].includes(operator)) {
                    // the second operand is a type, not a value: it is the feature's typing
                    const typing = args[1] ? this.rels(args[1].feature).find(r => r['@type'] === 'FeatureTyping') : undefined;
                    return { k: 'op', op: operator, args: [this.valueOf(args[0].feature) ?? { k: 'unknown', what: 'operand' }], type: typing ? this.qn(idOf(typing.type)) : undefined };
                }
                return { k: 'op', op: operator, args: args.map(a => this.valueOf(a.feature) ?? { k: 'unknown', what: 'operand' }) };
            }
            case 'FeatureChainExpression': {
                const args = this.args(nodeId);
                const target = this.valueOf(args[0].feature) ?? { k: 'unknown' as const, what: 'chain target' };
                const membership = this.rels(nodeId).find(r => r['@type'] === 'Membership' || r['@type'] === 'OwningMembership');
                const chained = idOf(membership?.memberElement ?? ((membership?.ownedRelatedElement as unknown[]) ?? [])[0]);
                let features = this.rels(chained).filter(r => r['@type'] === 'FeatureChaining').map(r => this.qn(idOf(r.chainingFeature)));
                if (features.length === 0) features = [this.qn(chained)];
                return { k: 'chain', target, features };
            }
            case 'InvocationExpression': {
                const membership = this.rels(nodeId).find(r => r['@type'] === 'Membership');
                return {
                    k: 'call', fn: membership ? this.qn(idOf(membership.memberElement)) : '',
                    args: this.args(nodeId).map(a => ({ name: a.name, value: this.valueOf(a.feature) ?? { k: 'unknown' as const, what: 'argument' } })),
                };
            }
            case 'FeatureReferenceExpression': {
                const membership = this.rels(nodeId).find(r => r['@type'] === 'Membership');
                if (membership) return { k: 'ref', feature: this.qn(idOf(membership.memberElement)) };
                const nested = this.rels(nodeId).find(r => r['@type'] === 'FeatureMembership');
                const inner = nested ? this.owned(nested) : '';
                // an argument that is evaluated only when asked for (a branch of `if`), or a lambda
                return this.api.element(inner)?.['@type'] === 'Expression'
                    ? { k: 'lambda', ...this.lambda(inner) }
                    : { k: 'thunk', body: this.expr(inner) };
            }
            case 'Expression': return { k: 'lambda', ...this.lambda(nodeId) };
            default: return { k: 'unknown', what: element['@type'] };
        }
    }

    private lambda(id: string): { params: string[]; body: Expr } {
        const rels = this.rels(id);
        const params = rels.filter(r => r['@type'] === 'FeatureMembership')
            .map(r => this.api.element(this.owned(r))).filter((f): f is ApiElement => f !== undefined)
            .map(f => (f.name ?? f.declaredName) as string);
        const result = rels.find(r => r['@type'] === 'ResultExpressionMembership');
        return { params, body: result ? this.expr(this.owned(result)) : { k: 'unknown', what: 'lambda without a result' } };
    }

    /** Every calculation definition the handoff holds, by qualified name. */
    definitions(): Map<string, CalcDefinition> {
        const result = new Map<string, CalcDefinition>();
        for (const def of this.api.ofType('CalculationDefinition')) {
            const id = def['@id'];
            const name = this.api.name(id);
            if (!name) continue;
            const qualifiedName = this.qn(id);
            const parameters: CalcParameter[] = [];
            for (const rel of this.rels(id)) {
                const feature = this.api.element(this.owned(rel));
                if (rel['@type'] === 'FeatureMembership' && feature?.direction === 'in') {
                    parameters.push({ name: (feature.declaredName ?? feature.name) as string, direction: 'in' });
                }
            }
            const returnRel = this.rels(id).find(r => r['@type'] === 'ReturnParameterMembership');
            const returnFeature = returnRel ? this.owned(returnRel) : undefined;
            result.set(qualifiedName, {
                qualifiedName, name, parameters,
                returnName: returnFeature ? (this.api.name(returnFeature) ?? undefined) : undefined,
                body: returnFeature ? this.valueOf(returnFeature) : undefined,
            });
        }
        return result;
    }
}
