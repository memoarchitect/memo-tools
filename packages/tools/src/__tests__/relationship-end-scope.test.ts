import { describe, expect, it } from 'vitest';
import { KindRegistry } from '../model/kind-registry.js';
import { endAllowedByRules, isAuthorableRelationship, type RelationshipDefinitionDTO } from '../model/relationship-legality.js';
import { insertIntoContainer } from '../server/package-source.js';
import { renderRelationship } from '../server/sysml-notation.js';
import { parseConstraintExpression, type CompiledConstraint } from '../validator/constraint-eval.js';
import { relationshipEndScopes } from '../validator/relationship-end-scope.js';

const registry = () => {
    const kinds = new KindRegistry();
    const add = (name: string, sysmlConstruct: string, superType?: string) => kinds.register({
        name, label: name, layer: 'core', sysmlConstruct, sysmlName: name, ...(superType ? { superType } : {}),
    } as Parameters<KindRegistry['register']>[0]);
    add('MemoPart', 'part def');
    add('LogicalComponent', 'part def', 'MemoPart');
    add('MemoAction', 'action def');
    add('SystemFunction', 'action def', 'MemoAction');
    add('Requirement', 'requirement def');
    add('Hazard', 'item def');
    kinds.computeDerivedBy();
    return kinds;
};

const rule = (expression: string): CompiledConstraint => ({
    id: `R-${expression.length}`, description: '', appliesToKind: 'Model', severity: 'error',
    ast: parseConstraintExpression(expression),
});

describe('relationshipEndScopes', () => {
    const source = rule("sourcesOf(allocatedTo)->forAll(conformsTo(MemoPart) or construct == 'action')");
    const target = rule('targetsOf(allocatedTo)->forAll(conformsTo(MemoPart))');

    it('reads what a rule on one end refuses, per kind, through the real evaluator', () => {
        const scopes = relationshipEndScopes([source, target], registry());
        expect(scopes.allocatedTo.source?.sort()).toEqual(['Hazard', 'Requirement']);
        expect(scopes.allocatedTo.target?.sort()).toEqual(['Hazard', 'MemoAction', 'Requirement', 'SystemFunction']);
        expect(endAllowedByRules(scopes, 'allocatedTo', 'source', 'SystemFunction')).toBe(true);
        expect(endAllowedByRules(scopes, 'allocatedTo', 'source', 'Requirement')).toBe(false);
        expect(endAllowedByRules(scopes, 'allocatedTo', 'target', 'SystemFunction')).toBe(false);
    });

    it('asks about a kind only the model holds, by its construct', () => {
        const usages = [{ kind: 'ActionUsage', construct: 'action' as const }];
        const scopes = relationshipEndScopes([source, target], registry(), usages);
        expect(endAllowedByRules(scopes, 'allocatedTo', 'source', 'ActionUsage')).toBe(true);
        expect(endAllowedByRules(scopes, 'allocatedTo', 'target', 'ActionUsage')).toBe(false);
    });

    it('allows every kind on a relation no rule scopes', () => {
        expect(endAllowedByRules(relationshipEndScopes([source], registry()), 'mitigates', 'source', 'Hazard')).toBe(true);
    });

    it('leaves a rule relating both ends to validation', () => {
        const both = rule('sourcesOf(allocatedTo)->forAll(conformsTo(MemoPart)) and targetsOf(allocatedTo)->forAll(conformsTo(MemoPart))');
        expect(relationshipEndScopes([both], registry())).toEqual({});
    });
});

describe('allocation in source', () => {
    const definition = {
        name: 'allocatedTo', sysmlName: 'AllocatedTo', label: 'Allocated To', layer: 'core', nativeKeyword: 'allocate',
        sourceEnd: { name: 'source' }, targetEnd: { name: 'target' },
    } as RelationshipDefinitionDTO;

    it('writes the native allocate usage, not a connection', () => {
        expect(renderRelationship({ id: 'x', definition, sourceId: 'fn', targetId: 'owner.part' })).toBe('allocate fn to owner.part;');
    });

    it('treats a keyword the writer cannot place as not authorable', () => {
        expect(isAuthorableRelationship(definition)).toBe(true);
        expect(isAuthorableRelationship({ ...definition, nativeKeyword: 'satisfy' })).toBe(true);
        expect(isAuthorableRelationship({ ...definition, nativeKeyword: 'verify' })).toBe(false);
        expect(isAuthorableRelationship({ ...definition, nativeKeyword: undefined })).toBe(true);
        expect(isAuthorableRelationship({ ...definition, nativeKeyword: undefined, isAbstract: true })).toBe(false);
    });
});

describe('insertIntoContainer', () => {
    const declared = (text: string, needle: string, role: string, key: string, withBody: boolean) => {
        const start = text.indexOf(needle);
        const end = start + needle.length;
        return { key, name: key, role, start, end, members: [], ...(withBody ? { body: { open: text.indexOf('{', start) + 1, close: end - 1 } } : {}) };
    };
    const outlineOf = (text: string, nodes: unknown[]) => ({ file: 't.sysml', text, roots: nodes } as never);

    it('turns a usage with no body into one that holds the member', () => {
        const text = 'package p {\n    part a : T;\n}\n';
        const node = declared(text, 'part a : T;', 'usage', 'p::a', false);
        expect(insertIntoContainer(text, outlineOf(text, [node]), 'p::a', 'part b : T;\n'))
            .toBe('package p {\n    part a : T {\n        part b : T;\n    }\n}\n');
    });

    it('answers undefined for a name the file does not declare', () => {
        const text = 'package p {\n}\n';
        expect(insertIntoContainer(text, outlineOf(text, []), 'p::missing', 'part b;\n')).toBeUndefined();
    });
});
