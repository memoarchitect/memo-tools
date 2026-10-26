import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { writeRelease, type ReleaseCreateRequest } from '../server/release-writer.js';
import { defaultReleaseFile } from '../model/release-target.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// A11: "create a release" is one semantic write, the record and all its statements or none. It goes
// under sos/, never a system folder; it pins HEAD, and refuses HEAD when the tree has changes the
// commit does not hold; and it refuses a record earlier than what it contains.

const config = { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;
const RECORDS = 'model/catalog/sos/release_records.sysml';

describe.runIf(compilerConfigured && examplesPresent)('creating a release record (A11)', () => {
    let repo: FamilyRepo;
    let working: ProjectModel;
    const git = (...args: string[]) => execFileSync('git', ['-C', repo.root, ...args], { encoding: 'utf8' }).trim();
    const idOf = (name: string) => [...working.model.elements.values()].find(e => e.shortName === name)!.id;
    const context = () => ({
        projectRoot: repo.root, outlines: selectedOutlineSource(repo.root, config),
        fileOf: (id: string) => working.model.elements.get(id)?.file,
        commitOf: (id: string) => working.model.elements.get(id)?.attributes?.modelCommit,
    });
    const request = (over: Partial<ReleaseCreateRequest> = {}): ReleaseCreateRequest => ({
        name: 'relOutputC', label: 'Output stage C', itemId: idOf('OutputStageSystem'), partNumber: 'PN-3003', revision: 'C',
        status: 'draft', features: [idOf('featEuMarket')], file: RECORDS, ...over,
    });

    beforeAll(async () => {
        repo = createFamilyRepo();
        working = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
    }, 240_000);
    afterEach(() => { git('checkout', '-q', '--', '.'); git('clean', '-fdq', '-e', '.memo'); });
    afterAll(() => repo?.remove());

    it('writes the part and its statements together, pinning HEAD, and the model reads them back', async () => {
        const result = await writeRelease(request(), context());
        expect(result).toMatchObject({ success: true, filePath: RECORDS, modelCommit: repo.c8 });
        const after = await loadProjectModel({ projectRoot: repo.root, config, cache: false });
        const record = [...after.model.elements.values()].find(e => e.shortName === 'relOutputC')!;
        expect(record.attributes).toMatchObject({ partNumber: 'PN-3003', revision: 'C', status: 'ElementStatusKind::draft', modelCommit: repo.c8 });
        const from = (type: string) => [...after.model.relationships.values()].filter(r => r.type === type && r.sourceId === record.id)
            .map(r => after.model.elements.get(r.targetId)?.shortName);
        expect(from('releaseOf')).toEqual(['OutputStageSystem']);
        expect(from('selectsFeature')).toEqual(['featEuMarket']);
        expect(git('status', '--porcelain')).toBe(`M ${RECORDS}`);
    }, 240_000);

    it('refuses to write under a system folder, and writes nothing', async () => {
        const result = await writeRelease(request({ file: 'model/catalog/systems/manipulation/releases.sysml' }), context());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not written under systems\//);
        expect(existsSync(join(repo.root, 'model/catalog/systems/manipulation/releases.sysml'))).toBe(false);
    }, 240_000);

    it('names the file a record goes to: the one that holds records, else sos/ beside systems/', () => {
        expect(defaultReleaseFile({ recordFiles: [RECORDS, RECORDS, 'model/catalog/sos/releases.sysml', 'model/catalog/systems/manipulation/r.sysml'] })).toBe(RECORDS);
        expect(defaultReleaseFile({ recordFiles: ['model/catalog/systems/manipulation/r.sysml'], itemFile: 'model/catalog/systems/navigation/m.sysml' })).toBe('model/catalog/sos/releases.sysml');
        expect(defaultReleaseFile({ recordFiles: [], itemFile: 'model/catalog/sos/sos.sysml' })).toBe('model/catalog/sos/releases.sysml');
        expect(defaultReleaseFile({ recordFiles: [] })).toBe('model/sos/releases.sysml');
    });

    it('refuses HEAD when the item\'s folder has uncommitted changes, unless a commit is named', async () => {
        const file = join(repo.root, 'model/catalog/systems/navigation/navigation_system.sysml');
        writeFileSync(file, readFileSync(file, 'utf8').replace('rev C', 'rev D'));
        const refused = await writeRelease(request({ name: 'relNavigationD', itemId: idOf('NavigationSystem'), features: [] }), context());
        expect(refused.success).toBe(false);
        expect(refused.error).toMatch(/uncommitted changes in model\/catalog\/systems\/navigation/);
        const named = await writeRelease(request({ name: 'relNavigationD', itemId: idOf('NavigationSystem'), features: [], modelCommit: repo.c2 }), context());
        expect(named).toMatchObject({ success: true, modelCommit: repo.c2 });
    }, 240_000);

    it('refuses a record earlier than what it contains', async () => {
        // relFirmwareLate is at c4; a record at c3 cannot contain it.
        const result = await writeRelease(request({ name: 'relEarly', contains: [idOf('relFirmwareLate')], modelCommit: repo.c3 }), context());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be at or after what it contains/);
    }, 240_000);

    it('writes nothing when one statement does not compile', async () => {
        const before = readFileSync(join(repo.root, RECORDS), 'utf8');
        const result = await writeRelease(request({ features: ['robot_cell_family_features::noSuchFeature'] }), context());
        expect(result.success).toBe(false);
        expect(readFileSync(join(repo.root, RECORDS), 'utf8')).toBe(before);
        expect(git('status', '--porcelain')).toBe('');
    }, 240_000);

    it('creates a new file with the imports its statements need', async () => {
        const result = await writeRelease(request({ file: 'model/catalog/sos/new_releases.sysml' }), context());
        expect(result.success, result.error).toBe(true);
        expect(readFileSync(join(repo.root, 'model/catalog/sos/new_releases.sysml'), 'utf8')).toContain('private import memo_artifacts_configuration_management::*;');
    }, 240_000);

    it('refuses a name, a status or an id that is not one', async () => {
        for (const bad of [{ name: 'has space' }, { status: 'not a status' }, { itemId: 'a b' }, { partNumber: ' ' }] as Partial<ReleaseCreateRequest>[]) {
            expect((await writeRelease(request(bad), context())).success, JSON.stringify(bad)).toBe(false);
        }
    }, 240_000);
});
