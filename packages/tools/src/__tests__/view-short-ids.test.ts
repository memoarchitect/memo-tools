import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeModel } from '../model/complete-model.js';
import { toElementIndex } from '../model/element-index.js';
import { rebaseRegistry } from '../model/id-rebase.js';
import { IDENTITY_FILENAME, persistIdentities, readIdentityRegistry, type IdentityRegistry } from '../model/identity-registry.js';
import type { MEMOConfig } from '../model/config.js';
import type { MemoElement } from '../model/semantic.js';
import { deriveModelViews } from '../model/view-deriver.js';

interface ViewSpec { name: string; providedId?: string; diagramType?: string; origin?: string }

function view({ name, providedId, diagramType = 'ibd', origin }: ViewSpec): MemoElement {
    return {
        id: `views::${name}`, shortName: name, name, kind: 'DiagramView', construct: 'part', layer: 'viewpoints',
        file: 'model/views.sysml', package: 'views',
        attributes: { diagramType, ...(providedId ? { providedId } : {}) },
        ...(origin ? { provenance: { declaration: { origin } } } : {}),
    } as MemoElement;
}

function part(name: string, kind: string): MemoElement {
    return {
        id: `model::${name}`, shortName: name, name, kind, construct: 'part', layer: 'logical_structure',
        file: 'model/parts.sysml', package: 'model', attributes: {},
    } as MemoElement;
}

/** One project, built repeatedly: each build reads the file the one before it wrote, as `memo validate` does. */
function project() {
    const root = mkdtempSync(join(tmpdir(), 'memo-view-ids-'));
    return {
        root,
        build(elements: MemoElement[]) {
            const config = { priorIdentities: readIdentityRegistry(root) } as MEMOConfig;
            const model = completeModel({ elements: toElementIndex(elements), relationships: [], errors: [], config });
            persistIdentities(root, model.elements.values(), config.priorIdentities ?? {});
            return {
                model,
                numbers: Object.fromEntries(deriveModelViews(model).diagrams.map(d => [d.id, d.shortId])),
            };
        },
    };
}

const ibd = (name: string) => view({ name });

describe('the view deriver in the browser', () => {
    it('imports nothing that reads files, since Architect\'s web app loads it', () => {
        const source = readFileSync(new URL('../model/view-deriver.ts', import.meta.url), 'utf-8');
        const imports = [...source.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map(match => match[1]);
        expect(imports.filter(name => name.startsWith('node:') || name.includes('identity-registry'))).toEqual([]);
    });
});

describe('a view keeps its number', () => {
    it('numbers a first build by the id each view routes by', () => {
        const views = [
            view({ name: 'aFirstDeclared', providedId: 'VIEW-3' }),
            view({ name: 'bSecondDeclared', providedId: 'VIEW-1' }),
            view({ name: 'cThirdDeclared', providedId: 'VIEW-2' }),
        ];
        expect(project().build(views).numbers).toEqual({ 'VIEW-1': 'INT-1', 'VIEW-2': 'INT-2', 'VIEW-3': 'INT-3' });
    });

    it('gives an added view the next number, even when it sorts before every other view', () => {
        const p = project();
        expect(p.build([ibd('bravo'), ibd('charlie'), ibd('delta')]).numbers)
            .toEqual({ bravo: 'INT-1', charlie: 'INT-2', delta: 'INT-3' });
        expect(p.build([ibd('alpha'), ibd('bravo'), ibd('charlie'), ibd('delta')]).numbers)
            .toEqual({ alpha: 'INT-4', bravo: 'INT-1', charlie: 'INT-2', delta: 'INT-3' });
    });

    it('leaves the others alone when a view is removed, and never hands its number out again', () => {
        const p = project();
        p.build([ibd('bravo'), ibd('charlie'), ibd('delta')]);
        expect(p.build([ibd('bravo'), ibd('delta')]).numbers).toEqual({ bravo: 'INT-1', delta: 'INT-3' });
        expect(p.build([ibd('bravo'), ibd('delta'), ibd('echo')]).numbers)
            .toEqual({ bravo: 'INT-1', delta: 'INT-3', echo: 'INT-4' });
        // The removed view is still recorded; bringing it back restores its own number.
        expect(p.build([ibd('bravo'), ibd('charlie'), ibd('delta'), ibd('echo')]).numbers.charlie).toBe('INT-2');
    });

    it('only moves within its own view kind', () => {
        const p = project();
        p.build([ibd('alpha'), view({ name: 'tree', diagramType: 'bdd' })]);
        expect(p.build([view({ name: 'another', diagramType: 'bdd' }), ibd('alpha'), view({ name: 'tree', diagramType: 'bdd' })]).numbers)
            .toEqual({ alpha: 'INT-1', tree: 'GEN-1', another: 'GEN-2' });
    });

    it('retires the old number when a view changes kind', () => {
        const p = project();
        p.build([ibd('alpha'), ibd('bravo')]);
        expect(p.build([view({ name: 'alpha', diagramType: 'bdd' }), ibd('bravo')]).numbers).toEqual({ alpha: 'GEN-1', bravo: 'INT-2' });
        expect(readIdentityRegistry(p.root)['views::alpha']).toMatchObject({ viewShortId: 'GEN-1', retiredViewShortIds: ['INT-1'] });
        expect(p.build([view({ name: 'alpha', diagramType: 'bdd' }), ibd('bravo'), ibd('charlie')]).numbers.charlie).toBe('INT-3');
        // Back to the first kind is a new number too: INT-1 stays retired.
        expect(p.build([ibd('alpha'), ibd('bravo'), ibd('charlie')]).numbers.alpha).toBe('INT-4');
    });

    it('records the number in the identity file without disturbing a rebuild', () => {
        const p = project();
        p.build([ibd('alpha')]);
        const written = readFileSync(join(p.root, IDENTITY_FILENAME), 'utf-8');
        expect(written).toContain('viewShortId: "INT-1"');
        p.build([ibd('alpha')]);
        expect(readFileSync(join(p.root, IDENTITY_FILENAME), 'utf-8')).toBe(written);
    });

    it('keeps a dependency\'s view stable without taking on the dependency\'s element identity', () => {
        const p = project();
        const library = () => view({ name: 'libraryView', origin: 'dependency' });
        p.build([library()]);
        expect(p.build([ibd('alpha'), library()]).numbers).toEqual({ libraryView: 'INT-1', alpha: 'INT-2' });
        expect(readIdentityRegistry(p.root)['views::libraryView']).toEqual({ viewShortId: 'INT-1' });
    });
});

describe('view numbers beside element short ids', () => {
    it('counts a view family apart from the element family sharing its letters', () => {
        const p = project();
        const iface = (name: string) => part(name, 'Interface');
        const first = p.build([iface('ifOne'), ibd('alpha'), ibd('bravo')]);
        expect(first.model.elements.get('model::ifOne')!.shortId).toBe('INT-1');
        expect(first.numbers).toEqual({ alpha: 'INT-1', bravo: 'INT-2' });

        const second = p.build([iface('ifOne'), iface('ifTwo'), ibd('alpha'), ibd('bravo')]);
        expect(second.model.elements.get('model::ifTwo')!.shortId).toBe('INT-2');
        const third = p.build([iface('ifOne'), iface('ifTwo'), ibd('alpha'), ibd('charlie')]);
        expect(third.numbers).toEqual({ alpha: 'INT-1', charlie: 'INT-3' });
        expect(third.model.elements.get('model::ifTwo')!.shortId).toBe('INT-2');
    });
});

describe('view numbers that two branches both handed out', () => {
    const views = (entries: Record<string, string>): IdentityRegistry =>
        Object.fromEntries(Object.entries(entries).map(([key, viewShortId]) => [key, { shortId: `MMX-${key.length}`, viewShortId }]));

    it('keeps the target\'s number and renumbers the branch\'s new view above the mark', () => {
        const target = views({ 'p::a': 'INT-1', 'p::theirs': 'INT-2' });
        const branch = views({ 'p::a': 'INT-1', 'p::mine': 'INT-2' });
        const { registry, changes } = rebaseRegistry(target, branch);
        expect(registry['p::mine'].viewShortId).toBe('INT-3');
        expect(registry['p::a'].viewShortId).toBe('INT-1');
        expect(changes).toContainEqual({ where: 'p::mine', from: 'INT-2', to: 'INT-3' });
    });

    it('does not let a view number collide with an element\'s', () => {
        const target = { 'p::a': { shortId: 'INT-5' } };
        const branch = { 'p::a': { shortId: 'INT-5' }, 'p::view': { shortId: 'MMX-1', viewShortId: 'INT-2' } };
        expect(rebaseRegistry(target, branch).changes).toEqual([]);
    });

    it('treats a retired view number as taken', () => {
        const target = { 'p::a': { retiredViewShortIds: ['INT-4'], viewShortId: 'INT-1' } };
        const branch = { 'p::a': { viewShortId: 'INT-1' }, 'p::mine': { viewShortId: 'INT-4' } };
        expect(rebaseRegistry(target, branch).registry['p::mine'].viewShortId).toBe('INT-5');
    });
});
