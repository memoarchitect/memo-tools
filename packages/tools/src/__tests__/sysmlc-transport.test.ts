// The §2.1 exit tests: MEMO's own compiler, reached as a tool.
//
// The point of shipping `sysmlc` is that a contract you can only reach
// in-process is a contract you can cheat — pass by reference, share state, skip
// serialization. So the test that matters is not "the process transport works",
// it is **the two transports are indistinguishable**. If they ever diverge, the
// in-process path has grown a shortcut the protocol does not have, and the
// boundary has stopped being one.
//
// These spawn a real `sysmlc` over a real pipe. That is deliberate: CI runs the
// process transport precisely because it is not the default, and an unexercised
// boundary rots.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runLowering } from '../toolchain/operations.js';
import { loadProjectConfig, lowerProject } from '../toolchain/lowering.js';
import { disposeSysmlcClients } from '../toolchain/sysmlc-client.js';
import { findBundledExecutable, whichExecutable } from '../toolchain/process.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import {
    SYSMLC_PROTOCOL_VERSION,
    assertProtocolCompatible,
    isProtocolCompatible,
} from '../toolchain/protocol.js';
import { buildProjectSnapshot, forgetLastGoodModel } from '../operations/project-snapshot.js';
import type { MEMOConfig } from '../model/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(HERE, '../../../../../memo/examples');

/**
 * The corpus defines itself: a directory is a MEMO project when it declares one
 * in SysML. Listing them here instead would mean a new example silently escapes
 * the test that says the transports agree.
 */
function exampleProjects(): string[] {
    if (!existsSync(EXAMPLES)) return [];
    return readdirSync(EXAMPLES).sort()
        .map(name => join(EXAMPLES, name))
        .filter(dir => existsSync(join(dir, 'model/catalog/project.sysml')));
}

function withTransport(config: MEMOConfig, transport: string): MEMOConfig {
    return {
        ...config,
        toolchain: { ...config.toolchain, internal: { transport } },
    };
}

afterAll(async () => {
    await disposeSysmlcClients();
});

describe('the protocol is versioned, and the version is checked', () => {
    it('accepts a matching major', () => {
        expect(isProtocolCompatible(SYSMLC_PROTOCOL_VERSION)).toBe(true);
        expect(isProtocolCompatible('1.7.3', '1.0.0')).toBe(true);
    });

    it('refuses a different major, and refuses silence', () => {
        expect(isProtocolCompatible('2.0.0', '1.0.0')).toBe(false);
        expect(isProtocolCompatible(undefined)).toBe(false);
        // A server that advertises nothing is the case worth being strict
        // about: it is what any *other* LSP server on PATH looks like.
        expect(() => assertProtocolCompatible(undefined, 'a server')).toThrow(/protocol/i);
    });
});

describe('both transports produce byte-identical results', () => {
    const projects = exampleProjects();

    it('found a corpus to compare over', () => {
        expect(projects.length).toBeGreaterThan(0);
    });

    for (const projectDir of projects) {
        const name = projectDir.slice(EXAMPLES.length + 1);
        it(`agrees on ${name}`, async () => {
            const config = loadProjectConfig(projectDir);
            const inProcess = await runLowering({
                config: withTransport(config, 'in-process'), projectDir,
            });
            const spawned = await runLowering({
                config: withTransport(config, 'process'), projectDir,
            });

            expect(inProcess.transport).toBe('in-process');
            expect(spawned.transport).toBe('process');
            // Byte-identical, not merely equivalent: the IR crosses a pipe as
            // JSON, so JSON is the form the comparison has to be made in.
            expect(JSON.stringify(spawned.ir)).toEqual(JSON.stringify(inProcess.ir));
            expect(JSON.stringify(spawned.diagnostics)).toEqual(JSON.stringify(inProcess.diagnostics));
            expect(spawned.accepted).toBe(inProcess.accepted);
        }, 120_000);
    }
});

describe('an explicit source list crosses the pipe too', () => {
    // Protocol 1.1.0 added `files`. If only the in-process transport honoured
    // it, "any provider can fill the lowering role" would quietly stop being
    // true of the one case that needs it: a corpus is a file set, not a project.
    it('agrees on a subset of a project, and the subset is smaller', async () => {
        const projectDir = exampleProjects()[0];
        const config = loadProjectConfig(projectDir);
        const all = findSysmlFiles(projectDir).sort();
        expect(all.length).toBeGreaterThan(1);
        const subset = all.slice(0, Math.max(1, Math.floor(all.length / 2)));

        const inProcess = await runLowering({
            config: withTransport(config, 'in-process'), projectDir, files: subset,
        });
        const spawned = await runLowering({
            config: withTransport(config, 'process'), projectDir, files: subset,
        });
        const whole = await runLowering({
            config: withTransport(config, 'process'), projectDir,
        });

        expect(JSON.stringify(spawned.ir)).toEqual(JSON.stringify(inProcess.ir));
        // The subset has to actually restrict the run. Without this the test
        // would pass against a server that ignored `files` entirely — which is
        // precisely the failure mode an optional protocol field invites.
        expect(Object.keys(spawned.ir.model.elements).length)
            .toBeLessThan(Object.keys(whole.ir.model.elements).length);
    }, 120_000);
});

describe('a superseded revision never emits a stale result', () => {
    it('answers the overtaken request with the newer model, not the old one', async () => {
        const projectDir = mkdtempSync(join(tmpdir(), 'memo-sysmlc-'));
        try {
            cpSync(join(EXAMPLES, 'temperature-alarm'), projectDir, { recursive: true });
            const config = withTransport(loadProjectConfig(projectDir), 'process');
            const target = firstProjectSource(projectDir);
            const original = readFileSync(target, 'utf8');
            const probe = (name: string) => `${original}\npackage Probe { part ${name}; }\n`;

            // Warm the server, so the race that follows is between two compiles
            // rather than between a compile and a process start.
            await runLowering({ config, projectDir });

            // Revision N is sent against text the server has not seen, so it has
            // real work to do. While it does, the file changes again and
            // revision N+1 goes out — which is exactly the window in which a
            // compiler that answers with what it finished would put a picture of
            // a dead revision on the canvas.
            writeFileSync(target, probe('firstProbe'));
            const overtaken = runLowering({ config, projectDir });
            writeFileSync(target, probe('secondProbe'));
            const newer = runLowering({ config, projectDir });

            const [overtakenResult, newerResult] = await Promise.all([overtaken, newer]);
            const names = (result: typeof newerResult) =>
                Object.values(result.ir.model.elements).map(element => element.name);

            expect(names(newerResult)).toContain('secondProbe');
            // The whole rule in two assertions: the overtaken caller did not get
            // the revision it asked for — it got the current one — and it did
            // not get the one the server had already finished computing.
            expect(names(overtakenResult)).toContain('secondProbe');
            expect(names(overtakenResult)).not.toContain('firstProbe');
            expect(JSON.stringify(overtakenResult.ir)).toEqual(JSON.stringify(newerResult.ir));
        } finally {
            await disposeSysmlcClients();
            rmSync(projectDir, { recursive: true, force: true });
        }
    }, 120_000);
});

describe('a clean install with an empty PATH still compiles and draws', () => {
    it('lowers and builds a snapshot with nothing on PATH', async () => {
        const projectDir = join(EXAMPLES, 'temperature-alarm');
        const path = process.env.PATH;
        process.env.PATH = '';
        forgetLastGoodModel(projectDir);
        try {
            // Nothing is resolvable, by construction.
            expect(whichExecutable('sysmlc')).toBeUndefined();
            expect(whichExecutable('syside')).toBeUndefined();

            // And MEMO still works, because its own compiler is never something
            // the user was asked to install. `internal` is always sufficient.
            const ir = await lowerProject(projectDir);
            expect(Object.keys(ir.model.elements).length).toBeGreaterThan(0);

            const snapshot = await buildProjectSnapshot(projectDir);
            expect(Object.keys(snapshot.model.elements).length).toBeGreaterThan(0);
            expect(snapshot.stale).toBe(false);
        } finally {
            process.env.PATH = path;
        }
    }, 120_000);
});

describe('Architect resolves the bundled binary with no user action', () => {
    it('finds sysmlc from an install that depends on it, without PATH', () => {
        const architect = resolve(HERE, '../../../../../memo-architect');
        const manifest = JSON.parse(readFileSync(join(architect, 'package.json'), 'utf8'));
        // Bundling is a declared dependency, not a build step someone remembers.
        expect(Object.keys(manifest.dependencies)).toContain('@memoarchitect/sysmlc');

        const path = process.env.PATH;
        process.env.PATH = '';
        try {
            expect(findBundledExecutable('sysmlc', [architect])).toBeDefined();
        } finally {
            process.env.PATH = path;
        }
    });
});

/** Any project-owned source file, for a test that needs something to edit. */
function firstProjectSource(projectDir: string): string {
    const entry = join(projectDir, 'model/catalog/project.sysml');
    if (existsSync(entry)) return entry;
    throw new Error(`No project entrypoint under ${projectDir}`);
}
