// ─── Sparx EA Importer ───────────────────────────────────────────────────────
//
// Reads a Sparx EA SQLite database (.qea/.eap/.eapx) and extracts elements
// and relationships, mapping stereotypes → MEMO kinds via KindRegistry.
// Produces .sysml files compatible with the MEMO parser.
//
// Usage:
//   const result = await importEaProject(filePath, kindRegistry, relRegistry);
// ─────────────────────────────────────────────────────────────────────────────

import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipRegistry } from '../model/relationship-registry.js';
import { wrapPackage } from '../serializer/sysml-generator.js';

/** An element extracted from an EA project */
export interface EaElement {
    /** EA element ID */
    eaId: number;
    /** Element name */
    name: string;
    /** EA element type (e.g. "Class", "Requirement", "Component") */
    eaType: string;
    /** EA stereotype (e.g. "Hazard", "RiskControl") */
    stereotype: string;
    /** Mapped MEMO kind (e.g. "Hazard") */
    memoKind?: string;
    /** SysML construct (e.g. "part def", "requirement def") */
    construct?: string;
    /** Element notes/documentation */
    doc: string;
    /** Additional tagged values */
    attributes: Record<string, string>;
    /** EA package path */
    packagePath: string;
}

/** A relationship extracted from an EA project */
export interface EaRelationship {
    /** Source element EA ID */
    sourceEaId: number;
    /** Target element EA ID */
    targetEaId: number;
    /** EA connector type (e.g. "Dependency", "Realisation", "Association") */
    eaType: string;
    /** EA connector stereotype */
    stereotype: string;
    /** Mapped MEMO relationship type */
    memoRelType?: string;
    /** Source element name */
    sourceName: string;
    /** Target element name */
    targetName: string;
}

/** Result of importing an EA project */
export interface EaImportResult {
    /** Extracted and mapped elements */
    elements: EaElement[];
    /** Extracted and mapped relationships */
    relationships: EaRelationship[];
    /** Warnings generated during import */
    warnings: string[];
    /** Errors that prevented import of specific items */
    errors: string[];
    /** Mapping statistics */
    stats: {
        totalElements: number;
        mappedElements: number;
        unmappedElements: number;
        totalRelationships: number;
        mappedRelationships: number;
        unmappedRelationships: number;
    };
}

/** Mapping from EA element types and stereotypes to MEMO kinds */
const EA_TYPE_MAP: Record<string, string> = {
    // Direct type mappings
    'Requirement': 'Requirement',
    'Component': 'LogicalComponent',
    'Class': 'LogicalComponent',
    'Object': 'LogicalComponent',
    'Activity': 'Function',
    'Action': 'Function',
    'UseCase': 'UseCase',
    'Actor': 'Stakeholder',
    'Interface': 'Interface',
    'Port': 'Port',
    'Package': 'Package',
    'Node': 'PhysicalNode',
    'Artifact': 'Artifact',
    'Signal': 'ExchangeItem',
    'DataType': 'DataType',
};

/** Mapping from EA connector types to MEMO relationship types */
const EA_CONNECTOR_MAP: Record<string, string> = {
    'Dependency': 'dependency',
    'Realisation': 'realization',
    'Realization': 'realization',
    'Association': 'association',
    'Aggregation': 'aggregation',
    'Composition': 'composedOf',
    'Generalization': 'specialization',
    'Usage': 'dependency',
    'Abstraction': 'traceTo',
    'Trace': 'traceTo',
    'Derive': 'derives',
    'Satisfy': 'satisfy',
    'Verify': 'verify',
    'Allocate': 'allocateTo',
    'Refine': 'refines',
    'InformationFlow': 'carriesExchangeItem',
};

/** Mapping from EA stereotypes to MEMO kinds (higher priority than type mapping) */
const EA_STEREOTYPE_MAP: Record<string, string> = {
    // Risk management (ISO 14971)
    'Hazard': 'Hazard',
    'hazard': 'Hazard',
    'HazardousSituation': 'HazardousSituation',
    'hazardousSituation': 'HazardousSituation',
    'Harm': 'Harm',
    'harm': 'Harm',
    'RiskControl': 'RiskControl',
    'riskControl': 'RiskControl',
    'Risk': 'Risk',
    'risk': 'Risk',
    // Design control
    'UserNeed': 'Requirement',
    'userNeed': 'Requirement',
    'DesignInput': 'DesignInput',
    'designInput': 'DesignInput',
    'DesignOutput': 'DesignOutput',
    'designOutput': 'DesignOutput',
    // Software (IEC 62304)
    'SoftwareSystem': 'SoftwareSystem',
    'SoftwareItem': 'SoftwareItem',
    'SoftwareUnit': 'SoftwareUnit',
    'SOUPItem': 'SOUPItem',
    'SoftwareRequirement': 'Requirement',
    // Verification
    'TestCase': 'Test',
    'Test': 'Test',
    'VerificationActivity': 'VerificationActivity',
    // Requirements
    'SystemRequirement': 'Requirement',
    'systemRequirement': 'Requirement',
    'Requirement': 'Requirement',
    'FunctionalRequirement': 'Requirement',
    // Architecture
    'Subsystem': 'Subsystem',
    'Component': 'LogicalComponent',
    'Function': 'Function',
    'Interface': 'Interface',
    'PhysicalNode': 'PhysicalNode',
    // Clinical
    'IntendedUse': 'IntendedUse',
    'IndicationForUse': 'IndicationForUse',
    // Stakeholders
    'Stakeholder': 'Stakeholder',
    'Actor': 'Stakeholder',
};

/**
 * Parse Sparx EA SQLite (.qea) database structure.
 * EA stores its model in a SQLite database with tables:
 * - t_object: elements (Object_ID, Name, Object_Type, Stereotype, Note, Package_ID)
 * - t_connector: relationships (Connector_ID, Start_Object_ID, End_Object_ID, Connector_Type, Stereotype)
 * - t_package: packages (Package_ID, Name, Parent_ID)
 * - t_objectproperties: tagged values (Object_ID, Property, Value)
 *
 * Since we cannot use native SQLite bindings (would require node-gyp),
 * we parse the file as a structured text/XML format for .eap/.eapx files,
 * or provide a SQL-based import via an intermediate JSON export.
 */

/**
 * Import elements and relationships from a Sparx EA JSON export.
 *
 * EA projects can be exported as JSON via:
 * 1. EA's built-in "Publish as HTML" → extract model.json
 * 2. EA scripting API → custom JSON export
 * 3. eautils or similar third-party tools
 *
 * Expected JSON format:
 * {
 *   "elements": [{ "id": 1, "name": "...", "type": "Class", "stereotype": "Hazard", "notes": "...", "package": "Risk", "taggedValues": {} }],
 *   "connectors": [{ "id": 1, "sourceId": 1, "targetId": 2, "type": "Dependency", "stereotype": "mitigates" }]
 * }
 */
export function importEaJson(
    jsonData: EaJsonExport,
    kindRegistry?: KindRegistry,
    relRegistry?: RelationshipRegistry,
): EaImportResult {
    const elements: EaElement[] = [];
    const relationships: EaRelationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    let mappedElements = 0;
    let unmappedElements = 0;
    let mappedRelationships = 0;
    let unmappedRelationships = 0;

    // Build EA ID → name lookup
    const idToName = new Map<number, string>();
    const idToSysmlId = new Map<number, string>();

    for (const el of jsonData.elements || []) {
        const name = el.name || `element_${el.id}`;
        idToName.set(el.id, name);
        idToSysmlId.set(el.id, toSysmlId(name));
    }

    // Map elements
    for (const el of jsonData.elements || []) {
        const memoKind = resolveKind(el.type, el.stereotype, kindRegistry);
        const construct = resolveConstruct(memoKind, kindRegistry);
        const sysmlId = idToSysmlId.get(el.id) || toSysmlId(el.name);

        if (memoKind) {
            mappedElements++;
        } else {
            unmappedElements++;
            warnings.push(`Element "${el.name}" (type=${el.type}, stereotype=${el.stereotype}): no MEMO kind mapping`);
        }

        elements.push({
            eaId: el.id,
            name: el.name,
            eaType: el.type,
            stereotype: el.stereotype || '',
            memoKind,
            construct,
            doc: el.notes || '',
            attributes: el.taggedValues || {},
            packagePath: el.package || '',
        });
    }

    // Map relationships
    for (const conn of jsonData.connectors || []) {
        const memoRelType = resolveRelType(conn.type, conn.stereotype, relRegistry);
        const sourceName = idToName.get(conn.sourceId) || `element_${conn.sourceId}`;
        const targetName = idToName.get(conn.targetId) || `element_${conn.targetId}`;

        if (memoRelType) {
            mappedRelationships++;
        } else {
            unmappedRelationships++;
            warnings.push(`Connector ${sourceName}→${targetName} (type=${conn.type}, stereotype=${conn.stereotype}): no MEMO relationship mapping`);
        }

        relationships.push({
            sourceEaId: conn.sourceId,
            targetEaId: conn.targetId,
            eaType: conn.type,
            stereotype: conn.stereotype || '',
            memoRelType,
            sourceName,
            targetName,
        });
    }

    return {
        elements,
        relationships,
        warnings,
        errors,
        stats: {
            totalElements: (jsonData.elements || []).length,
            mappedElements,
            unmappedElements,
            totalRelationships: (jsonData.connectors || []).length,
            mappedRelationships,
            unmappedRelationships,
        },
    };
}

/** JSON export format from Sparx EA */
export interface EaJsonExport {
    elements?: EaJsonElement[];
    connectors?: EaJsonConnector[];
}

export interface EaJsonElement {
    id: number;
    name: string;
    type: string;
    stereotype?: string;
    notes?: string;
    package?: string;
    taggedValues?: Record<string, string>;
}

export interface EaJsonConnector {
    id: number;
    sourceId: number;
    targetId: number;
    type: string;
    stereotype?: string;
    name?: string;
}

/**
 * Generate SysML v2 text from an EA import result.
 * Groups elements by package path, creates package hierarchy.
 */
export function eaResultToSysml(result: EaImportResult, packageName: string): string {
    const lines: string[] = [];
    const indent = '    ';

    lines.push('');

    // Build EA ID → SysML ID map
    const idToSysmlId = new Map<number, string>();
    for (const el of result.elements) {
        if (el.memoKind) {
            idToSysmlId.set(el.eaId, toSysmlId(el.name));
        }
    }

    // Group mapped elements by kind
    const byKind = new Map<string, EaElement[]>();
    for (const el of result.elements) {
        if (!el.memoKind) continue;
        if (!byKind.has(el.memoKind)) byKind.set(el.memoKind, []);
        byKind.get(el.memoKind)!.push(el);
    }

    for (const [kind, kindElements] of byKind) {
        lines.push(`${indent}// ── ${kind} ──`);
        for (const el of kindElements) {
            const sysmlId = toSysmlId(el.name);
            const construct = el.construct || 'part';
            lines.push(`${indent}${construct} ${sysmlId} : ${kind} {`);
            if (el.doc) {
                lines.push(`${indent}${indent}doc /* ${escapeDoc(el.doc)} */`);
            }
            if (el.name !== sysmlId) {
                lines.push(`${indent}${indent}attribute redefines name = "${escapeString(el.name)}";`);
            }
            for (const [key, value] of Object.entries(el.attributes)) {
                lines.push(`${indent}${indent}attribute redefines ${toSysmlId(key)} = "${escapeString(value)}";`);
            }
            lines.push(`${indent}}`);
            lines.push('');
        }
    }

    // Mapped relationships
    const mappedRels = result.relationships.filter(r => r.memoRelType);
    if (mappedRels.length > 0) {
        lines.push(`${indent}// ── Relationships ──`);
        for (const rel of mappedRels) {
            const sourceId = idToSysmlId.get(rel.sourceEaId);
            const targetId = idToSysmlId.get(rel.targetEaId);
            if (!sourceId || !targetId) continue;
            const typeName = capitalizeFirst(rel.memoRelType!);
            lines.push(`${indent}connection : ${typeName} connect source ::> ${sourceId} to target ::> ${targetId};`);
        }
        lines.push('');
    }

    return wrapPackage(packageName, lines).join('\n') + '\n';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveKind(
    eaType: string,
    stereotype: string | undefined,
    kindRegistry?: KindRegistry,
): string | undefined {
    // 1. Try stereotype first (most specific)
    if (stereotype) {
        // Check registry first
        if (kindRegistry?.has(stereotype)) return stereotype;
        // Then static map
        if (EA_STEREOTYPE_MAP[stereotype]) return EA_STEREOTYPE_MAP[stereotype];
    }

    // 2. Try EA type
    if (kindRegistry?.has(eaType)) return eaType;
    if (EA_TYPE_MAP[eaType]) return EA_TYPE_MAP[eaType];

    return undefined;
}

function resolveRelType(
    eaType: string,
    stereotype: string | undefined,
    relRegistry?: RelationshipRegistry,
): string | undefined {
    // 1. Try stereotype first (most specific)
    if (stereotype) {
        const camel = stereotype.charAt(0).toLowerCase() + stereotype.slice(1);
        if (relRegistry?.has(camel)) return camel;
        if (EA_CONNECTOR_MAP[stereotype]) return EA_CONNECTOR_MAP[stereotype];
        // Stereotype as-is (e.g. "mitigates" → "mitigates")
        return camel;
    }

    // 2. Try connector type
    if (EA_CONNECTOR_MAP[eaType]) return EA_CONNECTOR_MAP[eaType];

    return undefined;
}

function resolveConstruct(
    memoKind: string | undefined,
    kindRegistry?: KindRegistry,
): string | undefined {
    if (!memoKind) return undefined;
    const entry = kindRegistry?.getKind(memoKind);
    if (entry) return entry.sysmlConstruct;
    // Fallback heuristics
    if (memoKind.includes('Requirement') || memoKind === 'DesignInput' || memoKind === 'DesignOutput') {
        return 'requirement';
    }
    if (memoKind === 'Function' || memoKind.includes('Activity') || memoKind.includes('Action')) {
        return 'action';
    }
    return 'part';
}

function toSysmlId(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .replace(/^(\d)/, '_$1') || 'unnamed';
}

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeDoc(s: string): string {
    return s.replace(/\*\//g, '* /').replace(/\n/g, ' ');
}

function capitalizeFirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
