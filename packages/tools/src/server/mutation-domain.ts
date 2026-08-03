// ─── One action, one domain ─────────────────────────────────────────────────
//
// A MEMO project keeps two kinds of state, and they are not the same kind of
// fact:
//
//   semantic — what the model says. Lives in `.sysml`, reviewed, diffed,
//              versioned, and read by every tool that reads SysML.
//   layout   — where a symbol sits on a canvas. Lives in a `.viewlayout`
//              sidecar, and says nothing about the model.
//
// The rule this module enforces is that **no single action writes both**.
// Moving a symbol must produce no `.sysml` diff, and editing a declaration must
// leave the sidecar alone. The reason is reviewability: once a drag can change
// source, a semantic diff can no longer be read as a semantic change, and once
// a semantic edit can move symbols, a layout diff stops being noise you can
// safely ignore.
//
// Keeping it as a check rather than a convention means a new handler cannot
// quietly reintroduce the mixture: an unclassified mutation is a failure, not a
// default.
// ─────────────────────────────────────────────────────────────────────────────

/** Which store an action is allowed to write. */
export type MutationDomain = 'semantic' | 'layout' | 'neither';

/** Payload keys that only ever describe presentation. */
export const LAYOUT_ONLY_FIELDS: readonly string[] = [
    'layout', 'position', 'nodes', 'edges', 'canvas', 'annotations',
];

/**
 * The domain a server message writes.
 *
 * Deliberately explicit rather than pattern-matched on the message name: a
 * message whose domain nobody decided is the one that ends up writing both.
 */
const MUTATION_DOMAINS: Record<string, MutationDomain> = {
    'element:create': 'semantic',
    'element:update': 'semantic',
    'element:delete': 'semantic',
    'element:remap-kinds': 'semantic',
    'relationship:create': 'semantic',
    'relationship:delete': 'semantic',
    'diagram:source:save': 'semantic',
    'methodology:source:save': 'semantic',
    'csv:import': 'semantic',
    'diagram:layout:update': 'layout',
    // User diagrams are a sidecar too — a saved view is presentation state, and
    // creating one has never written SysML.
    'diagram:create': 'layout',
    'diagram:update': 'layout',
    'diagram:delete': 'layout',
};

export function mutationDomain(messageType: string): MutationDomain {
    return MUTATION_DOMAINS[messageType] ?? 'neither';
}

/** A mutation carrying data from a domain it is not allowed to write. */
export class MixedMutationDomainError extends Error {
    constructor(readonly messageType: string, readonly offendingFields: readonly string[]) {
        super(
            `"${messageType}" is a ${mutationDomain(messageType)} mutation but carries layout data `
            + `(${offendingFields.join(', ')}). Layout changes go to the view sidecar and semantic `
            + 'changes go to SysML source; one action never writes both.',
        );
        this.name = 'MixedMutationDomainError';
    }
}

/**
 * Refuse a semantic mutation that also carries layout data.
 *
 * The check runs on the payload rather than trusting the caller, because the
 * mixture arrives from a client: a properties panel that happened to spread a
 * node object into its save request would otherwise write a canvas position
 * into `.sysml` as an ordinary attribute, and nothing downstream would tell it
 * apart from a modelled one.
 */
export function assertSingleDomainMutation(messageType: string, payload: unknown): void {
    if (mutationDomain(messageType) !== 'semantic') return;
    if (!payload || typeof payload !== 'object') return;
    const record = payload as Record<string, unknown>;
    const offending = LAYOUT_ONLY_FIELDS.filter(field => record[field] !== undefined);
    // Attributes are modelled data and are written to source by definition, so
    // a modelled attribute *named* `position` is legitimate; only top-level
    // payload fields are presentation.
    if (offending.length > 0) throw new MixedMutationDomainError(messageType, offending);
}
