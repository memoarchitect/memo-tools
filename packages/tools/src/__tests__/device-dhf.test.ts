import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDeviceDhf, findDevice, type DeviceDhfResult } from '../dhf/device-dhf.js';
import { computeWorkspaceMembership } from '../model/workspace-membership.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

const config = { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;

describe.runIf(compilerConfigured && examplesPresent)('the design history of a regulated device (T14)', () => {
    let repo: FamilyRepo;
    let working: ProjectModel;
    let scratch: string;
    let custom: string;
    let eu: DeviceDhfResult;
    let fda: DeviceDhfResult;
    const read = (result: DeviceDhfResult, release: string, path: string) => readFileSync(join(result.outputDir, release, path), 'utf8');

    beforeAll(async () => {
        repo = createFamilyRepo();
        working = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
        scratch = realpathSync(mkdtempSync(join(tmpdir(), 'memo-device-')));
        custom = join(scratch, 'templates');
        mkdirSync(custom, { recursive: true });
        // A project's own template that lists the logical components, so what each release builds is visible.
        writeFileSync(join(custom, 'variants.md'), `---
id: variants
title: What this release builds
standard: project
clauses: []
required_for: ["MDR", "FDA_510k"]
---

\`\`\`memo-query
kind: [LogicalComponent]
display: table
columns: name
sort: name
empty: "none"
\`\`\`
`);
        const run = (device: string) => compileDeviceDhf({
            projectRoot: repo.root, working, device, outputDir: join(scratch, 'out'), config: config as never,
            templates: ['system/standards-checklist', 'variants'], customTemplateDir: custom,
        });
        eu = await run('devEu');
        fda = await run('devFda');
    }, 300_000);
    afterAll(() => { repo?.remove(); rmSync(scratch, { recursive: true, force: true }); });

    it('finds a device by name or id, and says which exist when it cannot', () => {
        expect(findDevice(working.model, 'devEu')).toMatchObject({ name: 'devEu' });
        expect(findDevice(working.model, 'nope')).toEqual({ error: expect.stringContaining('devices: devEu, devFda') });
    });

    it('builds each device from the release it covers, at that release\'s commit', () => {
        expect(eu.releases.map(r => [r.record, r.commit])).toEqual([['relOutputEu', repo.c3]]);
        expect(fda.releases.map(r => [r.record, r.commit])).toEqual([['relOutputUs', repo.c3]]);
        expect([eu.device.jurisdiction, fda.device.jurisdiction]).toEqual(['MDR', 'FDA_510k']);
        expect(eu.releases[0].workspace).toBe('OutputStageSystem');
    });

    it('names the variant its own release builds and not the other', () => {
        const euDoc = read(eu, 'relOutputEu', 'documents/variants.md');
        const fdaDoc = read(fda, 'relOutputUs', 'documents/variants.md');
        expect(euDoc).toContain('EU Output Stage');
        expect(euDoc).not.toContain('US Output Stage');
        expect(fdaDoc).toContain('US Output Stage');
        expect(fdaDoc).not.toContain('EU Output Stage');
        expect(eu.releases[0].excludedVariants).toEqual(['usOutput']);
        expect(fda.releases[0].excludedVariants).toEqual(['euOutput']);
    });

    it('lists in the standards section only the clauses its own jurisdiction requires', () => {
        const table = (result: DeviceDhfResult, release: string) =>
            read(result, release, 'system/standards-checklist.md').split('## 2. Coverage Summary')[1].split('## 3.')[0];
        const euTable = table(eu, 'relOutputEu');
        const fdaTable = table(fda, 'relOutputUs');
        expect(euTable).toContain('ISO 13485:2016');
        expect(euTable).not.toContain('21 CFR');
        expect(fdaTable).toContain('21 CFR');
        expect(fdaTable).not.toContain('ISO 13485:2016');
    });

    it('selects documents by the jurisdiction their templates are required for', async () => {
        const [euAll, fdaAll] = await Promise.all(['devEu', 'devFda'].map(device => compileDeviceDhf({
            projectRoot: repo.root, working, device, outputDir: join(scratch, 'all'), config: config as never,
        })));
        const ids = (r: DeviceDhfResult) => new Set(r.releases[0].documents.map(d => d.id));
        // Only an FDA approval needs the 21 CFR 820 design outputs.
        expect(ids(fdaAll).has('21cfr820/design-output')).toBe(true);
        expect(ids(euAll).has('21cfr820/design-output')).toBe(false);
        expect(ids(euAll).size).toBeGreaterThan(0);
        expect([...ids(euAll)].sort()).not.toEqual([...ids(fdaAll)].sort());
        // The risk management file is generated per device, and the index says how many documents it holds.
        expect(euAll.riskDocuments).toBeGreaterThan(0);
        const index = readFileSync(euAll.index, 'utf8');
        expect(index).toContain('Jurisdiction: MDR');
        expect(index).toContain('EU-0001');
        expect(index).toContain(`relOutputEu (${repo.c3.slice(0, 7)})`);
        expect(index).toContain('Built without: usOutput.');
        expect(index).toMatch(/Compiler: \w+/);
    }, 300_000);

    it('places a device with the system whose release it covers (O9), so it is not Unassigned', () => {
        const membership = computeWorkspaceMembership(working.model, working.registries!);
        const id = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;
        expect(membership.systems.get(id('devEu'))).toEqual(membership.systems.get(id('OutputStageSystem')));
        expect(membership.systems.get(id('devEu'))!.length).toBeGreaterThan(0);
        expect(membership.unassigned).not.toContain(id('devFda'));
    });

    it('names the system of systems version that pins a covered release, and the releases beside it', async () => {
        const [euAll, fdaAll] = [readFileSync(eu.index, 'utf8'), readFileSync(fda.index, 'utf8')];
        expect(eu.releases[0].context).toEqual([{
            record: 'relLabOutputEu', item: 'RoboticCell', commit: repo.c3,
            siblings: [{ record: 'relNavigation', item: 'NavigationSystem', commit: expect.any(String) }],
        }]);
        expect(euAll).toContain('part of relLabOutputEu, a release of RoboticCell');
        expect(euAll).toContain('relNavigation (NavigationSystem)');
        // The US release is in no SoS version, and the index says so rather than staying silent.
        expect(fda.releases[0].context).toEqual([]);
        expect(fdaAll).toContain('no release record contains this one');
    });

    it('links a device to its intended use and to the devices it is used with', () => {
        const id = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;
        const edges = (type: string) => working.model.relationships.filter(r => r.type === type).map(r => [r.sourceId, r.targetId]);
        expect(edges('intendedUseOf')).toEqual([[id('euIntendedUse'), id('devEu')]]);
        expect(edges('usedWith')).toEqual([[id('devEu'), id('devFda')]]);
    });

    it('refuses a device that does not exist', async () => {
        await expect(compileDeviceDhf({ projectRoot: repo.root, working, device: 'devNone', outputDir: join(scratch, 'x'), config: config as never }))
            .rejects.toThrow(/not a regulated device of this model/);
    });
});
