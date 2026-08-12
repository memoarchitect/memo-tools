// ─── Package write-back ──────────────────────────────────────────────────────
//
// Containment in MEMO is package membership. A container in an Architect
// explorer is therefore a SysML `package` declaration in project source, and
// creating, renaming, deleting or moving into one is a source edit — not a
// directory on disk, and not an attribute on a placeholder element.
//
// Every operation here follows the same discipline as ./persistor.ts: locate
// the declaration by parsing (never by matching its name in the file text),
// splice one range, parse the result before it reaches disk, and write
// atomically. A package is addressed by its **qualified name** rather than by
// an IR identity because the IR does not ingest package declarations — it walks
// through them — so there is no identity to quote. A qualified name is a real
// address for the same reason the model uses it: two packages cannot share one.
//
// What these operations deliberately do NOT do is update references. Renaming
// or deleting a package changes the qualified name of everything it declares,
// and rewriting every reference needs workspace-wide name resolution — the
// linker, which does not exist yet. The caller is told so, in the same words
// the element rename uses, rather than being handed a broken model presented as
// a successful edit.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseText } from '../model/parser-utils.js';
import {
    requireIrIdentity,
    resolveDeclarationByIdentity,
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';
import { commitSource } from './persistor.js';
import {
    dedent, insertIntoBody, locatePackages, removeLine, spliceIndented,
} from './package-source.js';

/**
 * Why a package rename or delete is only a text edit.
 *
 * Said once here so every surface says the same thing, and phrased as what was
 * *not* done: the edit succeeded, and the references it invalidated are the
 * caller's to fix until the linker can do it.
 */
export const PACKAGE_EDIT_IS_TEXT_ONLY =
    'This edits the package declaration only. MEMO cannot yet update qualified names that refer to it or to '
    + 'anything it declares — that needs cross-file name resolution — so those references will not resolve '
    + 'until you update them by hand.';

export interface PackageWriteResult {
    success: boolean;
    /** Project-relative files this operation wrote. */
    filePaths: string[];
    /** Qualified name of the package the operation produced or acted on. */
    qualifiedName?: string;
    /** Advisory notes about a write that succeeded. */
    warnings?: { code: 'package-edit-is-text-only'; message: string }[];
    error?: string;
    /** Set when the failure was a stale element identity, so callers can say so. */
    stale?: boolean;
}

/** Names MEMO will write into source. Anything else is refused, not escaped. */
const PACKAGE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Declare a new package.
 *
 * With a parent, the package is nested inside that declaration; without one it
 * is appended at the file's top level. Nesting rather than minting a new file
 * keeps the edit to a single range in a file the caller already named — the
 * catalog's namespace-to-directory mirroring is a project layout decision, not
 * something a right-click in a tree should quietly make.
 */
export async function createPackage(
    cwd: string,
    request: { file: string; parent?: string; name: string },
): Promise<PackageWriteResult> {
    const { file, parent, name } = request;
    if (!PACKAGE_NAME.test(name)) {
        return { success: false, filePaths: [], error: `"${name}" is not a valid package name.` };
    }
    const qualifiedName = parent ? `${parent}::${name}` : name;

    const absolute = resolve(cwd, file);
    const source = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';

    const existing = await locatePackages(source);
    if (existing.some(pkg => pkg.qualifiedName === qualifiedName)) {
        return { success: false, filePaths: [], error: `Package "${qualifiedName}" already exists in ${file}.` };
    }

    let updated: string;
    if (parent) {
        const target = existing.find(pkg => pkg.qualifiedName === parent);
        if (!target) {
            return { success: false, filePaths: [], error: `${file} does not declare package "${parent}".` };
        }
        updated = insertIntoBody(source, target, `package ${name} {\n}\n`);
    } else {
        const separator = source && !source.endsWith('\n\n') ? (source.endsWith('\n') ? '\n' : '\n\n') : '';
        updated = `${source}${separator}package ${name} {\n}\n`;
    }

    const committed = await commitSource(absolute, file, updated);
    if (!committed.success) return { success: false, filePaths: [], error: committed.error };
    return { success: true, filePaths: [file], qualifiedName };
}

/**
 * Rename a package in place.
 *
 * Only the declared name token is replaced; members keep their positions, so
 * the operation cannot reorder or reformat a file around them.
 */
export async function renamePackage(
    cwd: string,
    request: { file: string; qualifiedName: string; name: string },
): Promise<PackageWriteResult> {
    const { file, qualifiedName, name } = request;
    if (!PACKAGE_NAME.test(name)) {
        return { success: false, filePaths: [], error: `"${name}" is not a valid package name.` };
    }

    const absolute = resolve(cwd, file);
    if (!existsSync(absolute)) return { success: false, filePaths: [], error: `${file} does not exist.` };
    const source = readFileSync(absolute, 'utf8');

    const packages = await locatePackages(source);
    const target = packages.find(pkg => pkg.qualifiedName === qualifiedName);
    if (!target) {
        return { success: false, filePaths: [], error: `${file} does not declare package "${qualifiedName}".` };
    }
    if (target.name === name) return { success: true, filePaths: [], qualifiedName };

    const parent = parentOf(qualifiedName);
    const renamed = parent ? `${parent}::${name}` : name;
    if (packages.some(pkg => pkg.qualifiedName === renamed)) {
        return { success: false, filePaths: [], error: `Package "${renamed}" already exists in ${file}.` };
    }

    const header = source.slice(target.start, target.bodyStart);
    const match = header.match(new RegExp(`(\\bpackage\\s+)(${escapeRegExp(target.name)})\\b`));
    if (!match || match.index === undefined) {
        return { success: false, filePaths: [], error: `Could not find the declared name of "${qualifiedName}".` };
    }
    const nameStart = target.start + match.index + match[1].length;
    const updated = source.slice(0, nameStart) + name + source.slice(nameStart + target.name.length);

    const committed = await commitSource(absolute, file, updated);
    if (!committed.success) return { success: false, filePaths: [], error: committed.error };
    return {
        success: true, filePaths: [file], qualifiedName: renamed,
        warnings: [{ code: 'package-edit-is-text-only', message: PACKAGE_EDIT_IS_TEXT_ONLY }],
    };
}

/**
 * Re-parent a package: move its whole declaration under another package.
 *
 * The declaration is moved verbatim, so everything it declares moves with it —
 * which is what makes this one operation rather than a move per member. Moving
 * a package into itself or into its own descendant is refused: the result would
 * be a namespace that contains the thing containing it.
 */
export async function movePackage(
    cwd: string,
    request: {
        file: string;
        qualifiedName: string;
        /** Absent means the file's top level. */
        targetParent?: string;
        targetFile: string;
    },
): Promise<PackageWriteResult> {
    const { file, qualifiedName, targetParent, targetFile } = request;
    if (targetParent === qualifiedName || targetParent?.startsWith(`${qualifiedName}::`)) {
        return {
            success: false, filePaths: [],
            error: `"${qualifiedName}" cannot be moved into itself or into a package it declares.`,
        };
    }
    if (targetParent === parentOf(qualifiedName)) return { success: true, filePaths: [], qualifiedName };

    const absolute = resolve(cwd, file);
    const targetAbsolute = resolve(cwd, targetFile);
    if (!existsSync(absolute)) return { success: false, filePaths: [], error: `${file} does not exist.` };
    if (!existsSync(targetAbsolute)) return { success: false, filePaths: [], error: `${targetFile} does not exist.` };

    const source = readFileSync(absolute, 'utf8');
    const target = (await locatePackages(source)).find(pkg => pkg.qualifiedName === qualifiedName);
    if (!target) {
        return { success: false, filePaths: [], error: `${file} does not declare package "${qualifiedName}".` };
    }
    const moved = `${target.name.split('::').pop()}`;
    const renamed = targetParent ? `${targetParent}::${moved}` : moved;

    const declaration = dedent(source.slice(target.start, target.end).replace(/\s+$/, ''));
    const withoutPackage = removeLine(source, target.start, target.end);

    const sameFile = absolute === targetAbsolute;
    const targetSource = sameFile ? withoutPackage : readFileSync(targetAbsolute, 'utf8');

    let updatedTarget: string;
    if (targetParent) {
        const parent = (await locatePackages(targetSource)).find(pkg => pkg.qualifiedName === targetParent);
        if (!parent) {
            return { success: false, filePaths: [], error: `${targetFile} does not declare package "${targetParent}".` };
        }
        updatedTarget = insertIntoBody(targetSource, parent, `${declaration}\n`);
    } else {
        const separator = targetSource.endsWith('\n') ? '' : '\n';
        updatedTarget = `${targetSource}${separator}${declaration}\n`;
    }

    const warnings = [{ code: 'package-edit-is-text-only' as const, message: PACKAGE_EDIT_IS_TEXT_ONLY }];
    if (sameFile) {
        const committed = await commitSource(absolute, file, updatedTarget);
        if (!committed.success) return { success: false, filePaths: [], error: committed.error };
        return { success: true, filePaths: [file], qualifiedName: renamed, warnings };
    }

    const committedTarget = await commitSource(targetAbsolute, targetFile, updatedTarget);
    if (!committedTarget.success) return { success: false, filePaths: [], error: committedTarget.error };
    const committedSource = await commitSource(absolute, file, withoutPackage);
    if (!committedSource.success) {
        return {
            success: false, filePaths: [targetFile],
            error: `${committedSource.error} "${qualifiedName}" is now declared in both ${file} and ${targetFile}; `
                + 'remove the one you do not want.',
        };
    }
    return { success: true, filePaths: [targetFile, file], qualifiedName: renamed, warnings };
}

/**
 * Remove a package declaration, keeping everything it declares.
 *
 * The members are lifted into the enclosing scope rather than deleted: emptying
 * a container is a containment change, and silently deleting a subtree of the
 * model because someone removed a folder would be the most expensive possible
 * reading of that gesture.
 */
export async function deletePackage(
    cwd: string,
    request: { file: string; qualifiedName: string },
): Promise<PackageWriteResult> {
    const { file, qualifiedName } = request;
    const absolute = resolve(cwd, file);
    if (!existsSync(absolute)) return { success: false, filePaths: [], error: `${file} does not exist.` };
    const source = readFileSync(absolute, 'utf8');

    const target = (await locatePackages(source)).find(pkg => pkg.qualifiedName === qualifiedName);
    if (!target) {
        return { success: false, filePaths: [], error: `${file} does not declare package "${qualifiedName}".` };
    }
    if (!parentOf(qualifiedName)) {
        return {
            success: false, filePaths: [],
            error: `"${qualifiedName}" is a top-level package; removing it would leave its members with no `
                + 'namespace. Move or delete its contents first.',
        };
    }

    const body = source.slice(target.bodyStart, target.bodyEnd);
    const lifted = dedent(body.replace(/^\n/, '').replace(/\s+$/, ''));
    const updated = lifted
        ? spliceIndented(source, target.start, target.end, lifted)
        : removeLine(source, target.start, target.end);

    const committed = await commitSource(absolute, file, updated);
    if (!committed.success) return { success: false, filePaths: [], error: committed.error };
    return {
        success: true, filePaths: [file], qualifiedName,
        ...(lifted ? { warnings: [{ code: 'package-edit-is-text-only' as const, message: PACKAGE_EDIT_IS_TEXT_ONLY }] } : {}),
    };
}

/**
 * Move one element's declaration into another package.
 *
 * The declaration text is moved verbatim — this is a containment change, not a
 * rewrite, so nothing the user authored inside the declaration is regenerated.
 * The element is addressed by IR identity, exactly as an update is, so a move
 * made against a stale revision fails loudly instead of cutting whatever now
 * occupies that position.
 */
export async function moveElementToPackage(
    cwd: string,
    request: {
        elementId: string;
        irIdentity: string;
        sourceFile: string;
        targetFile: string;
        /** Absent means the file's top level. */
        targetPackage?: string;
    },
    index: IrIdentityIndex,
): Promise<PackageWriteResult> {
    const { elementId, irIdentity, sourceFile, targetFile, targetPackage } = request;
    const sourceAbsolute = resolve(cwd, sourceFile);
    const targetAbsolute = resolve(cwd, targetFile);
    if (!existsSync(sourceAbsolute)) return { success: false, filePaths: [], error: `${sourceFile} does not exist.` };
    if (!existsSync(targetAbsolute)) return { success: false, filePaths: [], error: `${targetFile} does not exist.` };

    const source = readFileSync(sourceAbsolute, 'utf8');
    let located: { start: number; end: number };
    try {
        located = await locateByIdentity(source, index, irIdentity, elementId);
    } catch (e) {
        if (e instanceof StaleIrIdentityError) return { success: false, filePaths: [], stale: true, error: e.message };
        return { success: false, filePaths: [], error: String(e) };
    }

    const declaration = dedent(source.slice(located.start, located.end).replace(/\s+$/, ''));
    const withoutElement = removeLine(source, located.start, located.end);

    // A move within one file is one edit to one string. Splitting it into a
    // remove and an insert against the original offsets would place the second
    // splice using positions the first one invalidated.
    const sameFile = sourceAbsolute === targetAbsolute;
    const targetSource = sameFile ? withoutElement : readFileSync(targetAbsolute, 'utf8');

    let updatedTarget: string;
    if (targetPackage) {
        const target = (await locatePackages(targetSource)).find(pkg => pkg.qualifiedName === targetPackage);
        if (!target) {
            return { success: false, filePaths: [], error: `${targetFile} does not declare package "${targetPackage}".` };
        }
        updatedTarget = insertIntoBody(targetSource, target, `${declaration}\n`);
    } else {
        const separator = targetSource.endsWith('\n') ? '' : '\n';
        updatedTarget = `${targetSource}${separator}${declaration}\n`;
    }

    if (sameFile) {
        const committed = await commitSource(targetAbsolute, targetFile, updatedTarget);
        if (!committed.success) return { success: false, filePaths: [], error: committed.error };
        return { success: true, filePaths: [targetFile], qualifiedName: targetPackage };
    }

    // Across files, the destination is written first: if it fails, the source
    // file still holds the only copy of the declaration. The reverse order can
    // lose it outright.
    const committedTarget = await commitSource(targetAbsolute, targetFile, updatedTarget);
    if (!committedTarget.success) return { success: false, filePaths: [], error: committedTarget.error };
    const committedSource = await commitSource(sourceAbsolute, sourceFile, withoutElement);
    if (!committedSource.success) {
        return {
            success: false, filePaths: [targetFile],
            error: `${committedSource.error} "${elementId}" is now declared in both ${sourceFile} and ${targetFile}; `
                + 'remove the one you do not want.',
        };
    }
    return { success: true, filePaths: [targetFile, sourceFile], qualifiedName: targetPackage };
}

// ─── Source location ─────────────────────────────────────────────────────────

/** Source range of the declaration an IR identity names, in this file's text. */
async function locateByIdentity(
    source: string, index: IrIdentityIndex, identityId: string, elementId: string,
): Promise<{ start: number; end: number }> {
    const record = requireIrIdentity(index, identityId, elementId);
    const { document, errors } = await parseText(source);
    if (errors.length > 0) {
        throw new StaleIrIdentityError(identityId, `its file no longer parses (${errors[0].message})`);
    }
    const node = resolveDeclarationByIdentity(document.parseResult.value as any, record.identity);
    const cst = node.$cstNode;
    if (!cst) throw new StaleIrIdentityError(identityId, 'the resolved declaration has no source range');
    return { start: cst.offset, end: cst.offset + cst.length };
}

// ─── Text editing ────────────────────────────────────────────────────────────

/** Qualified name of the declaring package, or undefined at the top level. */
function parentOf(qualifiedName: string): string | undefined {
    const separator = qualifiedName.lastIndexOf('::');
    return separator === -1 ? undefined : qualifiedName.slice(0, separator);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
