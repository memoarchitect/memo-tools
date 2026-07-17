import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { loadConfig, loadRenderingLayers, resolveConfig } from '../model/config-loader.js';
import { VENDOR_ONTOLOGY_PACKAGES_DIR } from '../model/paths.js';

const TMP_DIR = resolve(__dirname, '__tmp_config_test__');

beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── loadRenderingLayers Tests ──────────────────────────────────────────────

describe('loadRenderingLayers', () => {
    it('loads layers from memo.rendering.yaml', () => {
        writeFileSync(join(TMP_DIR, 'memo.rendering.yaml'), `
layers:
  - id: risk
    label: Risk Management
    color: "#E74C3C"
  - id: requirements
    label: Requirements
    color: "#4A90D9"
`);
        const layers = loadRenderingLayers(TMP_DIR);
        expect(layers).toHaveLength(2);
        expect(layers[0].id).toBe('risk');
        expect(layers[0].label).toBe('Risk Management');
        expect(layers[0].color).toBe('#E74C3C');
        expect(layers[1].id).toBe('requirements');
    });

    it('returns empty array if no rendering file exists', () => {
        const layers = loadRenderingLayers(TMP_DIR);
        expect(layers).toEqual([]);
    });

    it('returns empty array for malformed rendering file', () => {
        writeFileSync(join(TMP_DIR, 'memo.rendering.yaml'), 'not: valid: yaml: [');
        const layers = loadRenderingLayers(TMP_DIR);
        expect(layers).toEqual([]);
    });
});

// ─── loadConfig with memo.rendering.yaml ────────────────────────────────────

describe('loadConfig with memo.rendering.yaml', () => {
    it('loads toolchain selection from memo.package.yaml', () => {
        writeFileSync(join(TMP_DIR, 'memo.package.yaml'), `
name: test-project
type: device
toolchain:
  compiler: syside
  packager: sysand
  syside:
    executable: /opt/tools/syside
    warningsAsErrors: true
    diagnose: all
  sysand:
    executable: /opt/tools/sysand
`);

        const config = loadConfig(join(TMP_DIR, 'memo.package.yaml'));
        expect(config.toolchain).toEqual({
            compiler: 'syside',
            packager: 'sysand',
            syside: { executable: '/opt/tools/syside', warningsAsErrors: true, diagnose: 'all' },
            sysand: { executable: '/opt/tools/sysand' },
        });
    });

    it('loads toolchain selection from legacy memo.config.yaml', () => {
        writeFileSync(join(TMP_DIR, 'memo.config.yaml'), `
projectName: test-project
projectType: device
toolchain:
  compiler: internal
  packager: sysand
`);

        expect(loadConfig(join(TMP_DIR, 'memo.config.yaml')).toolchain).toEqual({
            compiler: 'internal',
            packager: 'sysand',
        });
    });

    it('inherits tool settings while allowing a project to override provider options', () => {
        const parent = {
            projectName: 'parent',
            projectType: 'ontology' as const,
            toolchain: {
                compiler: 'syside' as const,
                packager: 'sysand' as const,
                syside: { executable: '/opt/tools/syside', diagnose: 'all' as const },
                sysand: { executable: '/opt/tools/sysand' },
            },
        };
        const child = {
            projectName: 'child',
            projectType: 'device' as const,
            extends: '@memoarchitect/parent',
            toolchain: { syside: { diagnose: 'none' as const } },
        };

        expect(resolveConfig(child, name => name === '@memoarchitect/parent' ? parent : undefined).toolchain).toEqual({
            compiler: 'syside',
            packager: 'sysand',
            syside: { executable: '/opt/tools/syside', diagnose: 'none' },
            sysand: { executable: '/opt/tools/sysand' },
        });
    });

    it('merges rendering layers into architectureLayers', () => {
        // Config with no architectureLayers
        writeFileSync(join(TMP_DIR, 'memo.config.yaml'), `
projectName: test-project
projectType: device
`);
        writeFileSync(join(TMP_DIR, 'memo.rendering.yaml'), `
layers:
  - id: risk
    label: Risk Management
    color: "#E74C3C"
`);

        const config = loadConfig(join(TMP_DIR, 'memo.config.yaml'));
        expect(config.architectureLayers).toHaveLength(1);
        expect(config.architectureLayers![0].id).toBe('risk');
    });

    it('rendering layers take precedence over config architectureLayers for same id', () => {
        writeFileSync(join(TMP_DIR, 'memo.config.yaml'), `
projectName: test-project
projectType: device
cosmaLayers:
  - id: risk
    label: Old Risk Label
    color: "#000000"
`);
        writeFileSync(join(TMP_DIR, 'memo.rendering.yaml'), `
layers:
  - id: risk
    label: Risk Management
    color: "#E74C3C"
`);

        const config = loadConfig(join(TMP_DIR, 'memo.config.yaml'));
        expect(config.architectureLayers).toHaveLength(1);
        expect(config.architectureLayers![0].label).toBe('Risk Management');
        expect(config.architectureLayers![0].color).toBe('#E74C3C');
    });

    it('backward compat: legacy cosmaLayers YAML key is read into architectureLayers', () => {
        writeFileSync(join(TMP_DIR, 'memo.config.yaml'), `
projectName: test-project
projectType: device
cosmaLayers:
  - id: risk
    label: Risk Management
    color: "#E74C3C"
  - id: requirements
    label: Requirements
    color: "#4A90D9"
`);

        const config = loadConfig(join(TMP_DIR, 'memo.config.yaml'));
        expect(config.architectureLayers).toHaveLength(2);
        expect(config.architectureLayers![0].id).toBe('risk');
    });

    it('merges both sources when both have different layer ids', () => {
        writeFileSync(join(TMP_DIR, 'memo.config.yaml'), `
projectName: test-project
projectType: device
cosmaLayers:
  - id: risk
    label: Risk
    color: "#E74C3C"
`);
        writeFileSync(join(TMP_DIR, 'memo.rendering.yaml'), `
layers:
  - id: requirements
    label: Requirements
    color: "#4A90D9"
`);

        const config = loadConfig(join(TMP_DIR, 'memo.config.yaml'));
        expect(config.architectureLayers).toHaveLength(2);
        const ids = config.architectureLayers!.map(l => l.id);
        expect(ids).toContain('risk');
        expect(ids).toContain('requirements');
    });
});

// ─── Integration: real ontology packages ────────────────────────────────────

describe('loadConfig with real ontology package files', () => {
    it('ontology loads rendering layers from memo.package.yaml + memo.rendering.yaml', () => {
        const configPath = resolve(__dirname, '../../../..', VENDOR_ONTOLOGY_PACKAGES_DIR, 'ontology/memo.package.yaml');
        const config = loadConfig(configPath);

        // Should have 11 layers from memo.rendering.yaml
        expect(config.architectureLayers!.length).toBeGreaterThanOrEqual(10);

        // Verify specific layers are present
        const layerIds = config.architectureLayers!.map(l => l.id);
        expect(layerIds).toContain('operational');
        expect(layerIds).toContain('functional');
        expect(layerIds).toContain('software');
        expect(layerIds).toContain('verification');
        expect(layerIds).toContain('safety');

        // Verify identity from memo.package.yaml
        expect(config.projectName).toBe('@memoarchitect/ontology');
        expect(config.projectType).toBe('ontology');
    });

});
