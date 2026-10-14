import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildForRecord, previousRelease } from '../model/pinned.js';
import { createVersionServers, type VersionServers } from '../server/version-servers.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// A11/A14: the model of any release record, the previous release found by ancestry, and what changed
// between two releases. On a throwaway repository with real history (`helpers/pinned-repo.ts`).

const toolchain = { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } as never;

describe.runIf(compilerConfigured && examplesPresent)('releases compared (A11, A14)', () => {
    let repo: FamilyRepo;
    let working: ProjectModel;
    let servers: VersionServers;
    let scratch: string;
    const id = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;

    beforeAll(async () => {
        repo = createFamilyRepo();
        working = await loadProjectModel({ projectRoot: repo.root, config: { toolchain } as never, cache: false });
        scratch = realpathSync(mkdtempSync(join(tmpdir(), 'memo-diff-')));
        const entry = join(scratch, 'child.mjs');
        writeFileSync(entry, 'process.send({ type: "memo:read-only-ready", url: "http://127.0.0.1:1" }); setInterval(() => {}, 1000);');
        servers = createVersionServers({ projectRoot: repo.root, entry, args: [], workingModel: () => working.model, workingUrl: () => 'http://x', toolchain });
    }, 240_000);
    afterAll(() => { servers?.close(); repo?.remove(); rmSync(scratch, { recursive: true, force: true }); });

    it('builds a system release at its own commit, opened on that system, and an SoS version assembled', async () => {
        const system = await buildForRecord(repo.root, working, id('relMapping'), { config: { toolchain } });
        expect(system.commit).toBe(repo.c2);
        expect(system.info).toMatchObject({ kind: 'release', label: 'relMapping', workspace: id('CardiacMappingSystem') });
        expect(system.info.commits).toEqual([{ name: 'release', commit: repo.c2 }]);
        const sos = await buildForRecord(repo.root, working, id('relLabV1'), { config: { toolchain } });
        expect(sos.info.kind).toBe('release');
        expect(sos.info.workspace).toBeUndefined();
        expect(sos.info.commits?.map(c => c.name).sort()).toEqual(['ablation', 'mapping', 'recording', 'version']);
    }, 240_000);

    it('finds the previous release as the nearest earlier record of the same item, and guesses nothing', async () => {
        const previous = async (name: string) => {
            const found = await previousRelease(repo.root, working.model, id(name));
            return found ? working.model.elements.get(found)!.shortName : undefined;
        };
        expect(await previous('relFirmwareB')).toBe('relFirmwareA');
        // c1 is also earlier, but c2 is nearer.
        expect(await previous('relFirmwareLate')).toBe('relFirmwareB');
        expect(await previous('relFirmwareA')).toBeUndefined();
        // The only record of its item.
        expect(await previous('relMapping')).toBeUndefined();
        // The side branch and the main line are both ancestors of the merge and unordered: no previous.
        expect(await previous('relFirmwareMerge')).toBeUndefined();
    }, 240_000);

    it('says what changed between a release and the previous one, with stable relationship ids', async () => {
        const result = await servers.diff(id('relFirmwareB'), 'previous');
        expect(result.previous).toBe(true);
        expect([result.before.label, result.after.label]).toEqual(['relFirmwareA', 'relFirmwareB']);
        expect([result.before.commit, result.after.commit]).toEqual([repo.c1, repo.c2]);
        // c2 changed one system's description and nothing else.
        expect(result.diff.changed.map(c => `${c.name}: ${c.changes.join(',')}`)).toEqual(['CardiacMappingSystem: attributes changed']);
        expect(result.diff.summary).toEqual({ added: 0, removed: 0, changed: 1, addedRels: 0, removedRels: 0 });

        const wide = await servers.diff(id('relFirmwareLate'), 'previous');
        expect([wide.before.label, wide.after.label]).toEqual(['relFirmwareB', 'relFirmwareLate']);
        // c2 to c4 changed the other two systems, and added the release records themselves (and their links).
        expect(wide.diff.changed.map(c => c.name).sort()).toEqual(['AblationGeneratorSystem', 'CardiacMappingSystem', 'SignalRecordingSystem']);
        expect(wide.diff.added.map(a => a.name)).toContain('relLabV1');
        expect(wide.diff.removed).toEqual([]);
        expect(wide.diff.removedRels).toEqual([]);
        expect(wide.diff.addedRels.map(r => r.type)).toContain('contains');
    }, 240_000);

    it('compares against a named release, and refuses when there is no previous one', async () => {
        const named = await servers.diff(id('relFirmwareB'), id('relFirmwareA'));
        expect(named.previous).toBe(false);
        expect(named.diff.summary.changed).toBe(1);
        await expect(servers.diff(id('relMapping'), 'previous')).rejects.toThrow(/no previous release/);
        await expect(servers.diff(id('relFirmwareMerge'), 'previous')).rejects.toThrow(/no previous release/);
    }, 240_000);
});
