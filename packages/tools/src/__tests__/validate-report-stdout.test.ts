import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilerConfigured, withExample } from './helpers/compile-source.js';

// `memo validate --format json` (or junit) without `-o` writes the report as
// the whole of stdout, so a script can parse it; the progress lines go to
// stderr. Before, they preceded the JSON on stdout. Runs the built CLI.

const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');

function validate(root: string, format: string) {
    return spawnSync('node', [CLI_PATH, 'validate', root, '--format', format], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });
}

describe.runIf(compilerConfigured)('memo validate writes its report alone to stdout', () => {
    it('json parses, with the progress on stderr', async () => {
        await withExample({}, (_project, root) => {
            const result = validate(root, 'json');
            const report = JSON.parse(result.stdout) as { summary: { rulesEvaluated: number } };
            expect(report.summary.rulesEvaluated).toBeGreaterThan(0);
            expect(result.stderr).toContain('MEMO Validate');
        });
    }, 120_000);

    it('junit is XML from its first byte', async () => {
        await withExample({}, (_project, root) => {
            expect(validate(root, 'junit').stdout.startsWith('<?xml')).toBe(true);
        });
    }, 120_000);
});
