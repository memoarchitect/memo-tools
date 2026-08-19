import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';

// A `package` nested in a usage body groups without decomposing. SysIDE accepts
// it; the Langium grammar rejected it until 2026-08-19, and the builder would
// then have dropped it silently — a production with no builder handler parses
// and vanishes, which has now happened four times in this codebase.
const parse = parseHelper<Model>(createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML);

const SOURCE = `package t {
    part scrHome : UIElement {
        package grpHeader {
            part btnBack : UIElement;
            part btnClose : UIElement;
        }
        part footer : UIElement;
    }
    viewpoint vpSoS : MemoViewpoint {
        viewpoint vpSubA : MemoViewpoint;
    }
}`;

describe('grouping constructs inside a usage body', () => {
    it('parses a nested package and a nested viewpoint', async () => {
        const doc = await parse(SOURCE);
        expect(doc.parseResult.parserErrors.map(e => e.message)).toEqual([]);
    });

    it('the nested package survives into the AST with its members', async () => {
        const doc = await parse(SOURCE);
        const pkg = doc.parseResult.value.members?.[0] as any;
        const screen = pkg.members.find((m: any) => m.name === 'scrHome');
        const group = screen.body.find((m: any) => m.$type === 'PackageDeclaration');
        expect(group?.name).toBe('grpHeader');
        expect(group.members.map((m: any) => m.name)).toEqual(['btnBack', 'btnClose']);
    });

    it('a viewpoint nests a viewpoint', async () => {
        const doc = await parse(SOURCE);
        const pkg = doc.parseResult.value.members?.[0] as any;
        const vp = pkg.members.find((m: any) => m.name === 'vpSoS');
        expect(vp.body.some((m: any) => m.$type === 'ViewpointUsage' && m.name === 'vpSubA')).toBe(true);
    });
});
