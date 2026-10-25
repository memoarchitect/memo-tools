import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offerNpmInstall, pinMismatches, type InstallPromptEnvironment } from '../pin-check.js';

// ─── The installed packages are not the ones package.json pins ───────────────
//
// At the start of the app the user is asked whether to `npm install`. Without a terminal nothing waits,
// and a linked workspace checkout is a developer's own build, not a pin to honour.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

function project(pinned: string, installed: string, link = false): void {
    writeFileSync(join(root, 'memo.package.yaml'), 'name: scratch\nversion: 0.1.0\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'scratch', dependencies: { '@memoarchitect/ontology': pinned } }));
    const dir = join(root, 'node_modules', '@memoarchitect', 'ontology');
    if (link) {
        const real = join(root, 'checkout');
        mkdirSync(real, { recursive: true });
        writeFileSync(join(real, 'package.json'), JSON.stringify({ name: '@memoarchitect/ontology', version: installed }));
        mkdirSync(join(root, 'node_modules', '@memoarchitect'), { recursive: true });
        symlinkSync(real, dir);
    } else {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@memoarchitect/ontology', version: installed }));
    }
}

function environment(answer: string, interactive = true) {
    const calls = { asked: 0, installed: [] as string[], log: [] as string[] };
    const env: InstallPromptEnvironment = {
        interactive,
        ask: async () => { calls.asked++; return answer; },
        install: dir => { calls.installed.push(dir); },
        log: line => { calls.log.push(line); },
    };
    return { env, calls };
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pin-check-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pinMismatches', () => {
    it('names a package installed outside the version package.json pins', () => {
        project('0.16.1', '0.15.0');
        expect(pinMismatches(root)).toEqual([{ name: '@memoarchitect/ontology', pinned: '0.16.1', installed: '0.15.0' }]);
    });

    it('leaves a matching install and a linked checkout alone', () => {
        project('0.16.1', '0.16.1');
        expect(pinMismatches(root)).toEqual([]);
        rmSync(join(root, 'node_modules'), { recursive: true, force: true });
        project('0.16.1', '0.0.1', true);
        expect(pinMismatches(root)).toEqual([]);
    });
});

describe('offerNpmInstall', () => {
    it('installs when the user says yes, and asks for a restart', async () => {
        project('0.16.1', '0.15.0');
        const { env, calls } = environment('');
        expect(await offerNpmInstall(root, env)).toBe('installed');
        expect(calls.installed).toEqual([root]);
        expect(calls.log.join('\n')).toContain('Start the app again');
    });

    it('goes on with what is installed when the user says no, and installs nothing', async () => {
        project('0.16.1', '0.15.0');
        const { env, calls } = environment('n');
        expect(await offerNpmInstall(root, env)).toBe('continue');
        expect(calls.installed).toEqual([]);
    });

    it('does not ask without a terminal, so a preview launch or CI never waits', async () => {
        project('0.16.1', '0.15.0');
        const { env, calls } = environment('y', false);
        expect(await offerNpmInstall(root, env)).toBe('continue');
        expect(calls.asked).toBe(0);
        expect(calls.installed).toEqual([]);
    });

    it('does not ask when nothing differs', async () => {
        project('0.16.1', '0.16.1');
        const { env, calls } = environment('y');
        expect(await offerNpmInstall(root, env)).toBe('continue');
        expect(calls.asked).toBe(0);
    });
});
