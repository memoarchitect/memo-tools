// ─── Import from another system ───────────────────────────────────────────────
//
// An export from a requirements tool, a PLM, a quality system or a test run
// becomes elements that remember the record they were made from
// (`@ExternalSource`), so the next export can be compared with them.
//
//   read   → CsvElement[] + SourceLink[]   (CSV, ReqIF, trace matrix)
//   plan   → the diff against the model: new, changed, unchanged, deleted
//   render → the one .sysml file the source owns
//
// The file is wholly import-owned and regenerated on every import; authored
// content never goes in it. A record that has left the export is NOT deleted: it
// stays, marked `sourceWithdrawn`, so the links authored against it still
// compile and can be reviewed. Whether a link is suspect is derived from the
// model afterwards (`computeSuspectLinks`), never stored here.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipRegistry } from '../model/relationship-registry.js';
import type { MemoModel } from '../model/semantic.js';
import {
    parseElementsCsv, type CsvElement, type CsvParseResult, type ElementSource, type ParseElementsOptions,
} from '../serializer/csv-io.js';
import { generateFile } from '../serializer/sysml-generator.js';
import { renderRelationship } from '../server/sysml-notation.js';
import { suspectReason } from '../analysis/suspect-links.js';
import { computeImportDiff, importedElements, type AffectedLink, type ImportDiff } from './import-diff.js';
import { parseReqIf } from './reqif.js';

export type SourceFormat = 'csv' | 'reqif' | 'trace-matrix';

export const SOURCE_FORMATS: readonly SourceFormat[] = ['csv', 'reqif', 'trace-matrix'];

/** A trace between two records of one source, by their source ids. */
export interface SourceLink {
    fromId: string;
    toId: string;
    /** A relationship name the ontology has, such as `derivesFrom`. */
    type: string;
}

/** What the ontology contributes to reading and writing an import. */
export interface SourceImportContext {
    kindRegistry: KindRegistry;
    relationshipRegistry: RelationshipRegistry;
}

export interface SourceImportRequest {
    system: string;
    format: SourceFormat;
    text: string;
    /** The kind of a record that names none. */
    defaultKind?: string;
    /** The relationship of a trace row or SPEC-RELATION that names none. */
    defaultRelation?: string;
}

export interface SourceRecords extends CsvParseResult<CsvElement> {
    links: SourceLink[];
    /**
     * True when the export does not state the whole population of records (a trace
     * matrix): what it does not mention is kept as it is, never withdrawn.
     */
    partial?: boolean;
}

/** The file a source's records are written to, relative to the project. */
export const importFile = (system: string) => `model/imports/${slug(system)}.sysml`;
export const importPackage = (system: string) => `imports_${slug(system)}`;

function slug(system: string): string {
    const text = system.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return text === '' || /^[0-9]/.test(text) ? `source_${text}` : text;
}

const hash = (text: string, length: number) => createHash('sha256').update(text).digest('hex').slice(0, length);

/** Whether a kind declares an attribute, itself or through any supertype. */
export function kindDeclaresAttribute(registry: KindRegistry, kind: string, attribute: string): boolean {
    const seen = new Set<string>();
    const visit = (name: string | undefined): boolean => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        const entry = registry.getKind(name);
        if (!entry) return false;
        if (entry.attributeNames?.includes(attribute)) return true;
        return visit(entry.superType) || (entry.additionalSuperTypes ?? []).some(visit);
    };
    return visit(kind);
}

// ─── Read ────────────────────────────────────────────────────────────────────

const constructOf = (registry: KindRegistry, kind: string): string => {
    const definition = registry.toKindDefinition(kind);
    return definition ? definition.sysmlConstruct.replace(/ def$/, '') : 'part';
};

/** Parse an export into records and the traces between them. */
export function readSource(request: SourceImportRequest, context: SourceImportContext): SourceRecords {
    const { kindRegistry, relationshipRegistry } = context;
    const ontology = {
        kinds: kindRegistry.toKindsRecord(),
        relationshipTypes: relationshipRegistry.toRelationshipTypesArray(),
    };
    if (request.format === 'reqif') {
        if (!request.defaultKind) return { items: [], links: [], errors: ['--kind is required for a ReqIF import'], warnings: [] };
        const result = parseReqIf(request.text, {
            system: request.system,
            defaultKind: request.defaultKind,
            constructOf: (kind) => constructOf(kindRegistry, kind),
            kinds: new Set(kindRegistry.kindNames()),
            declaresAttribute: (kind, attribute) => kindDeclaresAttribute(kindRegistry, kind, attribute),
            relationTypes: new Set(relationshipRegistry.relTypeNames()),
            defaultRelation: request.defaultRelation,
        });
        const unknown = result.items.filter((el) => !kindRegistry.has(el.kind));
        return {
            ...result,
            errors: [...result.errors, ...unknown.map((el) => `record '${el.source?.identifier}': unknown kind '${el.kind}'`)],
            items: result.items.filter((el) => kindRegistry.has(el.kind)),
        };
    }
    if (request.format === 'trace-matrix') {
        return {
            items: [], partial: true,
            ...parseTraceMatrix(request.text, ontology.relationshipTypes.map((r) => r.name), request.defaultRelation),
        };
    }
    const options: ParseElementsOptions = { sourceSystem: request.system, defaultKind: request.defaultKind, mastered: true };
    return { ...parseElementsCsv(request.text, ontology, options), links: [] };
}

/** `from,to,type` rows (or `sourceId,targetId,type`): traces between records, by source id. */
export function parseTraceMatrix(
    text: string, relationTypes: readonly string[], defaultRelation?: string,
): { links: SourceLink[]; errors: string[]; warnings: string[] } {
    const links: SourceLink[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length === 0) return { links, errors: ['CSV is empty — no header row found'], warnings };
    const split = (line: string) => line.split(',').map((field) => field.trim().replace(/^"|"$/g, ''));
    const headers = split(lines[0]);
    const column = (...names: string[]) => headers.findIndex((h) => names.includes(h));
    const from = column('from', 'sourceId');
    const to = column('to', 'targetId');
    const type = column('type', 'relation');
    if (from < 0 || to < 0) return { links, errors: ['Missing required columns: from, to'], warnings };
    for (const [index, line] of lines.slice(1).entries()) {
        const row = split(line);
        const relation = (type >= 0 ? row[type] : '') || defaultRelation || '';
        if (!row[from] || !row[to]) {
            errors.push(`Row ${index + 2}: missing 'from' or 'to'`);
        } else if (!relationTypes.includes(relation)) {
            errors.push(`Row ${index + 2}: unknown relationship type '${relation}'`);
        } else {
            links.push({ fromId: row[from], toId: row[to], type: relation });
        }
    }
    return { links, errors, warnings };
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface SourceImportPlan {
    system: string;
    /** True when the export did not state the whole population (see `SourceRecords.partial`). */
    partial: boolean;
    /** The incoming elements, named: an element the model already holds keeps its name. */
    elements: CsvElement[];
    links: SourceLink[];
    diff: ImportDiff;
    warnings: string[];
}

const shortName = (id: string) => id.slice(id.lastIndexOf('::') + 2);

/** The traces the last import wrote, by the source ids of their ends. */
function existingLinks(model: MemoModel, system: string): SourceLink[] {
    const file = importFile(system);
    const identifier = (id: string) => model.elements.get(id)?.attributes['externalReference.identifier'];
    const links: SourceLink[] = [];
    for (const relationship of model.relationships) {
        if (relationship.file !== file) continue;
        const fromId = identifier(relationship.sourceId);
        const toId = identifier(relationship.targetId);
        if (fromId !== undefined && toId !== undefined) links.push({ fromId, toId, type: relationship.type });
    }
    return links;
}

/**
 * Compare an export with the model. The names of records the model already
 * holds are kept (an element's identity in `memo.identity.yaml` is its qualified
 * name, so a rename would mint a new number and orphan every link authored to
 * it), and a new record whose derived name is taken gets a stable suffix.
 */
export function planSourceImport(model: MemoModel, system: string, records: SourceRecords): SourceImportPlan {
    const existing = importedElements(model, system);
    const used = new Set([...existing.values()].map((el) => shortName(el.id)));
    const elements = records.items.map((element) => {
        const source = element.source!;
        const known = existing.get(`${source.system}\u0000${source.identifier}`);
        let name = known ? shortName(known.id) : element.id;
        if (!known && used.has(name)) name = `${name}${hash(source.identifier, 4)}`;
        used.add(name);
        return { ...element, id: name };
    });
    // An export that carries no traces leaves the traces of the last import in place; one that
    // carries some replaces them, so a trace the source dropped is dropped here too.
    const links = records.links.length > 0 ? records.links : existingLinks(model, system);
    return {
        system,
        partial: records.partial === true,
        elements,
        links,
        diff: computeImportDiff(model, elements, !records.partial),
        warnings: [],
    };
}

// ─── Render ──────────────────────────────────────────────────────────────────

export interface RenderedImport {
    /** Project-relative file. */
    file: string;
    text: string;
    /** Columns left out because the kind declares no such attribute, as `Kind.column`. */
    dropped: string[];
    warnings: string[];
}

/**
 * The file the source owns after this import: the incoming records, then the
 * records the export no longer holds, kept and marked withdrawn.
 */
export function renderSourceImport(
    model: MemoModel,
    plan: SourceImportPlan,
    context: SourceImportContext,
    options: { format: SourceFormat; sourceFile?: string; now: Date },
): RenderedImport {
    const { kindRegistry, relationshipRegistry } = context;
    const dropped = new Set<string>();
    const warnings = [...plan.warnings];

    // Records the export does not hold, carried forward from the model: the ones that just left it
    // are marked withdrawn, the ones withdrawn before stay so, and (for a partial export) the rest
    // are kept as they were.
    const incoming = new Set(plan.elements.map((element) => element.source!.identifier));
    const leaving = new Set(plan.diff.withdrawn.map(({ id }) => id));
    const carried: CsvElement[] = [];
    for (const element of importedElements(model, plan.system).values()) {
        const identifier = element.attributes['externalReference.identifier'];
        if (incoming.has(identifier)) continue;
        const attributes: Record<string, string> = {};
        for (const [key, value] of Object.entries(element.attributes)) {
            // The builder also records an attribute declared but not given as `<Type>`, and keys of
            // its own (`usageType`, the source record); only what the kind declares was ever written.
            if (/^<.*>$/.test(value)) continue;
            if (!kindDeclaresAttribute(kindRegistry, element.kind, key.split('.')[0])) continue;
            attributes[key] = value;
        }
        const source: ElementSource = {
            system: plan.system,
            identifier,
            revision: element.attributes['externalReference.revision'] ?? '',
            mastered: element.attributes['sourceMastered'] !== 'false',
            ...(leaving.has(element.id) || element.attributes['sourceWithdrawn'] === 'true' ? { withdrawn: true } : {}),
        };
        carried.push({
            id: shortName(element.id), name: element.name, kind: element.kind, construct: element.construct,
            doc: element.doc ?? '', attributes, source,
        });
    }
    const withdrawn = carried;

    const nameOf = new Map<string, string>();
    for (const element of [...plan.elements, ...withdrawn]) nameOf.set(element.source!.identifier, element.id);
    const definitions = new Map(relationshipRegistry.toDefinitionDTOs().map((d) => [d.name, d]));
    const links: string[] = [];
    for (const link of plan.links) {
        const definition = definitions.get(link.type);
        const from = nameOf.get(link.fromId);
        const to = nameOf.get(link.toId);
        if (!definition || !from || !to) {
            warnings.push(`trace ${link.fromId} → ${link.toId} (${link.type}): ${!definition ? 'unknown relationship' : 'an end is not in this export'}; skipped`);
            continue;
        }
        links.push(renderRelationship({ id: `link${hash(`${link.type}|${link.fromId}|${link.toId}`, 8)}`, definition, sourceId: from, targetId: to }));
    }

    const header = [
        '    @ImportSource {',
        `        :>> sourceSystem = ${JSON.stringify(plan.system)};`,
        `        :>> importFormat = ${JSON.stringify(options.format)};`,
        ...(options.sourceFile ? [`        :>> importFile = ${JSON.stringify(options.sourceFile)};`] : []),
        `        :>> importedAt = ${JSON.stringify(options.now.toISOString())};`,
        '    }',
    ];
    // Each name the file uses is imported from the package that declares it.
    const all = [...plan.elements, ...withdrawn];
    const kindPackages = new Set<string>();
    for (const kind of new Set(all.map((element) => element.kind))) {
        const qualified = kindRegistry.getKind(kind)?.qualifiedName;
        if (qualified?.includes('::')) kindPackages.add(`${qualified.slice(0, qualified.lastIndexOf('::'))}::*`);
    }
    const text = generateFile(all, [], importPackage(plan.system), {
        imports: [
            'ScalarValues::*', 'memo_core_semantics::*', 'memo_core_common::MemoIdentity',
            ...(links.length > 0 ? ['memo_core_relationships::*'] : []),
            ...[...kindPackages].sort(),
        ],
        header,
        links,
        declaresAttribute: (kind, attribute) => kindDeclaresAttribute(kindRegistry, kind, attribute),
        onDropped: (element, attribute) => dropped.add(`${element.kind}.${attribute}`),
    });
    return { file: importFile(plan.system), text, dropped: [...dropped].sort(), warnings };
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** One record of the preview, with what the import does to the links authored against it. */
export interface PreviewEntry {
    identifier: string;
    elementId: string;
    name: string;
    kind: string;
    /** Revision held now and revision incoming; either is absent for a new or a deleted record. */
    from?: string;
    to?: string;
    /** The fields that differ. */
    changes: { field: string; from: string; to: string }[];
    /** Baselined links that become suspect: the record moved, or it left the export. */
    suspectLinks: string[];
    /** Every link that touches the record. */
    linkCount: number;
}

export interface SourceImportPreview {
    system: string;
    added: PreviewEntry[];
    changed: PreviewEntry[];
    unchanged: number;
    deleted: PreviewEntry[];
}

/** The ids of the links that are suspect once the record is as given. */
function suspectAfter(links: readonly AffectedLink[] | undefined, record: Parameters<typeof suspectReason>[1]): string[] {
    return (links ?? []).filter((l) => l.baseline && suspectReason(l.baseline, record)).map((l) => l.relationshipId);
}

/** What a re-import would do, in the terms a person reviews it: new, changed, deleted. */
export function previewSourceImport(model: MemoModel, plan: SourceImportPlan): SourceImportPreview {
    const { diff } = plan;
    const attributes = (id: string) => model.elements.get(id)?.attributes ?? {};
    return {
        system: plan.system,
        added: diff.added.map((element) => ({
            identifier: element.source!.identifier, elementId: element.id, name: element.name, kind: element.kind,
            to: element.source!.revision, changes: [], suspectLinks: [], linkCount: 0,
        })),
        changed: diff.modified.map((entry) => ({
            identifier: entry.incoming.source!.identifier, elementId: entry.current.id, name: entry.current.name, kind: entry.current.kind,
            from: entry.current.attributes['externalReference.revision'], to: entry.incoming.source!.revision,
            changes: entry.changes.map((c) => ({ field: c.field, from: c.currentValue, to: c.incomingValue })),
            // Asked of the one predicate the queue uses, at the revision the import brings.
            suspectLinks: suspectAfter(entry.links, {
                identifier: entry.incoming.source!.identifier, revision: entry.incoming.source!.revision, withdrawn: false,
            }),
            linkCount: entry.links?.length ?? 0,
        })),
        unchanged: diff.unchanged.length,
        deleted: diff.withdrawn.map(({ id, links }) => ({
            identifier: attributes(id)['externalReference.identifier'], elementId: id,
            name: model.elements.get(id)?.name ?? id, kind: model.elements.get(id)?.kind ?? '',
            from: attributes(id)['externalReference.revision'],
            changes: [], linkCount: links.length,
            suspectLinks: suspectAfter(links, {
                identifier: attributes(id)['externalReference.identifier'],
                revision: attributes(id)['externalReference.revision'], withdrawn: true,
            }),
        })),
    };
}

// ─── The whole step ──────────────────────────────────────────────────────────

export interface PreparedSourceImport {
    records: SourceRecords;
    plan: SourceImportPlan;
    preview: SourceImportPreview;
    rendered: RenderedImport;
}

/**
 * Read an export, compare it with the model, and render the file it would
 * leave. The CLI and the dev server both call this; neither writes anything
 * here, so a preview and an apply are the same computation.
 */
export function prepareSourceImport(
    model: MemoModel,
    context: SourceImportContext,
    request: SourceImportRequest,
    options: { sourceFile?: string; now?: Date } = {},
): PreparedSourceImport {
    const records = readSource(request, context);
    const plan = planSourceImport(model, request.system, records);
    return {
        records,
        plan,
        preview: previewSourceImport(model, plan),
        rendered: renderSourceImport(model, plan, context, {
            format: request.format, sourceFile: options.sourceFile, now: options.now ?? new Date(),
        }),
    };
}
