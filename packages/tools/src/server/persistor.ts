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

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateUsage } from '../serializer/sysml-generator.js';
import { parseText } from '../model/parser-utils.js';
import {
    requireIrIdentity,
    resolveDeclarationByIdentity,
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';

/** Default home for an element the request does not place. */
export const DEFAULT_ELEMENT_FILE = 'model/catalog/project.sysml';

export interface ElementWriteRequest {
    id: string;
    name?: string;
    kind?: string;
    construct?: string;
    layer?: string;
    doc?: string;
    attributes?: Record<string, string>;
    /** Project-relative source file. */
    file?: string;
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
    error?: string;
    /** Set when the failure was a stale identity, so callers can say so. */
    stale?: boolean;
}

/**
 * Why a rename is only a text edit, said once here so every surface says the
 * same thing.
 *
 * Updating references would need name resolution across the workspace — the
 * linker, which is Track B B5 and does not exist yet. Silently rewriting the
 * declaration and leaving every reference pointing at the old name would be a
 * broken model presented as a successful edit, so the write succeeds and says
 * what it did not do.
 */
export const RENAME_IS_TEXT_ONLY =
    'Renaming edits this declaration only. MEMO cannot yet update references to it elsewhere in the '
    + 'project — that needs cross-file name resolution — so any reference to the old name will not resolve '
    + 'until you update it by hand.';

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
    index?: IrIdentityIndex,
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
    const usage = generateUsage({
        id: element.id,
        name: element.name,
        kind: element.kind,
        construct: element.construct || 'part',
        layer: element.layer || '',
        doc: element.doc || '',
        attributes: element.attributes || {},
    } as any);

    let updated: string;
    let replaced = false;
    const warnings: ElementWriteWarning[] = [];

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
                located = await locateDeclaration(content, index, identity, element.renamedFrom ?? element.id);
        } catch (e) {
            if (e instanceof StaleIrIdentityError) {
                return { success: false, filePath: relativePath, stale: true, error: e.message };
            }
            return { success: false, filePath: relativePath, error: String(e) };
        }
        if (located.declaredName && element.id !== located.declaredName) {
            warnings.push({ code: 'rename-is-text-only', message: RENAME_IS_TEXT_ONLY });
        }
        updated = spliceIndented(content, located.start, located.end, usage);
        replaced = true;
    } else {
        updated = appendToLastPackage(content, usage);
    }

    // Parse-before-commit: source that does not parse never reaches disk. The
    // editor model (§1.1) says a *user* may save anything; it does not say a
    // machine-generated splice may corrupt a file the user did not touch.
    const { errors } = await parseText(updated);
    if (errors.length > 0) {
        return {
            success: false, filePath: relativePath,
            error: `The updated source did not parse (${errors[0].message}); the file was left unchanged.`,
        };
    }

    try {
        atomicWrite(filePath, updated);
    } catch (e) {
        return { success: false, filePath: relativePath, error: `Could not write ${relativePath}: ${String(e)}` };
    }
    return { success: true, filePath: relativePath, replaced, ...(warnings.length ? { warnings } : {}) };
}

/** Source range of the declaration an identity names, in this file's text. */
async function locateDeclaration(
    source: string,
    index: IrIdentityIndex,
    identityId: string,
    memoElementId: string,
): Promise<{ start: number; end: number; declaredName?: string }> {
    const record = requireIrIdentity(index, identityId, memoElementId);

    const { document, errors } = await parseText(source);
    if (errors.length > 0) {
        throw new StaleIrIdentityError(identityId, `its file no longer parses (${errors[0].message})`);
    }
    const node = resolveDeclarationByIdentity(document.parseResult.value as any, record.identity);
    const cst = node.$cstNode;
    if (!cst) throw new StaleIrIdentityError(identityId, 'the resolved declaration has no source range');
    return { start: cst.offset, end: cst.offset + cst.length, declaredName: node.name };
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
function appendToLastPackage(source: string, usage: string): string {
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
function atomicWrite(absolutePath: string, contents: string): void {
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
