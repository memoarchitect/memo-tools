// ─── A project's path is its real path ────────────────────────────────────────
//
// A compiler names the files it read by their real paths. A project reached
// through a symbolic link (macOS `/tmp`, `/var`, a linked home) used to be matched
// against the path it was given, so nothing matched and it compiled to nothing and
// was reported valid. The paths are real at their source, `findProjectRoot` and
// `discoverProjectSources`, and a compile that resolves nothing is an error.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverProjectSources, findProjectRoot } from '../model/native-project.js';
import { compileModelWithSelected } from '../toolchain/operations.js';
import { ProviderRegistry } from '../toolchain/registry.js';
import type { MEMOConfig } from '../model/config.js';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');

describe.runIf(existsSync(example))('a project reached through a symbolic link', () => {
    it('is found, and its files are named, by the real path', () => {
        const base = realpathSync(mkdtempSync(join(tmpdir(), 'memo-canonical-')));
        try {
            cpSync(example, join(base, 'real'), { recursive: true, filter: source => !source.includes('/.memo') });
            symlinkSync(join(base, 'real'), join(base, 'link'));
            expect(findProjectRoot(join(base, 'link', 'model'))).toBe(join(base, 'real'));
            const sources = discoverProjectSources(join(base, 'link'));
            expect(sources.projectRoot).toBe(join(base, 'real'));
            expect(sources.entrypoint?.startsWith(join(base, 'real'))).toBe(true);
            expect(sources.projectFiles.length).toBeGreaterThan(0);
            expect(sources.projectFiles.every(file => file.startsWith(join(base, 'real')))).toBe(true);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});

describe('a compile that selects no library root and no kinds', () => {
    const registryOf = (kindNames: string[], selectedRoots: unknown[]) => new ProviderRegistry().register({
        id: 'stub', role: 'lowering', capabilities: [],
        probe: () => ({ available: true, transport: 'in-process' }),
        create: () => { throw new Error('not run'); },
        compileModel: async () => ({
            accepted: true, diagnostics: [],
            registries: { kindRegistry: { kindNames: () => kindNames } },
            resolution: { projectRoot: '/p', selectedRoots, diagnostics: [] },
        }) as never,
    });
    const options = (registry: ProviderRegistry) => ({
        config: { projectName: 'x', toolchain: { lowering: 'stub' } } as unknown as MEMOConfig,
        projectDir: '/p', libraryDirs: [], registry,
    });

    it('is refused, not accepted as an empty model', async () => {
        const result = await compileModelWithSelected(options(registryOf([], [])));
        expect(result.accepted).toBe(false);
        expect(result.diagnostics.map(d => d.message).join(' ')).toContain('no library root and no kinds');
    });

    it('is accepted once the project reaches its ontology', async () => {
        const result = await compileModelWithSelected(options(registryOf(['Hazard'], [{}])));
        expect(result.accepted).toBe(true);
    });
});
