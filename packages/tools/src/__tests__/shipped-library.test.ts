// ─── A library's shipped stage 1 export ──────────────────────────────────────
//
// The portable-path round trip always runs. With a compiler configured
// (`MEMO_SYSIDE_PYTHON`; `OPENSYSML_BINARY` with `MEMO_OPENSYSML_CLIENT`), the
// library set of temperature-alarm is shipped into a scratch package and a cold
// compile that reads the shipped file must build the model a cold compile that
// exports the libraries itself builds (plans/memo-incremental-stage1.md, step 4).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverProjectSources } from '../model/native-project.js';
import type { MEMOConfig } from '../model/config.js';
import { SHIPPED_DIR, fromPortable, toPortable } from '../toolchain/shipped-library.js';
import { shipOpenSysMLLibrary } from '../toolchain/providers/opensysml-lowering.js';
import { shipSysideLibrary } from '../toolchain/providers/syside-lowering.js';

describe('portable library paths', () => {
    const dirs = ['/a/lib', '/a/lib/nested', '/b/other'];
    const text = JSON.stringify({
        documents: [{ file: 'x.sysml', root: '/a/lib', elements: [{ 'sysx:sourceDocument': '/a/lib/nested/y.sysml' }] }],
        index: { one: { root: '/b/other' } },
    });
    it('replaces each root with its place and restores it elsewhere', () => {
        const portable = toPortable(text, dirs);
        expect(portable).not.toContain('/a/lib');
        expect(portable).toContain('"@root/0"');
        expect(fromPortable(portable, dirs)).toBe(text);
        expect(JSON.parse(fromPortable(portable, ['/m/one', '/m/two', '/m/three'])).index.one.root).toBe('/m/three');
    });
    it('refuses a path under none of the roots', () => {
        expect(() => toPortable('{"root":"/elsewhere"}', dirs)).toThrow(/under none of its library roots/);
    });
});

const memo = resolve(__dirname, '../../../../../memo');
const example = join(memo, 'examples/temperature-alarm');
const python = process.env.MEMO_SYSIDE_PYTHON;
const binary = process.env.OPENSYSML_BINARY;
const client = process.env.MEMO_OPENSYSML_CLIENT;

const cli = resolve(__dirname, '../../lib/bin/memo.js');

/**
 * A cold compile is a process of its own: a worker or a kept library handoff
 * from an earlier compile in this one would make the shipped file unread.
 * Returns the compiled model it wrote and how long the compile took.
 */
function coldCompile(root: string, flags: string[], label: string): { model: string; seconds: number } {
    const out = join(root, `${label}.json`);
    rmSync(join(root, '.memo'), { recursive: true, force: true });
    const output = execFileSync(process.execPath, [cli, 'compile', root, '--force', '--out', out, ...flags], { encoding: 'utf8', env: process.env });
    const seconds = Number(/,\s*([\d.]+)s\)/.exec(output)?.[1]);
    const model = JSON.parse(readFileSync(out, 'utf8')) as { documents: unknown; index: Record<string, unknown> };
    // The index's key order is not stable between two ordinary compiles (SysIDE's export walks a set), its entries are.
    const index = Object.entries(model.index).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return { model: createHash('sha256').update(JSON.stringify([model.documents, index])).digest('hex'), seconds };
}

/**
 * Ship the library set of temperature-alarm, where a package carries it
 * (`memo/stage1/`, ignored by git, removed afterwards), and compile with and
 * without the file.
 */
async function check(
    compiler: string, flags: string[],
    ship: (config: MEMOConfig, dirs: readonly string[], out: string) => Promise<string[]>,
    config: unknown,
): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), `memo-shipped-${compiler}-`));
    cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
    const libraryDirs = [...new Set(discoverProjectSources(root).libraryRoots.map(r => r.sysmlDir))];
    const out = join(memo, SHIPPED_DIR);
    let written: string[] = [];
    try {
        const own = coldCompile(root, flags, 'exports-itself');
        written = await ship(config as MEMOConfig, libraryDirs, out);
        expect(written.length).toBeGreaterThan(0);
        const shipped = coldCompile(root, flags, 'reads-shipped');
        expect(shipped.model).toBe(own.model);
        console.log(`${compiler} cold compile: exports the libraries ${own.seconds}s, reads the shipped file ${shipped.seconds}s`);
    } finally {
        for (const file of written) rmSync(file, { force: true });
        rmSync(root, { recursive: true, force: true });
    }
}

describe.runIf(Boolean(python) && existsSync(example))('shipped library export, SysIDE', () => {
    it('a cold compile from the shipped file equals one that exports the libraries', async () => {
        await check('syside', ['--toolchain.compiler=syside', `--toolchain.syside.python=${python}`], shipSysideLibrary,
            { projectName: 'x', toolchain: { compiler: 'syside', syside: { python } } });
    }, 300_000);
});

describe.runIf(Boolean(binary && client) && existsSync(example))('shipped library export, OpenSysML', () => {
    it('a cold compile from the shipped file equals one that exports the libraries', async () => {
        await check('opensysml',
            ['--toolchain.compiler=opensysml', `--toolchain.opensysml.binary=${binary}`, `--toolchain.opensysml.client=${client}`],
            shipOpenSysMLLibrary, { projectName: 'x', toolchain: { compiler: 'opensysml', opensysml: { binary, client } } });
    }, 300_000);
});
