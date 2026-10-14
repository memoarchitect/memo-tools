import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVersionServers, listRefs, type VersionServers } from '../server/version-servers.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// Opening a version: the unreleased refs on offer, and a read-only server started for a pinned release
// or ref, resolved first by the library so an ordering error is an answer and not a dead child. The
// child here is a stand-in that speaks the same IPC protocol; the real one is `memo-architect dev`,
// checked in the app.

const config = { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;

describe.runIf(compilerConfigured && examplesPresent)('opening a version (A1, A14)', () => {
    let repo: FamilyRepo;
    let working: ProjectModel;
    let scratch: string;
    let servers: VersionServers;
    let entry: string;
    const idOf = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;

    beforeAll(async () => {
        repo = createFamilyRepo();
        working = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
        scratch = realpathSync(mkdtempSync(join(tmpdir(), 'memo-version-')));
        entry = join(scratch, 'child.mjs');
        // A child that records what it was started with and says where it is.
        writeFileSync(entry, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(scratch, 'child.json'))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), info: process.env.MEMO_PINNED_INFO, prefs: process.env.MEMO_PINNED_PREFERENCES }));
process.send({ type: 'memo:read-only-ready', url: 'http://127.0.0.1:' + (40000 + process.pid % 1000) });
process.on('disconnect', () => process.exit(0)); setInterval(() => {}, 1000);
`);
        servers = createVersionServers({
            projectRoot: repo.root, entry, args: ['--toolchain.compiler=syside'],
            workingModel: () => working.model, workingUrl: () => 'http://127.0.0.1:3000',
            toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } as never,
        });
    }, 180_000);
    afterAll(() => { servers?.close(); repo?.remove(); rmSync(scratch, { recursive: true, force: true }); });

    it('offers the tip of the current branch and the latest tag, both marked as not releases', async () => {
        const refs = await listRefs(repo.root);
        expect(refs.map(r => `${r.kind}:${r.label}`)).toEqual([expect.stringMatching(/^branch:Latest commit on /), 'tag:Latest tag rc-mapping']);
        expect(refs[0].commit).toBe(repo.c6);
        expect(refs[1].commit).toBe(repo.c2);
    });

    it('opens a release in its assembled directory, read-only, telling the child where the working model is', async () => {
        const opened = await servers.open({ release: idOf('relLabV1') });
        expect(opened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(opened.info).toMatchObject({ kind: 'release', label: 'relLabV1', workingUrl: 'http://127.0.0.1:3000' });
        expect(opened.info.commits?.map(c => c.name).sort()).toEqual(['ablation', 'mapping', 'recording', 'version']);
        const started = JSON.parse(readFileSync(join(scratch, 'child.json'), 'utf8'));
        expect(started.argv).toEqual(['dev', '--pinned-dir', started.cwd, '--port', '0', '--no-open', '--toolchain.compiler=syside']);
        expect(started.cwd).toContain(join(repo.root, '.memo', 'assembled'));
        expect(started.prefs).toBe(repo.root);
        expect(JSON.parse(started.info).kind).toBe('release');
    }, 180_000);

    it('reuses the child for a version already open, and opens an unreleased ref as a ref', async () => {
        const first = await servers.open({ release: idOf('relLabV1') });
        const again = await servers.open({ release: idOf('relLabV1') });
        expect(again.url).toBe(first.url);
        const tag = await servers.open({ ref: 'rc-mapping' });
        expect(tag.info).toMatchObject({ kind: 'ref', label: 'rc-mapping', notARelease: true });
        expect(tag.url).not.toBe(first.url);
    }, 180_000);

    it('answers an ordering error as an error, and starts nothing', async () => {
        await expect(servers.open({ release: idOf('relLabOld') })).rejects.toThrow(/at or after what it contains/);
        await expect(servers.open({ ref: 'no-such-ref' })).rejects.toThrow(/not a commit or a ref/);
        await expect(servers.open({})).rejects.toThrow(/say which version/);
    }, 180_000);
});
