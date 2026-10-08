// ─── The baseline verifier's differ and verdict ───────────────────────────────
//
// `scripts/baseline-diff.mjs`: rows are matched by what they name, not by
// position, so a respelled id is not a rewrite; and INCOMPLETE means a fixture
// was not checked, not that one diverged.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Verdict { ok: boolean; checked: number; diverged: number; unchecked: string[] }
interface BaselineDiff {
    diff(expected: unknown, actual: unknown): string[];
    verify(input: {
        fixtures: { id: string }[]; baselineDir: string; capture: (spec: { id: string }) => unknown;
        log: (line: string) => void; error: (line: string) => void;
    }): Verdict;
}

async function load(): Promise<BaselineDiff> {
    return await import(pathToFileURL(resolve(__dirname, '../../../../scripts/baseline-diff.mjs')).href) as BaselineDiff;
}

const model = (ids: string[], extra: Record<string, unknown> = {}) => ({
    model: {
        elements: ids.map(id => ({ id, kind: 'Hazard', package: 'p', ...extra })),
        relationships: [
            { type: 'mitigates', sourceId: ids[0], targetId: ids[1] },
            { type: 'composes', sourceId: ids[1], targetId: ids[2] },
        ],
    },
    validation: { violations: [{ rule: 'CR-1', severity: 'warning', elementId: ids[2] }] },
});

describe('the differ', () => {
    it('reads a respelled id, in a different order, as no change', async () => {
        const { diff } = await load();
        const before = model(['p::a', 'p::b', 'p::c']);
        const after = model(['p::q::a', 'p::q::b', 'p::q::c']);
        // Reorder the arrays too, which is what a respelling does to a sorted list.
        after.model.elements.reverse();
        after.model.relationships.reverse();
        expect(diff(before, after)).toEqual([]);
    });

    it('still reports an element added, removed and changed, and a relationship dropped', async () => {
        const { diff } = await load();
        const before = model(['p::a', 'p::b', 'p::c']);
        const after = model(['p::a', 'p::b', 'p::d']);
        after.model.elements[0].kind = 'Requirement';
        after.model.relationships.pop();
        const found = diff(before, after).join('\n');
        expect(found).toContain('removed c');
        expect(found).toContain('added d');
        expect(found).toContain('[a].kind');
        expect(found).toContain('removed composes: b → c');
        // Three rows of three did not move, so three rows are not reported.
        expect(found).not.toContain('[b]');
    });
});

describe('the verdict', () => {
    function run(frozen: Record<string, unknown>, ids: string[], captured: (id: string) => unknown) {
        const dir = mkdtempSync(join(tmpdir(), 'memo-baseline-'));
        const lines: string[] = [];
        try {
            for (const [id, value] of Object.entries(frozen)) writeFileSync(join(dir, `${id}.json`), JSON.stringify(value));
            return load().then(({ verify }) => ({
                verdict: verify({
                    fixtures: ids.map(id => ({ id })), baselineDir: dir,
                    capture: spec => captured(spec.id), log: l => lines.push(l), error: l => lines.push(l),
                }),
                text: lines.join('\n'),
            }));
        } finally {
            // verify is synchronous once loaded; the directory is read before the promise settles.
            setTimeout(() => rmSync(dir, { recursive: true, force: true }), 1000);
        }
    }

    it('counts one diverged fixture once, and does not call it INCOMPLETE', async () => {
        const same = model(['p::a', 'p::b', 'p::c']);
        const changed = model(['p::a', 'p::b', 'p::c'], { kind: 'Requirement' });
        const { verdict, text } = await run({ one: same, two: same }, ['one', 'two'], id => (id === 'one' ? changed : same));
        expect(verdict).toMatchObject({ ok: false, checked: 2, diverged: 1, unchecked: [] });
        expect(text).toContain('1 fixture(s) diverged, 0 not checked');
        expect(text).not.toContain('INCOMPLETE');
    });

    it('calls a fixture with no baseline INCOMPLETE, and names it', async () => {
        const same = model(['p::a', 'p::b', 'p::c']);
        const { verdict, text } = await run({ one: same }, ['one', 'two'], () => same);
        expect(verdict).toMatchObject({ ok: false, checked: 1, diverged: 0, unchecked: ['two'] });
        expect(text).toContain('INCOMPLETE baseline verification: checked 1/2 fixtures, not checked: two');
    });
});
