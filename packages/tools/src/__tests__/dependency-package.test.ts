// A model builds on another package: its elements are built into the model, owned
// by that package, read-only, and a reference into them resolves.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { satisfiesRange } from '../model/version-range.js';
import { assertWritable, setReadOnlyRoots } from '../server/write-guard.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

describe('version ranges', () => {
    it('accepts what the range names and nothing else', () => {
        expect(satisfiesRange('1.2.0', '^1.2.0')).toBe(true);
        expect(satisfiesRange('1.9.3', '^1.2.0')).toBe(true);
        expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false);
        expect(satisfiesRange('1.1.9', '^1.2.0')).toBe(false);
        expect(satisfiesRange('0.3.5', '^0.3.1')).toBe(true);
        expect(satisfiesRange('0.4.0', '^0.3.1')).toBe(false);
        expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
        expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
        expect(satisfiesRange('2.0.0', '>=1.5.0')).toBe(true);
        expect(satisfiesRange('1.2.0', '1.2.0')).toBe(true);
        expect(satisfiesRange('1.2.1', '1.2.0')).toBe(false);
        expect(satisfiesRange('9.9.9', '*')).toBe(true);
        expect(satisfiesRange(undefined, '^1.0.0')).toBe(false);
        expect(satisfiesRange('1.0.0', 'banana')).toBe(false);
    });
});

describe('the write guard', () => {
    afterEach(() => setReadOnlyRoots([]));
    it('refuses a file under a read-only root, and only that', () => {
        setReadOnlyRoots(['/m/memo_packages/ep-platform']);
        expect(() => assertWritable('/m/memo_packages/ep-platform/model/platform.sysml')).toThrow(/depends on/);
        expect(() => assertWritable('/m/memo_packages/ep-platform-other/x.sysml')).not.toThrow();
        expect(() => assertWritable('/m/model/own.sysml')).not.toThrow();
    });
});

const PLATFORM = `package ep_platform {
    private import memo_architecture_logical_structure::*;
    part def PatientIsolationModule :> LogicalComponent;
    part def PowerSupply :> LogicalComponent;
}
`;
const EXTRA = 'package ep_platform_extra { part def NeverImported; }\n';
const USER = `package tmp_uses_platform {
    private import ep_platform::*;
    private import memo_architecture_logical_structure::*;
    part def Host :> LogicalComponent { part isolation : PatientIsolationModule; }
    part host : Host;
    dependency from host to PowerSupply;
}
`;

async function withPlatform<T>(range: string, use: (root: string) => Promise<T>): Promise<T> {
    const source = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
    return withExample({}, async (_host, root) => {
        const manifest = readFileSync(join(source, 'memo.package.yaml'), 'utf8');
        const files: Record<string, string> = {
            'memo.package.yaml': `${manifest}dependencies:\n  ep-platform: "${range}"\n`,
            'memo_packages/ep-platform/memo.package.yaml': 'name: ep-platform\nversion: 1.2.0\nsysmlDir: model\n',
            'memo_packages/ep-platform/model/platform.sysml': PLATFORM,
            'memo_packages/ep-platform/model/extra.sysml': EXTRA,
            'model/catalog/uses_platform.sysml': USER,
        };
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
        }
        const project = join(root, 'model/catalog/project.sysml');
        writeFileSync(project, readFileSync(project, 'utf8').replace(/package (\w+) \{/, 'package $1 {\n    private import tmp_uses_platform::*;'));
        return use(root);
    });
}

const config = { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;

describe.runIf(compilerConfigured && examplesPresent)('a model that depends on a package', () => {
    it('builds the elements it imports, owned by that package and read-only, and resolves a link into them', async () => {
        await withPlatform('^1.2.0', async root => {
            const { model } = await loadProjectModel({ projectRoot: root, config, cache: false });
            const power = model.elements.get('ep_platform::PowerSupply');
            expect(power?.provenance?.declaration).toMatchObject({
                origin: 'dependency', packageName: 'ep-platform', packageVersion: '1.2.0', writable: false,
            });
            expect(power?.file).toBe('memo_packages/ep-platform/model/platform.sysml');
            expect(model.elements.get('tmp_uses_platform::Host::isolation')).toBeDefined();
            const link = model.relationships.find(r => r.type === 'dependency' && r.sourceId === 'tmp_uses_platform::host');
            expect(link?.targetId).toBe('ep_platform::PowerSupply');
            // Imports decide scope: a package of the dependency nothing imports adds nothing.
            expect(model.elements.has('ep_platform_extra::NeverImported')).toBe(false);
            // Its identity is its own package's: no display number minted in this model.
            expect(power?.shortId).toBeUndefined();
        });
    });

    it('is refused when the version found is not one the range accepts', async () => {
        await withPlatform('^2.0.0', async root => {
            await expect(loadProjectModel({ projectRoot: root, config, cache: false })).rejects.toThrow(/asks for \^2\.0\.0/);
        });
    });

    it('is refused when the package is not there', async () => {
        await withPlatform('^1.2.0', async root => {
            rmSync(join(root, 'memo_packages'), { recursive: true });
            await expect(loadProjectModel({ projectRoot: root, config, cache: false })).rejects.toThrow();
        });
    });
});
