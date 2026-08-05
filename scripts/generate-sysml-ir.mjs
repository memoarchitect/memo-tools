#!/usr/bin/env node
// ─── Ecore → TypeScript metamodel emitter (Track B B2) ───────────────────────
//
// Input is `SysML.ecore` alone. Never `kerml.ecore`: Session 0 measured the
// SysML file to be a self-contained superset of it — all 82 KerML metaclasses,
// identical supertypes, plus the OCL bodies the KerML file lacks entirely — so
// feeding both would emit 82 duplicate metaclasses (plan §1.5.1 rule 1).
//
// What is emitted, and what deliberately is not.
//
//   Emitted: every metaclass as an interface with its supertypes, every enum,
//   every structural feature with its type, multiplicity, containment-vs-
//   reference and opposite, the `subsets`/`redefines`/`union` annotations as
//   metadata, and every operation's signature. Derived features are emitted as
//   *declarations only*, carrying their spec OCL clause verbatim as a comment.
//
//   Not emitted: derivation bodies. The `.ecore`'s OCL is spec prose in a code
//   font — it has typos (`exist`, `exits`, `refrencedFeature`,
//   `OrderedSet(Types)`), unlabelled assignments, and empty bodies at seven
//   load-bearing operations. Translating it automatically would encode those
//   defects as behaviour. The clause is a citation for a hand-written
//   implementation in the resolution core, never its source (plan §1.5.1
//   rule 2).
//
//   Also not emitted: reverse references synthesised from the 280
//   `Property.oppositeRoleName` annotations. Only the 70 real `eOpposite` pairs
//   are navigable; inventing the rest would give MEMO 280 features the
//   reference implementation does not have (plan §1.5.1 rule 3).
//
// The generated file is committed. `--check` re-runs the emitter and fails if
// the committed output differs, so a hand-edit or an unrecorded input change is
// a red build rather than a silent divergence.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SOURCE = resolve(root, 'packages/tools/ecore/SysML.ecore');

/**
 * Two outputs, because they have two audiences.
 *
 * `sysml-metamodel.ts` is the structural metamodel: types, multiplicity,
 * containment, opposites. Anything may import it, including the web bundle.
 *
 * `sysml-derivations.ts` is the specification OCL — 225 feature clauses and 63
 * operation bodies. It is B3's input and nothing else's, and it roughly doubles
 * the emitted JavaScript, so it is kept out of the module every consumer
 * reaches for by default. The OCL still appears beside each declaration as a
 * doc comment in the metamodel file; comments do not survive to the bundle.
 */
const OUTPUT = resolve(root, 'packages/tools/src/sysml-ir/generated/sysml-metamodel.ts');
const DERIVATIONS_OUTPUT = resolve(root, 'packages/tools/src/sysml-ir/generated/sysml-derivations.ts');

/** Pinned input, per plan §4.1 B2. A different file is a different metamodel. */
const PROVENANCE = {
    release: '2026-05',
    commit: 'fa709f2',
    sha256: '7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0',
};

/**
 * Expected shape of the input, measured in Session 0
 * (`memo-ecore-measurement.md`). These are not decoration: a regex that stops
 * matching, or an upstream file swapped in behind the same name, shows up here
 * as a count that moved rather than as a quietly smaller metamodel.
 */
const EXPECTED = {
    metaclasses: 175,
    enums: 7,
    features: 415,
    derived: 328,
    opposites: 70,
    operations: 70,
    subsets: 190,
    redefines: 119,
    union: 1,
    /** Derived features carrying an explicit `name = <OCL>` clause. */
    derivations: 225,
};

// ─── A small Ecore reader ────────────────────────────────────────────────────
//
// Same reasoning as `conformance/xmi.ts`: EMF's output is regular — elements,
// attributes and nesting, no mixed content, no CDATA, no comments — so a
// single-pass scanner reads it exactly and costs nothing. What this needs that
// the flat XMI scanner does not is the containment tree, because annotations
// nest inside features which nest inside classifiers.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(raw) {
    return raw.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (match, body) => {
        if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
        if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
        return ENTITIES[body] ?? match;
    });
}

/** End of the tag opened at `start`, skipping `>` inside a quoted value. */
function endOfTag(text, start) {
    let quote;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (char === quote) quote = undefined;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return index;
        }
    }
    return -1;
}

function attributesOf(raw) {
    const out = {};
    for (const match of raw.matchAll(/([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g)) {
        out[match[1]] = decodeEntities(match[2]);
    }
    return out;
}

/** Parse into `{ tag, attrs, children }` nodes. */
function parseXml(text) {
    const rootNode = { tag: '#document', attrs: {}, children: [] };
    const stack = [rootNode];
    let index = 0;
    while (index < text.length) {
        const start = text.indexOf('<', index);
        if (start < 0) break;
        if (text.startsWith('<?', start) || text.startsWith('<!', start)) {
            const close = text.indexOf('>', start);
            if (close < 0) throw new Error(`unterminated declaration at byte ${start}`);
            index = close + 1;
            continue;
        }
        const close = endOfTag(text, start);
        if (close < 0) throw new Error(`unterminated tag at byte ${start}`);
        const body = text.slice(start + 1, close);
        index = close + 1;
        if (body.startsWith('/')) {
            if (stack.length === 1) throw new Error(`closing tag with nothing open at byte ${start}`);
            stack.pop();
            continue;
        }
        const selfClosing = body.endsWith('/');
        const inner = selfClosing ? body.slice(0, -1) : body;
        const space = inner.search(/\s/);
        const node = {
            tag: space < 0 ? inner : inner.slice(0, space),
            attrs: space < 0 ? {} : attributesOf(inner.slice(space)),
            children: [],
        };
        stack[stack.length - 1].children.push(node);
        if (!selfClosing) stack.push(node);
    }
    if (stack.length !== 1) throw new Error(`${stack.length - 1} unclosed element(s)`);
    return rootNode;
}

const childrenNamed = (node, tag) => node.children.filter(child => child.tag === tag);
const xsiType = node => node.attrs['xsi:type'] ?? '';

// ─── Reading the derivations out of the class documentation ──────────────────
//
// The OCL is not on the feature. It sits in the *class's* GenModel
// documentation, whose tail — after the HTML prose — is the spec clause, with
// per-feature assignments (`payloadArgument = argument(1)`) interleaved with
// the class's constraints. This is the same extraction Session 0 measured, kept
// deliberately identical so the emitted count can be checked against its 225.

const HTML_LINE = /<\/?(p|code|em|ul|ol|li|pre|b|i|br|blockquote|table|tr|td|th|sub|sup|h[1-6])\b[^>]*>/;
const ASSIGNMENT = /^\s*([A-Za-z][A-Za-z0-9]*)\s*=(?!=)/;

function documentationOf(node) {
    for (const annotation of childrenNamed(node, 'eAnnotations')) {
        if (!(annotation.attrs.source ?? '').endsWith('GenModel')) continue;
        for (const detail of childrenNamed(annotation, 'details')) {
            if (detail.attrs.key === 'documentation') return detail.attrs.value ?? '';
        }
    }
    return '';
}

/**
 * Prose is HTML-tagged, one paragraph per line; OCL lines carry no tags.
 * Splitting on the last `</p>` is unreliable — several classes (`ViewUsage`,
 * `Import`) leave a `<p>` unclosed.
 */
function stripProse(documentation) {
    return documentation.split('\n').filter(line => !HTML_LINE.test(line)).join('\n');
}

/** A statement runs from a column-0 line to the next one; continuations indent. */
function splitStatements(ocl) {
    const statements = [];
    let current = [];
    for (const line of ocl.split('\n')) {
        if (!line.trim()) continue;
        if (!/^[ \t]/.test(line) && current.length > 0) {
            statements.push(current.join('\n'));
            current = [line];
        } else {
            current.push(line);
        }
    }
    if (current.length > 0) statements.push(current.join('\n'));
    return statements;
}

/** `{ featureName: 'featureName = <ocl>' }` for one class. */
function derivationsOf(classNode) {
    const byName = {};
    for (const statement of splitStatements(stripProse(documentationOf(classNode)))) {
        const match = ASSIGNMENT.exec(statement);
        if (match && !(match[1] in byName)) byName[match[1]] = statement.trim();
    }
    return byName;
}

/** An operation's body is its whole documentation tail; seven have none. */
function operationBodyOf(operationNode) {
    const body = stripProse(documentationOf(operationNode)).trim();
    return !body || body.toLowerCase().startsWith('no ocl') ? undefined : body;
}

// ─── Type mapping ────────────────────────────────────────────────────────────

const SCALARS = {
    EString: 'string', EBoolean: 'boolean', EInt: 'number', EInteger: 'number',
    EDouble: 'number', EFloat: 'number', ELong: 'number', EShort: 'number',
    EByte: 'number', EChar: 'string', EBigInteger: 'number', EBigDecimal: 'number',
    EJavaObject: 'unknown', EDate: 'string',
};

/** `#//Type` and `…Ecore#//EBoolean` both reduce to their last segment. */
function typeNameOf(reference) {
    if (!reference) return undefined;
    const segments = reference.includes('#//') ? reference.split('#//').pop() : reference.split('//').pop();
    return segments.split('/').pop();
}

/** `default` is a reserved word in a TypeScript member position in practice. */
const RESERVED = { default: 'defaultValue' };

// ─── Emission ────────────────────────────────────────────────────────────────

const quote = value => JSON.stringify(value);

// A doc comment, with any comment-terminating sequence inside the text
// neutralised — several OCL clauses contain one.
function docComment(lines, indent) {
    const safe = lines.flatMap(line => line.split('\n')).map(line => line.replace(/\*\//g, '*​/'));
    if (safe.length === 1) return `${indent}/** ${safe[0]} */`;
    return [`${indent}/**`, ...safe.map(line => `${indent} * ${line}`.trimEnd()), `${indent} */`].join('\n');
}

function multiplicityOf(feature) {
    const upper = feature.upperBound === -1 ? '*' : String(feature.upperBound);
    return `${feature.lowerBound}..${upper}`;
}

/** One feature's doc comment: what it is, how many, and where it came from. */
function featureDoc(feature) {
    const lines = [];
    const shape = feature.kind === 'attribute' ? 'Attribute' : feature.containment ? 'Containment' : 'Reference';
    const flags = [
        `${shape} ${multiplicityOf(feature)}`,
        feature.ordered ? 'ordered' : undefined,
        feature.derived ? 'derived' : undefined,
        feature.volatile && !feature.derived ? 'volatile' : undefined,
    ].filter(Boolean);
    lines.push(`${flags.join(', ')}.`);
    if (feature.opposite) lines.push(`Opposite: \`${feature.opposite}\`.`);
    if (feature.subsets.length > 0) lines.push(`Subsets: ${feature.subsets.map(name => `\`${name}\``).join(', ')}.`);
    if (feature.redefines.length > 0) lines.push(`Redefines: ${feature.redefines.map(name => `\`${name}\``).join(', ')}.`);
    if (feature.union) lines.push('Derived union.');
    if (feature.derived) {
        lines.push('');
        if (feature.derivation) {
            // Verbatim, never translated — this is the citation the resolution
            // core implements against (plan §1.5.1 rule 2).
            lines.push('Specification OCL, verbatim from SysML.ecore:', '```ocl', feature.derivation, '```');
        } else if (feature.subsets.length > 0 || feature.redefines.length > 0 || feature.union) {
            lines.push('No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.');
        } else {
            lines.push('No OCL clause and no derivation annotation: must be read out of the specification text.');
        }
        lines.push('Resolved by the hand-written resolution core, never by a generated body.');
    }
    return lines;
}

function emitInterface(metaclass) {
    const heading = docComment([
        `\`${metaclass.name}\`${metaclass.abstract ? ' (abstract)' : ''}.`,
        metaclass.superTypes.length > 0 ? `Generalizes: ${metaclass.superTypes.map(name => `\`${name}\``).join(', ')}.` : 'Root metaclass.',
    ], '');
    const members = metaclass.features.map(feature => {
        const optional = feature.lowerBound === 0 || feature.derived ? '?' : '';
        const type = `${feature.tsType}${feature.many ? '[]' : ''}`;
        return `${docComment(featureDoc(feature), '    ')}\n    ${feature.derived ? 'readonly ' : ''}${feature.name}${optional}: ${type};`;
    });
    const extendsClause = metaclass.superTypes.length > 0 ? ` extends ${metaclass.superTypes.join(', ')}` : '';
    // A metaclass that adds no features of its own is a real thing in this
    // metamodel — `AssociationStructure` exists to combine two supertypes.
    const body = members.length > 0 ? ` {\n${members.join('\n')}\n}` : ' {}';
    return `${heading}\nexport interface ${metaclass.name}${extendsClause}${body}`;
}

function emitEnum(enumeration) {
    const union = enumeration.literals.map(quote).join(' | ') || 'string';
    return [
        docComment([`\`${enumeration.name}\` enumeration.`], ''),
        `export type ${enumeration.name} = ${union};`,
        `export const ${enumeration.constName}: readonly ${enumeration.name}[] = [${enumeration.literals.map(quote).join(', ')}];`,
    ].join('\n');
}

function build() {
    const xml = readFileSync(SOURCE, 'utf8');
    const sha256 = createHash('sha256').update(xml).digest('hex');
    if (sha256 !== PROVENANCE.sha256) {
        throw new Error(
            `SysML.ecore SHA-256 is ${sha256}, expected ${PROVENANCE.sha256}. `
            + 'The pinned metamodel changed: re-pin it deliberately (plan §4.1 B2) rather than regenerating against an unrecorded input.',
        );
    }

    const document = parseXml(xml);
    const ePackage = document.children.find(child => child.tag.endsWith('EPackage'));
    if (!ePackage) throw new Error('no EPackage in SysML.ecore');
    const classifiers = childrenNamed(ePackage, 'eClassifiers');

    const enums = classifiers.filter(node => xsiType(node).endsWith('EEnum')).map(node => ({
        name: node.attrs.name,
        constName: `${node.attrs.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_LITERALS`,
        literals: childrenNamed(node, 'eLiterals').map(literal => literal.attrs.name).filter(Boolean),
    }));
    const enumNames = new Set(enums.map(item => item.name));

    const metaclasses = [];
    for (const node of classifiers.filter(candidate => xsiType(candidate).endsWith('EClass'))) {
        const derivations = derivationsOf(node);
        const features = childrenNamed(node, 'eStructuralFeatures').map(featureNode => {
            const attrs = featureNode.attrs;
            const ecoreName = attrs.name;
            const typeName = typeNameOf(attrs.eType) ?? 'unknown';
            const annotationRefs = source => childrenNamed(featureNode, 'eAnnotations')
                .filter(annotation => annotation.attrs.source === source)
                .flatMap(annotation => (annotation.attrs.references ?? '').split(/\s+/).filter(Boolean))
                .map(reference => reference.replace(/^#\/\//, ''));
            const upperBound = Number(attrs.upperBound ?? '1');
            return {
                name: RESERVED[ecoreName] ?? ecoreName,
                ecoreName,
                kind: xsiType(featureNode).endsWith('EAttribute') ? 'attribute' : 'reference',
                type: typeName,
                tsType: SCALARS[typeName] ?? (enumNames.has(typeName) ? typeName : typeName),
                lowerBound: Number(attrs.lowerBound ?? '0'),
                upperBound,
                many: upperBound !== 1,
                ordered: attrs.ordered !== 'false',
                containment: attrs.containment === 'true',
                derived: attrs.derived === 'true',
                volatile: attrs.volatile === 'true',
                transient: attrs.transient === 'true',
                opposite: attrs.eOpposite ? attrs.eOpposite.replace(/^#\/\//, '') : undefined,
                subsets: annotationRefs('subsets'),
                redefines: annotationRefs('redefines'),
                union: childrenNamed(featureNode, 'eAnnotations').some(annotation => annotation.attrs.source === 'union'),
                derivation: attrs.derived === 'true' || attrs.volatile === 'true' ? derivations[ecoreName] : undefined,
            };
        });
        const operations = childrenNamed(node, 'eOperations').map(operationNode => ({
            name: operationNode.attrs.name,
            type: SCALARS[typeNameOf(operationNode.attrs.eType) ?? ''] ?? typeNameOf(operationNode.attrs.eType) ?? 'void',
            lowerBound: Number(operationNode.attrs.lowerBound ?? '0'),
            upperBound: Number(operationNode.attrs.upperBound ?? '1'),
            parameters: childrenNamed(operationNode, 'eParameters').map(parameter => ({
                name: parameter.attrs.name,
                type: SCALARS[typeNameOf(parameter.attrs.eType) ?? ''] ?? typeNameOf(parameter.attrs.eType) ?? 'unknown',
                many: Number(parameter.attrs.upperBound ?? '1') !== 1,
            })),
            body: operationBodyOf(operationNode),
        }));
        metaclasses.push({
            name: node.attrs.name,
            abstract: node.attrs.abstract === 'true',
            superTypes: (node.attrs.eSuperTypes ?? '').split(/\s+/).filter(Boolean).map(typeNameOf),
            features,
            operations,
        });
    }

    verify(metaclasses, enums);
    return { sha256, metaclasses, enums };
}

/**
 * Structural checks that must hold of any input we are willing to emit.
 *
 * The opposite check is the one that earns its keep: `eOpposite` pairs are the
 * only bidirectional navigation in the metamodel, and a pair that points at a
 * feature which does not point back is a silently one-way reference — the kind
 * of defect that surfaces much later, as a traversal that returns nothing.
 */
function verify(metaclasses, enums) {
    const byName = new Map(metaclasses.map(metaclass => [metaclass.name, metaclass]));
    const features = metaclasses.flatMap(metaclass => metaclass.features.map(feature => ({ metaclass, feature })));
    const problems = [];

    for (const metaclass of metaclasses) {
        for (const superType of metaclass.superTypes) {
            if (!byName.has(superType)) problems.push(`${metaclass.name} generalizes unknown ${superType}`);
        }
    }

    let opposites = 0;
    for (const { metaclass, feature } of features) {
        if (!feature.opposite) continue;
        opposites += 1;
        const [ownerName, featureName] = feature.opposite.split('/');
        const target = byName.get(ownerName)?.features.find(candidate => candidate.ecoreName === featureName);
        if (!target) {
            problems.push(`${metaclass.name}.${feature.ecoreName} names a missing opposite ${feature.opposite}`);
        } else if (target.opposite !== `${metaclass.name}/${feature.ecoreName}`) {
            problems.push(`${metaclass.name}.${feature.ecoreName} opposite ${feature.opposite} does not point back`);
        }
    }

    for (const { metaclass, feature } of features) {
        for (const reference of [...feature.subsets, ...feature.redefines]) {
            const [ownerName, featureName] = reference.split('/');
            if (!byName.get(ownerName)?.features.some(candidate => candidate.ecoreName === featureName)) {
                problems.push(`${metaclass.name}.${feature.ecoreName} subsets/redefines missing ${reference}`);
            }
        }
    }

    const actual = {
        metaclasses: metaclasses.length,
        enums: enums.length,
        features: features.length,
        derived: features.filter(({ feature }) => feature.derived || feature.volatile).length,
        opposites,
        operations: metaclasses.reduce((total, metaclass) => total + metaclass.operations.length, 0),
        subsets: features.filter(({ feature }) => feature.subsets.length > 0).length,
        redefines: features.filter(({ feature }) => feature.redefines.length > 0).length,
        union: features.filter(({ feature }) => feature.union).length,
        derivations: features.filter(({ feature }) => feature.derivation).length,
    };
    for (const [key, expected] of Object.entries(EXPECTED)) {
        if (actual[key] !== expected) problems.push(`${key}: emitted ${actual[key]}, Session 0 measured ${expected}`);
    }

    if (problems.length > 0) {
        throw new Error(`SysML.ecore did not read as expected:\n  ${problems.join('\n  ')}`);
    }
    return actual;
}

function render({ sha256, metaclasses, enums }) {
    const featureRecords = metaclasses.map(metaclass => {
        const entries = metaclass.features.map(feature => `        ${quote(feature.name)}: ${quote({
            name: feature.name,
            ecoreName: feature.ecoreName,
            kind: feature.kind,
            type: feature.type,
            lowerBound: feature.lowerBound,
            upperBound: feature.upperBound,
            many: feature.many,
            ordered: feature.ordered,
            containment: feature.containment,
            derived: feature.derived,
            volatile: feature.volatile,
            ...(feature.opposite ? { opposite: feature.opposite } : {}),
            ...(feature.subsets.length > 0 ? { subsets: feature.subsets } : {}),
            ...(feature.redefines.length > 0 ? { redefines: feature.redefines } : {}),
            ...(feature.union ? { union: true } : {}),
            ...(feature.derivation ? { hasDerivation: true } : {}),
        })},`);
        const operations = metaclass.operations.map(operation => `        ${quote({
            name: operation.name,
            type: operation.type,
            lowerBound: operation.lowerBound,
            upperBound: operation.upperBound,
            parameters: operation.parameters,
            ...(operation.body ? { hasBody: true } : {}),
        })},`);
        return [
            `    ${quote(metaclass.name)}: {`,
            `        name: ${quote(metaclass.name)},`,
            `        abstract: ${metaclass.abstract},`,
            `        superTypes: ${quote(metaclass.superTypes)},`,
            '        features: {',
            ...entries,
            '        },',
            operations.length > 0 ? `        operations: [\n${operations.join('\n')}\n        ],` : '        operations: [],',
            '    },',
        ].join('\n');
    });

    return `// GENERATED from SysML.ecore by scripts/generate-sysml-ir.mjs. DO NOT EDIT.
//
// Source: OMG SysML v2 Pilot Implementation, release ${PROVENANCE.release}, commit ${PROVENANCE.commit}.
// SHA-256: ${sha256}
//
// Derived features are declarations only. Their specification OCL is reproduced
// verbatim in the doc comment as a citation; the computation lives in the
// hand-written resolution core (plan §1.5.1 rule 2, §4.1 B3).

export const SYSML_ECORE_SHA256 = ${quote(sha256)};
export const SYSML_ECORE_RELEASE = ${quote(PROVENANCE.release)};
export const SYSML_ECORE_COMMIT = ${quote(PROVENANCE.commit)};

// ─── Enumerations ───────────────────────────────────────────────────────────

${enums.map(emitEnum).join('\n\n')}

// ─── Metaclasses ────────────────────────────────────────────────────────────

${metaclasses.map(emitInterface).join('\n\n')}

// ─── Reflective metadata ────────────────────────────────────────────────────
//
// The same metamodel as data, for code that must reason about features it was
// not written against — the resolution core, the lowering pass, and any tool
// that walks a metaclass it does not have a TypeScript name for.

/** Whether a feature holds a value, or points at another element. */
export type FeatureKind = 'attribute' | 'reference';

export interface FeatureDescriptor {
    /** Name as emitted on the interface. */
    name: string;
    /** Name in SysML.ecore; differs from \`name\` only where it is reserved. */
    ecoreName: string;
    kind: FeatureKind;
    /** Metaclass, enum or Ecore primitive name of the value. */
    type: string;
    lowerBound: number;
    /** \`-1\` for unbounded. */
    upperBound: number;
    many: boolean;
    ordered: boolean;
    /** True where the value is owned rather than referenced. */
    containment: boolean;
    derived: boolean;
    volatile: boolean;
    /** \`Metaclass/feature\` of the navigable inverse, for the 70 real pairs. */
    opposite?: string;
    /** \`Metaclass/feature\` references from the \`subsets\` annotation. */
    subsets?: string[];
    /** \`Metaclass/feature\` references from the \`redefines\` annotation. */
    redefines?: string[];
    /** Set on the single derived union, \`Namespace::membership\`. */
    union?: true;
    /**
     * Set where the metamodel states an OCL derivation for this feature.
     *
     * The clause itself is in \`generated/sysml-derivations.ts\` — it is B3's
     * input, it is large, and no consumer of the structural metamodel needs it.
     */
    hasDerivation?: true;
}

export interface OperationParameterDescriptor { name: string; type: string; many: boolean; }

export interface OperationDescriptor {
    name: string;
    type: string;
    lowerBound: number;
    upperBound: number;
    parameters: OperationParameterDescriptor[];
    /** Set where the metamodel states an OCL body; absent for the seven without. */
    hasBody?: true;
}

export interface MetaclassDescriptor {
    name: string;
    abstract: boolean;
    superTypes: string[];
    features: Record<string, FeatureDescriptor>;
    operations: OperationDescriptor[];
}

export const SYSML_METACLASSES: Record<string, MetaclassDescriptor> = {
${featureRecords.join('\n')}
};

/** Every metaclass name, in metamodel order. */
export const SYSML_METACLASS_NAMES: readonly string[] = Object.keys(SYSML_METACLASSES);

/**
 * Declared features of one metaclass, excluding inherited ones.
 *
 * Kept as a function rather than a second table so there is exactly one place
 * the generated shape is read from.
 */
export function declaredFeatures(metaclass: string): FeatureDescriptor[] {
    return Object.values(SYSML_METACLASSES[metaclass]?.features ?? {});
}

/** Declared and inherited features, nearest declaration winning on name. */
export function allFeatures(metaclass: string): FeatureDescriptor[] {
    const seen = new Map<string, FeatureDescriptor>();
    const visit = (name: string): void => {
        const descriptor = SYSML_METACLASSES[name];
        if (!descriptor) return;
        for (const feature of Object.values(descriptor.features)) {
            if (!seen.has(feature.name)) seen.set(feature.name, feature);
        }
        for (const superType of descriptor.superTypes) visit(superType);
    };
    visit(metaclass);
    return [...seen.values()];
}

/** Transitive supertypes of \`metaclass\`, nearest first, excluding itself. */
export function allSuperTypes(metaclass: string): string[] {
    const out: string[] = [];
    const queue = [...(SYSML_METACLASSES[metaclass]?.superTypes ?? [])];
    while (queue.length > 0) {
        const name = queue.shift() as string;
        if (out.includes(name)) continue;
        out.push(name);
        queue.push(...(SYSML_METACLASSES[name]?.superTypes ?? []));
    }
    return out;
}

/** Whether \`metaclass\` is, or specializes, \`superType\`. */
export function conformsTo(metaclass: string, superType: string): boolean {
    return metaclass === superType || allSuperTypes(metaclass).includes(superType);
}

/** Counts asserted by the emitter against Session 0's measurement. */
export const SYSML_METAMODEL_COUNTS = ${quote(EXPECTED)} as const;
`;
}

/** The specification OCL, keyed `Metaclass/feature` and `Metaclass::operation`. */
function renderDerivations({ metaclasses }) {
    const features = [];
    const operations = [];
    for (const metaclass of metaclasses) {
        for (const feature of metaclass.features) {
            if (feature.derivation) features.push(`    ${quote(`${metaclass.name}/${feature.ecoreName}`)}: ${quote(feature.derivation)},`);
        }
        for (const operation of metaclass.operations) {
            if (operation.body) operations.push(`    ${quote(`${metaclass.name}::${operation.name}`)}: ${quote(operation.body)},`);
        }
    }
    return `// GENERATED from SysML.ecore by scripts/generate-sysml-ir.mjs. DO NOT EDIT.
//
// The specification OCL, verbatim, from release ${PROVENANCE.release} commit ${PROVENANCE.commit}.
//
// This is a **citation index, not an implementation**. The OCL here is spec
// prose in a code font: it carries typos, unlabelled assignments, and empty
// bodies at seven load-bearing operations. Nothing translates it automatically
// (plan §1.5.1 rule 2) — the resolution core implements each clause by hand and
// quotes it, and this module is what it quotes from.
//
// Kept out of \`sysml-metamodel.ts\` on purpose: it is roughly the same size
// again as the structural metamodel, and only the resolution core reads it.

/** Feature derivations, keyed \`Metaclass/feature\`. */
export const SYSML_FEATURE_DERIVATIONS: Record<string, string> = {
${features.join('\n')}
};

/** Operation bodies, keyed \`Metaclass::operation\`. */
export const SYSML_OPERATION_BODIES: Record<string, string> = {
${operations.join('\n')}
};

/** The clause a derived feature is implemented against, if the metamodel states one. */
export function derivationOf(metaclass: string, feature: string): string | undefined {
    return SYSML_FEATURE_DERIVATIONS[\`\${metaclass}/\${feature}\`];
}

/** The clause an operation is implemented against, if the metamodel states one. */
export function operationBodyOf(metaclass: string, operation: string): string | undefined {
    return SYSML_OPERATION_BODIES[\`\${metaclass}::\${operation}\`];
}
`;
}

const model = build();
const outputs = [
    [OUTPUT, render(model)],
    [DERIVATIONS_OUTPUT, renderDerivations(model)],
];
if (process.argv.includes('--check')) {
    for (const [path, generated] of outputs) {
        if (readFileSync(path, 'utf8') !== generated) {
            throw new Error(
                `Generated ${path.split('/').pop()} is stale or hand-edited. `
                + 'Run `pnpm generate:ir` and commit the result.',
            );
        }
    }
} else {
    for (const [path, generated] of outputs) writeFileSync(path, generated);
}
