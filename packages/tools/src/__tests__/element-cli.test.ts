// ─── memo element — the CLI half of write-back ───────────────────────────────
//
// §1.2.2 rule 2: an operation reachable from Architect has a CLI command, and a
// capability that exists only in the server is a defect. Write-back was exactly
// that between Session 7 and this one. These tests hold the command to the same
// behaviour the server handler has — identity addressing, a loud failure on a
// stale address, recompilation through the selected lowering provider — rather
// than merely checking that a command exists.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elementIdentitiesCommand, elementWriteCommand } from '../commands/element.js';

const TWO_NAMESPACES = `package Plant {
    package Upstream {
        part pump : Component;
    }
    package Downstream {
        part pump : Component;
    }
}
`;

let projectRoot: string;

beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'memo-element-cli-'));
    writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
});

afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function writeProjectFile(relativePath: string, contents: string): void {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
}

/** Run a command with stdout captured, and hand back what it printed. */
async function capture(run: () => Promise<void>): Promise<{ out: string; err: string; exit?: number }> {
    const out: string[] = [];
    const err: string[] = [];
    let exit: number | undefined;
    vi.spyOn(console, 'log').mockImplementation((...args) => { out.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { err.push(args.join(' ')); });
    // `process.exit` is how every command in this CLI reports failure. Throwing
    // instead of exiting keeps the test process alive while still stopping the
    // command where it would have stopped.
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exit = code ?? 0;
        throw new Error('process.exit');
    }) as never);
    try {
        await run();
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'process.exit') throw error;
    }
    return { out: out.join('\n'), err: err.join('\n'), exit };
}

async function identities(): Promise<Record<string, string>> {
    const { out } = await capture(() => elementIdentitiesCommand(projectRoot, { format: 'json' }));
    return JSON.parse(out).identities as Record<string, string>;
}

async function declarations(): Promise<{ identity: string; element?: string; metaclass: string }[]> {
    const { out } = await capture(() => elementIdentitiesCommand(projectRoot, { format: 'json' }));
    return JSON.parse(out).declarations;
}

describe('memo element identities', () => {
    it('prints an addressable identity per projected element', async () => {
        const { out } = await capture(() => elementIdentitiesCommand(projectRoot, { format: 'json' }));
        const report = JSON.parse(out);

        expect(report.provider).toBeTruthy();
        const values = Object.values(report.identities as Record<string, string>);
        expect(values.length).toBeGreaterThan(0);
        // The identity is `file-URI # declaration-path : metaclass`, which is
        // what makes it positional rather than name-based.
        expect(values.every(identity => identity.includes('#') && identity.includes(':'))).toBe(true);
    });

    it('gives two same-named declarations in different namespaces distinct addresses', async () => {
        const pumps = (await declarations()).filter(row => row.identity.endsWith(':PartUsage'));

        expect(pumps.length).toBe(2);
        expect(new Set(pumps.map(row => row.identity)).size).toBe(2);
    });

    it('lists declarations the flat Memo projection cannot key, because a write can still reach them', async () => {
        // MEMO keys an element by its bare ID, so `Upstream::pump` and
        // `Downstream::pump` project to one Memo element. The Memo-keyed table
        // therefore names one of the two; the IR-keyed listing names both, and
        // it is the IR identity that a write is addressed by.
        const table = await identities();
        const rows = await declarations();

        expect(Object.keys(table)).toEqual(['pump']);
        expect(rows.filter(row => row.element).length).toBe(1);
        expect(rows.filter(row => !row.element).length).toBe(1);
    });

    it('fails, rather than printing nothing, for an element the project does not have', async () => {
        const { err, exit } = await capture(() => elementIdentitiesCommand(projectRoot, { id: 'nope', format: 'json' }));
        // JSON format prints an empty table; text format is the one that has to
        // say something, so this is checked there.
        expect(exit).toBeUndefined();
        expect(err).toBe('');

        const text = await capture(() => elementIdentitiesCommand(projectRoot, { id: 'nope' }));
        expect(text.exit).toBe(1);
        expect(text.err).toMatch(/No element "nope"/);
    });
});

describe('memo element write', () => {
    it('creates a declaration and returns the identity the write minted', async () => {
        const { out } = await capture(() => elementWriteCommand(projectRoot, {
            id: 'tank', kind: 'Component', construct: 'part', file: 'model/plant.sysml', format: 'json',
        }));
        const report = JSON.parse(out);

        expect(report.success).toBe(true);
        expect(report.sourceFile).toContain('plant.sysml');
        expect(report.irIdentity).toBeTruthy();
        expect(readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8')).toContain('tank');
    });

    it('updates by IR identity, editing only the declaration that identity names', async () => {
        const table = await identities();
        const [elementId, identity] = Object.entries(table).find(([id]) => id.toLowerCase().includes('pump'))!;
        const before = readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8');

        const { out } = await capture(() => elementWriteCommand(projectRoot, {
            id: elementId, kind: 'Component', construct: 'part', doc: 'Feed pump.',
            file: 'model/plant.sysml', irIdentity: identity, format: 'json',
        }));
        const report = JSON.parse(out);
        const after = readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8');

        expect(report.success).toBe(true);
        expect(report.replaced).toBe(true);
        // One of the two same-named declarations gained documentation; the
        // other is untouched, which a name-addressed write could not promise.
        expect(after).toContain('Feed pump.');
        expect(after.split('Feed pump.').length - 1).toBe(1);
        expect(after).not.toBe(before);
    });

    it('refuses a stale identity loudly and writes nothing', async () => {
        const before = readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8');
        const stale = `${resolve(projectRoot, 'model/plant.sysml')}#members[9]/members[9]:PartUsage`;

        const { out, exit } = await capture(() => elementWriteCommand(projectRoot, {
            id: 'pump', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', irIdentity: `file://${stale}`, format: 'json',
        }));

        expect(exit).toBe(1);
        expect(JSON.parse(out)).toMatchObject({ success: false, stale: true });
        expect(readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8')).toBe(before);
    });

    it('rejects a request with no element to write', async () => {
        const { err, exit } = await capture(() => elementWriteCommand(projectRoot, { kind: 'Component' }));
        expect(exit).toBe(1);
        expect(err).toMatch(/needs --id/);
    });

    it('rejects a malformed --attribute rather than guessing at it', async () => {
        const { err, exit } = await capture(() => elementWriteCommand(projectRoot, {
            id: 'tank', attribute: ['pressure'],
        }));
        expect(exit).toBe(1);
        expect(err).toMatch(/key=value/);
    });

    it('accepts a whole request from a file, as a scripted caller would send it', async () => {
        const requestPath = join(projectRoot, 'request.json');
        writeFileSync(requestPath, JSON.stringify({
            id: 'valve', kind: 'Component', construct: 'part', file: 'model/plant.sysml',
            attributes: { pressure: '3 bar' },
        }), 'utf8');

        const { out } = await capture(() => elementWriteCommand(projectRoot, { request: requestPath, format: 'json' }));

        expect(JSON.parse(out).success).toBe(true);
        expect(readFileSync(resolve(projectRoot, 'model/plant.sysml'), 'utf8')).toContain('valve');
    });
});
