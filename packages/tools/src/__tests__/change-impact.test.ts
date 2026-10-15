import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traverseImpact } from '../analysis/impact.js';
import { computeChangeImpact, type ImpactHead, type ImpactReport } from '../model/impact.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// T11: what a change reaches. The change is the working tree against the commit it branched from
// (`merge-base target HEAD`), expanded from what changed along every relation but containment, two steps out,
// never through a system. A throwaway repository with real history: `main` has moved on since `feature`
// branched, and the edits here are not committed.

const config = { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;
const ABLATION = 'model/systems/manipulation/manipulation_system.sysml';
const TRACE = 'model/systems/manipulation/trace.sysml';

describe.runIf(compilerConfigured && examplesPresent)('what a change reaches (T11)', () => {
    let repo: FamilyRepo;
    const git = (...args: string[]) => execFileSync('git', ['-C', repo.root, ...args], { encoding: 'utf8' }).trim();
    const edit = (file: string, from: string, to: string) => {
        const text = readFileSync(join(repo.root, file), 'utf8');
        if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
        writeFileSync(join(repo.root, file), text.split(from).join(to));
    };
    const head = async (): Promise<ImpactHead> => {
        const project = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
        return {
            model: project.model, registries: project.registries!, api: project.api,
            constraints: collectApiConstraints(project.api), packages: ['memo_methodology_profiles'],
        };
    };
    const compute = async (target?: string) => computeChangeImpact({ projectRoot: repo.root, head: await head(), target, build: { config: config as never } });
    const names = (report: ImpactReport) => Object.values(report.reached).flat().map(i => i.name);
    const reset = () => { git('checkout', '-q', '--', '.'); };

    beforeAll(() => {
        repo = createFamilyRepo();
        // The branch point is c8. `main` then moves on with an unrelated change, and the work is on `feature`.
        git('branch', 'feature');
        edit('model/systems/navigation/navigation_system.sysml', 'Navigation workstation', 'Navigation workstation, moved on');
        git('commit', '-q', '-am', 'main moves on: navigation');
        git('checkout', '-q', 'feature');
    }, 240_000);
    afterAll(() => repo?.remove());

    it('lists the requirement, the test, the system, the releases and the SoS version a changed function reaches', async () => {
        edit(ABLATION, 'and the event that records it', 'and the event that records it, with the delivered energy');
        try {
            const report = await compute('main');
            expect(report.changed.elements.map(e => `${e.via}: ${e.name}`)).toEqual(['changed: fnExecuteGrasp']);
            expect(names(report)).toEqual(expect.arrayContaining(['reqMotionLimits', 'vcMotionLimits', 'motionController']));
            // Requirements and tests are separate groups, from the ontology's layers and not from a list of kinds.
            const layerOf = (name: string) => Object.entries(report.reached).find(([, items]) => items.some(i => i.name === name))![0];
            expect(layerOf('reqMotionLimits')).not.toBe(layerOf('vcMotionLimits'));
            // The function is performed by the lab's scenario, which also performs the navigation and perception functions:
            // a change here reaches the systems it works with, and each system's releases.
            expect(report.systems.map(s => s.name)).toEqual(['ManipulatorSystem', 'NavigationSystem', 'PerceptionSystem', 'RoboticCell']);
            expect(report.releases.map(r => r.name)).toEqual(expect.arrayContaining(['relManipulation', 'relNavigation', 'relPerception', 'relLabV1']));
            expect(report.releases.find(r => r.name === 'relManipulation')).toMatchObject({ status: 'released', needsNewRelease: true });
            // A release of something nothing reaches is not listed.
            expect(report.releases.map(r => r.name)).not.toContain('relOutputEu');
            expect(report.reopened).toEqual([]);
            expect(report.limits.join(' ')).toMatch(/rename/);
        } finally { reset(); }
    }, 240_000);

    it('reaches the other functions a scenario performs with it, and does not walk up into the system or across its containment', async () => {
        edit(ABLATION, 'and the event that records it', 'and the event that records it, again');
        try {
            const rep = await compute('main');
            const reached = names(rep);
            // The scenario performs this function and the other systems' functions: two steps.
            expect(reached).toEqual(expect.arrayContaining(['scMapGuidedPick', 'fnBuildMap', 'fnTagGrasp', 'fnAcquirePointClouds']));
            expect(Object.values(rep.reached).flat().find(i => i.name === 'fnBuildMap')).toMatchObject({ via: 'performs', depth: 2 });
            // Three steps out, and containment, are not followed: no component of another system, no port of this one.
            for (const absent of ['mapEngine', 'sensorHub', 'pGraspEventOut', 'safetyRelay']) expect(reached, absent).not.toContain(absent);
            // The system holds the function by containment: it is where the change is, not something it reaches.
            expect(reached).not.toContain('ManipulatorSystem');
        } finally { reset(); }
    }, 240_000);

    it('measures from where the branch left main, not from main\'s tip', async () => {
        edit(ABLATION, 'and the event that records it', 'and the event that records it, a third time');
        try {
            const report = await compute('main');
            expect(report.base.commit).toBe(repo.c8);
            // `main` changed the navigation system after the branch point: against its tip that would read as reverted here.
            expect(report.changed.elements.map(e => e.name)).toEqual(['fnExecuteGrasp']);
        } finally { reset(); }
    }, 240_000);

    it('shows an uncommitted edit against HEAD itself, which is the default', async () => {
        edit(ABLATION, 'and the event that records it', 'and the event that records it, uncommitted');
        try {
            const report = await compute();
            expect(report.target).toBe('HEAD');
            expect(report.base.commit).toBe(repo.c8);
            expect(report.changed.elements.map(e => `${e.via}: ${e.name}`)).toEqual(['changed: fnExecuteGrasp']);
        } finally { reset(); }
        // Nothing edited, nothing changed.
        const clean = await compute();
        expect(clean.changed).toMatchObject({ added: 0, removed: 0, changed: 0, elements: [] });
        expect(clean.reached).toEqual({});
    }, 240_000);

    it('reopens a step the change leaves not done: a done verification step loses its test', async () => {
        const text = readFileSync(join(repo.root, TRACE), 'utf8');
        writeFileSync(join(repo.root, TRACE), text.slice(0, text.indexOf('    verification vcMotionLimits')) + '}\n');
        try {
            const report = await compute('main');
            expect(report.changed.elements.map(e => `${e.via}: ${e.name}`)).toContain('removed: vcMotionLimits');
            expect(report.reopened.map(r => `${r.workspace}: ${r.label}`)).toContain('ManipulatorSystem: Sys Verification');
        } finally { reset(); }
    }, 240_000);

    it('refuses a target it cannot resolve', async () => {
        await expect(compute('no-such-ref')).rejects.toThrow(/not a commit or a ref/);
    }, 240_000);
});

describe('the traversal an impact is made of', () => {
    const graph = {
        element: (id: string) => ({ name: id, kind: 'K', layer: 'l' }),
        links: [
            { id: '1', type: 'composes', sourceId: 'sys', targetId: 'a' },
            { id: '2', type: 'composes', sourceId: 'sys', targetId: 'b' },
            { id: '3', type: 'satisfiedBy', sourceId: 'req', targetId: 'a' },
            { id: '4', type: 'verifiedBy', sourceId: 'req', targetId: 'test' },
            { id: '5', type: 'verifiedBy', sourceId: 'req', targetId: 'far' },
            { id: '6', type: 'traces', sourceId: 'far', targetId: 'farther' },
        ],
    };
    const reach = (options: Parameters<typeof traverseImpact>[2]) => traverseImpact(graph, ['a'], options).nodes.map(n => n.name).sort();

    it('starts from several roots, stops at the depth, and does not follow what it is told to skip', () => {
        expect(reach({ maxDepth: 2, skipTypes: new Set(['composes']) })).toEqual(['far', 'req', 'test']);
        expect(reach({ maxDepth: 1, skipTypes: new Set(['composes']) })).toEqual(['req']);
        expect(reach({ maxDepth: 2 })).toEqual(['b', 'far', 'req', 'sys', 'test']);
        expect(traverseImpact(graph, ['a', 'b'], { maxDepth: 1, skipTypes: new Set(['composes']) }).nodes.map(n => n.name)).toEqual(['req']);
    });

    it('lists an element it will not pass through without expanding it', () => {
        expect(reach({ maxDepth: 3, skipTypes: new Set(['composes']), stopAt: new Set(['req']) })).toEqual(['req']);
    });
});
