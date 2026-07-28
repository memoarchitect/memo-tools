import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [before = '', ref = ''] = process.argv.slice(2);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const expectedTag = `v${pkg.version}`;
const runGit = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => { console.error(message); process.exit(1); };

if (ref.startsWith('refs/tags/')) {
  const pushedTag = ref.slice('refs/tags/'.length);
  if (pushedTag !== expectedTag) fail(`Tag ${pushedTag} does not match package version ${pkg.version}; expected ${expectedTag}.`);
  console.log(`Tag ${pushedTag} matches package version ${pkg.version}.`);
  process.exit(0);
}
if (!before || /^0+$/.test(before)) {
  console.log('No prior main commit is available; version-tag comparison skipped.');
  process.exit(0);
}
let previousVersion;
try { previousVersion = JSON.parse(runGit('show', `${before}:package.json`)).version; }
catch { console.log('The previous commit has no readable package version; comparison skipped.'); process.exit(0); }
if (previousVersion === pkg.version) {
  console.log(`Package version remains ${pkg.version}.`);
  process.exit(0);
}
const tags = runGit('tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
if (!tags.includes(expectedTag)) fail(`package.json changed from ${previousVersion} to ${pkg.version}, but HEAD is not tagged ${expectedTag}. Push the main commit and ${expectedTag} together.`);
console.log(`Package version changed from ${previousVersion} to ${pkg.version} and HEAD is tagged ${expectedTag}.`);
