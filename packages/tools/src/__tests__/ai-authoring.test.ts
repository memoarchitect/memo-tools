import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateValidatedSysml, MAX_SYSML_GENERATION_ATTEMPTS } from '../operations/ai-authoring.js';
import type { LLMProvider } from '../llm/llm-provider.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'memo-ai-authoring-'));
    roots.push(root);
    const file = join(root, 'model/catalog/project.sysml');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'package ProjectCatalog { }\n');
    return root;
}

function provider(responses: string[]): LLMProvider {
    const fallback = responses[responses.length - 1];
    return { name: 'test', complete: vi.fn(async () => ({
        content: responses.shift() ?? fallback,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })) };
}

describe('AI authoring through the validator', () => {
    it('repairs a known-bad draft within the fixed retry bound', async () => {
        const llm = provider([
            '```sysml\npackage Broken { part def Pump \n```',
            '```sysml\npackage Fixed { part def Pump; }\n```\n**Explanation:** Fixed.',
        ]);
        const result = await generateValidatedSysml({ projectRoot: project(), description: 'add pump', provider: llm });

        expect(result.attempts).toBe(2);
        expect(result.initialSysml).toContain('Broken');
        expect(result.sysml).toContain('Fixed');
        expect(result.diagnostics).toEqual([]);
        expect(result.changeRecord.guidanceVersion).toBe('1.0.0');
        expect(llm.complete).toHaveBeenCalledTimes(2);
    });

    it('returns an invalid candidate and its diagnostics after giving up; it does not gate it', async () => {
        const llm = provider(['```sysml\npackage Broken { part def Pump \n```']);
        const result = await generateValidatedSysml({ projectRoot: project(), description: 'add pump', provider: llm });

        expect(result.attempts).toBe(MAX_SYSML_GENERATION_ATTEMPTS);
        expect(result.sysml).toContain('Broken');
        expect(result.diagnostics.some(diagnostic => diagnostic.domain === 'sysml')).toBe(true);
        expect(llm.complete).toHaveBeenCalledTimes(MAX_SYSML_GENERATION_ATTEMPTS);
    });
});
