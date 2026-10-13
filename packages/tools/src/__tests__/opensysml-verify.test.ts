// ─── Verifying an edit with OpenSysML, as a content document ────────────────
//
// Runs when an OpenSysML service binary is configured (`OPENSYSML_BINARY`),
// against a scratch copy of the temperature-alarm example: an authoring write
// is compiled before it reaches disk, the edited file sent as text.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { loadProjectSettings } from '../model/config-loader.js';
import { recompileProject } from '../operations/authoring.js';
import { saveElementToFile } from '../server/persistor.js';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const binary = process.env.OPENSYSML_BINARY;
const FILE = 'model/catalog/temperature_alarm.sysml';

describe.runIf(Boolean(binary) && existsSync(example))('an edit verified by OpenSysML as a content document', () => {
    let root: string;
    let envBefore: string | undefined;
    let compilerBefore: string | undefined;
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'memo-opensysml-verify-'));
        cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
        // The project names its compiler; where the service is on this machine is the user's, so it comes
        // from the environment, not from a file that would be checked in.
        writeFileSync(join(root, 'memo.tools.yaml'), 'toolchain:\n  compiler: opensysml\n');
        envBefore = process.env.OPENSYSML_BINARY;
        process.env.OPENSYSML_BINARY = binary;
        // The suite's MEMO_TEST_COMPILER arrives as MEMO_TOOLCHAIN_COMPILER and would override the
        // project's file; this test is about OpenSysML whichever compiler the rest of the suite uses.
        compilerBefore = process.env.MEMO_TOOLCHAIN_COMPILER;
        process.env.MEMO_TOOLCHAIN_COMPILER = 'opensysml';
    });
    afterAll(() => {
        if (envBefore === undefined) delete process.env.OPENSYSML_BINARY; else process.env.OPENSYSML_BINARY = envBefore;
        if (compilerBefore === undefined) delete process.env.MEMO_TOOLCHAIN_COMPILER; else process.env.MEMO_TOOLCHAIN_COMPILER = compilerBefore;
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts valid text without writing it, and refuses invalid text with the compiler\'s diagnostic', async () => {
        const outlines = selectedOutlineSource(root, loadProjectSettings(root));
        const text = readFileSync(join(root, FILE), 'utf8');
        await expect(outlines.verify(FILE, text.replace('part icuNurse', '// a note\n    part icuNurse'))).resolves.toBeUndefined();
        await expect(outlines.verify(FILE, `${text}\npackage extra { part broken : NoSuchType; }\n`))
            .rejects.toThrow(/opensysml rejects the updated model\/catalog\/temperature_alarm\.sysml: .*NoSuchType/);
        expect(readFileSync(join(root, FILE), 'utf8')).toBe(text);
    }, 60_000);

    it('writes an accepted edit and leaves the file alone when OpenSysML rejects one', async () => {
        const config = loadProjectSettings(root);
        const revision = await recompileProject({ projectDir: root, config });
        const id = 'memo_examples_temperature_alarm::icuNurse';
        const base = {
            id, shortName: 'icuNurse', kind: 'User', construct: 'part', file: FILE,
            attributes: { actorKind: 'ActorKind::clinician' }, irIdentity: revision.index.byMemoElement[id],
        };

        const written = await saveElementToFile(root, { ...base, doc: 'checked by OpenSysML' }, revision.index, revision.outlines);
        expect(written.error).toBeUndefined();
        expect(readFileSync(join(root, FILE), 'utf8')).toContain('checked by OpenSysML');

        const before = readFileSync(join(root, FILE), 'utf8');
        const refused = await saveElementToFile(root, { ...base, kind: 'NoSuchKind' }, revision.index, revision.outlines);
        expect(refused.success).toBe(false);
        expect(refused.error).toMatch(/opensysml rejects/);
        expect(readFileSync(join(root, FILE), 'utf8')).toBe(before);
    }, 60_000);
});
