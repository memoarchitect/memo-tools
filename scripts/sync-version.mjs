import { readFileSync, writeFileSync } from 'node:fs';

const checkOnly = process.argv.includes('--check');
const version = readFileSync('VERSION', 'utf8').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('VERSION must contain a semantic version.');
const changes = [];
const replace = (path, pattern, replacement) => {
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, replacement);
  if (after === before && !pattern.test(before)) throw new Error(`${path}: version marker not found`);
  if (after !== before) changes.push({ path, after });
};
replace('package.json', /^(  "version": ")[^"]+(",)$/m, `$1${version}$2`);
// The repo publishes two artifacts now: the tools package and the compiler it
// ships as its own tool. They release together, so the compiler's own version
// and its pin on the tools package both track VERSION.
replace('packages/sysmlc/package.json', /^(  "version": ")[^"]+(",)$/m, `$1${version}$2`);
replace('packages/sysmlc/package.json', /^(    "@memoarchitect\/tools": ")[^"]+(",)$/m, `$1${version}$2`);
replace('pyproject.toml', /^(version = ")[^"]+("$)/m, `$1${version}$2`);
replace('README.md', /memo-tools \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `memo-tools ${version}`);
if (checkOnly && changes.length) {
  console.error(`VERSION ${version} is not synchronized to: ${changes.map(({ path }) => path).join(', ')}`);
  process.exit(1);
}
for (const { path, after } of changes) writeFileSync(path, after);
console.log(checkOnly ? `VERSION ${version} is synchronized.` : `Synchronized product files to VERSION ${version}.`);
