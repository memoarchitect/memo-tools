// ─── MagicDraw/Cameo Importer ────────────────────────────────────────────────
//
// Reads MagicDraw/Cameo XML exports (.mdxml/.xml) and extracts elements
// and relationships, mapping stereotypes → MEMO kinds via KindRegistry.
// Produces .sysml files compatible with the MEMO parser.
//
// MagicDraw/Cameo stores models as XMI (XML Metadata Interchange) with
// UML/SysML profiles applied as stereotypes. This importer handles:
// - XMI 2.x format exported from MagicDraw/Cameo
// - JSON intermediate format (for .mdzip via extraction tools)
//
// Usage:
//   const result = importCameoXml(xmlContent, kindRegistry, relRegistry);
// ─────────────────────────────────────────────────────────────────────────────

import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipRegistry } from '../model/relationship-registry.js';

/** An element extracted from a Cameo project */
export interface CameoElement {
    /** XMI ID */
    xmiId: string;
    /** Element name */
    name: string;
    /** UML/SysML type (e.g. "uml:Class", "sysml:Block", "sysml:Requirement") */
    xmiType: string;
    /** Applied stereotype names */
    stereotypes: string[];
    /** Mapped MEMO kind */
    memoKind?: string;
    /** SysML construct */
    construct?: string;
    /** Documentation */
    doc: string;
    /** Tagged values / properties */
    attributes: Record<string, string>;
    /** Package path */
    packagePath: string;
}

/** A relationship extracted from a Cameo project */
export interface CameoRelationship {
    /** XMI ID */
    xmiId: string;
    /** Source element XMI ID */
    sourceXmiId: string;
    /** Target element XMI ID */
    targetXmiId: string;
    /** UML/SysML type (e.g. "uml:Dependency", "uml:Association") */
    xmiType: string;
    /** Applied stereotypes */
    stereotypes: string[];
    /** Mapped MEMO relationship type */
    memoRelType?: string;
    /** Source element name */
    sourceName: string;
    /** Target element name */
    targetName: string;
}

/** Result of importing a Cameo project */
export interface CameoImportResult {
    /** Extracted and mapped elements */
    elements: CameoElement[];
    /** Extracted and mapped relationships */
    relationships: CameoRelationship[];
    /** Warnings */
    warnings: string[];
    /** Errors */
    errors: string[];
    /** Statistics */
    stats: {
        totalElements: number;
        mappedElements: number;
        unmappedElements: number;
        totalRelationships: number;
        mappedRelationships: number;
        unmappedRelationships: number;
    };
}

/** XMI type → MEMO kind mapping */
const XMI_TYPE_MAP: Record<string, string> = {
    'uml:Class': 'LogicalComponent',
    'uml:Component': 'LogicalComponent',
    'uml:Interface': 'Interface',
    'uml:Port': 'Port',
    'uml:Activity': 'Function',
    'uml:Action': 'Function',
    'uml:UseCase': 'UseCase',
    'uml:Actor': 'Stakeholder',
    'uml:Node': 'PhysicalNode',
    'uml:Artifact': 'Artifact',
    'uml:Signal': 'ExchangeItem',
    'uml:DataType': 'DataType',
    'uml:Package': 'Package',
    'sysml:Block': 'LogicalComponent',
    'sysml:Requirement': 'Requirement',
    'sysml:ConstraintBlock': 'Constraint',
    'sysml:FlowPort': 'Port',
    'sysml:InterfaceBlock': 'Interface',
    'sysml:ValueType': 'DataType',
};

/** XMI relationship type → MEMO relationship type mapping */
const XMI_REL_MAP: Record<string, string> = {
    'uml:Dependency': 'dependency',
    'uml:Realization': 'realization',
    'uml:Abstraction': 'traceTo',
    'uml:Association': 'association',
    'uml:Usage': 'dependency',
    'uml:Generalization': 'specialization',
    'uml:InformationFlow': 'carriesExchangeItem',
    'sysml:Satisfy': 'satisfy',
    'sysml:Verify': 'verify',
    'sysml:DeriveReqt': 'derives',
    'sysml:Refine': 'refines',
    'sysml:Trace': 'traceTo',
    'sysml:Allocate': 'allocateTo',
    'sysml:Copy': 'traceTo',
};

/** Stereotype → MEMO kind mapping (same as EA, applied stereotypes take priority) */
const CAMEO_STEREOTYPE_MAP: Record<string, string> = {
    'Hazard': 'Hazard',
    'HazardousSituation': 'HazardousSituation',
    'Harm': 'Harm',
    'RiskControl': 'RiskControl',
    'Risk': 'Risk',
    'UserNeed': 'Requirement',
    'DesignInput': 'DesignInput',
    'DesignOutput': 'DesignOutput',
    'SoftwareSystem': 'SoftwareSystem',
    'SoftwareItem': 'SoftwareItem',
    'SoftwareUnit': 'SoftwareUnit',
    'SOUPItem': 'SOUPItem',
    'SoftwareRequirement': 'Requirement',
    'SystemRequirement': 'Requirement',
    'TestCase': 'Test',
    'Test': 'Test',
    'VerificationActivity': 'VerificationActivity',
    'Stakeholder': 'Stakeholder',
    'IntendedUse': 'IntendedUse',
    'Block': 'LogicalComponent',
    'Subsystem': 'Subsystem',
};

/**
 * Import from Cameo/MagicDraw XMI XML content.
 *
 * Parses a simplified XMI structure. For full .mdzip support,
 * users should first extract the XML via:
 *   unzip model.mdzip com.nomagic.magicdraw.uml_model.model
 *
 * Alternatively, accepts a JSON intermediate format (CameoJsonExport).
 */
export function importCameoXml(
    xmlContent: string,
    kindRegistry?: KindRegistry,
    relRegistry?: RelationshipRegistry,
): CameoImportResult {
    const elements: CameoElement[] = [];
    const relationships: CameoRelationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    let mappedElements = 0;
    let unmappedElements = 0;
    let mappedRels = 0;
    let unmappedRels = 0;

    // Build ID → name lookup from XML
    const idToName = new Map<string, string>();
    const idToSysmlId = new Map<string, string>();

    // Parse elements: <packagedElement xmi:type="uml:Class" xmi:id="..." name="..." >
    const elementRegex = /<packagedElement\s+[^>]*xmi:type="([^"]+)"[^>]*xmi:id="([^"]+)"[^>]*name="([^"]*)"[^>]*(?:\/>|>([\s\S]*?)<\/packagedElement>)/g;
    let match;

    while ((match = elementRegex.exec(xmlContent)) !== null) {
        const [, xmiType, xmiId, name, body] = match;
        idToName.set(xmiId, name);
        idToSysmlId.set(xmiId, toSysmlId(name));

        // Extract stereotypes from body
        const stereotypes: string[] = [];
        if (body) {
            const stereoRegex = /appliedStereotype[^>]*name="([^"]+)"/g;
            let sMatch;
            while ((sMatch = stereoRegex.exec(body)) !== null) {
                stereotypes.push(sMatch[1]);
            }
        }

        // Extract documentation
        let doc = '';
        if (body) {
            const docMatch = body.match(/<body>([\s\S]*?)<\/body>/);
            if (docMatch) doc = docMatch[1].trim();
        }

        // Resolve kind
        const memoKind = resolveCameoKind(xmiType, stereotypes, kindRegistry);
        const construct = resolveConstruct(memoKind, kindRegistry);

        if (memoKind) {
            mappedElements++;
        } else {
            unmappedElements++;
            warnings.push(`Element "${name}" (type=${xmiType}, stereotypes=[${stereotypes.join(',')}]): no MEMO kind mapping`);
        }

        elements.push({
            xmiId,
            name,
            xmiType,
            stereotypes,
            memoKind,
            construct,
            doc,
            attributes: {},
            packagePath: '',
        });
    }

    // Parse relationships: look for dependency, association, etc.
    const relPatterns = [
        // <packagedElement xmi:type="uml:Dependency" ... client="id1" supplier="id2">
        /<packagedElement\s+[^>]*xmi:type="(uml:\w+|sysml:\w+)"[^>]*xmi:id="([^"]+)"[^>]*client="([^"]+)"[^>]*supplier="([^"]+)"[^>]*/g,
        // Alternative: supplier before client
        /<packagedElement\s+[^>]*xmi:type="(uml:\w+|sysml:\w+)"[^>]*xmi:id="([^"]+)"[^>]*supplier="([^"]+)"[^>]*client="([^"]+)"[^>]*/g,
    ];

    const seenRelIds = new Set<string>();

    for (const relRegex of relPatterns) {
        while ((match = relRegex.exec(xmlContent)) !== null) {
            const [, xmiType, xmiId, id1, id2] = match;
            if (seenRelIds.has(xmiId)) continue;
            seenRelIds.add(xmiId);

            // For the first pattern, id1=client(source), id2=supplier(target)
            // For the second pattern, id1=supplier(target), id2=client(source)
            // We normalize: client=source, supplier=target
            const sourceId = id1;
            const targetId = id2;

            const memoRelType = resolveRelType(xmiType, relRegistry);
            const sourceName = idToName.get(sourceId) || sourceId;
            const targetName = idToName.get(targetId) || targetId;

            if (memoRelType) {
                mappedRels++;
            } else {
                unmappedRels++;
                warnings.push(`Relationship ${sourceName}→${targetName} (type=${xmiType}): no MEMO mapping`);
            }

            relationships.push({
                xmiId,
                sourceXmiId: sourceId,
                targetXmiId: targetId,
                xmiType,
                stereotypes: [],
                memoRelType,
                sourceName,
                targetName,
            });
        }
    }

    return {
        elements,
        relationships,
        warnings,
        errors,
        stats: {
            totalElements: elements.length,
            mappedElements,
            unmappedElements,
            totalRelationships: relationships.length,
            mappedRelationships: mappedRels,
            unmappedRelationships: unmappedRels,
        },
    };
}

/**
 * Import from a Cameo JSON intermediate format.
 * This is useful when .mdzip has been pre-processed by extraction tools.
 */
export interface CameoJsonExport {
    elements?: CameoJsonElement[];
    relationships?: CameoJsonRelationship[];
}

export interface CameoJsonElement {
    id: string;
    name: string;
    type: string;
    stereotypes?: string[];
    documentation?: string;
    package?: string;
    properties?: Record<string, string>;
}

export interface CameoJsonRelationship {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    stereotypes?: string[];
    name?: string;
}

export function importCameoJson(
    jsonData: CameoJsonExport,
    kindRegistry?: KindRegistry,
    relRegistry?: RelationshipRegistry,
): CameoImportResult {
    const elements: CameoElement[] = [];
    const relationships: CameoRelationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    let mappedElements = 0;
    let unmappedElements = 0;
    let mappedRels = 0;
    let unmappedRels = 0;

    const idToName = new Map<string, string>();
    const idToSysmlId = new Map<string, string>();

    for (const el of jsonData.elements || []) {
        idToName.set(el.id, el.name);
        idToSysmlId.set(el.id, toSysmlId(el.name));
    }

    for (const el of jsonData.elements || []) {
        const stereotypes = el.stereotypes || [];
        const memoKind = resolveCameoKind(el.type, stereotypes, kindRegistry);
        const construct = resolveConstruct(memoKind, kindRegistry);

        if (memoKind) {
            mappedElements++;
        } else {
            unmappedElements++;
            warnings.push(`Element "${el.name}" (type=${el.type}, stereotypes=[${stereotypes.join(',')}]): no MEMO kind mapping`);
        }

        elements.push({
            xmiId: el.id,
            name: el.name,
            xmiType: el.type,
            stereotypes,
            memoKind,
            construct,
            doc: el.documentation || '',
            attributes: el.properties || {},
            packagePath: el.package || '',
        });
    }

    for (const rel of jsonData.relationships || []) {
        const stereotypes = rel.stereotypes || [];
        const memoRelType = resolveRelType(rel.type, relRegistry);
        const sourceName = idToName.get(rel.sourceId) || rel.sourceId;
        const targetName = idToName.get(rel.targetId) || rel.targetId;

        if (memoRelType) {
            mappedRels++;
        } else {
            unmappedRels++;
            warnings.push(`Relationship ${sourceName}→${targetName} (type=${rel.type}): no MEMO mapping`);
        }

        relationships.push({
            xmiId: rel.id,
            sourceXmiId: rel.sourceId,
            targetXmiId: rel.targetId,
            xmiType: rel.type,
            stereotypes,
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
            totalElements: elements.length,
            mappedElements,
            unmappedElements,
            totalRelationships: relationships.length,
            mappedRelationships: mappedRels,
            unmappedRelationships: unmappedRels,
        },
    };
}

/**
 * Generate SysML v2 text from a Cameo import result.
 */
export function cameoResultToSysml(result: CameoImportResult, packageName: string): string {
    const lines: string[] = [];
    const indent = '    ';

    lines.push(`package ${packageName} {`);
    lines.push('');

    const idToSysmlId = new Map<string, string>();
    for (const el of result.elements) {
        if (el.memoKind) {
            idToSysmlId.set(el.xmiId, toSysmlId(el.name));
        }
    }

    // Group by kind
    const byKind = new Map<string, CameoElement[]>();
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

    // Relationships
    const mappedRels = result.relationships.filter(r => r.memoRelType);
    if (mappedRels.length > 0) {
        lines.push(`${indent}// ── Relationships ──`);
        for (const rel of mappedRels) {
            const sourceId = idToSysmlId.get(rel.sourceXmiId);
            const targetId = idToSysmlId.get(rel.targetXmiId);
            if (!sourceId || !targetId) continue;
            const typeName = capitalizeFirst(rel.memoRelType!);
            lines.push(`${indent}connection : ${typeName} connect source ::> ${sourceId} to target ::> ${targetId};`);
        }
        lines.push('');
    }

    lines.push('}');
    return lines.join('\n') + '\n';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveCameoKind(
    xmiType: string,
    stereotypes: string[],
    kindRegistry?: KindRegistry,
): string | undefined {
    // 1. Try stereotypes first (most specific)
    for (const s of stereotypes) {
        if (kindRegistry?.has(s)) return s;
        if (CAMEO_STEREOTYPE_MAP[s]) return CAMEO_STEREOTYPE_MAP[s];
    }

    // 2. Try XMI type
    if (XMI_TYPE_MAP[xmiType]) return XMI_TYPE_MAP[xmiType];

    return undefined;
}

function resolveRelType(
    xmiType: string,
    relRegistry?: RelationshipRegistry,
): string | undefined {
    if (XMI_REL_MAP[xmiType]) return XMI_REL_MAP[xmiType];
    return undefined;
}

function resolveConstruct(
    memoKind: string | undefined,
    kindRegistry?: KindRegistry,
): string | undefined {
    if (!memoKind) return undefined;
    const entry = kindRegistry?.getKind(memoKind);
    if (entry) return entry.sysmlConstruct;
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
