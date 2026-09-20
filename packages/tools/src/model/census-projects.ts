// ─── Census subjects ─────────────────────────────────────────────────────────
//
// Which projects the element census counts, and how one of them is built.
//
// Shared by the gate test and the capture script so the two cannot disagree
// about what was frozen: a baseline captured over a different project set than
// the gate checks is a baseline that passes for the wrong reason.
//
// The subjects are the shipped examples. They are what a reader opens first,
// they are the only in-repository models that exercise the full ingestion path,
// and a change to a shared ontology definition reaches every one of them at
// once — which is the change this census exists to watch.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMemoModel } from './builder.js';
import { loadProjectSettings } from './config-loader.js';
import { findProjectRoot } from './native-project.js';
import { loadOntologyRegistries } from './ontology-loader.js';
import { computeCensus, type ProjectCensus } from './census.js';

/** One subject: its baseline id and the directory holding the project. */
export interface CensusSubject {
    id: string;
    dir: string;
}

/**
 * The example projects, in directory order.
 *
 * Discovered rather than listed: a new example is content the census should
 * cover from the day it lands, and a hardcoded list would have to be edited to
 * get that — which is the edit nobody makes. A directory that does not resolve
 * as a project is skipped here and never reaches a baseline.
 */
export function censusSubjects(examplesDir: string): CensusSubject[] {
    if (!existsSync(examplesDir)) return [];
    return readdirSync(examplesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({ id: entry.name, dir: resolve(examplesDir, entry.name) }))
        .filter(subject => findProjectRoot(subject.dir))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Build one subject's model and count it.
 *
 * The build is `memo validate`'s: resolve natively, subtract every library root
 * — selected AND unused, because a file from a root the project never imported
 * is not its content — and build what is left. Counting the library's own
 * elements would make every project's census move when the ontology changes,
 * which is the one signal this must not drown.
 */
export async function censusOf(subject: CensusSubject): Promise<ProjectCensus> {
    const root = findProjectRoot(subject.dir);
    if (!root) throw new Error(`${subject.id}: not a MEMO project (${subject.dir})`);
    const loaded = await loadOntologyRegistries(root);
    const resolution = loaded.resolution;
    const libraryRoots = [...(resolution?.selectedRoots ?? []), ...(resolution?.unusedRoots ?? [])];
    const isProjectFile = (file: string) => !libraryRoots.some(r => file.startsWith(r.sysmlDir));
    const documents = (resolution?.documents ?? []).filter(d => isProjectFile(d.filePath));
    const parseErrors = (resolution?.parseErrors ?? []).filter(e => isProjectFile(e.file));
    const model = buildMemoModel(
        documents, loadProjectSettings(root), parseErrors,
        { ...loaded.registries, provenance: loaded.provenance });
    return computeCensus(model, { project: subject.id, projectRoot: root });
}
