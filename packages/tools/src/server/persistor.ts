// ─── Element write-back ──────────────────────────────────────────────────────
//
// Persists one element change back to its source `.sysml` file.
//
// This module used to find its target with a regular expression over the file
// text — `<construct> <id> : <kind> { … }` — which made the authored name the
// address of the declaration. That is wrong in three ways at once: two
// same-named declarations in different namespaces are one target; a `{}` nested
// two deep escapes the pattern; and a comment mentioning the name is a match.
//
// An update now addresses its target by **IR identity** (§6.2): the caller
// quotes the identity minted by the last lowering, the identity is resolved
// against the current source, and the declaration's own CST range is replaced.
// Everything else in the file — comments, imports, neighbouring declarations —
// is untouched because only that one range is edited, and the result is
// reparsed before it reaches disk. An identity the current source does not have
// raises `StaleIrIdentityError` rather than falling back to a name match, which
// is the whole point: a stale write fails loudly instead of editing whatever
// happens to share the name.
//
// Creation has no identity yet, by definition. It appends, and the recompile
// that follows the write mints the identity for the next edit.
// ─────────────────────────────────────────────────────────────────────────────

import { assertWritable } from './write-guard.js';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { generateUsage } from '../serializer/sysml-generator.js';
import { usageKeyword } from '../model/semantic.js';
import {
    requireIrIdentity,
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { resolveOutlineIdentity } from '../authoring/outline-identity.js';
import { bodyMembers, type OutlineNode } from '../authoring/source-outline.js';
import { insertIntoBody, locateContainers } from './package-source.js';
import { shortNameOf } from '../model/element-index.js';

/** Default home for an element the request does not place. */
export const DEFAULT_ELEMENT_FILE = 'model/methodology/project.sysml';

export interface ElementWriteRequest {
    /**
     * The element's qualified id, which is what addresses it in the model and
     * in the identity index. NOT what is written into the source text — see
     * `shortName`.
     */
    id: string;
    /**
     * The name to DECLARE, the last segment of `id`.
     *
     * Separate from `id` because an id is a qualified name now, and writing one
     * into a declaration would emit `part Plant::pump : Component`. A caller
     * that omits it gets the last segment of `id`, which is the same thing for
     * every element the model built.
     */
    shortName?: string;
    name?: string;
    kind?: string;
    construct?: string;
    layer?: string;
    doc?: string;
    attributes?: Record<string, string>;
    /** Project-relative source file. */
    file?: string;
    /**
     * Qualified name of the package — or the usage, for an element that belongs INSIDE a part, as a region
     * belongs inside its screen — that should declare this element.
     *
     * Creation only — a package change on an existing declaration is a move,
     * which is ./package-writer.ts's job because it has to cut the declaration
     * out of where it currently is. Absent means the file's last package, which
     * is what a request that does not care about placement gets.
     */
    package?: string;
    /**
     * The qualified name of the kind's definition (`pkg::Kind`), creation only. A new usage typed by a kind the
     * file cannot see does not compile, so the write imports the kind beside the usage unless the file already
     * imports its package or uses the kind. The server resolves it from the compiled model; absent, nothing is
     * imported.
     */
    kindDefinition?: string;
    /**
     * IR identity of the declaration being edited.
     *
     * Required to *update* an existing declaration. Absent means "create":
     * there is no identity to quote for source that does not exist yet.
     */
    irIdentity?: string;
    /**
     * The element ID the quoted identity is expected to name, when this write
     * changes the declaration's own identifier.
     *
     * Without it a rename is indistinguishable from a stale address — both are
     * "the identity names something other than `id`" — and the safe reading of
     * that ambiguity is to refuse. Saying so explicitly is what makes a rename
     * a deliberate act rather than an accident the checker has to tolerate.
     *
     * It is the element's PREVIOUS id, not its previous declared name — it is
     * checked against the identity index, which is keyed by id.
     */
    renamedFrom?: string;
}

/** Advisory notes about a write that succeeded. */
export interface ElementWriteWarning {
    code: 'rename-is-text-only';
    message: string;
}

export interface ElementWriteResult {
    success: boolean;
    filePath: string;
    /** True when the declaration was replaced rather than appended. */
    replaced?: boolean;
    warnings?: ElementWriteWarning[];
    /** Project-relative files other than `filePath` that a rename rewrote to follow the new name. */
    alsoWritten?: string[];
    error?: string;
    /** Set when the failure was a stale identity, so callers can say so. */
    stale?: boolean;
}

/**
 * Why a rename can be only a text edit, said once here so every surface says the
 * same thing.
 *
 * The write path splices source and has no name resolution of its own, so
 * rewriting the references to a renamed declaration is the compiler's: under
 * OpenSysML the service's `rename` follows them into every document. Silently
 * rewriting the declaration and leaving every reference pointing at the old
 * name would be a broken model presented as a successful edit, so where the
 * compiler cannot, the write succeeds and says what it did not do.
 */
export const RENAME_IS_TEXT_ONLY =
    'Renaming edits this declaration only. The selected compiler cannot update references to it elsewhere in the '
    + 'project, so any reference to the old name will not resolve until you update it by hand.';

/**
 * Write one element into project source.
 *
 * `index` is the identity index of the current revision. Passing it is what
 * makes an update identity-addressed; without it only creation is possible,
 * and an update that quotes an identity is refused rather than silently
 * degraded to a name match.
 */
export async function saveElementToFile(
    cwd: string,
    element: ElementWriteRequest,
    index: IrIdentityIndex | undefined,
    /** Outlines of the project's files, from the selected compiler. */
    outlines: OutlineSource,
): Promise<ElementWriteResult> {
    const relativePath = element.file || DEFAULT_ELEMENT_FILE;
    const filePath = resolve(cwd, relativePath);

    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (!existsSync(filePath)) {
        const pkgName = relativePath.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '').replace(/\.sysml$/, '');
        writeFileSync(filePath, `package ${pkgName || 'generated'} {\n}\n`, 'utf8');
    }

    const content = readFileSync(filePath, 'utf8');
    // The generator writes the flat attribute map back out verbatim, so a key
    // the BUILDER derived rather than read would be materialised into source on
    // the next save: `usageType` is the declaration's own `: Kind` and
    // `elementPackage` is the package it sits in. Writing them states in the
    // body what the declaration already says, and the copy then outlives
    // whatever it was derived from.
    // What the declaration is CALLED, as distinct from what addresses it.
    const declaredName = element.shortName ?? shortNameOf(element.id);
    // `declaring` is the name the generated text declares: the new one, except
    // while a compiler's rename still has to find the old one to rewrite.
    const buildUsage = (omit: readonly string[] = DERIVED_ATTRIBUTES, declaring = declaredName) => generateUsage({
        id: declaring,
        name: element.name,
        kind: element.kind,
        // Normalized at the boundary: a caller holding a kind definition has
        // `part def`, and this text is a USAGE. See `usageKeyword`.
        construct: usageKeyword(element.construct),
        layer: element.layer || '',
        doc: element.doc || '',
        attributes: withoutKeys(element.attributes || {}, omit),
    } as any);

    let updated: string;
    let replaced = false;
    const warnings: ElementWriteWarning[] = [];
    // The other files a compiler's rename rewrote, by project-relative path.
    let renamedElsewhere: Map<string, string> | undefined;

    // A caller holding the current index does not have to quote an identity for
    // an element the index already knows: server-side callers (kind remapping,
    // an approved LLM change) work from the model rather than from a UI
    // selection, and re-deriving the identity there is the same lookup the
    // client would have done. A *quoted* identity is never overridden this way
    // — that is the one that has to be checked for staleness.
    const identity = element.irIdentity ?? (index ? index.byMemoElement[element.id] : undefined);

    if (identity) {
        if (!index) {
            return {
                success: false, filePath: relativePath, stale: true,
                error: 'The write quotes an IR identity but no compiled revision is available to resolve it '
                    + 'against; no file was written.',
            };
        }
        let located: Awaited<ReturnType<typeof locateDeclaration>>;
        try {
                located = await locateDeclaration(
                    relativePath.replaceAll('\\', '/'), content, index, identity, element.renamedFrom ?? element.id, outlines);
        } catch (e) {
            if (e instanceof StaleIrIdentityError) {
                return { success: false, filePath: relativePath, stale: true, error: e.message };
            }
            return { success: false, filePath: relativePath, error: String(e) };
        }
        // An update replaces the declaration's whole source range with text
        // generated from a FLAT attribute map, so everything in the body that is
        // not a scalar attribute — nested usages, `@Foo { … }` annotations,
        // connections — has no representation in the replacement and is deleted
        // by the edit. Editing one screen's description used to remove the four
        // UI elements declared inside it. Those members are lifted out of the
        // original text and put back verbatim.
        const carried = carriedMembers(content, located.node, element.attributes || {});
        const renamed = Boolean(located.declaredName) && declaredName !== located.declaredName;
        const rename = renamed ? outlines.rename : undefined;
        // With a compiler that rewrites references, the splice keeps the old
        // name and the compiler's rename then changes the declaration and its
        // references together.
        updated = spliceIndented(
            content, located.start, located.end,
            withCarriedMembers(
                buildUsage([...DERIVED_ATTRIBUTES, ...carried.suppliedKeys], rename ? located.declaredName : declaredName),
                carried.text),
        );
        if (renamed) {
            const outcome = rename
                ? await rename.call(outlines, relativePath.replaceAll('\\', '/'), updated, located.node.key, declaredName)
                : undefined;
            if (outcome && 'files' in outcome) {
                const key = relativePath.replaceAll('\\', '/');
                updated = outcome.files.get(key) ?? updated;
                renamedElsewhere = new Map([...outcome.files].filter(([path]) => path !== key));
            } else {
                // The old name stays in the splice when a compiler's rename was
                // tried and refused: the declaration alone takes the new one.
                if (rename) {
                    updated = spliceIndented(
                        content, located.start, located.end,
                        withCarriedMembers(buildUsage([...DERIVED_ATTRIBUTES, ...carried.suppliedKeys]), carried.text));
                }
                warnings.push({
                    code: 'rename-is-text-only',
                    message: outcome && 'refused' in outcome ? `${RENAME_IS_TEXT_ONLY} (${outcome.refused})` : RENAME_IS_TEXT_ONLY,
                });
            }
        }
        replaced = true;
    } else if (element.package) {
        let outline;
        try {
            outline = await outlines.outline(relativePath.replaceAll('\\', '/'), content);
        } catch (e) {
            return { success: false, filePath: relativePath, error: `${relativePath} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
        }
        const target = locateContainers(outline).find(container => container.qualifiedName === element.package);
        if (!target) {
            return {
                success: false, filePath: relativePath,
                error: `${relativePath} does not declare package "${element.package}"; nothing was written.`,
            };
        }
        updated = insertIntoBody(content, target, `${kindImportFor(content, element.kindDefinition)}${buildUsage()}\n`);
    } else {
        updated = appendToLastPackage(content, `${kindImportFor(content, element.kindDefinition)}${buildUsage()}`);
    }

    const committed = await commitSource(filePath, relativePath, updated, outlines, renamedElsewhere
        ? new Map([...renamedElsewhere].map(([path, text]) => [resolve(cwd, path), text] as const)) : undefined, cwd);
    if (!committed.success) return { success: false, filePath: relativePath, error: committed.error };
    return {
        success: true, filePath: relativePath, replaced,
        ...(warnings.length ? { warnings } : {}),
        ...(renamedElsewhere?.size ? { alsoWritten: [...renamedElsewhere.keys()] } : {}),
    };
}

/**
 * Compile-before-commit, then write atomically.
 *
 * Source the selected compiler does not accept never reaches disk. The editor
 * model (§1.1) says a *user* may save anything; it does not say a
 * machine-generated splice may corrupt a file the user did not touch.
 */
export async function commitSource(
    absolutePath: string, relativePath: string, updated: string,
    /** The selected compiler's outlines, which verify the text. */
    outlines: OutlineSource,
    /** Other files the same edit rewrites (absolute path to text): valid only together, written all or none. */
    others?: ReadonlyMap<string, string>,
    /** The project root `others` are named relative to in the verdict. */
    root?: string,
): Promise<{ success: boolean; error?: string }> {
    const also = others && root
        ? new Map([...others].map(([path, text]) => [relative(root, path).replaceAll('\\', '/'), text] as const))
        : undefined;
    try {
        await outlines.verify(relativePath.replaceAll('\\', '/'), updated, also);
    } catch (e) {
        return {
            success: false,
            error: `The updated source was not accepted (${e instanceof Error ? e.message : String(e)}); ${relativePath} was left unchanged.`,
        };
    }
    // What each file held, or undefined when the write creates it.
    const before = new Map<string, string | undefined>();
    const files = new Map<string, string>([[absolutePath, updated], ...(others ?? [])]);
    try {
        for (const [path, text] of files) {
            before.set(path, existsSync(path) ? readFileSync(path, 'utf8') : undefined);
            atomicWrite(path, text);
        }
    } catch (e) {
        for (const [path, text] of before) {
            if (text === undefined) { if (existsSync(path)) unlinkSync(path); } else atomicWrite(path, text);
        }
        return { success: false, error: `Could not write ${relativePath}: ${String(e)}` };
    }
    return { success: true };
}

// ─── Carried members ─────────────────────────────────────────────────────────
//
// `generateUsage` writes a declaration out of a FLAT attribute map, and an
// update splices its output over the declaration's whole source range. That is
// sound for the CSV import it was written for, where the map IS the element. It
// is not sound for an edit: a SysML body also holds nested usages, `@Foo { … }`
// annotations and connections, none of which the map represents — so
// regenerating from the map alone deletes them.
//
// The members the generator can express (scalar and structured attributes, the
// doc comment) are regenerated. Every other member is carried across verbatim,
// and any flat key such a member supplied is dropped from the regenerated
// attributes so the same fact is not stated twice in two notations.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attributes the BUILDER derives from the declaration rather than reading from
 * its body. Writing them back materialises a copy that outlives the thing it
 * was derived from — a `usageType` left behind after the kind changed, an
 * `elementPackage` after the element moved.
 */
const DERIVED_ATTRIBUTES = ['usageType', 'elementPackage'] as const;

/** Drop `keys`, and anything nested under them (`bounds.x` under `bounds`). */
function withoutKeys(attributes: Record<string, string>, keys: readonly string[]): Record<string, string> {
    if (!keys.length) return attributes;
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
        if (keys.some(omit => key === omit || key.startsWith(`${omit}.`))) continue;
        kept[key] = value;
    }
    return kept;
}

/** Members the generator regenerates from the element; everything else carries. */
const REGENERATED_ROLES = new Set(['attribute', 'doc']);

/** Flat attribute keys a carried member already states in its own notation. */
function keysSuppliedBy(member: OutlineNode): string[] {
    if (member.role === 'metadata') return member.fields;
    if (member.role === 'expose') return ['expose'];
    return member.name ? [member.name] : [];
}

/**
 * Re-point an annotation's field at an edited value.
 *
 * A `@MemoIdentity { :>> providedId = "…"; }` field lifts into the flat
 * attribute map, and `extractAttributes` applies annotations LAST — so an
 * attribute written beside the annotation would be read back overridden by it.
 * An edit to such a field therefore has to land inside the annotation.
 */
function retargetAnnotationField(text: string, field: string, value: string): string {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`((?::>>|redefines)\\s+${escaped}\\s*=\\s*)"([^"]*)"`, 'g');
    const occurrences = [...text.matchAll(pattern)];
    if (!occurrences.length) return text;
    // `extractAttributes` keeps the LAST assignment, so that is the one the
    // edited value is an edit OF. Leaving earlier ones alone matters: a body may
    // state a field twice — imported screens carry two `providedId`s — and
    // rewriting every occurrence would overwrite history with whichever value
    // the reader happened to settle on.
    const target = occurrences[occurrences.length - 1];
    if (target[2] === String(value)) return text;
    const quoted = `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return text.slice(0, target.index) + target[1] + quoted + text.slice(target.index! + target[0].length);
}

/**
 * Normalise a lifted member to the one indentation level a usage body uses.
 *
 * `column` is where the member began in the original file, so subtracting it
 * makes the member's text self-relative and `spliceIndented` can re-indent it to
 * wherever the declaration now sits. Lines starting left of that column are
 * taken as already flush and only trimmed — generated declarations in this
 * codebase put some attributes at column 0, and treating that as negative
 * indentation is what made nested bodies drift right on every save.
 */
function reindent(text: string, column: number): string {
    return text
        .split('\n')
        .map((line, i) => {
            if (i === 0) return `    ${line.trim()}`;
            if (!line.trim()) return '';
            const lead = line.length - line.trimStart().length;
            return `    ${line.slice(Math.min(lead, column))}`;
        })
        .join('\n');
}

/**
 * Lift the members of `node` that the generator cannot express out of `source`.
 *
 * Returns them as one already-indented block plus the flat keys they supply, so
 * the caller can regenerate the attributes without them.
 */
function carriedMembers(
    source: string, node: OutlineNode, attributes: Record<string, string> = {},
): { text: string; suppliedKeys: string[] } {
    const carried: string[] = [];
    const suppliedKeys: string[] = [];
    for (const member of bodyMembers(node)) {
        if (REGENERATED_ROLES.has(member.role)) continue;
        let text = source.slice(member.start, member.end);
        const keys = keysSuppliedBy(member);
        if (member.role === 'metadata') {
            for (const field of keys) {
                const edited = attributes[field];
                if (edited !== undefined) text = retargetAnnotationField(text, field, edited);
            }
        }
        suppliedKeys.push(...keys);
        const column = member.start - (source.lastIndexOf('\n', member.start - 1) + 1);
        carried.push(reindent(text, column));
    }
    return { text: carried.join('\n'), suppliedKeys };
}

/** Put the carried members back inside the regenerated usage's body. */
function withCarriedMembers(usage: string, carried: string): string {
    if (!carried) return usage;
    const close = usage.lastIndexOf('}');
    if (close === -1) return usage;
    const before = usage.slice(0, close);
    return `${before.endsWith('\n') ? before : `${before}\n`}${carried}\n${usage.slice(close)}`;
}

/**
 * Source range of the declaration an identity names, in this file's text: the
 * identity must be in the revision the caller holds, and must name the same
 * declaration in the file as it is now.
 */
async function locateDeclaration(
    file: string,
    source: string,
    index: IrIdentityIndex,
    identityId: string,
    memoElementId: string,
    outlines: OutlineSource,
): Promise<{ start: number; end: number; declaredName?: string; node: OutlineNode }> {
    requireIrIdentity(index, identityId, memoElementId);
    let outline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        throw new StaleIrIdentityError(identityId, `its file no longer compiles (${e instanceof Error ? e.message : String(e)})`);
    }
    const node = resolveOutlineIdentity(outline, identityId);
    return { start: node.start, end: node.end, declaredName: node.name, node };
}

/** Replace a range, re-indenting the replacement to the line it starts on. */
function spliceIndented(source: string, start: number, end: number, replacement: string): string {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lead = source.slice(lineStart, start);
    const indent = /^[ \t]*$/.test(lead) ? lead : '';
    const body = replacement.split('\n').map((line, i) => (i === 0 || !line ? line : indent + line)).join('\n');
    return source.slice(0, start) + body + source.slice(end);
}

/** Append a new declaration as the last member of the file's final package. */
/**
 * `private import <pkg>::<Kind>;` to write ahead of a new usage of `Kind`, or nothing when the file can already see
 * the kind: it imports the kind's package or the kind itself, or another usage in it is typed by the kind. An import
 * is an ordinary package member in SysML, so it may sit beside the usage it serves.
 */
export function kindImportFor(source: string, kindDefinition: string | undefined): string {
    const split = kindDefinition?.lastIndexOf('::') ?? -1;
    if (!kindDefinition || split <= 0) return '';
    const pkg = kindDefinition.slice(0, split);
    const kind = kindDefinition.slice(split + 2);
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const imported = new RegExp(`\\bimport\\s+${escape(pkg)}::(\\*|${escape(kind)})\\s*;`).test(source);
    const typedBy = new RegExp(`(?<![:>]):\\s*${escape(kind)}\\b`).test(source);
    return imported || typedBy ? '' : `private import ${kindDefinition};\n`;
}

export function appendToLastPackage(source: string, usage: string): string {
    const lastBrace = source.lastIndexOf('}');
    if (lastBrace === -1) return `${source}\n${usage}\n`;
    const braceLineStart = source.lastIndexOf('\n', lastBrace - 1) + 1;
    const braceIndent = source.slice(braceLineStart, lastBrace);
    const indent = /^[ \t]*$/.test(braceIndent) ? `${braceIndent}    ` : '    ';
    const indented = usage.split('\n').map(line => (line ? indent + line : line)).join('\n');
    const before = source.slice(0, lastBrace);
    const separator = before.endsWith('\n') ? '' : '\n';
    return `${before}${separator}${indented}\n${source.slice(lastBrace)}`;
}

/** Write via a sibling temp file so a crash cannot leave a half-written model. */
export function atomicWrite(absolutePath: string, contents: string): void {
    assertWritable(absolutePath);
    const tempPath = `${absolutePath}.${process.pid}.tmp`;
    try {
        writeFileSync(tempPath, contents, 'utf8');
        renameSync(tempPath, absolutePath);
    } catch (e) {
        if (existsSync(tempPath)) {
            try { unlinkSync(tempPath); } catch { /* best effort cleanup */ }
        }
        throw e;
    }
}

// Relationship persistence lives in ./relationship-writer.ts, and the notation
// it emits in ./sysml-notation.ts.
