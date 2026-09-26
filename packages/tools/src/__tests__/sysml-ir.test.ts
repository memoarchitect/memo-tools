import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerProject } from '../toolchain/lowering.js';
import { parseFiles } from '../model/parser-utils.js';
import { buildMemoModel } from '../model/builder.js';
import { modelToDTO } from '../model/semantic.js';
import { lowerAstToSysmlIr } from '../model/sysml-ir.js';
import type { MEMOConfig } from '../model/config.js';

const examples = resolve(import.meta.dirname, '../../../../../memo/examples');
const projects = existsSync(examples) ? readdirSync(examples).sort()
    .map(name => join(examples, name))
    .filter(dir => existsSync(join(dir, 'model/catalog/project.sysml'))) : [];

describe('canonical SysML IR', () => {
    it('conserves every ingested declaration across the example corpus', async () => {
        expect(projects.length).toBeGreaterThan(0);
        for (const projectDir of projects) {
            const ir = await lowerProject(projectDir);
            const mapped = ir.sysml.elements.filter(element => element.kind === 'mapped');
            const generic = ir.sysml.elements.filter(element => element.kind === 'generic');
            expect(ir.sysml.elements).toHaveLength(mapped.length + generic.length);
            // Conservation alone is insufficient: a broken projection that
            // classified every declaration as generic would satisfy the count.
            expect(mapped.length).toBeGreaterThan(0);
            expect(ir.sysml.diagnostics).toHaveLength(generic.length);
            for (const record of generic) {
                expect(ir.sysml.diagnostics.some(diagnostic => diagnostic.elementId === record.identity.id && diagnostic.domain === 'memo-ingest')).toBe(true);
            }
        }
    }, 120_000);

    it('uses declaration path, rather than authored name, as identity', async () => {
        const ir = await lowerProject(projects[0]);
        const ids = ir.sysml.elements.map(element => element.identity.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every(id => id.includes('#') && id.includes(':'))).toBe(true);
    }, 120_000);

    it('retains unknown provider properties through JSON serialization', async () => {
        const ir = await lowerProject(projects[0]);
        const record = ir.sysml.elements[0];
        record.providerProperties.futureProviderField = { retained: true };
        const restored = JSON.parse(JSON.stringify(ir.sysml));
        expect(restored.elements[0].providerProperties.futureProviderField).toEqual({ retained: true });
    }, 120_000);

    it('records an empty package rather than dropping it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'memo-ir-empty-'));
        const file = join(dir, 'empty.sysml');
        writeFileSync(file, 'package Outer {\n    package Hollow { }\n    part def Filled;\n}\npackage Bare { }\n');
        const parsed = await parseFiles([file], `${dir}/`);
        const ir = lowerAstToSysmlIr(parsed.documents, modelToDTO(buildMemoModel(parsed.documents, { projectName: 'Empty' }, parsed.errors)), dir);
        const packages = ir.elements.filter(element => element.identity.metaclass === 'PackageDeclaration');
        // Nested and top-level alike; `Outer` has a member and is conserved
        // through it, so it is not a record of its own.
        expect(packages.map(element => element.standardProperties.name).sort()).toEqual(['Bare', 'Hollow']);
        for (const record of packages) {
            expect(record.kind).toBe('generic');
            expect(ir.diagnostics.some(diagnostic => diagnostic.elementId === record.identity.id && diagnostic.domain === 'memo-ingest')).toBe(true);
        }
        expect(ir.elements.some(element => element.kind === 'mapped' && element.memoElementId.endsWith('Filled'))).toBe(true);
    });

    it('round-trips the FulfillOrder semantic graph through JSON', async () => {
        const fixture = resolve(import.meta.dirname, '../../../../../sysml-v2-activity-example.sysml');
        const parsed = await parseFiles([fixture], `${resolve(import.meta.dirname, '../../../../../')}/`);
        const config: MEMOConfig = { projectName: 'FulfillOrder' };
        const ir = lowerAstToSysmlIr(parsed.documents, modelToDTO(buildMemoModel(parsed.documents, config, parsed.errors)), resolve(import.meta.dirname, '../../../../../'));
        expect(JSON.parse(JSON.stringify(ir))).toEqual(ir);
    });
});
