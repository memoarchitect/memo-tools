import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examplesPresent } from './helpers/compile-source.js';

// A methodology that names a module the project cannot resolve selects
// nothing, so the rules that ran are not the ones it describes. That is a
// failure of the run, reported as one, not a yellow warning among warnings.

const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');
const ROS = resolve(__dirname, '../../../../../memo/examples/ros-mobile-robot');

function validate(root: string) {
    return spawnSync('node', [CLI_PATH, 'validate', root], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });
}

describe.runIf(examplesPresent)('a methodology that names a module nothing declares', () => {
    it('is reported as a methodology-resolution failure, and a resolvable one is not', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-methodology-'));
        try {
            cpSync(ROS, root, { recursive: true });
            expect(validate(root).stdout).not.toContain('Methodology resolution');

            const binding = join(root, 'model/catalog/project.sysml');
            // The binding names the ROS extension by reference, which also
            // has to resolve for the clean run above to be clean. A module
            // string is what can still name nothing.
            writeFileSync(binding, readFileSync(binding, 'utf-8').replace(
                'ref :>> includedExtension = rosExtensionMethod;',
                'ref :>> includedExtension = rosExtensionMethod;\n        attribute :>> includedModule = "memo_extension_rss";'));
            const broken = validate(root);
            expect(broken.stdout).toContain('Methodology resolution');
            expect(broken.stdout).toContain('unavailable-module');
            expect(broken.status).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 120_000);
});
