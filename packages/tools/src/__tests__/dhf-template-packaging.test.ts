// DHF templates have to be inside the published package.
//
// They lived at `src/compliance/dhf-templates/` — a namespace the V-model
// taxonomy removed — and that directory was absent from the ontology package's
// `files` list. So the templates resolved in a linked memo-meta workspace and
// shipped to nobody: every installed user's `memo dhf` found an empty template
// set, and no test noticed, because every test runs in the workspace where the
// path happens to exist.
//
// They now live under `src/artifacts/templates/dhf/`, which is both where the
// artifacts taxonomy puts document templates and a directory the package
// actually publishes.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const memoRoot = resolve(__dirname, '../../../../../memo');
const templatesDir = join(memoRoot, 'src/artifacts/templates/dhf');
const available = existsSync(memoRoot);

describe.runIf(available)('DHF template packaging', () => {
    it('keeps the templates under the artifacts taxonomy', () => {
        expect(existsSync(templatesDir)).toBe(true);
        expect(existsSync(join(memoRoot, 'src/compliance'))).toBe(false);
    });

    it('publishes the directory that holds them', () => {
        // The check that actually matters: a `files` entry covering the
        // templates. Without one they exist in the repo and not in the tarball.
        const pkg = JSON.parse(readFileSync(join(memoRoot, 'package.json'), 'utf-8'));
        const covered = (pkg.files as string[]).some(entry =>
            'src/artifacts/templates/dhf'.startsWith(entry.replace(/\/$/, '')));
        expect(covered).toBe(true);
    });

    it('lists no path in files that does not exist', () => {
        // `ontology/memo.rendering.yaml` outlived the file the session-3 flip
        // deleted. A stale entry is harmless until it is load-bearing, and
        // there is no reason to find out which one it is.
        const pkg = JSON.parse(readFileSync(join(memoRoot, 'package.json'), 'utf-8'));
        const missing = (pkg.files as string[])
            .filter(entry => !existsSync(join(memoRoot, entry.replace(/\/$/, ''))));
        expect(missing).toEqual([]);
    });
});
