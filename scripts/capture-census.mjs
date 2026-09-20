#!/usr/bin/env node
// ─── Element census capture ──────────────────────────────────────────────────
//
// Freezes the per-file, per-kind element counts of every shipped example, so
// `census.test.ts` can fail the gate when a later change makes one of them
// contain less.
//
//   pnpm build && pnpm census:capture
//
// Run it only when the difference is UNDERSTOOD. The census cannot tell content
// that was deliberately removed from content that silently vanished — that is
// the reader's job, and re-freezing is how the reader says which one it was.
// Say in the commit message what moved and why, the way
// `capture-baseline.mjs`'s re-freeze notes do.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const examplesDir = resolve(toolsRoot, '../memo/examples');
const outDir = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/census');
const lib = resolve(toolsRoot, 'packages/tools/lib/index.js');

if (!existsSync(lib)) {
    console.error(`Not built: ${lib}\nRun: pnpm build`);
    process.exit(1);
}
if (!existsSync(examplesDir)) {
    console.error(`No examples beside this checkout: ${examplesDir}`);
    process.exit(1);
}

const { censusSubjects, censusOf, compareCensus, formatCensusFindings } = await import(lib);

const subjects = censusSubjects(examplesDir);
if (subjects.length === 0) {
    console.error(`No example project resolved under ${examplesDir}`);
    process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const subject of subjects) {
    const path = resolve(outDir, `${subject.id}.json`);
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : undefined;
    let census;
    try {
        census = await censusOf(subject);
    } catch (error) {
        console.error(`FAIL ${subject.id}: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
        continue;
    }
    writeFileSync(path, JSON.stringify(census, null, 2) + '\n');
    const t = census.totals;
    console.log(`${subject.id}: ${t.elements} elements, ${t.relationships} relationships, `
        + `${t.packages} packages, ${t.files} files`
        + `${t.parseErrors ? `, ${t.parseErrors} PARSE ERRORS` : ''}`
        + `${t.builderFindings ? `, ${t.builderFindings} builder findings` : ''}`);
    // Print what the re-freeze is overwriting. A capture that silently replaces
    // a baseline is a capture nobody reviews.
    if (previous) {
        const findings = compareCensus(previous, census);
        if (findings.length > 0) {
            console.log(indent(formatCensusFindings(findings, 10)));
        }
    }
}

console.log(`\nCensus written to ${outDir}`);

function indent(text) {
    return text.split('\n').map(line => `    ${line}`).join('\n');
}
