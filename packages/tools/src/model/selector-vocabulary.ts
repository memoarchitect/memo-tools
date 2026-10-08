// ─── Selector Vocabulary Check ───────────────────────────────────────────────
//
// A selector is a string in the model that NAMES part of the ontology's
// vocabulary: the kinds a view admits, the relationships it draws, the
// attribute a legend colours by. Every one of them is matched against the built
// model by name, and a name the ontology never declared matches nothing.
//
// Matching nothing is indistinguishable from having nothing to match. A view
// selecting `Supports` renders empty in a model with no supports relations and
// in a model with a thousand of them, because no such relation was ever
// declared — so the feature reads as "no data" everywhere and stays broken
// until someone happens to compare the selector against the ontology by hand.
// Measured twice on 2026-09-19 in Architect's Use Cases view: four undeclared
// names, every model rendering "No workflows".
//
// The registries already know every declared name, so the check costs a set
// lookup. It belongs at the point the project is built, not at the point a view
// is rendered, because the author is who can fix it.
//
// A name hardcoded in a CONSUMER's TypeScript is the other half, and a model-side
// check cannot see it: Architect's views select relationships through
// `relationshipsOfType` (relation-selection.ts), which reports an undeclared
// name when a view runs, and `architect-relation-literals.test.ts` checks every
// literal at those call sites against the resolved ontology. Kinds and
// attributes a consumer names are NOT covered by either.
//
// This covers selectors the MODEL authors, which is where the ontology's
// vocabulary is spelled out by people who are not reading the registry either.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from './semantic.js';
import type { KindRegistry } from './kind-registry.js';
import type { RelationshipRegistry } from './relationship-registry.js';
import { toModelType } from './naming.js';

/** Diagnostic code for a selector naming something the ontology never declared. */
export const SELECTOR_UNDECLARED_NAME = 'selector-undeclared-name';

/** Which registry a selector's names are drawn from. */
export type SelectorVocabulary = 'kind' | 'relationship' | 'attribute';

/**
 * Relationship types the BUILDER emits directly rather than from a
 * `connection def`, so the relationship registry does not list them.
 *
 * A view that selects `flow` is selecting something the model really contains;
 * checking it against the registry alone would report the correct spelling as
 * an error. They are enumerated here rather than inferred from the model
 * because the check must not depend on a project happening to contain one.
 */
export const BUILDER_NATIVE_RELATION_TYPES: readonly string[] = [
    // `connect` is what an UNTYPED `connection ... connect a to b` builds, so it
    // is the commonest of these and the one a view is most likely to select.
    // `interface` is what a typed `interface x : T connect a to b` builds.
    'connect', 'flow', 'bind', 'succession', 'variant', 'interface',
];

/** One selector attribute and the vocabulary its names come from. */
interface SelectorSpec {
    /** Attribute key as the builder stores it on the element. */
    attribute: string;
    vocabulary: SelectorVocabulary;
}

/**
 * The selectors this check knows about.
 *
 * `selectionQuery.includeElementIds` is absent on purpose: it names elements,
 * not vocabulary, and an unresolved one is already reported as an unresolved
 * reference. `selectionQuery.includeLayers` is absent because a layer is
 * derived from a source directory rather than declared, so there is no registry
 * to check it against.
 */
const SELECTORS: readonly SelectorSpec[] = [
    { attribute: 'selectionQuery.includeElementKinds', vocabulary: 'kind' },
    { attribute: 'selectionQuery.includeRelationshipKinds', vocabulary: 'relationship' },
    // ViewRule (viewpoints) and the methodology profiles' rules both spell a
    // type this way, as a comma-separated list.
    { attribute: 'elementTypeName', vocabulary: 'kind' },
    { attribute: 'relationTypeName', vocabulary: 'relationship' },
    // MemoLegend: one of the two names the key is built from.
    { attribute: 'attributeName', vocabulary: 'attribute' },
    // An `enum def` is registered as a kind, so the kind registry answers this.
    { attribute: 'enumerationName', vocabulary: 'kind' },
];

/** A selector naming something no registry declares. */
export interface SelectorVocabularyDiagnostic {
    code: typeof SELECTOR_UNDECLARED_NAME;
    /** Project-relative file declaring the element that carries the selector. */
    file: string;
    /** Element id of the view, rule or legend the selector is written on. */
    elementId: string;
    /** Attribute key the selector was read from. */
    selector: string;
    /** The offending name, as written. */
    name: string;
    vocabulary: SelectorVocabulary;
    /** Declared name this looks like a misspelling of, when one stands out. */
    suggestion?: string;
    message: string;
}

/** Registries the check reads. Both optional: an unresolved ontology checks nothing. */
export interface SelectorVocabularyRegistries {
    kindRegistry?: KindRegistry;
    relationshipRegistry?: RelationshipRegistry;
}

/**
 * A value the builder wrote for an attribute that was DECLARED and not given.
 *
 * `attribute elementTypeName : String;` in a `part def` records `<String>`, so
 * every definition of a selector-carrying type looks like a selector naming a
 * type called "String". That is the declaration, not a selector.
 */
function isUnvaluedDeclaration(raw: string): boolean {
    return /^<[^>]*>$/.test(raw);
}

function splitList(raw: string | undefined): string[] {
    if (!raw || isUnvaluedDeclaration(raw.trim())) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * The declared name a misspelling most likely meant.
 *
 * Two cheap rules, both drawn from the defects that prompted this: a difference
 * of case only (`Includes` for `includes`), and a declared name that extends
 * what was written (`Includes` for `includesStep`). Anything further apart gets
 * no suggestion rather than a guess — a wrong suggestion is read as an
 * instruction.
 */
function suggest(name: string, declared: readonly string[]): string | undefined {
    const lower = name.toLowerCase();
    const caseOnly = declared.find(d => d.toLowerCase() === lower);
    if (caseOnly) return caseOnly;
    const extension = declared.filter(d => d.toLowerCase().startsWith(lower));
    return extension.length === 1 ? extension[0] : undefined;
}

/**
 * Check every selector in the model against the registries.
 *
 * Returns one diagnostic per offending name. An empty result means every
 * selector names something declared — or that no ontology was resolved, in
 * which case there is nothing to check against and nothing is reported.
 */
export function checkSelectorVocabulary(
    model: MemoModel,
    registries?: SelectorVocabularyRegistries,
): SelectorVocabularyDiagnostic[] {
    const kindRegistry = registries?.kindRegistry;
    const relationshipRegistry = registries?.relationshipRegistry;
    const diagnostics: SelectorVocabularyDiagnostic[] = [];

    const declaredKinds = kindRegistry?.kindNames() ?? [];
    const declaredViewDefinitions = kindRegistry?.viewDefinitionNames() ?? [];
    const declaredRelations = [
        ...(relationshipRegistry?.relTypeNames() ?? []),
        ...BUILDER_NATIVE_RELATION_TYPES,
    ];
    const declaredAttributes = kindRegistry?.attributeNames() ?? [];
    const relationKeys = new Set(declaredRelations.map(toModelType));

    for (const element of model.elements.values()) {
        for (const spec of SELECTORS) {
            const names = splitList(element.attributes[spec.attribute]);
            for (const name of names) {
                const declared = isDeclared(name, spec.vocabulary);
                if (declared === undefined) continue; // no registry for this vocabulary
                if (declared) continue;
                diagnostics.push(diagnostic(element, spec, name));
            }
        }
    }
    return diagnostics;

    /** `undefined` when the registry that would answer was not supplied. */
    function isDeclared(name: string, vocabulary: SelectorVocabulary): boolean | undefined {
        switch (vocabulary) {
            case 'kind':
                if (!kindRegistry) return undefined;
                // A `view def` is declared vocabulary a selection query may
                // legitimately name, though it is not registered as a kind.
                return kindRegistry.has(name) || kindRegistry.hasViewDefinition(name);
            case 'relationship':
                // A selector spells a relation the way SOURCE does — `Composes`
                // for a connection def, `flow` for a keyword — and the model
                // keys them lowerCamelCase, so both sides normalize.
                return relationshipRegistry ? relationKeys.has(toModelType(name)) : undefined;
            case 'attribute':
                return kindRegistry ? kindRegistry.declaresAttribute(name) : undefined;
        }
    }

    function diagnostic(
        element: MemoElement, spec: SelectorSpec, name: string,
    ): SelectorVocabularyDiagnostic {
        const pool = spec.vocabulary === 'kind' ? [...declaredKinds, ...declaredViewDefinitions]
            : spec.vocabulary === 'relationship' ? declaredRelations
                : declaredAttributes;
        const suggestion = suggest(name, pool);
        const noun = spec.vocabulary === 'kind' ? 'kind or enumeration'
            : spec.vocabulary === 'relationship' ? 'relationship' : 'attribute';
        return {
            code: SELECTOR_UNDECLARED_NAME,
            file: element.file,
            elementId: element.id,
            selector: spec.attribute,
            name,
            vocabulary: spec.vocabulary,
            ...(suggestion ? { suggestion } : {}),
            message:
                `${element.id}: \`${spec.attribute}\` names "${name}", which no resolved `
                + `ontology declares as a ${noun}. The selector matches nothing, in every `
                + `model.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`
                + (name.includes('[')
                    ? ' A selector is a list of names: no reader parses a `[attribute=value]`'
                    + ' filter, so the brackets are part of the name being looked up.'
                    : ''),
        };
    }
}
