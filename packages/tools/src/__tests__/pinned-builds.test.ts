import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
    PinnedBuildError, buildAt, buildRelease, crossSystemReferences, isAncestor, orderingViolations,
    pinWorktree, releasePins, worktreeIsClean,
} from '../model/pinned.js';
import { servable } from '../commands/validate-client.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// T5: the model at a commit, and an SoS version assembled from the commits its records pin.
// A throwaway repository with real history (`helpers/pinned-repo.ts`), never the memo checkout.

const cli = resolve(__dirname, '../../lib/bin/memo.js');
const config = { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;
const options = { config: { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never };

describe.runIf(compilerConfigured && examplesPresent)('pinned builds (T5)', () => {
    let repo: FamilyRepo;
    let working: ProjectModel;
    // The working model's own stage 1 cache (`.memo/stage1`) is ordinary tool state, not what is tested.
    const status = () => execFileSync('git', ['-C', repo.root, 'status', '--porcelain', '--', '.', ':!.memo/stage1'], { encoding: 'utf8' });
    const idOf = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;
    const boundary = (project: ProjectModel, system: string) => {
        const e = [...project.model.elements.values()].find(el => el.isDefinition && el.shortName === system);
        return e?.attributes.systemBoundaryDescription;
    };

    beforeAll(async () => {
        repo = createFamilyRepo();
        working = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
    }, 180_000);
    afterAll(() => repo?.remove());

    it('reads each system from the commit its own release names', async () => {
        const build = await buildRelease(repo.root, working, idOf('relLabV1'), options);
        // The SoS commit (c3) holds mapping at rev C and recording with rev X; the release pins them earlier.
        expect(boundary(build.project, 'CardiacMappingSystem')).toMatch(/rev B/);       // c2
        expect(boundary(build.project, 'CardiacMappingSystem')).not.toMatch(/rev C/);
        expect(boundary(build.project, 'AblationGeneratorSystem')).toMatch(/rev B/);    // c3
        expect(boundary(build.project, 'SignalRecordingSystem')).not.toMatch(/rev X/);  // c1
        expect(build.releasePins.systems.map(s => `${s.system}@${s.commit.slice(0, 7)}`).sort()).toEqual([
            `ablation@${repo.c3.slice(0, 7)}`, `mapping@${repo.c2.slice(0, 7)}`, `recording@${repo.c1.slice(0, 7)}`,
        ]);
        // The project's own checkout is untouched, and the pinned trees are clean.
        for (const { pin } of build.pins) expect(await worktreeIsClean(pin), pin.dir).toBe(true);
        expect(status()).toBe('');
    }, 180_000);

    it('fails when shared/ at the SoS commit lost what a pinned system still uses, naming the system and commit', async () => {
        const failure = await buildRelease(repo.root, working, idOf('relLabV2'), options).catch(e => e);
        expect(failure).toBeInstanceOf(PinnedBuildError);
        expect((failure as Error).message).toMatch(new RegExp(`systems/mapping@${repo.c2.slice(0, 7)}/.*mapping_system\\.sysml`));
        expect((failure as Error).message).not.toMatch(/assembled\//);
    }, 180_000);

    it('refuses a release earlier than what it contains, at the SoS level and one level down', async () => {
        const sos = await orderingViolations(repo.root, working.model, idOf('relLabOld'));
        expect(sos.map(v => `${v.container}>${v.contained}`).sort()).toEqual(['relLabOld>relAblation', 'relLabOld>relMapping']);
        const nested = await orderingViolations(repo.root, working.model, idOf('relLabLevel'));
        expect(nested.map(v => `${v.container}>${v.contained}`)).toEqual(['relAblationLate>relFirmwareLate']);
        await expect(buildRelease(repo.root, working, idOf('relLabOld'), options)).rejects.toThrow(/at or after what it contains/);
        await expect(buildRelease(repo.root, working, idOf('relLabLevel'), options)).rejects.toThrow(/relAblationLate .* contains relFirmwareLate/);
        expect(await orderingViolations(repo.root, working.model, idOf('relLabV1'))).toEqual([]);
    }, 180_000);

    it('refuses a system folder the SoS commit holds and no contained release pins', async () => {
        await expect(buildRelease(repo.root, working, idOf('relLabPartial'), options)).rejects.toThrow(/no contained release pins: model\/systems\/recording/);
    }, 180_000);

    it('names the item and file of a release that pins nothing under systems/', async () => {
        const pins = releasePins(working.model, idOf('relLabIcdOnly'));
        expect(pins.systems).toEqual([]);
        expect(pins.notPinned.map(n => n.item)).toEqual(['AblationToMappingIcd']);
        await expect(buildRelease(repo.root, working, idOf('relLabIcdOnly'), options)).rejects.toThrow(/relAblationIcd is a release of AblationToMappingIcd, declared in model\/sos\/icds\.sysml/);
    }, 180_000);

    it('reuses a worktree and an assembly on the second call, and adds no second worktree', async () => {
        const count = () => execFileSync('git', ['-C', repo.root, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n').length;
        const first = await buildRelease(repo.root, working, idOf('relLabV1'), options);
        const before = count();
        const second = await buildRelease(repo.root, working, idOf('relLabV1'), options);
        expect(second.assembly.reused).toBe(true);
        expect(second.pins.every(p => p.pin.reused)).toBe(true);
        expect(count()).toBe(before);
        expect(second.assembly.dir).toBe(first.assembly.dir);
    }, 180_000);

    it('moves a modified worktree back to its commit instead of building on it', async () => {
        const pin = await pinWorktree(repo.root, repo.c2);
        const file = join(pin.projectDir, 'model/systems/mapping/mapping_system.sysml');
        writeFileSync(file, readFileSync(file, 'utf8') + '\n// edited\n');
        expect(await worktreeIsClean(pin)).toBe(false);
        const again = await pinWorktree(repo.root, repo.c2);
        expect(again.reused).toBe(false);
        expect(readFileSync(file, 'utf8')).not.toContain('// edited');
    }, 60_000);

    it('builds an unreleased ref the same way: a tag, and the model at HEAD', async () => {
        const tagged = await buildAt(repo.root, 'rc-mapping', options);
        expect(tagged.pins[0].pin.sha).toBe(repo.c2);
        expect(boundary(tagged.project, 'CardiacMappingSystem')).toMatch(/rev B/);
        expect(boundary(tagged.project, 'AblationGeneratorSystem')).not.toMatch(/rev B/);
        expect(existsSync(join(tagged.projectDir, 'model/sos/release_records.sysml'))).toBe(false);
        expect(await worktreeIsClean(tagged.pins[0].pin)).toBe(true);
        expect(tagged.compiler).toBe(process.env.MEMO_TOOLCHAIN_COMPILER);
        await expect(buildAt(repo.root, 'no-such-ref', options)).rejects.toThrow(/not a commit or a ref/);
    }, 180_000);

    const memo = (args: string[]) => {
        const run = spawnSync(process.execPath, [cli, ...args, `--toolchain.compiler=${process.env.MEMO_TEST_COMPILER ?? 'syside'}`], { cwd: repo.root, encoding: 'utf8', env: process.env });
        return { code: run.status, out: `${run.stdout}${run.stderr}` };
    };

    it('memo compile --at and memo validate --release run in the pinned directory and write nothing into it', async () => {
        const at = memo(['compile', '.', '--at', 'rc-mapping']);
        expect(at.code, at.out).toBe(0);
        expect(at.out).toContain(repo.c2.slice(0, 7));
        const release = memo(['validate', '.', '--release', 'relLabV1', '--no-server']);
        expect(release.out).toMatch(/relLabV1: .* with .*mapping@/);
        expect(release.out).not.toMatch(/Parse errors: [1-9]/);
        // The identity file a validate would have rewritten is the SoS commit's own, and nothing else moved.
        const assembled = join(repo.root, '.memo/assembled');
        for (const key of execFileSync('ls', [assembled], { encoding: 'utf8' }).trim().split('\n')) {
            expect(readFileSync(join(assembled, key, 'memo.identity.yaml'), 'utf8')).toBe(execFileSync('git', ['-C', repo.root, 'show', `${repo.c3}:memo.identity.yaml`], { encoding: 'utf8' }));
        }
        expect(status()).toBe('');
        expect(memo(['compile', '.', '--at', 'no-such-ref']).code).toBe(1);
        expect(memo(['compile', '.', '--at', 'rc-mapping', '--release', 'relLabV1']).out).toMatch(/give one/);
    }, 240_000);

    it('is never answered by a running memo dev, which holds the working model', () => {
        expect(servable({ format: 'text' })).toBe(true);
        expect(servable({ readOnly: true })).toBe(false);
    });

    it('knows when one commit is at or after another', async () => {
        expect(await isAncestor(repo.root, repo.c1, repo.c3)).toBe(true);
        expect(await isAncestor(repo.root, repo.c3, repo.c3)).toBe(true);
        expect(await isAncestor(repo.root, repo.c3, repo.c1)).toBe(false);
    });
});

describe.runIf(compilerConfigured && examplesPresent)('system folders are self-contained (spike decision 3)', () => {
    it('reports a system that types by, or links to, an element declared in another system folder', async () => {
        await withExample({
            'model/systems/recording/reach.sysml': `package ep_lab_family_recording_reach {
    private import ep_lab_family_mapping::*;
    part reachIntoMapping : CardiacMappingSystem;
}
`,
        }, project => {
            const found = crossSystemReferences(project.model, project.registries!);
            expect(found.map(f => `${f.from}:${f.fromSystem}->${f.to}:${f.toSystem} by ${f.how}`)).toEqual([
                'reachIntoMapping:model/systems/recording->CardiacMappingSystem:model/systems/mapping by typing',
            ]);
        }, 'ep-lab-family');
    }, 120_000);

    it('finds none in the family as it is', async () => {
        await withExample({}, project => {
            expect(crossSystemReferences(project.model, project.registries!)).toEqual([]);
        }, 'ep-lab-family');
    }, 120_000);
});
