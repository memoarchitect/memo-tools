// ─── Creating a release record: one semantic write ───────────────────────────
//
// A record is the part and its typed-dependency statements (`#ReleaseOf`, `#Contains`, `#Implements`,
// `#SelectsFeature`, `#VerifiedByCase`), and they are written together or not at all: N separate
// relationship writes could leave a half-made release when one is refused. The text goes through the
// same compile-before-commit and atomic write as every other semantic write (`commitSource`).
//
// Two things the write enforces that the page cannot:
//   - placement: never under `<include>/systems/` (see `release-target.ts`);
//   - the commit: `modelCommit` is HEAD unless the caller names one, and HEAD is refused when what the
//     person sees has uncommitted changes, because the record would pin a commit that does not hold it.
//     Everything the record contains must be at or before the commit it is written at.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OutlineSource } from '../authoring/outline-source.js';
import { isAncestor } from '../model/pinned.js';
import { isInSystemFolder } from '../model/release-target.js';
import { appendToLastPackage, commitSource } from './persistor.js';

const git = promisify(execFile);

export interface ReleaseCreateRequest {
    requestId?: string;
    /** The declared name, lowerCamelCase. */
    name: string;
    label?: string;
    /** The element id (a qualified name) of the item the record is a release of. */
    itemId: string;
    partNumber: string;
    revision: string;
    softwareVersion?: string;
    codeTag?: string;
    /** An `ElementStatusKind` literal name: `draft`, `approved`, `released`. */
    status?: string;
    /** Default: the commit HEAD names. */
    modelCommit?: string;
    /** Element ids (qualified names) of the records it contains, the interface records it implements,
     *  the features it selects and the verification cases that verified it. */
    contains?: string[];
    implements?: string[];
    features?: string[];
    verifiedBy?: string[];
    /** The project-relative file to write into. */
    file: string;
}

export interface ReleaseCreateContext {
    projectRoot: string;
    outlines: OutlineSource;
    /** The project-relative file declaring an element, if the model has it. */
    fileOf(id: string): string | undefined;
    /** A release record's `modelCommit`, if the model has it. */
    commitOf(id: string): string | undefined;
}

export interface ReleaseCreateResult {
    success: boolean;
    filePath?: string;
    name?: string;
    modelCommit?: string;
    error?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/;
const STATUS = /^[a-z][A-Za-z]*$/;

const quote = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

async function run(cwd: string, args: string[]): Promise<string> {
    return (await git('git', ['-C', cwd, ...args])).stdout.trim();
}

/** The packages the record's text names: its kind and links, its status, its identity, and features. */
export function releaseImports(request: ReleaseCreateRequest): string[] {
    return [
        'memo_core_common', 'memo_core_dimensions', 'memo_artifacts_configuration_management',
        ...(request.features && request.features.length > 0 ? ['memo_architecture_variability'] : []),
    ];
}

/** `source` with an import of each package it does not already import, at the top of its last package. */
function withImports(source: string, packages: readonly string[]): string {
    const open = [...source.matchAll(/\bpackage\s+[A-Za-z_][\w:]*\s*\{[ \t]*\r?\n/g)].pop();
    if (!open) return source;
    const missing = packages.filter(name => !new RegExp(`\\bimport\\s+${name}::`).test(source));
    if (missing.length === 0) return source;
    const at = open.index! + open[0].length;
    return `${source.slice(0, at)}${missing.map(name => `    private import ${name}::*;\n`).join('')}${source.slice(at)}`;
}

/** The text of the record and its statements. */
export function releaseRecordText(request: ReleaseCreateRequest, modelCommit: string): string {
    const lines = [`    part ${request.name} : ReleaseRecord {`];
    if (request.label) lines.push(`        @MemoIdentity { :>> label = ${quote(request.label)}; }`);
    if (request.status) lines.push(`        attribute :>> status = ElementStatusKind::${request.status};`);
    lines.push(`        attribute :>> partNumber = ${quote(request.partNumber)};`);
    lines.push(`        attribute :>> revision = ${quote(request.revision)};`);
    if (request.softwareVersion) lines.push(`        attribute :>> softwareVersion = ${quote(request.softwareVersion)};`);
    if (request.codeTag) lines.push(`        attribute :>> codeTag = ${quote(request.codeTag)};`);
    lines.push(`        attribute :>> modelCommit = ${quote(modelCommit)};`, '    }');
    lines.push(`    #ReleaseOf dependency from ${request.name} to ${request.itemId};`);
    for (const [relation, ends] of [['Contains', request.contains], ['Implements', request.implements], ['SelectsFeature', request.features], ['VerifiedByCase', request.verifiedBy]] as const) {
        if (ends && ends.length > 0) lines.push(`    #${relation} dependency from ${request.name} to ${ends.join(', ')};`);
    }
    return lines.join('\n');
}

export async function writeRelease(request: ReleaseCreateRequest, context: ReleaseCreateContext): Promise<ReleaseCreateResult> {
    const fail = (error: string): ReleaseCreateResult => ({ success: false, error });
    if (!IDENTIFIER.test(request.name)) return fail(`"${request.name}" is not a name a record can be declared with.`);
    for (const [what, value] of [['part number', request.partNumber], ['revision', request.revision]] as const) {
        if (!value?.trim()) return fail(`A release has a ${what}.`);
    }
    if (request.status !== undefined && !STATUS.test(request.status)) return fail(`"${request.status}" is not a status.`);
    for (const id of [request.itemId, ...(request.contains ?? []), ...(request.implements ?? []), ...(request.features ?? []), ...(request.verifiedBy ?? [])]) {
        if (!QUALIFIED.test(id)) return fail(`"${id}" is not an element id.`);
    }
    const file = request.file.replaceAll('\\', '/');
    if (!file.endsWith('.sysml') || file.startsWith('/') || file.split('/').includes('..')) return fail(`"${request.file}" is not a project file.`);
    if (isInSystemFolder(file)) {
        return fail(`A release record is not written under systems/ (${file}): a system folder is checked out at the commit the record pins, where the record does not exist yet. Use a file under sos/.`);
    }

    let commit = request.modelCommit?.trim();
    try {
        const head = await run(context.projectRoot, ['rev-parse', 'HEAD']);
        if (!commit) {
            commit = head;
            // What the person sees must be what the commit holds: the item's system folder, or, for
            // anything else, the whole project, ignoring the file this write is about to change.
            const itemFile = context.fileOf(request.itemId)?.replaceAll('\\', '/');
            const scope = itemFile && isInSystemFolder(itemFile) ? itemFile.replace(/^(.*?\/?systems\/[^/]+)\/.*$/, '$1') : '.';
            const dirty = await run(context.projectRoot, ['status', '--porcelain', '--untracked-files=no', '--', scope, `:(exclude)${file}`]);
            if (dirty) {
                return fail(`There are uncommitted changes in ${scope === '.' ? 'the project' : scope}, so the commit ${head.slice(0, 7)} does not hold what you see. `
                    + `Commit them first, or name the commit to record.\n${dirty.split('\n').slice(0, 5).join('\n')}`);
            }
        } else {
            commit = await run(context.projectRoot, ['rev-parse', '--verify', `${commit}^{commit}`]);
        }
        for (const contained of request.contains ?? []) {
            const other = context.commitOf(contained);
            if (other && !(await isAncestor(context.projectRoot, other, commit))) {
                return fail(`${contained} is at ${other.slice(0, 7)}, which is not at or before ${commit.slice(0, 7)}: a release must be at or after what it contains.`);
            }
        }
    } catch (error) {
        return fail(`The commit could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }

    const absolute = resolve(context.projectRoot, file);
    const root = resolve(context.projectRoot);
    if (!absolute.startsWith(`${root}/`)) return fail('The file is outside the project.');
    mkdirSync(dirname(absolute), { recursive: true });
    const text = releaseRecordText(request, commit);
    const existing = existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
    const packageName = file.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '').replace(/_sysml$/, '');
    const updated = existing === undefined
        ? `package ${packageName} {\n${releaseImports(request).map(name => `    private import ${name}::*;\n`).join('')}${text}\n}\n`
        : appendToLastPackage(withImports(existing, releaseImports(request)), text);
    // A new file is verified as a new file: the outline source reads it from the text, not from disk.
    const committed = await commitSource(absolute, file, updated, context.outlines);
    if (!committed.success) return fail(committed.error ?? 'The release could not be written.');
    return { success: true, filePath: file, name: request.name, modelCommit: commit };
}
