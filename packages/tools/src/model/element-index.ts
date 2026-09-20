// ─── Element index ────────────────────────────────────────────────────────────
//
// `qualified name → element`, plus the lookups that let an authored reference
// find its way to one.
//
// **An element's id is its qualified name**, built the way SysML builds one:
// the owner chain, joined with `::`, rooted at the declaring package.
//
//     memo_examples_ros_mobile_robot::nodeSafetyMonitor::scanSubscriber
//
// It used to be the short name alone, which is not a key the language promises
// to be unique — a name is scoped to its owner. Two parts each owning a port
// called `scanSubscriber` is ordinary, correct SysML, and it made two elements
// compete for one map entry: the last one built won, the other was gone, and
// nothing was said. Measured 2026-09-19 in `ros-mobile-robot`, where
// `nodeNavigation` and `nodeSafetyMonitor` each declare `in port
// scanSubscriber`; the flow to the safety monitor's port degraded to an edge on
// the node, because `resolveEndpoint` checked the owner, found the wrong one,
// and gave up one segment short.
//
// The authored short name is kept on `shortName`, because it is what the source
// says and what a reader should see. `id` is for identity; `shortName` is for
// display; `name` remains the human label from `attribute redefines name`.
//
// Two elements can still collide — two packages that each declare `clinician`
// at top level produce two different ids, but a reference to a bare
// `clinician` cannot say which. That is reported rather than guessed; see
// `lookup`.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement } from './semantic.js';

/** The `ParseError.code` every ambiguous bare reference carries. */
export const AMBIGUOUS_ELEMENT_REFERENCE = 'ambiguous-element-reference';

/** The `ParseError.code` a duplicate qualified name carries. */
export const ELEMENT_NAME_COLLISION = 'element-name-collision';

/** The separator SysML uses between the segments of a qualified name. */
export const QUALIFIER = '::';

/**
 * The qualified name of a declaration.
 *
 * `ownerId` is the owning element's own qualified id, so the chain builds
 * itself one hop at a time and a port three levels down reads as the path you
 * would type in the source.
 */
export function qualifiedId(
    shortName: string,
    packageName: string | undefined,
    ownerId: string | undefined,
): string {
    if (ownerId) return `${ownerId}${QUALIFIER}${shortName}`;
    if (packageName) return `${packageName}${QUALIFIER}${shortName}`;
    return shortName;
}

/**
 * The last segment of a qualified name.
 *
 * Accepts `undefined` and passes it through, because most of what is asked for
 * a short name is an optional field — an element's `owner`, a relationship's
 * resolved end — and making every caller guard it reads worse than this does.
 */
export function shortNameOf(id: string): string;
export function shortNameOf(id: string | undefined): string | undefined;
export function shortNameOf(id: string | undefined): string | undefined {
    if (id === undefined) return undefined;
    const at = id.lastIndexOf(QUALIFIER);
    return at === -1 ? id : id.slice(at + QUALIFIER.length);
}

/** Two elements that wanted the same qualified name. */
export interface ElementCollision {
    /** The qualified name both elements are declared with. */
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

/** A bare reference that more than one element answers to. */
export interface AmbiguousReference {
    /** The reference as it was authored. */
    reference: string;
    /** The qualified ids that all answer to it. */
    candidates: string[];
    /** The file the reference was written in, when the caller said. */
    file?: string;
}

/**
 * Where a reference was written, which is what decides what a short name means.
 *
 * Both fields are optional because some callers genuinely have no context — a
 * name a person typed at a terminal, a key read back from a saved layout — and
 * for those the global rules (4 and 5) are the right ones.
 */
export interface ReferenceContext {
    /** The package the reference was authored in. */
    packageName?: string;
    /** The element whose body the reference was authored in, if any. */
    ownerId?: string;
    /** The file, for the diagnostic if the reference turns out ambiguous. */
    file?: string;
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
 * `qualified name → element`, with the lookups an authored reference needs.
 *
 * Extends `Map` so that every function already typed `Map<string, MemoElement>`
 * keeps working: `get` is exact and means "this qualified id". Everything that
 * starts from something a person wrote goes through `lookup` or `resolvePath`.
 */
export class ElementIndex extends Map<string, MemoElement> {
    /** Every pair that competed for one qualified name. */
    readonly collisions: ElementCollision[] = [];

    /** Bare references that more than one element answered to. */
    readonly ambiguities: AmbiguousReference[] = [];

    /** Short name → the qualified ids declaring it, in declaration order. */
    private byShortName = new Map<string, string[]>();

    /** Declaration lines of the elements that landed, for collision reports. */
    private lines = new Map<string, number>();

    /**
     * Add an element under its own qualified `id`. Returns whether it landed —
     * false means one was already there and this one was dropped, either as a
     * duplicate arrival or as a recorded collision.
     */
    define(element: MemoElement, node?: unknown): boolean {
        const existing = this.get(element.id);
        const line = declarationLine(node);

        if (!existing) {
            super.set(element.id, element);
            if (line !== undefined) this.lines.set(element.id, line);
            const short = element.shortName || shortNameOf(element.id);
            const ids = this.byShortName.get(short) ?? [];
            ids.push(element.id);
            this.byShortName.set(short, ids);
            return true;
        }

        if (isSameDeclaration(existing, element)) return false;

        // Same qualified name, same owner, two declarations. SysML forbids it
        // and SysIDE rejects it; MEMO says so too rather than dropping one.
        this.collisions.push({
            id: element.id,
            kept: existing,
            dropped: element,
            keptLine: this.lines.get(element.id),
            droppedLine: line,
        });
        return false;
    }

    /** The qualified ids that declare this short name. */
    idsNamed(shortName: string): readonly string[] {
        return this.byShortName.get(shortName) ?? [];
    }

    /**
     * Find the element an authored reference names, from where it was written.
     *
     * The context is what makes a short name meaningful, and it is the same
     * order SysML resolves in: the owner's own members, then the enclosing
     * package, then anything visible. Two view packages that each declare
     * `clinician` are two elements, and inside either package the bare word
     * means that package's one — which is why the context is not optional in
     * practice even though the parameter is.
     *
     *   1. the full qualified id;
     *   2. a member of `ownerId` — `scanSubscriber` inside `nodeSafetyMonitor`;
     *   3. a member of `packageName`, walking OUT through enclosing packages;
     *   4. a TRAILING part of some qualified id, when exactly one ends that way
     *      — `nodeLidar::scanPublisher` written from another package;
     *   5. a bare short name, when exactly one element in the model carries it.
     *
     * A reference that survives all five with more than one candidate is
     * recorded in `ambiguities` and resolves to nothing. Picking one would be
     * picking by declaration order, which is the bug this index exists to stop.
     */
    lookup(reference: string, context?: ReferenceContext): MemoElement | undefined {
        const exact = this.get(reference);
        if (exact) return exact;

        if (context?.ownerId) {
            const owned = this.get(`${context.ownerId}${QUALIFIER}${reference}`);
            if (owned) return owned;
        }

        // Out through the enclosing packages: a reference written in
        // `A::B::C` sees `A::B::C::x`, then `A::B::x`, then `A::x`.
        let scope = context?.packageName;
        while (scope) {
            const inScope = this.get(`${scope}${QUALIFIER}${reference}`);
            if (inScope) return inScope;
            const at = scope.lastIndexOf(QUALIFIER);
            scope = at === -1 ? undefined : scope.slice(0, at);
        }

        const suffix = `${QUALIFIER}${reference}`;
        const bySuffix = [...this.keys()].filter(id => id.endsWith(suffix));
        if (bySuffix.length === 1) return this.get(bySuffix[0]);
        if (bySuffix.length > 1) {
            this.recordAmbiguity(reference, bySuffix, context);
            return undefined;
        }

        const named = this.byShortName.get(reference) ?? [];
        if (named.length === 1) return this.get(named[0]);
        if (named.length > 1) this.recordAmbiguity(reference, named, context);
        return undefined;
    }

    /**
     * Resolve a dotted feature path — `nodeSafetyMonitor.scanSubscriber.payload`
     * — as far as it names elements.
     *
     * The first segment is looked up; each further segment is an owned member
     * of what came before, which is an exact `owner::name` probe rather than a
     * global search that then checks the owner. That check is what used to stop
     * one segment short when the global search returned the wrong node's port.
     *
     * Returns the deepest element reached and whatever is left over — a port's
     * `payload`, an action's parameter — which the caller keeps as the edge's
     * end name.
     */
    resolvePath(
        reference: string,
        context?: ReferenceContext,
    ): { element?: MemoElement; id: string; end: string; ambiguous: boolean } {
        const segments = reference.split('.');
        const before = this.ambiguities.length;
        const head = this.lookup(segments[0], context);
        // Whether THIS lookup is what could not decide. A caller that falls
        // back to the bare reference when nothing resolved must not do so
        // here: several elements answer to it, and an edge to the name would
        // be an edge to whichever of them a reader assumed.
        const ambiguous = this.ambiguities.length > before
            || this.ambiguities.some(a => a.reference === segments[0]);
        if (!head) return { id: segments[0], end: segments.slice(1).join('.'), ambiguous };

        let element = head;
        let i = 1;
        while (i < segments.length) {
            const child = this.get(`${element.id}${QUALIFIER}${segments[i]}`);
            if (!child) break;
            element = child;
            i++;
        }
        return { element, id: element.id, end: segments.slice(i).join('.'), ambiguous };
    }

    private recordAmbiguity(reference: string, candidates: string[], context?: ReferenceContext): void {
        const from = context?.file;
        if (this.ambiguities.some(a => a.reference === reference && a.file === from)) return;
        this.ambiguities.push({ reference, candidates, file: from });
    }
}

/**
 * An index built from elements that already have their ids — a model received
 * over the wire, a hand-built test fixture, a conversion from another tool.
 */
export function toElementIndex(
    elements: Iterable<MemoElement> | Map<string, MemoElement>,
): ElementIndex {
    const index = new ElementIndex();
    const values = elements instanceof Map ? elements.values() : elements;
    for (const element of values) index.define(element);
    return index;
}

/** Whether two entries are one declaration arriving twice. */
function isSameDeclaration(a: MemoElement, b: MemoElement): boolean {
    return a.file === b.file && a.construct === b.construct;
}

/** Where an element sits, for a reader who has to go and look at both. */
export function describeLocation(element: MemoElement, line?: number): string {
    const at = line !== undefined ? `${element.file}:${line}` : element.file;
    return `${at} (${element.construct} ${element.kind})`;
}
