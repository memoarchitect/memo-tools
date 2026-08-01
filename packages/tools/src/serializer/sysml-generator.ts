// ─── SysML v2 Text Generator ─────────────────────────────────────────────────
//
// Generates valid SysML v2 text from imported elements and relationships.
// Used by CSV import to produce .sysml files that the parser can roundtrip.
// ─────────────────────────────────────────────────────────────────────────────

import type { CsvElement, CsvRelationship } from './csv-io.js';

// Generate a SysML usage block for a single element.
// Example: requirement hazard_001 : Hazard { doc /​* text *​/ attribute redefines name = "..."; }
export function generateUsage(element: CsvElement): string {
    const lines: string[] = [];
    const indent = '    ';

    // Usage header: <construct> <id> : <kind> {
    lines.push(`${element.construct} ${element.id} : ${element.kind} {`);

    // Doc comment
    if (element.doc) {
        lines.push(`${indent}doc /* ${element.doc} */`);
    }

    // Name attribute (always emit if different from id)
    if (element.name && element.name !== element.id) {
        lines.push(`${indent}attribute redefines name = "${escapeString(element.name)}";`);
    }

    // Dynamic attributes. Structured attribute values are flattened in the
    // semantic model (`bounds.x`, `bounds.width`) and reconstructed here so an
    // edit round-trips to the SysML form the parser accepts.
    const scalarAttributes: Array<[string, string]> = [];
    const structuredAttributes = new Map<string, Array<[string, string]>>();
    for (const [key, value] of Object.entries(element.attributes)) {
        if (key === 'name') continue; // already handled above
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

    // Provenance attributes (written as _import_* so they don't conflict with model attrs)
    if (element.provenance) {
        const p = element.provenance;
        lines.push(`${indent}attribute redefines _import_source = "${escapeString(p.sourceFile)}";`);
        lines.push(`${indent}attribute redefines _import_row = "${p.sourceRow}";`);
        lines.push(`${indent}attribute redefines _import_timestamp = "${escapeString(p.importTimestamp)}";`);
        lines.push(`${indent}attribute redefines _import_session = "${escapeString(p.importSessionId)}";`);
    }

    lines.push('}');
    return lines.join('\n');
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
    packageName: string
): string {
    const body: string[] = [];
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
            const usageLines = generateUsage(el).split('\n');
            for (const ul of usageLines) {
                body.push(`    ${ul}`);
            }
            body.push('');
        }
    }

    // Relationships
    if (relationships.length > 0) {
        body.push('    // ── Relationships ──');
        for (const rel of relationships) {
            body.push(`    ${generateConnection(rel)}`);
        }
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
