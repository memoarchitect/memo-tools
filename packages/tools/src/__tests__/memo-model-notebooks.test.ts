// ─── The notebooks' model: `memo compile --out` read by memo_model.py ────────
//
// Analysis notebooks read the SysML v2 model through `python/memo_model.py`,
// which runs `memo compile --out` and so follows `toolchain.compiler` like every
// other command. This reads a compiled stage 1 handoff through the document
// `--out` writes and the Python module, with no compiler involved.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compiledModelDocument, COMPILED_MODEL_FORMAT } from '../commands/compile.js';
import type { Stage1Output } from '../stage2/api-model.js';

const handoff = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/stage2/api-model.stage1.json'), 'utf8')) as Stage1Output;
const pythonDir = resolve(__dirname, '../../python');
const python = spawnSync('python3', ['--version']).status === 0 ? 'python3' : undefined;

describe('the compiled model document', () => {
    it('carries the compiler, its documents and index, and each metaclass\'s supertypes', () => {
        const document = compiledModelDocument('example', handoff, '1.0', true, []) as Record<string, any>;
        expect(document.format).toBe(COMPILED_MODEL_FORMAT);
        expect(document.compiler).toBe('example');
        expect(document.documents).toHaveLength(handoff.documents!.length);
        expect(document.supertypes.PartUsage).toEqual(expect.arrayContaining(['ItemUsage', 'OccurrenceUsage', 'Usage', 'Feature', 'Element']));
    });
});

describe.runIf(Boolean(python))('memo_model.py', () => {
    it('reads elements, ownership and subtypes from the compiled model', () => {
        const dir = mkdtempSync(join(tmpdir(), 'memo-model-'));
        try {
            const path = join(dir, 'model.json');
            writeFileSync(path, JSON.stringify(compiledModelDocument('example', handoff, '1.0', true, [])));
            const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pythonDir)})
import memo_model
model = memo_model.Model(json.load(open(${JSON.stringify(path)})))
pump = next(e for e in model.elements('PartUsage') if e.qualified_name == 'Model::pump')
print(json.dumps({
    'compiler': model.compiler,
    'documents': model.documents,
    'parts': sorted(e.qualified_name for e in model.elements('PartUsage')),
    'usages': len(model.elements('Usage', include_subtypes=True)),
    'exactUsages': len(model.elements('Usage')),
    'owner': pump.owner.qualified_name,
    'owned': sorted(e.qualified_name or '' for e in pump.owned_elements if e.is_a('Usage')),
    'isFeature': pump.is_a('Feature'),
    'isDefinition': pump.is_a('Definition'),
}))`;
            const result = JSON.parse(execFileSync(python!, ['-c', script], { encoding: 'utf8' }));
            expect(result.compiler).toBe('example');
            expect(result.documents).toEqual(['model.sysml']);
            expect(result.parts).toContain('Model::pump');
            expect(result.parts).toContain('Model::pump::motor');
            expect(result.usages).toBeGreaterThan(result.parts.length);
            expect(result.exactUsages).toBe(0);
            expect(result.owner).toBe('Model');
            expect(result.owned).toContain('Model::pump::motor');
            expect(result.isFeature).toBe(true);
            expect(result.isDefinition).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
