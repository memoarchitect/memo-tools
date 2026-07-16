// ─── OWL/JSON-LD Ontology Importer ───────────────────────────────────────────
//
// Reads OWL/Turtle or JSON-LD ontology files and maps:
//   owl:Class → MEMO kinds (part def / requirement def)
//   owl:ObjectProperty → MEMO relationships (connection def)
//
// Produces an ontology package with SysML files organized by layer.
//
// Usage:
//   const result = importOwlTurtle(turtleContent);
//   const sysml = owlResultToSysml(result, "imported_ontology");
// ─────────────────────────────────────────────────────────────────────────────

import { wrapPackage } from '../serializer/sysml-generator.js';

/** An OWL class mapped to a MEMO kind */
export interface OwlClass {
    /** IRI or local name */
    uri: string;
    /** Local name extracted from IRI */
    name: string;
    /** rdfs:label if present */
    label: string;
    /** rdfs:comment if present */
    comment: string;
    /** Parent class (rdfs:subClassOf) */
    superClass?: string;
    /** Layer derived from class annotations or superclass */
    layer: string;
    /** SysML construct (heuristic: "requirement def" for req-like names, "part def" otherwise) */
    construct: string;
}

/** An OWL object property mapped to a MEMO relationship */
export interface OwlProperty {
    /** IRI or local name */
    uri: string;
    /** Local name */
    name: string;
    /** rdfs:label if present */
    label: string;
    /** rdfs:comment if present */
    comment: string;
    /** rdfs:domain (source kind) */
    domain?: string;
    /** rdfs:range (target kind) */
    range?: string;
    /** Layer derived from annotations */
    layer: string;
}

/** Result of importing an OWL ontology */
export interface OwlImportResult {
    /** Ontology IRI */
    ontologyIri: string;
    /** Ontology version */
    version: string;
    /** Ontology title/description */
    title: string;
    /** Extracted classes */
    classes: OwlClass[];
    /** Extracted object properties */
    properties: OwlProperty[];
    /** Warnings */
    warnings: string[];
    /** Errors */
    errors: string[];
    /** Statistics */
    stats: {
        classes: number;
        properties: number;
        dataProperties: number;
    };
}

/**
 * Import from OWL/Turtle format.
 *
 * Parses a simplified Turtle syntax to extract:
 * - owl:Class declarations → MEMO kinds
 * - owl:ObjectProperty declarations → MEMO relationships
 * - rdfs:subClassOf for type hierarchy
 * - Layer annotations (memo:layer or derived from superclass)
 */
export function importOwlTurtle(turtleContent: string): OwlImportResult {
    const classes: OwlClass[] = [];
    const properties: OwlProperty[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    // Parse prefixes
    const prefixes = new Map<string, string>();
    const prefixRegex = /@prefix\s+(\w*):\s*<([^>]+)>\s*\./g;
    let match;
    while ((match = prefixRegex.exec(turtleContent)) !== null) {
        prefixes.set(match[1], match[2]);
    }

    // Extract ontology IRI
    let ontologyIri = '';
    let version = '';
    let title = '';
    const ontologyMatch = turtleContent.match(/<([^>]+)>\s+a\s+owl:Ontology/);
    if (ontologyMatch) {
        ontologyIri = ontologyMatch[1];
    }
    const versionMatch = turtleContent.match(/owl:versionInfo\s+"([^"]+)"/);
    if (versionMatch) version = versionMatch[1];
    const titleMatch = turtleContent.match(/dcterms:title\s+"([^"]+)"/);
    if (titleMatch) title = titleMatch[1];

    // Parse class declarations: <name> a owl:Class ; ... .
    // Also handle prefixed forms: memo:Hazard a owl:Class ; ... .
    const blockRegex = /(?:<([^>]+)>|(\w+):(\w+))\s+a\s+owl:Class\s*;([\s\S]*?)\./g;
    while ((match = blockRegex.exec(turtleContent)) !== null) {
        const uri = match[1] || expandPrefix(match[2], match[3], prefixes);
        const name = extractLocalName(uri);
        const body = match[4] || '';

        // Skip layer classes (Layer_Purpose, etc.)
        if (name.startsWith('Layer_')) continue;

        const label = extractStringProperty(body, 'rdfs:label') || name;
        const comment = extractStringProperty(body, 'rdfs:comment') || '';
        const layer = extractStringProperty(body, /\w+:layer/) || deriveLayerFromName(name);
        const construct = extractStringProperty(body, /\w+:sysmlConstruct/) || deriveConstruct(name);

        // Look for rdfs:subClassOf
        let superClass: string | undefined;
        const subClassMatch = body.match(/rdfs:subClassOf\s+(?:<([^>]+)>|(\w+):(\w+))/);
        if (subClassMatch) {
            const superUri = subClassMatch[1] || expandPrefix(subClassMatch[2], subClassMatch[3], prefixes);
            const superName = extractLocalName(superUri);
            if (!superName.startsWith('Layer_')) {
                superClass = superName;
            }
        }

        classes.push({ uri, name, label, comment, superClass, layer, construct });
    }

    // Parse object property declarations
    const propRegex = /(?:<([^>]+)>|(\w+):(\w+))\s+a\s+owl:ObjectProperty\s*;([\s\S]*?)\./g;
    while ((match = propRegex.exec(turtleContent)) !== null) {
        const uri = match[1] || expandPrefix(match[2], match[3], prefixes);
        const name = extractLocalName(uri);
        const body = match[4] || '';

        const label = extractStringProperty(body, 'rdfs:label') || name;
        const comment = extractStringProperty(body, 'rdfs:comment') || '';
        const layer = extractStringProperty(body, /\w+:layer/) || 'crosscutting';

        // Domain and range
        let domain: string | undefined;
        let range: string | undefined;
        const domainMatch = body.match(/rdfs:domain\s+(?:<([^>]+)>|(\w+):(\w+))/);
        if (domainMatch) {
            domain = extractLocalName(domainMatch[1] || expandPrefix(domainMatch[2], domainMatch[3], prefixes));
        }
        const rangeMatch = body.match(/rdfs:range\s+(?:<([^>]+)>|(\w+):(\w+))/);
        if (rangeMatch) {
            range = extractLocalName(rangeMatch[1] || expandPrefix(rangeMatch[2], rangeMatch[3], prefixes));
        }

        properties.push({ uri, name, label, comment, domain, range, layer });
    }

    return {
        ontologyIri,
        version,
        title,
        classes,
        properties,
        warnings,
        errors,
        stats: {
            classes: classes.length,
            properties: properties.length,
            dataProperties: 0,
        },
    };
}

/**
 * Import from JSON-LD format.
 *
 * Expected structure:
 * {
 *   "@context": { ... },
 *   "@graph": [
 *     { "@id": "...", "@type": "owl:Class", "rdfs:label": "...", ... },
 *     { "@id": "...", "@type": "owl:ObjectProperty", ... }
 *   ]
 * }
 */
export function importJsonLd(jsonContent: string): OwlImportResult {
    const classes: OwlClass[] = [];
    const properties: OwlProperty[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    let data: any;
    try {
        data = JSON.parse(jsonContent);
    } catch (e) {
        errors.push(`Failed to parse JSON-LD: ${e}`);
        return {
            ontologyIri: '', version: '', title: '',
            classes, properties, warnings, errors,
            stats: { classes: 0, properties: 0, dataProperties: 0 },
        };
    }

    const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
    let ontologyIri = '';
    let version = '';
    let title = '';

    for (const node of graph) {
        const type = normalizeType(node['@type']);
        const id = node['@id'] || '';
        const name = extractLocalName(id);

        if (type === 'owl:Ontology') {
            ontologyIri = id;
            version = extractValue(node['owl:versionInfo']) || '';
            title = extractValue(node['dcterms:title']) || extractValue(node['rdfs:label']) || '';
            continue;
        }

        if (type === 'owl:Class') {
            if (name.startsWith('Layer_')) continue;

            const label = extractValue(node['rdfs:label']) || name;
            const comment = extractValue(node['rdfs:comment']) || '';
            const layer = extractValue(node['memo:layer']) || deriveLayerFromName(name);
            const construct = extractValue(node['memo:sysmlConstruct']) || deriveConstruct(name);

            let superClass: string | undefined;
            const subClassOf = node['rdfs:subClassOf'];
            if (subClassOf) {
                const superUri = typeof subClassOf === 'string' ? subClassOf :
                    (subClassOf['@id'] || '');
                const superName = extractLocalName(superUri);
                if (superName && !superName.startsWith('Layer_')) {
                    superClass = superName;
                }
            }

            classes.push({ uri: id, name, label, comment, superClass, layer, construct });
        }

        if (type === 'owl:ObjectProperty') {
            const label = extractValue(node['rdfs:label']) || name;
            const comment = extractValue(node['rdfs:comment']) || '';
            const layer = extractValue(node['memo:layer']) || 'crosscutting';
            const domain = node['rdfs:domain'] ? extractLocalName(
                typeof node['rdfs:domain'] === 'string' ? node['rdfs:domain'] : node['rdfs:domain']['@id'] || ''
            ) : undefined;
            const range = node['rdfs:range'] ? extractLocalName(
                typeof node['rdfs:range'] === 'string' ? node['rdfs:range'] : node['rdfs:range']['@id'] || ''
            ) : undefined;

            properties.push({ uri: id, name, label, comment, domain, range, layer });
        }
    }

    return {
        ontologyIri, version, title,
        classes, properties, warnings, errors,
        stats: { classes: classes.length, properties: properties.length, dataProperties: 0 },
    };
}

/**
 * Generate SysML v2 text from an OWL import result.
 * Produces ontology-style definitions (part def, connection def).
 */
export function owlResultToSysml(result: OwlImportResult, packageName: string): string {
    const lines: string[] = [];
    const indent = '    ';

    lines.push('');

    // Group classes by layer
    const byLayer = new Map<string, OwlClass[]>();
    for (const cls of result.classes) {
        const layer = cls.layer || 'unknown';
        if (!byLayer.has(layer)) byLayer.set(layer, []);
        byLayer.get(layer)!.push(cls);
    }

    for (const [layer, layerClasses] of byLayer) {
        lines.push(`${indent}// ── ${layer} layer ──`);
        for (const cls of layerClasses) {
            const construct = cls.construct || 'part def';
            const superClause = cls.superClass ? ` :> ${cls.superClass}` : '';
            lines.push(`${indent}${construct} ${cls.name}${superClause} {`);
            if (cls.comment) {
                lines.push(`${indent}${indent}doc /* ${escapeDoc(cls.comment)} */`);
            }
            lines.push(`${indent}}`);
            lines.push('');
        }
    }

    // Connection definitions for object properties
    if (result.properties.length > 0) {
        lines.push(`${indent}// ── Relationships ──`);
        for (const prop of result.properties) {
            const ends: string[] = [];
            if (prop.domain) ends.push(`end ${toCamelCase(prop.domain)} : ${prop.domain}[0..*];`);
            if (prop.range) ends.push(`end ${toCamelCase(prop.range)} : ${prop.range}[0..*];`);

            if (ends.length > 0) {
                lines.push(`${indent}connection def ${capitalizeFirst(prop.name)} {`);
                if (prop.comment) {
                    lines.push(`${indent}${indent}doc /* ${escapeDoc(prop.comment)} */`);
                }
                for (const end of ends) {
                    lines.push(`${indent}${indent}${end}`);
                }
                lines.push(`${indent}}`);
            } else {
                lines.push(`${indent}connection def ${capitalizeFirst(prop.name)} {`);
                if (prop.comment) {
                    lines.push(`${indent}${indent}doc /* ${escapeDoc(prop.comment)} */`);
                }
                lines.push(`${indent}}`);
            }
            lines.push('');
        }
    }

    return wrapPackage(packageName, lines).join('\n') + '\n';
}

/**
 * Generate a complete ontology package from OWL import result.
 * Returns a map of relative file paths → content.
 */
export function owlResultToPackage(
    result: OwlImportResult,
    packageName: string,
): Map<string, string> {
    const files = new Map<string, string>();

    // memo.package.yaml
    const pkgYaml = [
        `name: "${packageName}"`,
        `version: "${result.version || '0.1.0'}"`,
        `type: ontology`,
        `description: "${escapeString(result.title || `Imported from ${result.ontologyIri}`)}"`,
        `license: "Apache-2.0"`,
    ].join('\n') + '\n';
    files.set('memo.package.yaml', pkgYaml);

    // .project.json
    const projectJson = JSON.stringify({
        type: 'ontology-package',
        name: packageName,
        version: result.version || '0.1.0',
        usage: ['kinds', 'relationships'],
    }, null, 2) + '\n';
    files.set('.project.json', projectJson);

    // Group classes by layer → separate SysML files
    const byLayer = new Map<string, OwlClass[]>();
    for (const cls of result.classes) {
        const layer = cls.layer || 'unknown';
        if (!byLayer.has(layer)) byLayer.set(layer, []);
        byLayer.get(layer)!.push(cls);
    }

    for (const [layer, layerClasses] of byLayer) {
        const sysmlLines: string[] = [];
        const pkgName = `${toSysmlPackageName(packageName)}_${capitalizeFirst(layer)}`;
        sysmlLines.push('');

        for (const cls of layerClasses) {
            const construct = cls.construct || 'part def';
            const superClause = cls.superClass ? ` :> ${cls.superClass}` : '';
            sysmlLines.push(`    ${construct} ${cls.name}${superClause} {`);
            if (cls.comment) {
                sysmlLines.push(`        doc /* ${escapeDoc(cls.comment)} */`);
            }
            sysmlLines.push(`    }`);
            sysmlLines.push('');
        }

        files.set(`sysml/${layer}/${layer}.sysml`, wrapPackage(pkgName, sysmlLines).join('\n') + '\n');
    }

    // Relationships in crosscutting
    if (result.properties.length > 0) {
        const relLines: string[] = [];
        const relPkgName = `${toSysmlPackageName(packageName)}_Relationships`;
        relLines.push('');

        for (const prop of result.properties) {
            relLines.push(`    connection def ${capitalizeFirst(prop.name)} {`);
            if (prop.comment) {
                relLines.push(`        doc /* ${escapeDoc(prop.comment)} */`);
            }
            if (prop.domain) {
                relLines.push(`        end ${toCamelCase(prop.domain)} : ${prop.domain}[0..*];`);
            }
            if (prop.range) {
                relLines.push(`        end ${toCamelCase(prop.range)} : ${prop.range}[0..*];`);
            }
            relLines.push(`    }`);
            relLines.push('');
        }

        files.set('sysml/relationships/relationships.sysml', wrapPackage(relPkgName, relLines).join('\n') + '\n');
    }

    // Index.sysml
    const indexLines: string[] = [];
    const indexPkgName = toSysmlPackageName(packageName);
    for (const layer of byLayer.keys()) {
        indexLines.push(`    import ${indexPkgName}_${capitalizeFirst(layer)}::*;`);
    }
    if (result.properties.length > 0) {
        indexLines.push(`    import ${indexPkgName}_Relationships::*;`);
    }
    files.set('sysml/index.sysml', wrapPackage(indexPkgName, indexLines).join('\n') + '\n');

    return files;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function expandPrefix(prefix: string, localName: string, prefixes: Map<string, string>): string {
    const ns = prefixes.get(prefix);
    return ns ? `${ns}${localName}` : `${prefix}:${localName}`;
}

function extractLocalName(uri: string): string {
    if (!uri) return '';
    // Handle fragment (#Name) or slash (/Name) IRIs
    const hashIdx = uri.lastIndexOf('#');
    if (hashIdx >= 0) return uri.substring(hashIdx + 1);
    const slashIdx = uri.lastIndexOf('/');
    if (slashIdx >= 0) return uri.substring(slashIdx + 1);
    // Handle prefixed names (prefix:Name)
    const colonIdx = uri.lastIndexOf(':');
    if (colonIdx >= 0) return uri.substring(colonIdx + 1);
    return uri;
}

function extractStringProperty(body: string, property: string | RegExp): string {
    const propPattern = typeof property === 'string'
        ? property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : property.source;
    const regex = new RegExp(`${propPattern}\\s+"([^"]*)"`, 'g');
    const match = regex.exec(body);
    return match ? match[1] : '';
}

function normalizeType(type: string | string[] | undefined): string {
    if (!type) return '';
    if (Array.isArray(type)) return type[0] || '';
    return type;
}

function extractValue(v: any): string {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && '@value' in v) return String(v['@value']);
    return String(v);
}

function deriveLayerFromName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('hazard') || lower.includes('risk') || lower.includes('harm')) return 'risk';
    if (lower.includes('requirement') || lower.includes('need') || lower.includes('designinput')) return 'requirements';
    if (lower.includes('function') || lower.includes('action') || lower.includes('activity')) return 'functional';
    if (lower.includes('software') || lower.includes('soup')) return 'software';
    if (lower.includes('test') || lower.includes('verification')) return 'verification';
    if (lower.includes('stakeholder') || lower.includes('actor') || lower.includes('goal')) return 'purpose';
    if (lower.includes('interface') || lower.includes('port')) return 'interfaces';
    if (lower.includes('physical') || lower.includes('node') || lower.includes('hardware')) return 'physical';
    if (lower.includes('component') || lower.includes('subsystem') || lower.includes('logical')) return 'logical';
    if (lower.includes('clinical') || lower.includes('intendeduse')) return 'clinical';
    if (lower.includes('safety') || lower.includes('usability')) return 'safety';
    return 'logical';
}

function deriveConstruct(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('requirement') || lower.includes('need') || lower.includes('designinput') || lower.includes('designoutput')) {
        return 'requirement def';
    }
    if (lower.includes('function') || lower.includes('action') || lower.includes('activity') || lower.includes('process')) {
        return 'action def';
    }
    return 'part def';
}

function toSysmlPackageName(name: string): string {
    return name
        .replace(/^@/, '')
        .replace(/[\/-]/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .replace(/^(\d)/, '_$1') || 'Imported';
}

function toCamelCase(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
}

function capitalizeFirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeDoc(s: string): string {
    return s.replace(/\*\//g, '* /').replace(/\n/g, ' ');
}
