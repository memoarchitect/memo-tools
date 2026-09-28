import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MEMOConfig } from '../model/config.js';
import { createDefaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { openSysMLDocuments, toDiagnostic } from '../toolchain/providers/opensysml.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function config(toolchain?: MEMOConfig['toolchain']): MEMOConfig {
    return { toolchain } as MEMOConfig;
}

describe('the opensysml validator', () => {
    it('is selectable as the validator', () => {
        const effective = resolveToolchain(config({ validator: 'opensysml' }), createDefaultRegistry());
        expect(effective.validator).toBe('opensysml');
    });

    it('maps a service diagnostic to a located sysml diagnostic', () => {
        const d = toDiagnostic({
            severity: 'error', message: 'Must have at least two related elements', code: 'related-elements',
            span: { file: '/p/a.sysml', startLine: 22, startCol: 5, endLine: 28, endCol: 6 },
        }, 'dev');
        expect(d).toEqual({
            domain: 'sysml', provider: 'opensysml', providerVersion: 'dev', severity: 'error',
            message: 'Must have at least two related elements', file: '/p/a.sysml',
            range: { start: { line: 22, column: 5 }, end: { line: 28, column: 6 } }, code: 'related-elements',
        });
        expect(toDiagnostic({ severity: 'hint', message: 'm', code: '' }).severity).toBe('info');
        expect(toDiagnostic({ severity: 'warning', message: 'm', code: '' })).not.toHaveProperty('range');
    });

    it('loads the library roots and the project once each, a root inside the project included', () => {
        const project = mkdtempSync(join(tmpdir(), 'memo-opensysml-'));
        dirs.push(project);
        mkdirSync(join(project, 'methodology'));
        writeFileSync(join(project, 'a.sysml'), 'package A;');
        writeFileSync(join(project, 'methodology', 'm.sysml'), 'package M;');
        const documents = openSysMLDocuments({ config: config(), projectDir: project, includeDirs: [join(project, 'methodology')] });
        expect(documents.sort()).toEqual([join(project, 'a.sysml'), join(project, 'methodology', 'm.sysml')].sort());
        expect(openSysMLDocuments({ config: config(), projectDir: project, files: ['a.sysml'] }))
            .toEqual([join(project, 'a.sysml')]);
    });
});
