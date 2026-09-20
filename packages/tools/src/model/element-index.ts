// ─── Element index ────────────────────────────────────────────────────────────
//
// The builder's `name → element` map, with the one behaviour a plain `Map`
// cannot have: it refuses to let a second element of the same short name
// overwrite the first, and it records the pair so the build can report it.
//
// A plain `Map` keyed on `usage.name` is keyed on something the language does
// not promise to be unique. SysML v2 scopes a name to its owner, so
// `action confirmPrimed` in a view and `action confirmPrimed : OperativeAction`
// in an operational file are two elements; the map made them one, last write
// winning, with nothing said. Measured 2026-09-19: the view's untyped copy won
// and the model held the wrong element, and in the same model a
// `WorkflowControlNode` carrying a decision question was replaced by a bare
// `ForkNode`.
//
// Two changes, both deliberate:
//
//   * **First definition wins.** Not because the first is more likely right —
//     it is not — but because last-wins makes the winner a function of document
//     iteration order, so the same sources could build two different models.
//     Whichever rule is chosen, the collision is reported, so neither one is
//     silently relied upon.
//   * **Re-extraction is not a collision.** The same declaration reaches the
//     index by more than one path (a definition walked as a package member and
//     again as a nested member, say). Same file, same package, same owner and
//     same construct is the same element arriving twice; anything else is two
//     elements competing for one key.
//
// The qualified identity this index would need to store instead — `owner::name`
// rather than `name` — is a larger change than a diagnostic, because every
// reference in a model is authored as a bare name and every consumer of the
// built model reads `element.id` as one. Reporting is what stops the silence;
// see the board row "Element identity is keyed by short name".
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement } from './semantic.js';

/** The `ParseError.code` every short-name collision carries. */
export const ELEMENT_NAME_COLLISION = 'element-name-collision';

/** Two elements that wanted the same key. */
export interface ElementCollision {
    /** The short name both elements are declared with. */
    id: string;
    /** The element that is in the model. */
    kept: MemoElement;
    /** The element that was dropped. */
    dropped: MemoElement;
    /** 1-based line of the kept element's declaration, when the CST gave one. */
    keptLine?: number;
    /** 1-based line of the dropped element's declaration, when the CST gave one. */
    droppedLine?: number;
}

/** The owner an element's name is scoped to, whichever way it carries one. */
function scopeOf(element: MemoElement): string | undefined {
    return element.owner ?? element.parentAction;
}

/**
 * The 1-based declaration line of a Langium AST node.
 *
 * Typed loosely on purpose: the builder passes a mix of generated AST nodes and
 * the structural `UsageNode` shape it declares for itself, and neither is worth
 * a cast at nine call sites.
 */
export function declarationLine(node: unknown): number | undefined {
    const cst = (node as { $cstNode?: { range?: { start?: { line?: number } } } } | undefined)?.$cstNode;
    const line = cst?.range?.start?.line;
    return typeof line === 'number' ? line + 1 : undefined;
}

/**
 * `name → element`, first definition winning and every collision recorded.
 *
 * Extends `Map` so that every builder function already typed
 * `Map<string, MemoElement>` keeps working unchanged. Call `define` rather than
 * `set` when adding an element: `set` cannot report whether the element landed,
 * and a caller that registers a dropped element with the package registry
 * points that registry at the wrong package.
 */
export class ElementIndex extends Map<string, MemoElement> {
    /** Every pair that competed for one key, in the order they were found. */
    readonly collisions: ElementCollision[] = [];

    /** Declaration lines of the elements that landed, for collision reports. */
    private lines = new Map<string, number>();

    /**
     * Add an element under its own `id`. Returns whether it landed — false
     * means an element of that name was already present and this one was
     * dropped, either as a duplicate arrival or as a recorded collision.
     */
    define(element: MemoElement, node?: unknown): boolean {
        const existing = this.get(element.id);
        const line = declarationLine(node);

        if (!existing) {
            super.set(element.id, element);
            if (line !== undefined) this.lines.set(element.id, line);
            return true;
        }

        if (isSameDeclaration(existing, element)) return false;

        this.collisions.push({
            id: element.id,
            kept: existing,
            dropped: element,
            keptLine: this.lines.get(element.id),
            droppedLine: line,
        });
        return false;
    }
}

/** Whether two entries are one declaration arriving twice. */
function isSameDeclaration(a: MemoElement, b: MemoElement): boolean {
    return a.file === b.file
        && a.package === b.package
        && a.construct === b.construct
        && scopeOf(a) === scopeOf(b);
}

/** Where an element sits, for a reader who has to go and look at both. */
export function describeLocation(element: MemoElement, line?: number): string {
    const at = line !== undefined ? `${element.file}:${line}` : element.file;
    const scope = scopeOf(element);
    const owner = scope ? ` in ${scope}` : element.package ? ` in package ${element.package}` : '';
    return `${at} (${element.construct} ${element.kind}${owner})`;
}
