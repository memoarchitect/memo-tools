// ─── SysML v2 Text Generator ─────────────────────────────────────────────────
//
// Generates valid SysML v2 text from imported elements and relationships.
// Used by CSV import to produce .sysml files that the parser can roundtrip.
// ─────────────────────────────────────────────────────────────────────────────

import type { CsvElement, CsvRelationship, ElementSource } from './csv-io.js';

// Generate a SysML usage block for a single element.
// Example: requirement hazard_001 : Hazard { doc /​* text *​/ @MemoIdentity { :>> label = "..."; } }
export function generateUsage(element: CsvElement, options: GenerateOptions = {}): string {
    const lines: string[] = [];
    const indent = '    ';

    // Usage header: <construct> <id> : <kind> {
    lines.push(`${element.construct} ${element.id} : ${element.kind} {`);

    // Doc comment
    if (element.doc) {
        lines.push(`${indent}doc /* ${element.doc} */`);
    }

    // Display label, emitted only when it says something the id does not.
    // It goes on `@MemoIdentity`: the MEMO bases no longer declare a `name`
    // attribute, so `attribute redefines name` — what this emitted until the
    // label migration — no longer resolves, and the generated file would not
    // compile.
    if (element.name && element.name !== element.id) {
        lines.push(`${indent}@MemoIdentity { :>> label = "${escapeString(element.name)}"; }`);
    }
    // The authored id is identity too: `providedId` is a field of `@MemoIdentity`, not an attribute the kind
    // declares, so `attribute redefines providedId` would not resolve and the whole write would be refused.
    const providedId = element.attributes.providedId;
    if (providedId) {
        lines.push(`${indent}@MemoIdentity { :>> providedId = "${escapeString(providedId)}"; }`);
    }

    // Dynamic attributes. Structured attribute values are flattened in the
    // semantic model (`bounds.x`, `bounds.width`) and reconstructed here so an
    // edit round-trips to the SysML form the parser accepts.
    const scalarAttributes: Array<[string, string]> = [];
    const structuredAttributes = new Map<string, Array<[string, string]>>();
    for (const [key, value] of Object.entries(element.attributes)) {
        if (key === 'name' || key === 'label' || key === 'providedId') continue; // emitted above
        // `attribute redefines x` resolves only against an attribute the kind declares; any other
        // column would be a feature nothing declares and the file would not compile.
        if (options.declaresAttribute && !options.declaresAttribute(element.kind, key.split('.')[0])) {
            options.onDropped?.(element, key);
            continue;
        }
        const dot = key.indexOf('.');
        if (dot < 1 || dot === key.length - 1) {
            scalarAttributes.push([key, value]);
            continue;
        }
        const root = key.slice(0, dot);
        const child = key.slice(dot + 1);
        const members = structuredAttributes.get(root) ?? [];
        members.push([child, value]);
        structuredAttributes.set(root, members);
    }
    for (const [key, value] of scalarAttributes) {
        lines.push(`${indent}attribute redefines ${key} = ${renderAttributeValue(value)};`);
    }
    for (const [root, members] of structuredAttributes) {
        lines.push(`${indent}attribute redefines ${root} {`);
        for (const [key, value] of members) {
            lines.push(`${indent}${indent}attribute redefines ${key} = ${renderAttributeValue(value)};`);
        }
        lines.push(`${indent}}`);
    }

    // The record in another system this element was made from.
    if (element.source) lines.push(...sourceLines(element.source, indent));

    lines.push('}');
    return lines.join('\n');
}

/**
 * `@ExternalSource { … }` for an imported element: the metadata body form, because a
 * prefix `#ExternalSource` cannot carry a value (SysML-textual-bnf.kebnf:1667) and the
 * nested `externalReference { … }` is a MetadataBodyUsage (kebnf:1694).
 */
function sourceLines(source: ElementSource, indent: string): string[] {
    return [
        `${indent}@ExternalSource {`,
        `${indent}${indent}:>> externalReference {`,
        `${indent}${indent}${indent}:>> sourceSystem = "${escapeString(source.system)}";`,
        `${indent}${indent}${indent}:>> identifier = "${escapeString(source.identifier)}";`,
        `${indent}${indent}${indent}:>> revision = "${escapeString(source.revision)}";`,
        `${indent}${indent}}`,
        `${indent}${indent}:>> sourceMastered = ${source.mastered};`,
        ...(source.withdrawn ? [`${indent}${indent}:>> sourceWithdrawn = true;`] : []),
        `${indent}}`,
    ];
}

/** What a generator needs to know of the ontology to write only what compiles. */
export interface GenerateOptions {
    /** Whether the kind declares (or inherits) the attribute. Absent: every column is written. */
    declaresAttribute?: (kind: string, attribute: string) => boolean;
    /** Called for each column left out because the kind does not declare it. */
    onDropped?: (element: CsvElement, attribute: string) => void;
    /** `private import` targets written at the head of the package, such as `memo::*`. */
    imports?: readonly string[];
    /** Package-body lines written after the imports, already indented, such as a metadata usage. */
    header?: readonly string[];
    /** Relationship declarations, already rendered, written after the elements. */
    links?: readonly string[];
}

/** Preserve native scalar/enum/list syntax; quote ordinary text. */
function renderAttributeValue(value: string): string {
    const trimmed = String(value).trim();
    if (/^(?:true|false|-?\d+(?:\.\d+)?|[A-Za-z_]\w*::[A-Za-z_]\w*)$/.test(trimmed)) return trimmed;
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed;
    return `"${escapeString(String(value))}"`;
}

/**
 * Generate a SysML connection usage for a relationship.
 *
 * Example output:
 * ```sysml
 * connection : Mitigates connect control ::> risk_control_001 to hazard ::> hazard_001;
 * ```
 */
export function generateConnection(rel: CsvRelationship): string {
    const typeName = capitalizeFirst(rel.type);
    return `connection : ${typeName} connect ${rel.sourceEnd} ::> ${rel.sourceId} to ${rel.targetEnd} ::> ${rel.targetId};`;
}

/**
 * Generate a complete .sysml file from elements and relationships.
 *
 * @param elements - Parsed elements from CSV
 * @param relationships - Parsed relationships from CSV
 * @param packageName - SysML package name (e.g. "imported_elements")
 */
/**
 * Wrap already-indented inner package-body lines in `package` declarations.
 *
 * Standard SysML v2 requires single-identifier names in a package DECLARATION, so a
 * qualified name (`a::b::c`) is emitted as NESTED packages, never `package a::b::c {`.
 * The inner lines are assumed to already carry one indentation level (as the existing
 * generators produce them); deeper nesting adds the extra levels. For a single-segment
 * name this is byte-identical to the previous `package name { … }` output.
 */
export function wrapPackage(qualifiedName: string, innerLines: string[], opts?: { isLibrary?: boolean }): string[] {
    const segs = qualifiedName.split('::').filter(Boolean);
    if (segs.length === 0) return innerLines;
    const out: string[] = [];
    segs.forEach((seg, i) => {
        const pad = '    '.repeat(i);
        const lib = opts?.isLibrary && i === segs.length - 1 ? 'library ' : '';
        out.push(`${pad}${lib}package ${seg} {`);
    });
    const extra = '    '.repeat(segs.length - 1); // innerLines already carry one level
    for (const l of innerLines) out.push(l.length ? `${extra}${l}` : l);
    for (let i = segs.length - 1; i >= 0; i--) out.push(`${'    '.repeat(i)}}`);
    return out;
}

export function generateFile(
    elements: CsvElement[],
    relationships: CsvRelationship[],
    packageName: string,
    options: GenerateOptions = {},
): string {
    const body: string[] = [];
    for (const target of options.imports ?? []) body.push(`    private import ${target};`);
    body.push(...(options.header ?? []));
    body.push('');

    // Group elements by kind for readability
    const byKind = new Map<string, CsvElement[]>();
    for (const el of elements) {
        if (!byKind.has(el.kind)) byKind.set(el.kind, []);
        byKind.get(el.kind)!.push(el);
    }

    for (const [kind, kindElements] of byKind) {
        body.push(`    // ── ${kind} ──`);
        for (const el of kindElements) {
            const usageLines = generateUsage(el, options).split('\n');
            for (const ul of usageLines) {
                body.push(`    ${ul}`);
            }
            body.push('');
        }
    }

    // Relationships
    if (relationships.length > 0 || (options.links?.length ?? 0) > 0) {
        body.push('    // ── Relationships ──');
        for (const rel of relationships) {
            body.push(`    ${generateConnection(rel)}`);
        }
        for (const link of options.links ?? []) body.push(`    ${link}`);
        body.push('');
    }

    return wrapPackage(packageName, body).join('\n') + '\n';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function capitalizeFirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
