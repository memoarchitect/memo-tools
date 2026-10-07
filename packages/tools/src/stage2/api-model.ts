// ─── Stage 2 read model over stage 1's API JSON ──────────────────────────────
//
// Stage 1 (an external SysML compiler) hands stage 2 the OMG SysML v2
// API JSON of every document, plus an element index the standard JSON does not
// carry: each element's qualified name and source position
// (plans/memo-compiler-stages-opensysml.md, "Milestone 2 design"). This module is
// the one place stage 2 reads that handoff. Everything MEMO builds from a model
// asks it, never the compiler, so which compiler ran is invisible from here up.
//
// **Identity is the qualified name.** The `@id` a compiler writes is its own
// (one derives it from the qualified name, another writes UUIDs), so it is
// used only to follow references inside one handoff and never escapes this
// module as an element's identity.
//
// **Only standard, non-derived properties are read.** Ownership, typing,
// specialization and values are recovered from the relationships that state
// them (`FeatureTyping.type`, `Subclassification.superclassifier`, …), which
// every conforming compiler writes; derived properties such as `owner` or
// `type` are computed here rather than trusted to be present.
// ─────────────────────────────────────────────────────────────────────────────

/** A reference in API JSON: `{ "@id": … }`. */
import { join } from 'node:path';

export interface ApiRef { '@id': string }

/** One element of the OMG API JSON; properties beyond `@type`/`@id` vary by metaclass. */
export interface ApiElement {
    '@type': string;
    '@id': string;
    [property: string]: unknown;
}

/** What the standard JSON does not carry, keyed by `@id`. */
export interface ApiIndexEntry {
    /** Absent for a `standard` entry: an element of SysML's own library, indexed but not exported. */
    file?: string;
    /**
     * The absolute root `file` is relative to: the project directory or the
     * library root the compiler was given. Absent in a handoff written before it.
     */
    root?: string;
    role: 'project' | 'library' | 'standard';
    qualifiedName?: string;
    startByte?: number;
    endByte?: number;
    line?: number;
    column?: number;
}

/** The stage 1 handoff (`memo-stage1/1`). */
export interface Stage1Output {
    format: string;
    provider: string;
    providerVersion?: string;
    clean: boolean;
    documents?: { file: string; role: 'project' | 'library'; root?: string; elements: ApiElement[] }[];
    index?: Record<string, ApiIndexEntry>;
}

export const STAGE1_FORMAT = 'memo-stage1/1';

/** A literal or reference a feature is valued with, as MEMO reads values. */
export type ApiValue =
    | { kind: 'string'; value: string }
    | { kind: 'number'; value: number; rational: boolean }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'reference'; qualifiedName: string }
    | { kind: 'chain'; steps: string[] }
    | { kind: 'sequence'; items: ApiValue[] }
    | { kind: 'other'; metaclass: string };

const isRef = (value: unknown): value is ApiRef =>
    typeof value === 'object' && value !== null && typeof (value as ApiRef)['@id'] === 'string';

const refs = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter(isRef).map(r => r['@id']) : isRef(value) ? [value['@id']] : [];

export class ApiModel {
    private readonly byId = new Map<string, ApiElement>();
    private readonly byQualifiedName = new Map<string, string>();
    private byType?: Map<string, ApiElement[]>;
    private rootsByFile?: Map<string, ApiElement[]>;
    private readonly index: Record<string, ApiIndexEntry>;
    readonly provider: string;

    constructor(readonly output: Stage1Output) {
        if (output.format !== STAGE1_FORMAT) {
            throw new Error(`stage 1 output is ${output.format}, expected ${STAGE1_FORMAT}`);
        }
        if (!output.clean) {
            // Stage 2 never runs on a failed stage 1 (plan, Decisions).
            throw new Error('stage 1 reported errors; stage 2 does not run on a failed stage 1');
        }
        this.provider = output.provider;
        this.index = output.index ?? {};
        for (const document of output.documents ?? []) {
            for (const element of document.elements) this.byId.set(element['@id'], element);
        }
        for (const [id, entry] of Object.entries(this.index)) {
            // A qualified name is one element; the first declaration keeps it,
            // exactly as SysML resolution would find it.
            if (entry.qualifiedName && !this.byQualifiedName.has(entry.qualifiedName)) {
                this.byQualifiedName.set(entry.qualifiedName, id);
            }
        }
    }

    get size(): number { return this.byId.size; }

    /**
     * The element an `@id` names. One the handoff references but does not carry —
     * a standard library element — answers as a stand-in of metaclass
     * `ExternalElement` holding only its name, which is all stage 2 asks of it.
     */
    element(id: string): ApiElement | undefined {
        const element = this.byId.get(id);
        if (element) return element;
        const qualifiedName = this.index[id]?.qualifiedName;
        return qualifiedName
            ? { '@type': 'ExternalElement', '@id': id, declaredName: qualifiedName.slice(qualifiedName.lastIndexOf('::') + 2) }
            : undefined;
    }

    /** The element a qualified name resolves to, if the handoff holds it. */
    resolve(qualifiedName: string): ApiElement | undefined {
        const id = this.byQualifiedName.get(qualifiedName);
        return id === undefined ? undefined : this.byId.get(id);
    }

    qualifiedName(id: string): string | undefined { return this.index[id]?.qualifiedName; }

    source(id: string): ApiIndexEntry | undefined { return this.index[id]; }

    /** The absolute file an element is declared in, when the handoff names its root. */
    absoluteFile(id: string): string | undefined {
        const entry = this.index[id];
        return entry?.file !== undefined && entry.root ? join(entry.root, entry.file) : undefined;
    }

    /** Every element of a metaclass, library included, in handoff order. */
    ofType(metaclass: string): readonly ApiElement[] {
        if (!this.byType) {
            // One pass over the handoff, on first ask: the model is not changed after it is built.
            this.byType = new Map();
            for (const element of this.byId.values()) {
                const same = this.byType.get(element['@type']);
                if (same) same.push(element); else this.byType.set(element['@type'], [element]);
            }
        }
        return this.byType.get(metaclass) ?? [];
    }

    /**
     * The namespaces nothing owns, by the absolute file they are declared in:
     * what a file's outline starts from, found for every file in one pass.
     */
    rootNamespacesByFile(): ReadonlyMap<string, readonly ApiElement[]> {
        if (!this.rootsByFile) {
            this.rootsByFile = new Map();
            for (const namespace of this.ofType('Namespace')) {
                if (this.owner(namespace['@id'])) continue;
                const file = this.absoluteFile(namespace['@id']);
                if (file === undefined) continue;
                const same = this.rootsByFile.get(file);
                if (same) same.push(namespace); else this.rootsByFile.set(file, [namespace]);
            }
        }
        return this.rootsByFile;
    }

    rootNamespacesIn(absoluteFile: string): readonly ApiElement[] {
        return this.rootNamespacesByFile().get(absoluteFile) ?? [];
    }

    /** Elements the project declares, not the library. */
    *projectElements(): Iterable<ApiElement> {
        for (const [id, element] of this.byId) if (this.index[id]?.role === 'project') yield element;
    }

    /** The namespace (or relationship) that owns an element. */
    owner(id: string): ApiElement | undefined {
        const element = this.byId.get(id);
        if (!element) return undefined;
        const direct = refs(element.owningRelatedElement)[0];
        if (direct) return this.byId.get(direct);
        const via = refs(element.owningRelationship)[0];
        const membership = via ? this.byId.get(via) : undefined;
        const ownerId = membership ? refs(membership.owningRelatedElement)[0] : undefined;
        return ownerId ? this.byId.get(ownerId) : undefined;
    }

    /** The relationships an element owns, in declaration order. */
    ownedRelationships(id: string): ApiElement[] {
        return refs(this.byId.get(id)?.ownedRelationship)
            .map(r => this.byId.get(r)).filter((e): e is ApiElement => e !== undefined);
    }

    /** The elements an element owns through its memberships, in declaration order. */
    ownedMembers(id: string): ApiElement[] {
        const out: ApiElement[] = [];
        for (const relationship of this.ownedRelationships(id)) {
            for (const r of refs(relationship.ownedRelatedElement)) {
                const member = this.byId.get(r);
                if (member) out.push(member);
            }
        }
        return out;
    }

    /** The `end` of each relationship of the given metaclasses an element owns. */
    related(id: string, metaclasses: string[], end: string): ApiElement[] {
        return this.ownedRelationships(id)
            .filter(r => metaclasses.includes(r['@type']))
            .flatMap(r => refs(r[end]))
            .map(r => this.element(r)).filter((e): e is ApiElement => e !== undefined);
    }

    /** What a feature is typed by (`FeatureTyping.type`). */
    types(id: string): ApiElement[] { return this.related(id, ['FeatureTyping'], 'type'); }

    /** What a classifier specializes (`Subclassification.superclassifier`). */
    superclassifiers(id: string): ApiElement[] { return this.related(id, ['Subclassification'], 'superclassifier'); }

    /** What a feature redefines (`Redefinition.redefinedFeature`). */
    redefined(id: string): ApiElement[] { return this.related(id, ['Redefinition'], 'redefinedFeature'); }

    /** What a feature subsets, redefinitions and reference subsettings excluded. */
    subsetted(id: string): ApiElement[] { return this.related(id, ['Subsetting'], 'subsettedFeature'); }

    /**
     * What a feature references (`ReferenceSubsetting.referencedFeature`), e.g. a
     * connector end. A chained reference (`pump.motor`) resolves to the feature
     * at the end of the chain; `chain` gives the steps.
     */
    referenced(id: string): ApiElement[] {
        return this.related(id, ['ReferenceSubsetting'], 'referencedFeature')
            .map(target => this.chain(target['@id']).at(-1) ?? target);
    }

    /**
     * The steps of a feature chain (`a.b.c`): an anonymous Feature owning one
     * `FeatureChaining` per step. Empty for a feature that is not a chain.
     */
    chain(id: string): ApiElement[] {
        return this.related(id, ['FeatureChaining'], 'chainingFeature');
    }

    /** The simple name an element declares, or the name its first redefinition gives it. */
    name(id: string): string | undefined {
        const element = this.element(id);
        if (!element) return undefined;
        const declared = element.declaredName ?? element.name;
        if (typeof declared === 'string') return declared;
        const redefined = this.redefined(id)[0];
        return redefined ? this.name(redefined['@id']) : undefined;
    }

    /** The name an element declares itself, never one it borrows through a redefinition. */
    declaredName(id: string): string | undefined {
        const declared = this.element(id)?.declaredName;
        return typeof declared === 'string' ? declared : undefined;
    }

    /** The value a feature is bound to (`FeatureValue`), read as MEMO reads values. */
    value(id: string): ApiValue | undefined {
        const featureValue = this.ownedRelationships(id).find(r => r['@type'] === 'FeatureValue');
        const expression = featureValue ? refs(featureValue.ownedRelatedElement)[0] : undefined;
        return expression ? this.expressionValue(expression) : undefined;
    }

    /** An expression's value, read as MEMO reads values. */
    expression(id: string): ApiValue { return this.expressionValue(id); }

    private expressionValue(id: string): ApiValue {
        const expression = this.byId.get(id);
        if (!expression) return { kind: 'other', metaclass: 'missing' };
        const type = expression['@type'];
        switch (type) {
            case 'LiteralString': return { kind: 'string', value: String(expression.value) };
            case 'LiteralInteger': return { kind: 'number', value: Number(expression.value), rational: false };
            case 'LiteralRational': return { kind: 'number', value: Number(expression.value), rational: true };
            case 'FeatureChainExpression': {
                // `a.b.c`: the argument is the head (`a`), bound through a
                // parameter; the target is the rest, one FeatureChaining per step
                // (or a single member when the tail is one feature).
                const steps: string[] = [];
                for (const relationship of this.ownedRelationships(id)) {
                    for (const owned of refs(relationship.ownedRelatedElement)) {
                        if (relationship['@type'] === 'ParameterMembership') {
                            const head = this.value(owned);
                            if (head?.kind === 'reference') steps.push(head.qualifiedName);
                            else if (head?.kind === 'chain') steps.push(...head.steps);
                            continue;
                        }
                        const tail = this.chain(owned);
                        for (const step of tail.length ? tail : [this.byId.get(owned)].filter(Boolean) as ApiElement[]) {
                            const name = this.qualifiedName(step['@id']);
                            if (name) steps.push(name);
                        }
                    }
                    if (relationship['@type'] === 'Membership') {
                        const target = refs(relationship.memberElement)[0];
                        const name = target ? this.qualifiedName(target) : undefined;
                        if (name) steps.push(name);
                    }
                }
                return steps.length ? { kind: 'chain', steps } : { kind: 'other', metaclass: type };
            }
            case 'LiteralBoolean': return { kind: 'boolean', value: Boolean(expression.value) };
            case 'FeatureReferenceExpression': {
                // The referent is the member of the expression's own membership: a
                // Membership naming it, or an OwningMembership owning a chain
                // feature when the reference is `a.b`.
                for (const relationship of this.ownedRelationships(id)) {
                    if (relationship['@type'] === 'Membership') {
                        const target = refs(relationship.memberElement)[0];
                        const qualifiedName = target ? this.qualifiedName(target) : undefined;
                        if (qualifiedName) return { kind: 'reference', qualifiedName };
                    } else if (relationship['@type'] === 'OwningMembership') {
                        const owned = refs(relationship.ownedRelatedElement)[0];
                        const steps = owned ? this.chain(owned).map(step => this.qualifiedName(step['@id'])) : [];
                        if (steps.length && steps.every(Boolean)) return { kind: 'chain', steps: steps as string[] };
                    }
                }
                return { kind: 'other', metaclass: type };
            }
            case 'OperatorExpression': {
                // A sequence literal `(a, b, c)` is the `,` operator. Each operand is
                // a parameter Feature bound by its own FeatureValue; a nested `,`
                // flattens, since a SysML sequence has no nesting.
                if (expression.operator === ',') {
                    const items = this.ownedRelationships(id)
                        .filter(r => r['@type'] === 'ParameterMembership')
                        .flatMap(r => refs(r.ownedRelatedElement))
                        .map(operand => this.value(operand) ?? { kind: 'other' as const, metaclass: 'unbound operand' });
                    return { kind: 'sequence', items: items.flatMap(i => i.kind === 'sequence' ? i.items : [i]) };
                }
                return { kind: 'other', metaclass: type };
            }
            default: return { kind: 'other', metaclass: type };
        }
    }
}
