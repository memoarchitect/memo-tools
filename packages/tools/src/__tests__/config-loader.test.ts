// The settings loader after the semantic flip.
//
// The tests this file replaces asserted the behaviour the flip removed: that
// `loadRenderingLayers` read layer colours out of memo.rendering.yaml, that
// `resolveConfig` merged kinds and viewpoints down an `extends` chain, and that
// a project's `projectType` came from YAML. None of those functions exist. What
// is worth testing now is the boundary itself: settings load, semantics do not.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { loadConfig, findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { checkSemanticFields } from '../model/settings-boundary.js';

const TMP_DIR = resolve(__dirname, '__tmp_config_test__');

beforeEach(() => { mkdirSync(TMP_DIR, { recursive: true }); });
afterEach(() => { rmSync(TMP_DIR, { recursive: true, force: true }); });

describe('loadConfig', () => {
    it('loads identity and toolchain settings', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), [
            'name: my-project',
            'version: 1.2.3',
            'toolchain:',
            '  compiler: syside',
        ].join('\n'));
        const config = loadConfig(join(TMP_DIR, 'memo.package.yaml'));
        expect(config.projectName).toBe('my-project');
        expect(config.toolchain?.compiler).toBe('syside');
    });

    it('does not surface semantic fields even when the file still carries them', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), [
            'name: my-project',
            'extends: "@memoarchitect/ontology"',
            'methodology: "@memoarchitect/methodology-default"',
            'type: device',
        ].join('\n'));
        const config = loadConfig(join(TMP_DIR, 'memo.package.yaml')) as unknown as Record<string, unknown>;
        expect(config.extends).toBeUndefined();
        expect(config.methodology).toBeUndefined();
        expect(config.projectType).toBeUndefined();
    });

    it('falls back to defaults when a project has no settings file at all', () => {
        const config = loadProjectSettings(TMP_DIR);
        expect(config.projectName).toBe('__tmp_config_test__');
        expect(findConfigFile(TMP_DIR)).toBeUndefined();
    });
});

describe('checkSemanticFields', () => {
    it('rejects a semantic field and names its native replacement', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), 'name: p\nmethodology: "@memoarchitect/methodology-default"\n');
        const rejections = checkSemanticFields(TMP_DIR);
        expect(rejections).toHaveLength(1);
        expect(rejections[0].field).toBe('methodology');
        expect(rejections[0].message).toContain('ProjectMethodBinding');
    });

    it('rejects a retired semantic file outright', () => {
        writeFileSync(join(TMP_DIR, 'memo.rules.yaml'), 'rules: []\n');
        const rejections = checkSemanticFields(TMP_DIR);
        expect(rejections).toHaveLength(1);
        expect(rejections[0].file).toContain('memo.rules.yaml');
        expect(rejections[0].message).toContain('constraint def');
    });

    it('accepts a settings file that only locates and configures', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), [
            'name: "@memoarchitect/ontology"',
            'version: 0.6.5',
            'description: identity only',
            'license: MIT',
            'sysmlDir: "../src"',
        ].join('\n'));
        expect(checkSemanticFields(TMP_DIR)).toEqual([]);
    });

    it('reports every rejection rather than only the first', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), 'name: p\nextends: x\ntype: device\nusage: [kinds]\n');
        const fields = checkSemanticFields(TMP_DIR).map(r => r.field).sort();
        expect(fields).toEqual(['extends', 'type', 'usage']);
    });
});
