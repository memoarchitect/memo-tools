// ─── CSV Import/Export for MEMO Elements & Relationships ─────────────────────
//
// Standard CSV formats for bulk import/export of model data.
// The element CSV schema is ontology-aware: kind determines the construct
// and layer automatically, and dynamic columns map to SysML attributes.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoRelationship, MemoModel } from '../model/semantic.js';
import type { KindDefinition, OntologyView } from '../model/kind-registry.js';
import { createHash } from 'node:crypto';
import { SYSML_RESERVED_KEYWORDS } from '../stage2/sysml-names.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * The record in another system an element was made from (`@ExternalSource`).
 *
 * `identifier` is the id the source system knows the record by; the element's
 * own name is MEMO's. `revision` is the source's revision of the record, or a
 * content hash where the source has none. A re-import matches records by
 * (`system`, `identifier`), so renaming the element never loses the match.
 */
export interface ElementSource {
    system: string;
    identifier: string;
    revision: string;
    /** True when the source system owns the element: a re-import overwrites it. */
    mastered: boolean;
    /** True when a re-import found the record gone from the source. */
    withdrawn?: boolean;
}

/** Parsed element from CSV (before SysML generation) */
export interface CsvElement {
    id: string;
    name: string;
    kind: string;
    construct: string;
    layer?: string;
    doc: string;
    attributes: Record<string, string>;
    /** Present on an element imported from another system; written as `@ExternalSource`. */
    source?: ElementSource;
}

/** Parsed relationship from CSV */
export interface CsvRelationship {
    sourceId: string;
    targetId: string;
    type: string;
    sourceEnd: string;
    targetEnd: string;
}

/** Result of parsing a CSV file */
export interface CsvParseResult<T> {
    items: T[];
    errors: string[];
    warnings: string[];
}

// ─── Fixed column names ─────────────────────────────────────────────────────

const ELEMENT_FIXED_COLS = ['id', 'name', 'kind', 'construct', 'doc'] as const;
/** Columns an import from another system reads besides the fixed ones. */
const SOURCE_COLS = ['sourceId', 'revision'] as const;
const RELATIONSHIP_FIXED_COLS = ['sourceId', 'targetId', 'type', 'sourceEnd', 'targetEnd'] as const;

// ─── CSV Parsing Helpers ────────────────────────────────────────────────────

/** Parse a CSV line respecting quoted fields (handles commas and newlines inside quotes) */
function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++; // skip escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                fields.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }
    fields.push(current.trim());
    return fields;
}

/** Escape a CSV field value (quote if it contains comma, quote, or newline) */
function escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/** Parse full CSV text into header + rows */
function parseCsvText(csvText: string): { headers: string[]; rows: string[][] } {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(parseCsvLine);
    return { headers, rows };
}

// ─── Element CSV ────────────────────────────────────────────────────────────

/**
 * Parse an elements CSV file.
 *
 * **Standard CSV format for elements:**
 * ```
 * id,name,kind,construct,doc,[attr1],[attr2],...
 * ```
 *
 * - `id` — unique element identifier (required, valid SysML identifier)
 * - `name` — display name (required)
 * - `kind` — ontology type from ontology.kinds (required, e.g. "Hazard", "Requirement")
 * - `construct` — SysML construct override (optional, auto-derived from kind if omitted)
 * - `doc` — documentation comment (optional)
 * - Additional columns become `attribute redefines <colName> = "<value>"` in SysML
 *
 * The `kind` value is validated against the resolved config. If `construct` is omitted,
 * it is derived from the kind's `sysmlConstruct` definition. The `layer` is always
 * derived from the kind definition and cannot be set manually.
 */
export function parseElementsCsv(
    csvText: string,
    ontology: OntologyView,
    options: ParseElementsOptions = {},
): CsvParseResult<CsvElement> {
    const { headers, rows } = parseCsvText(csvText);
    const items: CsvElement[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (headers.length === 0) {
        errors.push('CSV is empty — no header row found');
        return { items, errors, warnings };
    }

    // Validate required columns. An import from another system names the record by
    // `sourceId` (or `id`, the usual export spelling) and gets a MEMO name of its own.
    const fromSource = options.sourceSystem !== undefined;
    const idColumn = fromSource && headers.includes('sourceId') ? 'sourceId' : 'id';
    const required = [idColumn, 'name', ...(options.defaultKind ? [] : ['kind'])];
    const missing = required.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
        errors.push(`Missing required columns: ${missing.join(', ')}`);
        return { items, errors, warnings };
    }

    // Identify dynamic attribute columns (anything not in fixed set)
    const fixedSet = new Set<string>([...ELEMENT_FIXED_COLS, ...(fromSource ? SOURCE_COLS : [])]);
    const attrCols = headers.filter((h) => !fixedSet.has(h));

    const seenIds = new Set<string>();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const lineNum = rowIdx + 2; // 1-indexed, +1 for header

        // Build a field map
        const fields: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
            fields[headers[i]] = row[i] ?? '';
        }

        const rawId = fields[idColumn];
        const id = fromSource && rawId ? deriveElementName(rawId) : rawId;
        const name = fields['name'];
        const kind = fields['kind'] || options.defaultKind || '';
        const constructOverride = fields['construct'] || '';
        const doc = fields['doc'] || '';

        // Validate id
        if (!rawId) {
            errors.push(`Row ${lineNum}: missing required field '${idColumn}'`);
            continue;
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
            errors.push(`Row ${lineNum}: invalid id '${id}' — must be a valid SysML identifier (letters, digits, underscore, starting with letter or underscore)`);
            continue;
        }
        // Two source ids can derive one name (`REQ-1`, `REQ_1`); the name is stable per identifier
        // elsewhere, so here only a repeated source id is an error.
        if (seenIds.has(fromSource ? rawId : id)) {
            errors.push(`Row ${lineNum}: duplicate id '${rawId}'`);
            continue;
        }
        seenIds.add(fromSource ? rawId : id);

        // Validate name
        if (!name) {
            errors.push(`Row ${lineNum}: missing required field 'name'`);
            continue;
        }

        // Validate kind against config
        if (!kind) {
            errors.push(`Row ${lineNum}: missing required field 'kind'`);
            continue;
        }
        const kinds = ontology.kinds;
        const kindDef: KindDefinition | undefined = kinds[kind];
        if (!kindDef) {
            const validKinds = Object.keys(kinds).sort();
            errors.push(`Row ${lineNum}: unknown kind '${kind}'. Valid kinds: ${validKinds.join(', ')}`);
            continue;
        }

        // Derive construct from kind (or use override)
        let construct = constructOverride;
        if (!construct) {
            // Map sysmlConstruct (e.g. "part def") to usage construct (e.g. "part")
            construct = sysmlConstructToUsage(kindDef.sysmlConstruct);
        }

        // Derive layer from kind
        const layer = kindDef.layer || '';
        if (!layer) {
            warnings.push(`Row ${lineNum}: kind '${kind}' has no layer defined in config`);
        }

        // Collect dynamic attributes
        const attributes: Record<string, string> = {};
        for (const col of attrCols) {
            const val = fields[col];
            if (val) {
                attributes[col] = val;
            }
        }

        // Merge default attributes from kind definition (CSV values take precedence)
        if (kindDef.defaultAttributes) {
            for (const [key, val] of Object.entries(kindDef.defaultAttributes)) {
                if (!(key in attributes)) {
                    attributes[key] = val;
                }
            }
        }

        const element: CsvElement = { id, name, kind, construct, layer, doc, attributes };
        if (fromSource) {
            element.source = {
                system: options.sourceSystem!,
                identifier: rawId,
                revision: fields['revision'] || contentRevision(element),
                mastered: options.mastered ?? true,
            };
        }
        items.push(element);
    }

    return { items, errors, warnings };
}

/** How `parseElementsCsv` reads a source-system export instead of a MEMO-shaped one. */
export interface ParseElementsOptions {
    /** The system the export came from; its presence makes the id column a source id. */
    sourceSystem?: string;
    /** The kind of a row that names none. */
    defaultKind?: string;
    /** Whether the source owns the records (default true). */
    mastered?: boolean;
}

/**
 * The MEMO name for a source id: lowerCamelCase, a basic name (SysML-textual-bnf.kebnf:22),
 * not a reserved word. `REQ-CS-01` is `reqCs01`.
 */
export function deriveElementName(sourceId: string): string {
    const words = sourceId.split(/[^A-Za-z0-9]+/).filter(Boolean);
    let name = words
        .map((w, i) => {
            const lower = w.toLowerCase();
            return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('');
    if (name === '') name = 'imported';
    if (/^[0-9]/.test(name)) name = `item${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    if (SYSML_RESERVED_KEYWORDS.has(name)) name = `${name}Record`;
    return name;
}

/**
 * The revision of a record whose source states none: a hash over what the
 * import reads of it, so the same record always has the same revision and a
 * changed one has another.
 */
export function contentRevision(element: Pick<CsvElement, 'name' | 'kind' | 'doc' | 'attributes'>): string {
    const fields = JSON.stringify([
        element.name, element.kind, element.doc,
        Object.entries(element.attributes).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    return `content-${createHash('sha256').update(fields).digest('hex').slice(0, 8)}`;
}

/**
 * Export model elements to CSV.
 *
 * Produces a CSV with fixed columns (id, name, kind, construct, doc) plus
 * dynamic attribute columns gathered from all elements in the model.
 */
export function exportElementsCsv(model: MemoModel, _ontology: OntologyView): string {
    const elements = Array.from(model.elements.values());
    if (elements.length === 0) return '';

    // Collect all unique attribute keys across all elements
    const attrKeysSet = new Set<string>();
    for (const el of elements) {
        for (const key of Object.keys(el.attributes)) {
            if (key !== 'name') attrKeysSet.add(key); // 'name' is a fixed column
        }
    }
    const attrKeys = Array.from(attrKeysSet).sort();

    // Build header
    const headers = [...ELEMENT_FIXED_COLS, ...attrKeys];
    const lines = [headers.map(escapeCsvField).join(',')];

    // Build rows
    for (const el of elements) {
        const row = [
            el.id,
            el.name,
            el.kind,
            el.construct,
            el.doc || '',
            ...attrKeys.map((k) => el.attributes[k] || ''),
        ];
        lines.push(row.map(escapeCsvField).join(','));
    }

    return lines.join('\n') + '\n';
}

// ─── Relationship CSV ───────────────────────────────────────────────────────

/**
 * Parse a relationships CSV file.
 *
 * **Standard CSV format for relationships:**
 * ```
 * sourceId,targetId,type,sourceEnd,targetEnd
 * ```
 *
 * - `sourceId` — source element id (required, must exist in model or import batch)
 * - `targetId` — target element id (required, must exist in model or import batch)
 * - `type` — relationship type from config (required, e.g. "mitigates", "traceTo")
 * - `sourceEnd` — connection end name (optional, default: "source")
 * - `targetEnd` — connection end name (optional, default: "target")
 */
export function parseRelationshipsCsv(
    csvText: string,
    ontology: OntologyView,
    knownElementIds?: Set<string>
): CsvParseResult<CsvRelationship> {
    const { headers, rows } = parseCsvText(csvText);
    const items: CsvRelationship[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (headers.length === 0) {
        errors.push('CSV is empty — no header row found');
        return { items, errors, warnings };
    }

    // Validate required columns
    const missing = ['sourceId', 'targetId', 'type'].filter((c) => !headers.includes(c));
    if (missing.length > 0) {
        errors.push(`Missing required columns: ${missing.join(', ')}`);
        return { items, errors, warnings };
    }

    // Build valid relationship type set
    const validRelTypes = new Set((ontology.relationshipTypes).map((r) => r.name));

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const lineNum = rowIdx + 2;

        const fields: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
            fields[headers[i]] = row[i] ?? '';
        }

        const sourceId = fields['sourceId'];
        const targetId = fields['targetId'];
        const type = fields['type'];
        const sourceEnd = fields['sourceEnd'] || 'source';
        const targetEnd = fields['targetEnd'] || 'target';

        if (!sourceId) {
            errors.push(`Row ${lineNum}: missing required field 'sourceId'`);
            continue;
        }
        if (!targetId) {
            errors.push(`Row ${lineNum}: missing required field 'targetId'`);
            continue;
        }
        if (!type) {
            errors.push(`Row ${lineNum}: missing required field 'type'`);
            continue;
        }

        // Validate relationship type
        if (!validRelTypes.has(type)) {
            const valid = Array.from(validRelTypes).sort();
            errors.push(`Row ${lineNum}: unknown relationship type '${type}'. Valid types: ${valid.join(', ')}`);
            continue;
        }

        // Validate element ids if known
        if (knownElementIds) {
            if (!knownElementIds.has(sourceId)) {
                errors.push(`Row ${lineNum}: sourceId '${sourceId}' not found in model`);
                continue;
            }
            if (!knownElementIds.has(targetId)) {
                errors.push(`Row ${lineNum}: targetId '${targetId}' not found in model`);
                continue;
            }
        }

        if (sourceId === targetId) {
            warnings.push(`Row ${lineNum}: self-referencing relationship (sourceId === targetId === '${sourceId}')`);
        }

        items.push({ sourceId, targetId, type, sourceEnd, targetEnd });
    }

    return { items, errors, warnings };
}

/**
 * Export model relationships to CSV.
 */
export function exportRelationshipsCsv(model: MemoModel): string {
    if (model.relationships.length === 0) return '';

    const headers = [...RELATIONSHIP_FIXED_COLS];
    const lines = [headers.map(escapeCsvField).join(',')];

    for (const rel of model.relationships) {
        const row = [rel.sourceId, rel.targetId, rel.type, rel.sourceEnd, rel.targetEnd];
        lines.push(row.map(escapeCsvField).join(','));
    }

    return lines.join('\n') + '\n';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map SysML construct definition to usage keyword */
function sysmlConstructToUsage(sysmlConstruct: string): string {
    const map: Record<string, string> = {
        'part def': 'part',
        'item def': 'item',
        'requirement def': 'requirement',
        'action def': 'action',
        'port def': 'port',
        'interface def': 'interface',
        'connection def': 'connection',
        'attribute def': 'attribute',
        'enum def': 'enum',
    };
    return map[sysmlConstruct] || 'part';
}

/**
 * Generate a template CSV for elements based on the config's ontology kinds.
 * Includes all valid kinds as example rows with their default attributes.
 */
export function generateElementTemplate(ontology: OntologyView): string {
    // Gather all default attribute keys across all kinds
    const attrKeysSet = new Set<string>();
    for (const kindDef of Object.values(ontology.kinds)) {
        if (kindDef.defaultAttributes) {
            for (const key of Object.keys(kindDef.defaultAttributes)) {
                attrKeysSet.add(key);
            }
        }
    }
    const attrKeys = Array.from(attrKeysSet).sort();

    const headers = [...ELEMENT_FIXED_COLS, ...attrKeys];
    const lines = [headers.map(escapeCsvField).join(',')];

    // Add one example row per kind
    for (const [kindKey, kindDef] of Object.entries(ontology.kinds)) {
        const construct = sysmlConstructToUsage(kindDef.sysmlConstruct);
        const row = [
            `example_${kindKey.toLowerCase()}`,    // id
            `Example ${kindDef.label}`,             // name
            kindKey,                                // kind
            construct,                              // construct
            `A sample ${kindDef.label} element`,    // doc
            ...attrKeys.map((k) => kindDef.defaultAttributes?.[k] || ''),
        ];
        lines.push(row.map(escapeCsvField).join(','));
    }

    return lines.join('\n') + '\n';
}

/**
 * Generate a template CSV for relationships based on config relationship types.
 */
export function generateRelationshipTemplate(ontology: OntologyView): string {
    const headers = [...RELATIONSHIP_FIXED_COLS];
    const lines = [headers.map(escapeCsvField).join(',')];

    // Add one example row per relationship type
    for (const relType of (ontology.relationshipTypes)) {
        const row = [
            'source_element_id',   // sourceId
            'target_element_id',   // targetId
            relType.name,          // type
            'source',              // sourceEnd
            'target',              // targetEnd
        ];
        lines.push(row.map(escapeCsvField).join(','));
    }

    return lines.join('\n') + '\n';
}
