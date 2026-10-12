import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ontologyRoot = dirname(require.resolve('@memoarchitect/ontology/package.json'));
// `pnpm example:validate [<example>]` — gpca-pump unless another shipped
// example is named. The example is validated in a scratch copy, so the identity
// registry a validate writes never lands in the shipped tree.
const example = process.argv[2] ?? 'gpca-pump';
const installedExample = resolve(ontologyRoot, 'examples', example);
const exampleRoot = mkdtempSync(resolve(tmpdir(), `memo-${example}-`));
cpSync(installedExample, exampleRoot, { recursive: true });
const memoCli = resolve(repoRoot, 'packages/tools/lib/bin/memo.js');

const child = spawn(process.execPath, [memoCli, 'validate', '.'], {
    cwd: exampleRoot,
    stdio: 'inherit',
});

child.on('exit', code => {
    rmSync(exampleRoot, { recursive: true, force: true });
    process.exit(code ?? 1);
});
