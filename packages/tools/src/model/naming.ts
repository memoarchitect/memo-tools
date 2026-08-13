/**
 * The one conversion between how a name is WRITTEN in SysML source and how it
 * is KEYED in the built model.
 *
 * SysML v2 cases the two halves of a model differently, and MEMO follows it:
 *
 *   - definitions are PascalCase   — `Composes`, `Mitigates`, `DataPort`
 *   - usages and features are lowerCamelCase — `fuelTankPort`, `takePicture`
 *   - keywords are lowercase       — `flow`, `bind`, `connect`
 *
 * A `MemoRelationship.type` is a model KEY, not a definition name, so it is
 * lowerCamelCase throughout: `connection : Composes ...` builds an edge of type
 * `composes`, and a native `flow` builds one of type `flow`. A view that selects
 * relationships names them the way SOURCE spells them — `("Composes", "flow")` —
 * so every consumer has to normalize before it can match.
 *
 * That conversion used to be open-coded in seven places across two repos, in
 * three mutually incompatible ways: decapitalize-the-first-character, full
 * `.toLowerCase()`, and verbatim-no-normalization. `flow` and `bind` survive all
 * three by accident, being lowercase already; `Composes` survives two of the
 * three; anything reaching the verbatim path never matches at all. A filter that
 * silently matches nothing looks exactly like a filter with nothing to match,
 * which is why this stayed invisible.
 *
 * Use these helpers. Do not re-derive the rule at the call site.
 */

/**
 * A definition name as written in source → the key the model stores.
 *
 * `Composes` → `composes`, `DerivesFrom` → `derivesFrom`, `flow` → `flow`.
 *
 * Only the first character changes. Lowercasing the whole string would collapse
 * `derivesFrom` onto `derivesfrom` and stop matching the model, and an initialism
 * like `DecisionRecordedInADR` must keep its trailing capitals.
 */
export function toModelType(name: string): string {
    if (!name) return name;
    return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * A model key → the definition name source would spell it with.
 *
 * `composes` → `Composes`. Not a round-trip for native keywords: `flow` becomes
 * `Flow`, which names no definition. Use it for display of MEMO relationship
 * types, never to reconstruct a reference that has to resolve.
 */
export function toDefinitionName(type: string): string {
    if (!type) return type;
    return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Compare a source-spelled relationship kind against a model-stored type.
 *
 * Both sides are normalized, so `"Composes"`, `"composes"`, a native `"flow"`,
 * and a `"bind"` all behave the same way and no caller has to know which kind of
 * name it was handed.
 */
export function matchesRelationshipType(declared: string, modelType: string): boolean {
    return toModelType(declared) === toModelType(modelType);
}

/**
 * Normalize a whole selection list once, for repeated membership tests.
 */
export function toModelTypeSet(names: readonly string[]): Set<string> {
    return new Set(names.map(toModelType));
}
