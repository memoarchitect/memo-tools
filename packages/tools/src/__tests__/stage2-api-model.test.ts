// ─── Stage 2 read model ──────────────────────────────────────────────────────
//
// The fixture is `fixtures/stage2/api-model-src/model.sysml`, exported once by
// the SysIDE provider (`python/memo_stage1_syside.py`) into
// `api-model.stage1.json` and committed, so this suite needs no compiler.
// Regenerate it after changing the model:
//
//   python packages/tools/python/memo_stage1_syside.py \
//     --out packages/tools/src/__tests__/fixtures/stage2/api-model.stage1.json \
//     packages/tools/src/__tests__/fixtures/stage2/api-model-src
//
// Every claim is made through qualified names, never through a compiler's
// `@id`: that is the property that makes stage 2 indifferent to which compiler
// ran.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiModel, type Stage1Output } from '../stage2/api-model.js';

const fixture = JSON.parse(readFileSync(
    resolve(import.meta.dirname, 'fixtures/stage2/api-model.stage1.json'), 'utf8')) as Stage1Output;
const model = new ApiModel(fixture);

const at = (qualifiedName: string) => {
    const element = model.resolve(qualifiedName);
    if (!element) throw new Error(`${qualifiedName} is not in the fixture`);
    return element['@id'];
};
const names = (elements: { '@id': string }[]) => elements.map(e => model.qualifiedName(e['@id']));

describe('ApiModel', () => {
    it('refuses a failed stage 1', () => {
        expect(() => new ApiModel({ ...fixture, clean: false })).toThrow(/does not run on a failed stage 1/);
    });

    it('refuses a handoff of another format', () => {
        expect(() => new ApiModel({ ...fixture, format: 'memo-stage1/0' })).toThrow(/expected memo-stage1\/1/);
    });

    it('resolves elements by qualified name and reports where they are declared', () => {
        const pump = at('Model::pump');
        expect(model.element(pump)?.['@type']).toBe('PartUsage');
        expect(model.source(pump)).toMatchObject({ file: 'model.sysml', role: 'project', line: 11 });
    });

    it('recovers ownership from the membership that states it', () => {
        expect(model.qualifiedName(model.owner(at('Model::pump::motor'))!['@id'])).toBe('Model::pump');
        expect(names(model.ownedMembers(at('Model')))).toEqual(
            expect.arrayContaining(['Model::pump', 'Model::controller']));
    });

    it('reads typing and specialization from the relationships, not derived properties', () => {
        expect(names(model.types(at('Model::pump')))).toEqual(['Lib::Component']);
        expect(names(model.superclassifiers(at('Lib::Component')))).toEqual(['Lib::Element']);
    });

    it('names an anonymous redefinition after the feature it redefines', () => {
        const label = at('Model::pump::label');
        expect(names(model.redefined(label))).toEqual(['Lib::Element::label']);
        expect(model.name(label)).toBe('label');
    });

    it('reads literal, enumeration and sequence values', () => {
        expect(model.value(at('Model::pump::label'))).toEqual({ kind: 'string', value: 'Pump' });
        expect(model.value(at('Model::pump::weight'))).toEqual({ kind: 'number', value: 2.5, rational: true });
        expect(model.value(at('Model::pump::critical'))).toEqual({ kind: 'boolean', value: true });
        expect(model.value(at('Model::pump::level'))).toEqual({ kind: 'reference', qualifiedName: 'Lib::Level::high' });
        // A nonunique sequence keeps its repeats and its order.
        expect(model.value(at('Model::pump::kinds'))).toEqual({
            kind: 'sequence',
            items: [
                { kind: 'string', value: 'a' },
                { kind: 'string', value: 'b' },
                { kind: 'string', value: 'a' },
            ],
        });
    });

    it('follows a connector end to the feature it references', () => {
        const connection = [...model.projectElements()].find(e => e['@type'] === 'ConnectionUsage')!;
        const ends = model.ownedMembers(connection['@id']).filter(m => m.isEnd === true
            || model.ownedRelationships(m['@id']).some(r => r['@type'] === 'ReferenceSubsetting'));
        expect(ends.map(end => names(model.referenced(end['@id']))[0]))
            .toEqual(['Model::controller', 'Model::pump::motor']);
    });

    it('names a standard library type the handoff indexes but does not carry', () => {
        const [type] = model.types(at('Lib::Element::weight'));
        expect(type['@type']).toBe('ExternalElement');
        expect(model.name(type['@id'])).toBe('Real');
        expect(model.qualifiedName(type['@id'])).toBe('ScalarValues::Real');
    });

    it('lists only what the project declares as project elements', () => {
        const project = [...model.projectElements()];
        expect(project.length).toBeGreaterThan(0);
        expect(project.every(e => model.source(e['@id'])?.role === 'project')).toBe(true);
    });
});
