// ─── ReqIF requirements import ────────────────────────────────────────────────
//
// Reads an OMG ReqIF export (DOORS, Jama, Polarion and the others write it) into
// the same `CsvElement`s and links the CSV import produces, so one diff, one
// generator and one suspect-link computation serve every source.
//
// A SPEC-OBJECT is a record: its IDENTIFIER is the source id and its LAST-CHANGE
// is the revision the source states. A SPEC-RELATION is a trace between two
// records. Attribute definitions are read through their LONG-NAME, because the
// tool-specific IDENTIFIER of a definition says nothing.
//
// Regex scanning, like the Cameo importer: ReqIF's shape is fixed and shallow,
// and an XML dependency would ship to every install for one reader.
// ─────────────────────────────────────────────────────────────────────────────

import { contentRevision, deriveElementName, type CsvElement, type CsvParseResult } from '../serializer/csv-io.js';
import type { SourceLink } from './source-import.js';

export interface ReqIfOptions {
    /** The system the export came from. */
    system: string;
    /** The kind of a record whose type names none the ontology has. */
    defaultKind: string;
    /** The SysML usage keyword of a kind (`requirement`, `part`), from the ontology. */
    constructOf: (kind: string) => string;
    /** Kinds the ontology has, matched against a record type's LONG-NAME. */
    kinds?: ReadonlySet<string>;
    /** Whether the kind declares the attribute; routes the requirement text. */
    declaresAttribute?: (kind: string, attribute: string) => boolean;
    /** Relation names the ontology has, matched against a relation type's LONG-NAME. */
    relationTypes?: ReadonlySet<string>;
    /** The relation of a SPEC-RELATION whose type names none the ontology has. */
    defaultRelation?: string;
}

export interface ReqIfResult extends CsvParseResult<CsvElement> {
    links: SourceLink[];
}

const NAMES = /^(reqif\.)?(name|title|heading|chaptername|summary)$/i;
const TEXTS = /^(reqif\.)?(text|description|statement|content)$/i;

/** Decode the five predefined XML entities and numeric references. */
function decode(text: string): string {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** XHTML content as plain text: markup dropped, entities decoded, whitespace collapsed. */
function plain(xhtml: string): string {
    return decode(xhtml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const attr = (tag: string, name: string): string | undefined =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Every `<NAME …>…</NAME>` (or self-closing) in `xml`, as its opening tag and body. */
function blocks(xml: string, name: string): { tag: string; body: string }[] {
    const found: { tag: string; body: string }[] = [];
    const pattern = new RegExp(`<${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}>)`, 'g');
    for (let m = pattern.exec(xml); m; m = pattern.exec(xml)) found.push({ tag: m[0].slice(0, m[0].indexOf('>') + 1), body: m[2] ?? '' });
    return found;
}

/** `<NAME-REF>id</NAME-REF>` inside `xml`. */
const ref = (xml: string, name: string): string | undefined =>
    new RegExp(`<${name}-REF>([^<]*)</${name}-REF>`).exec(xml)?.[1]?.trim();

/** `Verification Method` → `verificationMethod`; `DerivesFrom` → `derivesFrom` (already camel: only the first letter moves). */
const camel = (text: string) => {
    const bare = text.replace(/^reqif\./i, '');
    return /[^A-Za-z0-9]/.test(bare) ? deriveElementName(bare) : bare.charAt(0).toLowerCase() + bare.slice(1);
};

export function parseReqIf(xml: string, options: ReqIfOptions): ReqIfResult {
    const items: CsvElement[] = [];
    const links: SourceLink[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!/<REQ-IF[\s>]/.test(xml)) {
        errors.push('Not a ReqIF document: no <REQ-IF> element');
        return { items, links, errors, warnings };
    }

    // Definition IDENTIFIER → LONG-NAME, and record type IDENTIFIER → LONG-NAME.
    const definitionName = new Map<string, string>();
    for (const type of blocks(xml, 'SPEC-OBJECT-TYPE')) {
        for (const tag of blocks(type.body, 'ATTRIBUTE-DEFINITION-[A-Z]+')) {
            const id = attr(tag.tag, 'IDENTIFIER');
            if (id) definitionName.set(id, attr(tag.tag, 'LONG-NAME') ?? id);
        }
    }
    const typeName = new Map<string, string>();
    for (const type of blocks(xml, 'SPEC-OBJECT-TYPE')) {
        const id = attr(type.tag, 'IDENTIFIER');
        if (id) typeName.set(id, attr(type.tag, 'LONG-NAME') ?? id);
    }
    const relationTypeName = new Map<string, string>();
    for (const type of blocks(xml, 'SPEC-RELATION-TYPE')) {
        const id = attr(type.tag, 'IDENTIFIER');
        if (id) relationTypeName.set(id, attr(type.tag, 'LONG-NAME') ?? id);
    }

    const objectSourceId = new Map<string, string>();
    const seen = new Set<string>();
    for (const object of blocks(xml, 'SPEC-OBJECT')) {
        const identifier = attr(object.tag, 'IDENTIFIER');
        if (!identifier) {
            errors.push('A SPEC-OBJECT has no IDENTIFIER');
            continue;
        }
        if (seen.has(identifier)) {
            errors.push(`duplicate IDENTIFIER '${identifier}'`);
            continue;
        }
        seen.add(identifier);
        objectSourceId.set(identifier, identifier);

        const recordType = typeName.get(ref(object.body, 'SPEC-OBJECT-TYPE') ?? '') ?? '';
        const kind = options.kinds?.has(recordType) ? recordType : options.defaultKind;

        let name = '';
        let text = '';
        const attributes: Record<string, string> = {};
        for (const value of blocks(object.body, 'ATTRIBUTE-VALUE-[A-Z]+')) {
            const definition = ref(value.body, 'ATTRIBUTE-DEFINITION-[A-Z]+');
            const label = definitionName.get(definition ?? '') ?? definition ?? '';
            const raw = attr(value.tag, 'THE-VALUE')
                ?? /<THE-VALUE>([\s\S]*?)<\/THE-VALUE>/.exec(value.body)?.[1] ?? '';
            const content = /^ATTRIBUTE-VALUE-XHTML/.test(value.tag.slice(1)) ? plain(raw) : decode(raw).trim();
            if (!content) continue;
            if (NAMES.test(label)) name = content;
            else if (TEXTS.test(label)) text = content;
            else attributes[camel(label)] = content;
        }

        // The requirement text is the kind's `statement` where it declares one, and prose otherwise.
        let doc = '';
        if (text) {
            if (options.declaresAttribute?.(kind, 'statement')) attributes['statement'] = text;
            else doc = text;
        }
        const element: CsvElement = {
            id: deriveElementName(identifier),
            name: name || identifier,
            kind,
            construct: options.constructOf(kind),
            doc,
            attributes,
        };
        element.source = {
            system: options.system,
            identifier,
            revision: attr(object.tag, 'LAST-CHANGE') ?? contentRevision(element),
            mastered: true,
        };
        items.push(element);
    }

    for (const relation of blocks(xml, 'SPEC-RELATION')) {
        const from = ref(relation.body.slice(relation.body.indexOf('<SOURCE')), 'SPEC-OBJECT');
        const to = ref(relation.body.slice(relation.body.indexOf('<TARGET')), 'SPEC-OBJECT');
        const label = relationTypeName.get(ref(relation.body, 'SPEC-RELATION-TYPE') ?? '') ?? '';
        const type = options.relationTypes?.has(camel(label)) ? camel(label) : options.defaultRelation;
        if (!from || !to) {
            warnings.push(`SPEC-RELATION ${attr(relation.tag, 'IDENTIFIER') ?? ''} has no source or target`);
            continue;
        }
        if (!type) {
            warnings.push(`SPEC-RELATION ${attr(relation.tag, 'IDENTIFIER') ?? ''}: type '${label}' is not a relationship the ontology has`);
            continue;
        }
        links.push({ fromId: from, toId: to, type });
    }

    return { items, links, errors, warnings };
}
