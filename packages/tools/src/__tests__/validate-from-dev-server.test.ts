import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilerConfigured, withExample } from './helpers/compile-source.js';

// `memo validate` beside a running `memo dev` is answered from the model the
// server holds instead of compiling the project again, and the answer is the
// one a run of its own gives — including right after a file changed on disk,
// before the server's watcher rebuilt. Runs the built CLI and server.

const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');
const OPERATIONS = pathToFileURL(join(__dirname, '../../lib/operations/index.js')).href;
const FILE = 'model/catalog/temperature_alarm.sysml';
const SERVED = 'answered by the dev server running for this project';

function validate(root: string, ...args: string[]) {
    return spawnSync('node', [CLI_PATH, 'validate', root, '--format', 'json', ...args], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });
}

/** The report a run gives, without what differs between two runs of one model. */
function report(stdout: string): unknown {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    delete parsed.timestamp;
    return parsed;
}

async function freePort(): Promise<number> {
    return new Promise(done => {
        const probe = createServer().listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => done(port));
        });
    });
}

async function startDevServer(root: string): Promise<ChildProcess> {
    const port = await freePort();
    const start = `import(${JSON.stringify(OPERATIONS)}).then(m => m.startProjectServer({`
        + `port: ${port}, open: false, exitWhenIdle: false, clientRoot: ${JSON.stringify(join(root, 'no-client'))} }))`;
    const server = spawn('node', ['-e', start], { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: 'ignore' });
    const record = join(root, '.memo', 'dev-server.json');
    for (let waited = 0; !existsSync(record); waited += 200) {
        if (waited > 120_000 || server.exitCode !== null) throw new Error('memo dev did not start');
        await new Promise(done => setTimeout(done, 200));
    }
    return server;
}

describe.runIf(compilerConfigured)('memo validate answered by a running memo dev', () => {
    it('answers from the model it holds, as a run of its own does, and stays current', async () => {
        await withExample({}, async (_project, root) => {
            const server = await startDevServer(root);
            try {
                const served = validate(root);
                const local = validate(root, '--no-server');
                expect(served.stderr).toContain(SERVED);
                expect(local.stderr).not.toContain(SERVED);
                expect(served.status).toBe(local.status);
                expect(report(served.stdout)).toEqual(report(local.stdout));

                // Broken on disk, before the watcher could rebuild: the answer is
                // the broken model's, never the last good one's.
                const file = join(root, FILE);
                writeFileSync(file, readFileSync(file, 'utf8') + '\npart broken : ;\n');
                const brokenServed = validate(root);
                const brokenLocal = validate(root, '--no-server');
                expect(brokenServed.stderr).toContain(SERVED);
                expect(brokenLocal.status).not.toBe(0);
                expect(brokenServed.status).toBe(brokenLocal.status);

                // Without the record's token the route refuses.
                const record = JSON.parse(readFileSync(join(root, '.memo', 'dev-server.json'), 'utf8')) as { url: string };
                const refused = await fetch(new URL('/__memo/validate', record.url), { method: 'POST', body: '{}' });
                expect(refused.status).toBe(403);
            } finally {
                server.kill('SIGTERM');
                await new Promise(done => server.once('exit', done));
            }
            expect(existsSync(join(root, '.memo', 'dev-server.json'))).toBe(false);
            expect(validate(root, '--no-server').stderr).not.toContain(SERVED);
            expect(validate(root).stderr).not.toContain(SERVED);
        });
    }, 300_000);
});
