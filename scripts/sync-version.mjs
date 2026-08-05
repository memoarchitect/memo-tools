import { readFileSync, writeFileSync } from 'node:fs';

const checkOnly = process.argv.includes('--check');
const version = readFileSync('VERSION', 'utf8').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('VERSION must contain a semantic version.');
const edited = new Map();
const changes = [];
const replace = (path, pattern, replacement) => {
  const before = edited.get(path) ?? readFileSync(path, 'utf8');
  const after = before.replace(pattern, replacement);
  if (after === before && !pattern.test(before)) throw new Error(`${path}: version marker not found`);
  if (after === before) return;
  edited.set(path, after);
  const existing = changes.find(change => change.path === path);
  if (existing) existing.after = after; else changes.push({ path, after });
};
replace('package.json', /^(  "version": ")[^"]+(",)$/m, `$1${version}$2`);
replace('pyproject.toml', /^(version = ")[^"]+("$)/m, `$1${version}$2`);
replace('README.md', /memo-tools \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `memo-tools ${version}`);
if (checkOnly && changes.length) {
  console.error(`VERSION ${version} is not synchronized to: ${changes.map(({ path }) => path).join(', ')}`);
  process.exit(1);
}
for (const { path, after } of changes) writeFileSync(path, after);
console.log(checkOnly ? `VERSION ${version} is synchronized.` : `Synchronized product files to VERSION ${version}.`);
