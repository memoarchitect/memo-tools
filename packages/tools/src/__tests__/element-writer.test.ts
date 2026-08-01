import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { removeElement } from '../server/element-writer.js';
import { parseText } from '../model/parser-utils.js';
import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';

let projectRoot: string;

function write(relativePath: string, text: string): void {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text, 'utf8');
}

function read(relativePath: string): string {
    return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function element(id: string, file = 'model/catalog.sysml'): MemoElement {
    return { id, name: id, kind: 'UIElement', construct: 'part', layer: 'implementation', file, attributes: {} };
}

function relationship(id: string, sourceId: string, targetId: string, file?: string): MemoRelationship {
    return { id, type: 'Composes', sourceId, sourceEnd: 'parent', targetId, targetEnd: 'child', file: file! };
}

function model(elements: MemoElement[], relationships: MemoRelationship[]): MemoModelDTO {
    return { elements: Object.fromEntries(elements.map(item => [item.id, item])), relationships } as MemoModelDTO;
}

beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'memo-element-writer-')); });
afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

describe('removeElement', () => {
    it('removes the element and all incoming and outgoing connections while preserving unrelated connections', async () => {
        const source = `package Test {
    part parent : UIElement;
    part victim : UIElement;
    part survivor : UIElement;
    connection : Composes connect parent ::> parent to child ::> victim;
    connection : Composes connect parent ::> victim to child ::> survivor;
    connection : Composes connect parent ::> parent to child ::> survivor;
}\n`;
        write('model/catalog.sysml', source);
        const victim = element('victim');
        const result = await removeElement(victim, model(
            [element('parent'), victim, element('survivor')],
            [
                relationship('in', 'parent', 'victim', 'model/catalog.sysml'),
                relationship('out', 'victim', 'survivor', 'model/catalog.sysml'),
                relationship('keep', 'parent', 'survivor', 'model/catalog.sysml'),
            ],
        ), projectRoot);

        expect(result).toMatchObject({ success: true, removedRelationshipIds: ['in', 'out'] });
        const updated = read('model/catalog.sysml');
        expect(updated).not.toContain('part victim');
        expect(updated).not.toContain('::> victim');
        expect(updated).toContain('connect parent ::> parent to child ::> survivor');
        expect((await parseText(updated)).errors).toHaveLength(0);
    });

    it('cleans connected relationships owned by a different source file', async () => {
        write('model/catalog.sysml', `package Catalog { part victim : UIElement; part survivor : UIElement; }\n`);
        write('model/relationships.sysml', `package Relations {
    connection : Composes connect parent ::> victim to child ::> survivor;
}\n`);
        const victim = element('victim');
        const result = await removeElement(victim, model(
            [victim, element('survivor')],
            [relationship('cross-file', 'victim', 'survivor', 'model/relationships.sysml')],
        ), projectRoot);

        expect(result.success).toBe(true);
        expect(read('model/catalog.sysml')).not.toContain('part victim');
        expect(read('model/relationships.sysml')).not.toContain('::> victim');
    });

    it('refuses deletion when a connected relationship has no writable owner', async () => {
        const source = `package Test { part victim : UIElement; part survivor : UIElement; }\n`;
        write('model/catalog.sysml', source);
        const victim = element('victim');
        const unowned = relationship('unowned', 'victim', 'survivor', undefined);
        const result = await removeElement(victim, model([victim, element('survivor')], [unowned]), projectRoot);

        expect(result.success).toBe(false);
        expect(result.error).toContain('avoid a dangling reference');
        expect(read('model/catalog.sysml')).toBe(source);
    });
});
