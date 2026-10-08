// ─── Selecting relationships by type, checked ────────────────────────────────
//
// A consumer that picks relationships out of a model by a type it spells in its
// own source (`'includesStep'`, `'mitigates'`) has no way to tell a type the
// ontology never declared from a type the model happens to have none of: both
// select nothing. A view naming such a type renders empty in every model, and
// stays that way until somebody compares the literal with the ontology by hand.
// It happened twice in Architect's Use Cases view (`Supports` and `Includes`,
// neither declared), each time as "No workflows" on every model.
//
// `checkSelectorVocabulary` makes that check for the selectors a MODEL authors.
// This is the same check for the names a CONSUMER writes: select through
// `relationshipsOfType`, which compares each name with the registries the model
// carries and says so, loudly, when one is not declared. The same declaredness
// test is `undeclaredRelationshipTypes`, so a source check can run it over the
// literals of every call site without a model.
//
// Browser-safe: no filesystem, no parser.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO, MemoRelationship } from './semantic.js';
import { BUILDER_NATIVE_RELATION_TYPES } from './selector-vocabulary.js';
import { toModelType } from './naming.js';

/** The names that are not relationship types the ontology declares, each with the declared name it most likely meant. */
export interface UndeclaredRelationshipType {
    name: string;
    suggestion?: string;
}

/**
 * Which of `names` are not declared relationship types.
 *
 * `declared` is the registry's names (camelCase keys or PascalCase definition
 * names, either); the types the builder emits without a `connection def`
 * (`flow`, `bind`, ...) are always declared. A name is compared the way source
 * spells it, through `toModelType`.
 */
export function undeclaredRelationshipTypes(
    names: readonly string[],
    declared: Iterable<string>,
): UndeclaredRelationshipType[] {
    const keys = new Set([...declared, ...BUILDER_NATIVE_RELATION_TYPES].map(toModelType));
    const lowered = new Map([...keys].map(key => [key.toLowerCase(), key] as const));
    return names.filter(name => !keys.has(toModelType(name))).map(name => {
        const lower = name.toLowerCase();
        const caseOnly = lowered.get(lower);
        const extending = [...keys].filter(key => key.toLowerCase().startsWith(lower));
        const suggestion = caseOnly ?? (extending.length === 1 ? extending[0] : undefined);
        return suggestion ? { name, suggestion } : { name };
    });
}

/** Names already reported, so a view re-rendering does not repeat itself. */
const reported = new Set<string>();

/**
 * The model's relationships of the given types.
 *
 * A name no registry declares selects nothing, as it always did, but it is
 * reported on the console with what it was probably meant to be; a model that
 * carries no registries (the ontology did not resolve) has nothing to check
 * against and is not checked.
 */
export function relationshipsOfType(
    model: Pick<MemoModelDTO, 'relationships' | 'registries'>,
    ...names: string[]
): MemoRelationship[] {
    const registry = model.registries?.relationships;
    if (registry) {
        for (const { name, suggestion } of undeclaredRelationshipTypes(names, registry.map(definition => definition.name))) {
            if (reported.has(name)) continue;
            reported.add(name);
            console.error(
                `No relationship type "${name}" is declared by the ontology${suggestion ? `; did you mean "${suggestion}"?` : ''} `
                + 'A view that selects it shows nothing in every model.');
        }
    }
    const accepted = new Set(names.map(toModelType));
    return model.relationships.filter(relationship => accepted.has(toModelType(relationship.type)));
}
