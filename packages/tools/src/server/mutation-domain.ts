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
    // A preview writes nothing; the apply and the review each write the source files they name.
    'import:preview': 'neither',
    // Writes the generated documents of one device under dhf-output/, which is output and not model source.
    'dhf:device:generate': 'neither',
    'import:apply': 'semantic',
    'suspect:review': 'semantic',
    // A release record and every statement that links it, written together.
    'release:create': 'semantic',
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

/**
 * The messages a read-only server answers. An allowlist, not a second denylist: the mutation set
 * (`MODEL_MUTATION_MESSAGES`) does not cover every write (dashboards, user preferences, the
 * DHF stores, the toolchain settings), and a pinned view must change nothing it was not asked to.
 * A message type that is not here is refused, so a handler added later is refused until someone
 * decides it reads only.
 */
export const READ_ONLY_MESSAGES: ReadonlySet<string> = new Set([
    'request:refresh',
    'dhf:docs:load', 'dhf:templates:list', 'dhf:template:read',
    'diagram:source:request', 'methodology:source:request', 'diagram:parse',
    'import:preview', 'rule:preview', 'open-file',
    // Choosing another version, and comparing two, write nothing.
    'versions:list', 'version:open', 'release:diff',
]);

/** Whether a read-only server may answer this message. */
export function isReadOnlyMessage(messageType: string): boolean {
    return READ_ONLY_MESSAGES.has(messageType);
}
