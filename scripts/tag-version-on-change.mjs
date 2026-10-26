// Tag v<VERSION> when VERSION changed between `before` (a commit) and now. Run by CI after a push.
// Usage: node scripts/tag-version-on-change.mjs [before-sha]

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
const before = process.argv[2] ?? '';
const version = readFileSync('VERSION', 'utf8').replace(/\s+/g, '');
const tag = `v${version}`;
let previous = '';
if (before && !/^0+$/.test(before)) {
    const shown = git('show', `${before}:VERSION`);
    previous = shown.status === 0 ? shown.stdout.replace(/\s+/g, '') : '';
}
if (previous === version) process.exit(0);

if (git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`).status === 0) {
    if (!previous) {
        console.log(`${tag} already records the version that predates VERSION; no replacement needed.`);
        process.exit(0);
    }
    console.error(`Refusing to reuse existing ${tag}; choose a new VERSION.`);
    process.exit(1);
}

for (const step of [
    ['config', 'user.name', 'github-actions[bot]'],
    ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'],
    ['tag', '-a', tag, '-m', `Release ${tag}`],
    ['push', 'origin', tag],
]) {
    const result = git(...step);
    if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
}
