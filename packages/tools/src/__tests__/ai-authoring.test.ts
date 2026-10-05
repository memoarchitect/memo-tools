import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateValidatedSysml, MAX_SYSML_GENERATION_ATTEMPTS } from '../operations/ai-authoring.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import type { LLMProvider } from '../llm/llm-provider.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

const EXAMPLE = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');

/** A real project, so the compiler that validates the candidate has a model to resolve it in. */
function project(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-ai-authoring-')));
    roots.push(root);
    cpSync(EXAMPLE, root, { recursive: true, filter: path => !path.includes('/.memo') });
    return root;
}

function provider(responses: string[]): LLMProvider {
    const fallback = responses[responses.length - 1];
    return { name: 'test', complete: vi.fn(async () => ({
        content: responses.shift() ?? fallback,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })) };
}

describe.runIf(compilerConfigured && examplesPresent)('AI authoring through the validator', () => {
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
