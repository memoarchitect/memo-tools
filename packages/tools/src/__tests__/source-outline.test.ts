import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { parseText } from '../model/parser-utils.js';
import {
    bodyMembers, findBody, outlineFromHandoff, outlineFromParse, outlineNodes,
    type OutlineNode, type SourceOutline,
} from '../authoring/source-outline.js';
import {
    outlineIdentity, outlineIdentityTable, parseOutlineIdentity, resolveOutlineIdentity,
} from '../authoring/outline-identity.js';
import { StaleIrIdentityError } from '../model/ir-identity.js';

// One file, read both ways. The doc comment holds a non-ASCII character, so a
// handoff's byte offsets differ from string offsets after it.
const FILE = 'model/plant.sysml';
const TEXT = `package Plant {
    part def Pump;
    part pump : Pump {
        doc /* Moves fluid — the main one. */
        attribute :>> mass = 3.5;
        @Tag { :>> providedId = "P-1"; :>> label = "Main"; }
        part motor;
    }
    connection connect pump to pump { attribute note = "}"; }
}
`;

const at = (needle: string, from = 0) => {
    const start = TEXT.indexOf(needle, from);
    if (start < 0) throw new Error(`fixture lacks ${needle}`);
    return start;
};
/** The declaration starting at `head`, through its `;` or its body's matching `}`. */
const declaration = (head: string, from = 0): [number, number] => {
    const start = at(head, from);
    const body = findBody(TEXT, start, TEXT.length);
    return [start, body ? body.close + 1 : TEXT.indexOf(';', start) + 1];
};
const bytes = (offset: number) => Buffer.byteLength(TEXT.slice(0, offset), 'utf8');

// The handoff a compiler would write for it.
const elements: ApiElement[] = [];
const index: NonNullable<Stage1Output['index']> = {};
let n = 0;
const ref = (id: string) => ({ '@id': id });
function add(type: string, fields: Record<string, unknown>, range?: [number, number]): ApiElement {
    const element = { '@type': type, '@id': `e${++n}`, ...fields } as ApiElement;
    elements.push(element);
    index[element['@id']] = {
        file: FILE, role: 'project', root: '/work',
        ...(range ? { startByte: bytes(range[0]), endByte: bytes(range[1]) } : {}),
    };
    return element;
}
function own(owner: ApiElement, member: ApiElement): void {
    const membership = add('OwningMembership', { ownedRelatedElement: [ref(member['@id'])] });
    ((owner.ownedRelationship ??= []) as unknown[]).push(ref(membership['@id']));
}
const doc = add('Namespace', {});
const plant = add('Package', { declaredName: 'Plant' }, declaration('package Plant'));
own(doc, plant);
own(plant, add('PartDefinition', { declaredName: 'Pump' }, declaration('part def Pump')));
const pump = add('PartUsage', { declaredName: 'pump' }, declaration('part pump'));
own(plant, pump);
own(pump, add('Documentation', {}, [at('doc /*'), at('*/') + 2]));
// `attribute :>> mass` declares no name; it redefines `mass`.
const massDef = add('AttributeUsage', { declaredName: 'mass' });
const mass = add('AttributeUsage', {}, declaration('attribute :>> mass'));
const redefinition = add('Redefinition', { redefinedFeature: ref(massDef['@id']) });
mass.ownedRelationship = [ref(redefinition['@id'])];
own(pump, mass);
const tag = add('MetadataUsage', {}, declaration('@Tag'));
for (const field of ['providedId', 'label']) {
    const base = add('ReferenceUsage', { declaredName: field });
    const value = add('ReferenceUsage', {});
    const redefines = add('Redefinition', { redefinedFeature: ref(base['@id']) });
    value.ownedRelationship = [ref(redefines['@id'])];
    own(tag, value);
}
own(pump, tag);
own(pump, add('PartUsage', { declaredName: 'motor' }, declaration('part motor')));
const connection = add('ConnectionUsage', {}, declaration('connection connect'));
own(plant, connection);
// The ends a compiler reads from `connect pump to pump`: in the head, not the body.
own(connection, add('Feature', { declaredName: 'source' }, [at('pump to'), at('pump to') + 4]));
own(connection, add('AttributeUsage', { declaredName: 'note' }, declaration('attribute note')));

const api = new ApiModel({
    format: 'memo-stage1/1', provider: 'test', clean: true, index,
    documents: [{ file: FILE, role: 'project', root: '/work', elements }],
});

const shape = (outline: SourceOutline) => [...outlineNodes(outline)]
    .filter(node => node.metaclass !== 'Feature')
    .map(node => ({ key: node.key, role: node.role, start: node.start, end: node.end, body: node.body, fields: node.fields }));

describe('a source outline', () => {
    const fromHandoff = outlineFromHandoff(api, '/work/model/plant.sysml', FILE, TEXT);

    it('keys each declaration by its owner and name, a redefinition by the feature it redefines', () => {
        expect([...outlineNodes(fromHandoff)].map(node => node.key)).toEqual([
            'Plant', 'Plant::Pump', 'Plant::pump', 'Plant::pump::@Documentation[0]', 'Plant::pump::mass',
            'Plant::pump::@MetadataUsage[0]', 'Plant::pump::motor',
            'Plant::@ConnectionUsage[0]', 'Plant::@ConnectionUsage[0]::source', 'Plant::@ConnectionUsage[0]::note',
        ]);
    });

    it('states ranges as string offsets, past a character a byte offset counts twice', () => {
        const motor = [...outlineNodes(fromHandoff)].find(node => node.key === 'Plant::pump::motor')!;
        expect(TEXT.slice(motor.start, motor.end)).toBe('part motor;');
    });

    it('finds a body by its braces, not a brace in a string', () => {
        const conn = [...outlineNodes(fromHandoff)].find(node => node.role === 'connection')!;
        expect(TEXT.slice(conn.body!.open, conn.body!.close)).toBe(' attribute note = "}"; ');
        expect(findBody('part x; part y { }', 0, 18)).toBeUndefined();
        expect(findBody('part x /* { */ { // }\n }', 0, 24)).toEqual({ open: 16, close: 23 });
    });

    it('reads a metadata annotation\'s fields, and keeps its members out of the outline', () => {
        const tagNode = [...outlineNodes(fromHandoff)].find(node => node.role === 'metadata')!;
        expect(tagNode.fields).toEqual(['providedId', 'label']);
        expect(tagNode.members).toEqual([]);
    });

    it('keeps a feature read from a declaration\'s head out of its body members', () => {
        const conn = [...outlineNodes(fromHandoff)].find(node => node.role === 'connection')!;
        expect(conn.members.map(m => m.key)).toContain('Plant::@ConnectionUsage[0]::source');
        expect(bodyMembers(conn).map(m => m.key)).toEqual(['Plant::@ConnectionUsage[0]::note']);
    });

    it('reads the same from MEMO\'s parse of the file', async () => {
        const { document, errors } = await parseText(TEXT);
        expect(errors).toEqual([]);
        const fromParse = outlineFromParse(document.parseResult.value as never, FILE, TEXT);
        expect(shape(fromParse)).toEqual(shape(fromHandoff));
    });
});

describe('an identity minted from the outline', () => {
    const outline = outlineFromHandoff(api, '/work/model/plant.sysml', FILE, TEXT);
    const node = (key: string) => [...outlineNodes(outline)].find(n => n.key === key) as OutlineNode;

    it('is the file, the key and the metaclass', () => {
        const identity = outlineIdentity(FILE, node('Plant::pump'));
        expect(identity).toBe('model/plant.sysml#Plant::pump:PartUsage');
        expect(parseOutlineIdentity(identity)).toEqual({ file: FILE, key: 'Plant::pump', metaclass: 'PartUsage' });
    });

    it('maps an element id to its declaration in its file, the file absolute or not', () => {
        expect(outlineIdentityTable([outline], [
            { id: 'Plant::pump', file: '/work/model/plant.sysml' },
            { id: 'Plant::Pump', file: FILE },
            { id: 'Plant::elsewhere', file: FILE },
        ], '/work')).toEqual({
            'Plant::pump': 'model/plant.sysml#Plant::pump:PartUsage',
            'Plant::Pump': 'model/plant.sysml#Plant::Pump:PartDefinition',
        });
    });

    it('resolves against the file as it is now, surviving an insertion above it', async () => {
        const edited = TEXT.replace('    part def Pump;\n', '    part def Pump;\n    part def Valve;\n');
        const { document } = await parseText(edited);
        const now = outlineFromParse(document.parseResult.value as never, FILE, edited);
        const found = resolveOutlineIdentity(now, 'model/plant.sysml#Plant::pump:PartUsage');
        expect(edited.slice(found.start, found.start + 14)).toBe('part pump : Pu');
    });

    it('is stale once the declaration is renamed, retyped or gone', async () => {
        const stale = (text: string) => parseText(text).then(({ document }) =>
            () => resolveOutlineIdentity(outlineFromParse(document.parseResult.value as never, FILE, text),
                'model/plant.sysml#Plant::pump:PartUsage'));
        expect(await stale(TEXT.replace('part pump : Pump', 'part pump2 : Pump'))).toThrow(StaleIrIdentityError);
        expect(await stale(TEXT.replace('part pump : Pump', 'item pump : Pump'))).toThrow(/now names a ItemUsage/);
        expect(() => resolveOutlineIdentity(outline, 'other.sysml#Plant::pump:PartUsage')).toThrow(/names other.sysml/);
    });
});
