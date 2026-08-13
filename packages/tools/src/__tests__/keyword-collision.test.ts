import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { AstUtils, type AstNode } from 'langium';
import { relative, resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { parseFiles, parseText } from '../model/parser-utils.js';
import { findSysmlFiles } from '../model/sysml-files.js';

// ─── Keyword-collision lint (ARCADIA plan §11.1) ─────────────────────────────
//
// The programme's first principle, made mechanical:
//
//   If a MEMO definition carries a meaning that a SysML v2 reserved keyword
//   already carries, it is a reinvention. If the standard is silent and the
//   domain is regulated or method-specific, it is an extension.
//
// So: flag every MEMO definition whose name's head or tail word is a reserved
// keyword, and require each survivor to be a RECORDED decision rather than an
// accident. The allow-list below is the programme's burndown — session 4 drains
// it, and when it holds only deliberate divergences the migration is done.
//
// Two rules keep this honest, and both are load-bearing:
//
//   * The keyword list is READ FROM THE VENDORED NORMATIVE BNF at test time,
//     never transcribed into TypeScript. If OMG adds a keyword and the corpus
//     pin moves, this test finds MEMO's new collisions on its own.
//   * MEMO's names come from the KindRegistry and RelationshipRegistry — the
//     same registries the tools reason with — not from grepping .sysml. A
//     definition the registries cannot see is a definition the tools cannot
//     check, so grepping would measure the wrong population.
//
// Two exemptions are applied before the allow-list, because they are not
// judgements about individual names:
//
//   * CONSTRUCT ALIGNMENT. A definition named after the construct it is
//     declared with is agreeing with the language, not competing with it:
//     `port def DataPort`, `part def MemoPart`, `use case def UseCase`,
//     `verification def MemoVerificationCase`. Only a name that reaches for a
//     keyword its own construct does not supply is a candidate reinvention —
//     which is exactly why `part def SoftwarePort` IS flagged and
//     `port def SensorPort` is not.
//   * ENUM DEFINITIONS. A reserved keyword introduces a definition or a usage;
//     none introduces an enumeration literal set. `enum def MessageKind`
//     classifies messages, it does not re-spell `message`, so an enum name
//     cannot be a reinvention of a keyword by construction.
// ─────────────────────────────────────────────────────────────────────────────

const GPCA_PROJECT = resolve(__dirname, '../../../../../memo/examples/gpca-pump');
const EXTENSIONS = resolve(__dirname, '../../../../../memo/extensions');
const BNF = resolve(__dirname, '../../../../corpus/sysml-v2-release/bnf/SysML-textual-bnf.kebnf');

/**
 * The reserved keywords, read out of the vendored normative grammar.
 *
 * `RESERVED_KEYWORD = 'about' | 'abstract' | …` runs over several lines and
 * ends at the first blank line, so the production is taken whole and every
 * quoted literal in it is a keyword.
 */
function reservedKeywords(): Set<string> {
    const source = readFileSync(BNF, 'utf-8');
    const start = source.indexOf('RESERVED_KEYWORD');
    if (start < 0) throw new Error(`RESERVED_KEYWORD production not found in ${BNF}`);
    const production = source.slice(start, source.indexOf('\n\n', start));
    return new Set([...production.matchAll(/'([a-z]+)'/g)].map(match => match[1]));
}

/** Split a PascalCase definition name into its words: "IncludesStep" → [Includes, Step]. */
function words(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_]+/)
        .filter(Boolean);
}

/**
 * A word and its singular, so `Performs` reaches `perform` and `Includes`
 * reaches `include`.
 *
 * Only the plain `-s` and `-ies` forms are stripped. An `-es` rule would turn
 * `Notes` into `not`, inventing a collision with the boolean operator that no
 * reader would recognize as one.
 */
function stems(word: string): string[] {
    const lower = word.toLowerCase();
    if (lower.endsWith('ies')) return [lower, `${lower.slice(0, -3)}y`];
    if (lower.endsWith('s')) return [lower, lower.slice(0, -1)];
    return [lower];
}

interface Collision {
    /** The reserved keyword the name reaches. */
    keyword: string;
    /** MEMO's definition name, as declared. */
    definition: string;
    /** The construct it is declared with, e.g. "part def". */
    construct: string;
}

interface FeatureCollision {
    /** The reserved keyword used as a feature name. */
    keyword: string;
    /** The feature name, as written in source. */
    feature: string;
    /** Source file relative to the extensions root. */
    source: string;
    /** The Langium member form that declared the feature. */
    construct: string;
}

/** Stable allow-list key, and the string a failure prints for copy-paste. */
const keyOf = (collision: Collision) => `${collision.keyword}:${collision.definition}`;
const featureKeyOf = (collision: FeatureCollision) => `${collision.keyword}:${collision.source}:${collision.feature}`;

/**
 * Definition-body members whose `name` is a feature, not a registry entry.
 *
 * These are deliberately read from the parsed source rather than the kind and
 * relationship registries. A port payload such as `out item message` is not a
 * definition and cannot appear in either registry — that was the hole R0-S2
 * closes.
 *
 * SysML v2's normative BNF defines `DefinitionBodyItem` as definition, variant
 * usage, non-occurrence usage, or occurrence usage (SysML textual BNF §8.2.2.6,
 * vendored at `corpus/sysml-v2-release/bnf/SysML-textual-bnf.kebnf`). Each
 * named usage is a feature. Match that complete family as represented by this
 * parser: every named `*Usage`, `*Member`, or `EndDeclaration`. Definitions,
 * packages, and enum literals have names but are not feature declarations.
 */
const NON_FEATURE_NAMED_TYPES = new Set([
    'AliasDeclaration', 'EnumLiteral', 'MetadataDefinition', 'PackageDeclaration',
    'PartDefinition', 'RequirementDefinition', 'VerificationDefinition',
    'StateDefinition', 'ActionDefinition', 'ItemDefinition', 'PortDefinition',
    'InterfaceDefinition', 'ConnectionDefinition', 'AllocationDefinition',
    'ConcernDefinition', 'AttributeDefinition', 'ConstraintDefinition',
    'EnumDefinition', 'ViewpointDefinition', 'ViewDefinition', 'UseCaseDeclaration',
]);

function isNamedFeature(node: AstNode): node is AstNode & { name: string } {
    // This grammar node models both `use case def` and a use-case usage. The
    // latter is a feature; the former is a definition and belongs to the
    // registry-level lint above.
    if (node.$type === 'UseCaseDeclaration') {
        return !(node as AstNode & { isDefinition?: boolean }).isDefinition
            && typeof (node as AstNode & { name?: unknown }).name === 'string';
    }
    if (NON_FEATURE_NAMED_TYPES.has(node.$type)) return false;
    if (!(node.$type.endsWith('Usage') || node.$type.endsWith('Member') || node.$type === 'EndDeclaration')) return false;
    return typeof (node as AstNode & { name?: unknown }).name === 'string';
}

function featureCollisionsIn(model: AstNode, source: string, keywords: Set<string>): FeatureCollision[] {
    const found: FeatureCollision[] = [];
    for (const node of AstUtils.streamAllContents(model)) {
        if (!isNamedFeature(node)) continue;
        const { name } = node;
        const keyword = name.toLowerCase();
        if (keywords.has(keyword)) found.push({ keyword, feature: name, source, construct: node.$type });
    }
    return found;
}

async function featureCollisionsFromSource(source: string, label: string): Promise<FeatureCollision[]> {
    const parsed = await parseText(source);
    if (parsed.errors.length > 0) throw new Error(`feature fixture did not parse: ${parsed.errors.map(error => error.message).join('; ')}`);
    return featureCollisionsIn(parsed.document.parseResult.value, label, reservedKeywords());
}

async function extensionFeatureCollisions(): Promise<FeatureCollision[]> {
    const files = findSysmlFiles(EXTENSIONS).sort();
    const parsed = await parseFiles(files, EXTENSIONS);
    if (parsed.errors.length > 0) throw new Error(`extension source did not parse: ${parsed.errors.map(error => `${error.file}: ${error.message}`).join('\n')}`);
    return parsed.documents.flatMap(({ document, filePath }) =>
        featureCollisionsIn(document.parseResult.value, relative(EXTENSIONS, resolve(EXTENSIONS, filePath)), reservedKeywords()));
}

/**
 * Every collision that exists today, with why it is there and what removes it.
 *
 * `removedBy` was the burndown: it named the session that retired an entry,
 * or `deliberate` for a divergence meant to survive. The burndown is finished
 * — R2 drained the last session rows when it deleted the private requirement
 * relations — so only `deliberate` remains, and the session literals are gone
 * rather than left as an unreachable option. An entry is not permission to add
 * more: a NEW definition that collides fails this test until someone writes
 * down why.
 */
const ALLOWED: Record<string, { reason: string; removedBy: 'deliberate' }> = {
    // `include:Includes` was here until R10-S6: `resolveOwnerRootedUsage` is
    // owner-type-agnostic, so native `include` already projects UseCase →
    // UseCase inclusion the same way it projects FunctionalFlow → Step —
    // the "currently projects only the latter" reasoning that kept this row
    // was never re-verified after the ARCADIA productions landed. Deleted
    // with `connection def Includes`; both use natively spell `includesStep`.
    // `port:PhysicalPort` and `port:SoftwarePort` were here until session 2.
    // Both are `port def`s now (Track A1), so the construct-alignment
    // exemption applies and neither reaches the allow-list — the first two
    // entries this programme has burned down.

    // ── Deliberate: MEMO means something the keyword does not ──
    'flow:FunctionalFlow': {
        reason: 'Carries flowCategory, endToEndLatencyBudgetMs, safetyRelevant, securityRelevant — properties of a whole route that no single `flow` usage owns (§7).',
        removedBy: 'deliberate',
    },
    'flow:EndToEndFlow': {
        reason: 'AADL end-to-end flow with latencyBudgetMs; a route-level budget carrier, not an arrow.',
        removedBy: 'deliberate',
    },
    'end:EndToEndFlow': {
        reason: 'Tail-word artifact of the same name; `end` here is English, not the connection-end keyword.',
        removedBy: 'deliberate',
    },
    'flow:FlowSpecification': {
        reason: 'AADL flow specification (source/sink/path) — a declaration about a component, not a flow usage.',
        removedBy: 'deliberate',
    },
    'flow:FlowComprisesSpec': {
        reason: 'Relates an end-to-end flow to its ordered segments; AADL flow implementation, which `flow` does not express.',
        removedBy: 'deliberate',
    },
    'flow:FlowTraversesBinding': {
        reason: 'Binding-aware latency accrual (AADL); names a flow, is not one.',
        removedBy: 'deliberate',
    },
    // ── The two AADL bindings added by plan C1 ──
    // Both are `allocation def`s rooted on Allocations::Allocation, which is
    // the standard's own answer for "this is an allocation". The collision is
    // on the ENGLISH word: AADL's `actual_memory_binding` and
    // `actual_connection_binding` are bindings of a component to a resource,
    // and SysML's `binding` is the binding connector `a = b`. Renaming to
    // dodge the word would cost the AADL term, which is what makes the
    // correspondence checkable — same judgement as FlowTraversesBinding.
    'binding:MemoryBinding': {
        reason: 'AADL actual_memory_binding — which memory a software component occupies. `bind` writes an anonymous binding connector, a different statement.',
        removedBy: 'deliberate',
    },
    'binding:ConnectionBinding': {
        reason: 'AADL actual_connection_binding — which medium carries an exchange. Same divergence as MemoryBinding.',
        removedBy: 'deliberate',
    },
    'connection:ConnectionBinding': {
        reason: 'Head word names the connection being bound, at the far end of the relation; the relation itself is an `allocation def`.',
        removedBy: 'deliberate',
    },
    'binding:FlowTraversesBinding': {
        reason: 'Tail word is the AADL binding it traverses, unrelated to SysML `binding` connectors.',
        removedBy: 'deliberate',
    },
    'flow:FlowServesUseCase': {
        reason: 'Traceability from a route to the use case it serves; neither end is a flow usage.',
        removedBy: 'deliberate',
    },
    'case:FlowServesUseCase': {
        reason: 'Tail word names the use case at the far end, not a `case` declaration.',
        removedBy: 'deliberate',
    },
    'flow:ActivityFlow': {
        reason: 'An action def in the operational layer — the shape of an operative activity, not an item transfer.',
        removedBy: 'deliberate',
    },
    'flow:InteractionFlow': {
        reason: 'An action def: a user-interaction sequence, not an item transfer.',
        removedBy: 'deliberate',
    },
    'flow:FlowCommand': {
        reason: 'An item def — the commanded infusion flow rate. Clinical fluid flow, not SysML `flow`.',
        removedBy: 'deliberate',
    },
    'connect:ComponentConnects': {
        reason: 'A connection def named for what it does; `connect` writes a connection usage, and the def is what the usage is typed by.',
        removedBy: 'deliberate',
    },
    // `connect:ConnectsPhysically` was here until R10-S6: deleted in favour
    // of native `connect`. Untyped connections built to nothing before this
    // (`resolveConnection` bailed on a missing `conn.type`) — the same
    // silent-drop shape as `BindingUsage`/`ExposeMember`.
    'crosses:CrossesTrustBoundary': {
        reason: 'Security relation: an exchange item crosses a trust boundary. `crosses` in SysML is the crossing-connector keyword, a different statement.',
        removedBy: 'deliberate',
    },
    'bind:BindsToInterface': {
        reason: 'Port-to-interface binding as a traceable relation with its own identity; `bind` writes an anonymous binding connector.',
        removedBy: 'deliberate',
    },
    'interface:BindsToInterface': {
        reason: 'Tail word names the interface at the far end.',
        removedBy: 'deliberate',
    },
    'binding:DataBinding': {
        reason: 'UI data binding — which model value a screen field shows. Nothing to do with SysML binding connectors.',
        removedBy: 'deliberate',
    },
    'binding:ProjectMethodBinding': {
        reason: 'The project-to-methodology binding; a methodology concept with no SysML counterpart.',
        removedBy: 'deliberate',
    },
    'binding:DhfDocumentBinding': {
        reason: 'Binds a DHF document template to its content query; a document concept.',
        removedBy: 'deliberate',
    },
    'view:ViewRule': {
        reason: 'A rule ABOUT views. `view` declares one; this classifies them.',
        removedBy: 'deliberate',
    },
    'view:ViewInclusionRule': {
        reason: 'Says which elements a view may include; metadata about views, not a view.',
        removedBy: 'deliberate',
    },
    'view:ViewSelectionQuery': {
        reason: 'The query a view runs to select content; a query, not a view.',
        removedBy: 'deliberate',
    },
    'viewpoint:Viewpoint': {
        reason: 'ISO 42010 viewpoint carrying allowedElementKinds, governing concerns and model kinds — richer than the SysML `viewpoint` usage, which MEMO views still conform to.',
        removedBy: 'deliberate',
    },
    'case:VerificationCase': {
        reason: 'Declared `verification def`, whose full keyword is `verification case def`; the construct-alignment exemption only sees the first token.',
        removedBy: 'deliberate',
    },
    'case:MemoVerificationCase': {
        reason: 'Same as VerificationCase — the abstract base it specializes.',
        removedBy: 'deliberate',
    },
    'case:ValidationCase': {
        reason: 'Same as VerificationCase; validation against intended use rather than against a requirement.',
        removedBy: 'deliberate',
    },
    'action:ActivityAction': {
        reason: 'A part def naming the ACTION-carrying element of an FMEA/activity table row, not an action usage.',
        removedBy: 'deliberate',
    },
    'action:FMEAAction': {
        reason: 'An FMEA corrective action — a document row, not a behaviour.',
        removedBy: 'deliberate',
    },
    // `action:ActionInvokesFunction` was here until R10-S6: deleted in
    // favour of native `perform`, which already collapses onto `performs`.
    'action:ElementTriggersAction': {
        reason: 'Relation from a UI element to the action it triggers; names its target end.',
        removedBy: 'deliberate',
    },
    'event:UIEvent': {
        reason: 'A UI event kind (tap, drag, long-press); `event` in SysML writes an event occurrence usage.',
        removedBy: 'deliberate',
    },
    'event:LogTherapyEvent': {
        reason: 'A clinical logging action in the GPCA behaviour; "event" is the therapy record it writes.',
        removedBy: 'deliberate',
    },
        'event:SequenceOfEvents': {
        reason: 'ISO 14971 sequence of events leading to a hazardous situation; a risk-analysis item.',
        removedBy: 'deliberate',
    },
    'event:ProducesEvent': {
        reason: 'Relation naming a produced domain event; the end is an item, not an occurrence usage.',
        removedBy: 'deliberate',
    },
    'event:ContainsEvent': {
        reason: 'Fault-tree containment; the contained thing is a FaultTreeEvent.',
        removedBy: 'deliberate',
    },
    'interface:InterfaceElement': {
        reason: 'The MEMO base for boundary-bearing parts. `interface def` declares an interface; this classifies what carries one.',
        removedBy: 'deliberate',
    },
        'interface:UserInterface': {
        reason: 'The human-machine interface of the device as a design subject; not a SysML interface def.',
        removedBy: 'deliberate',
    },
    'interface:InterfaceItem': {
        reason: 'An item def: what crosses an interface. `interface` names the boundary, not the payload.',
        removedBy: 'deliberate',
    },
    'item:ConfigurationItem': {
        reason: 'IEC 62304 / ISO 13485 configuration item — a regulated term.',
        removedBy: 'deliberate',
    },
    'analysis:AnalysisArtifact': {
        reason: 'The MEMO base for analysis outputs (FMEA, fault tree, notebook). `analysis def` is a case; these are its records.',
        removedBy: 'deliberate',
    },
    'analysis:AnalysisNotebook': {
        reason: 'A computational notebook backing an analysis; an artifact, not an analysis case.',
        removedBy: 'deliberate',
    },
    'constraint:TimingConstraint': {
        reason: 'A timing budget element carrying values; `constraint def` declares a boolean predicate.',
        removedBy: 'deliberate',
    },
    'constant:SystemConstant': {
        reason: 'A named system constant as a documented element; `constant` is a feature modifier.',
        removedBy: 'deliberate',
    },
    'attribute:AttributeConsistencyRule': {
        reason: 'A rule ABOUT attributes.',
        removedBy: 'deliberate',
    },
    'comment:ModelComment': {
        reason: 'A review comment with author, status and disposition — workflow content. `comment` is an annotation with none of that.',
        removedBy: 'deliberate',
    },
    'comment:CommentsOn': {
        reason: 'Relates a ModelComment to its subject; the subject link a review workflow needs to query.',
        removedBy: 'deliberate',
    },
    'alias:ElementKindAlias': {
        reason: 'Records that a project calls a kind by another name; `alias` renames a member in a namespace.',
        removedBy: 'deliberate',
    },
    'library:MethodologyLibrary': {
        reason: 'A methodology package collection; `library` marks a standard library package.',
        removedBy: 'deliberate',
    },
    'standard:RegulatoryStandard': {
        reason: 'ISO/IEC/FDA standard as a traceable item; `standard` marks a standard library package.',
        removedBy: 'deliberate',
    },
    'standard:StandardClause': {
        reason: 'A numbered clause of a RegulatoryStandard.',
        removedBy: 'deliberate',
    },
    'entry:SBOMEntry': {
        reason: 'A software bill-of-materials row; `entry` is a state-machine entry action.',
        removedBy: 'deliberate',
    },
    'occurrence:ScenarioOccurrence': {
        reason: 'A recorded run of a scenario; `occurrence def` is the KerML root of occurrences generally.',
        removedBy: 'deliberate',
    },
    'require:RequiresResource': {
        reason: 'Relates a component to a resource it needs; `require` asserts a requirement inside a requirement def.',
        removedBy: 'deliberate',
    },
    'requirement:RequirementDriver': {
        reason: 'The base for things that DRIVE requirements (needs, hazards, threats); not a requirement.',
        removedBy: 'deliberate',
    },
    'requirement:DerivesCyberRequirement': {
        reason: 'Threat/risk to security requirement derivation; names its target end.',
        removedBy: 'deliberate',
    },
    'state:UIState': {
        reason: 'A screen state in the UI layer; a part def carrying layout and data bindings.',
        removedBy: 'deliberate',
    },
    // `state:PresentsState` was here until R10-S6: deleted, zero usages
    // anywhere in the tree, and native `exhibit state` does not actually fit
    // `UIState` (a part def, not a state def).
    'use:UseContext': {
        reason: 'IEC 62366 use context — where and by whom the device is used.',
        removedBy: 'deliberate',
    },
    'use:UseEnvironment': {
        reason: 'IEC 62366 use environment; a regulated term.',
        removedBy: 'deliberate',
    },
    'use:UseError': {
        reason: 'IEC 62366 use error; a regulated term and never a `use case`.',
        removedBy: 'deliberate',
    },
    'use:IntendedUse': {
        reason: 'ISO 14971 / IEC 62366 intended use; a regulated term.',
        removedBy: 'deliberate',
    },
    // `use:ModuleUses` was here until R10-S6: `ModuleUses` is deleted in
    // favour of native `dependency`, and `dependency` collapses it with
    // `MonitorsChannel` too — see `dependency` in relationship-registry.ts.
    'decide:Decides': {
        reason: 'Relates an architecture decision record to what it decides; `decide` is a control node in an action body.',
        removedBy: 'deliberate',
    },
    'rendering:LayerRendering': {
        reason: 'Per-layer colour and icon for the Architect canvas; `rendering def` is the SysML textual-rendering mechanism.',
        removedBy: 'deliberate',
    },
    'for:RationaleFor': {
        reason: '`for` is an English particle in a relation name, not the loop keyword.',
        removedBy: 'deliberate',
    },
    'from:DerivesFrom': {
        reason: '`from` is an English particle in a relation name; SysML uses it in flow syntax.',
        removedBy: 'deliberate',
    },
};

/**
 * Feature-name collisions that deliberately remain. The key includes the
 * source path because features are local to their containing definition.
 *
 * This starts empty, but it is intentionally a reasoned escape hatch: a valid
 * future divergence must be recorded rather than deleting the lint.
 */
const ALLOWED_FEATURES: Record<string, { reason: string; removedBy: 'deliberate' }> = {};

/** Every (keyword, definition) pair the ontology collides on today. */
async function collisions(): Promise<Collision[]> {
    const keywords = reservedKeywords();
    const { registries } = await loadOntologyRegistries(GPCA_PROJECT);

    const definitions = [
        ...(registries.kindRegistry?.entries() ?? [])
            .map(entry => ({ name: entry.name, construct: entry.sysmlConstruct ?? '' })),
        // The construct comes from the registry, not from an assumption that
        // every relation is a `connection def` — since C1 the ontology also
        // declares `allocation def`s, and the construct-alignment exemption is
        // only sound if it reads the construct the definition actually used.
        ...(registries.relationshipRegistry?.entries() ?? [])
            // A native relation is a projection of a SysML construct, not a
            // declared MEMO definition. Its legacy sysmlName remains the graph
            // contract while the ontology definition has been retired.
            .filter(entry => !entry.nativeKeyword)
            .map(entry => ({ name: entry.sysmlName, construct: entry.sysmlConstruct ?? 'connection def' })),
    ];
    if (definitions.length < 100) throw new Error(`registries loaded only ${definitions.length} definitions`);

    const found: Collision[] = [];
    const seen = new Set<string>();
    for (const definition of definitions) {
        // An enum name cannot re-spell a keyword: no reserved keyword
        // introduces an enumeration literal set.
        if (definition.construct === 'enum def') continue;
        const ownKeywords = new Set(definition.construct.split(' ').filter(token => token !== 'def'));
        const parts = words(definition.name);
        for (const word of new Set([parts[0], parts[parts.length - 1]])) {
            if (!word || word.length < 3) continue;
            for (const stem of stems(word)) {
                // `ownKeywords` is the construct-alignment exemption: a name
                // that agrees with its own construct is not competing with it.
                if (!keywords.has(stem) || ownKeywords.has(stem) || stem === 'def') continue;
                const collision = { keyword: stem, definition: definition.name, construct: definition.construct };
                if (seen.has(keyOf(collision))) continue;
                seen.add(keyOf(collision));
                found.push(collision);
            }
        }
    }
    return found;
}

describe('MEMO definition names against SysML v2 reserved keywords', () => {
    it('reads the keyword list out of the vendored normative BNF', () => {
        const keywords = reservedKeywords();
        // Guards the extraction itself: a silently empty or truncated parse
        // would make the whole lint pass by finding nothing.
        expect(keywords.size).toBeGreaterThan(100);
        for (const keyword of ['perform', 'exhibit', 'include', 'message', 'transition', 'stakeholder', 'concern']) {
            expect(keywords.has(keyword), `'${keyword}' missing from the parsed RESERVED_KEYWORD production`).toBe(true);
        }
    });

    it('every collision is a recorded decision', async () => {
        if (!existsSync(GPCA_PROJECT)) return; // sibling ontology checkout absent
        const unrecorded = (await collisions()).filter(collision => !(keyOf(collision) in ALLOWED));
        const detail = unrecorded
            .map(c => `\n  '${keyOf(c)}': reserved keyword '${c.keyword}' vs ${c.construct} ${c.definition}`)
            .join('');
        expect(
            unrecorded.map(keyOf),
            `MEMO definitions collide with SysML v2 reserved keywords and are not in the allow-list.${detail}\n\n`
            + 'Either use the keyword, or add the entry to ALLOWED with a reason and the session that removes it.\n',
        ).toEqual([]);
    });

    it('the allow-list holds no entry that has stopped colliding', async () => {
        if (!existsSync(GPCA_PROJECT)) return;

        // The burndown only measures anything if retired entries leave. An
        // allow-list that outlives the collisions it excuses reports a debt
        // that has already been paid — and an entry that never matched anything
        // is a reason nobody will ever read.
        const live = new Set((await collisions()).map(keyOf));
        const stale = Object.keys(ALLOWED).filter(key => !live.has(key));
        expect(stale, `Allow-list entries whose definition or keyword no longer exists:\n  ${stale.join('\n  ')}\n`).toEqual([]);
    });
});

describe('MEMO extension feature names against SysML v2 reserved keywords', () => {
    it('rejects a reserved keyword used as an extension feature name', async () => {
        // Deliberate negative: this is the exact shape that made `memo build`
        // red while the prior registry-only lint stayed green.
        //
        // The fixture used `message` until the grammar stopped accepting it as
        // a name at all. A word MEMO cannot parse as a name never reaches this
        // lint, so it cannot exercise it — the negative control has to use a
        // keyword the grammar still admits, which is precisely the set this
        // lint exists to police.
        const collisions = await featureCollisionsFromSource(`package Fixture {
    port def Publisher {
        out item state : Payload;
    }
}
`, 'fixture.sysml');
        expect(collisions.map(featureKeyOf)).toEqual(['state:fixture.sysml:state']);
    });

    it('every extension feature collision is a recorded decision', async () => {
        if (!existsSync(EXTENSIONS)) return;
        const unrecorded = (await extensionFeatureCollisions()).filter(collision => !(featureKeyOf(collision) in ALLOWED_FEATURES));
        const detail = unrecorded
            .map(c => `\n  '${featureKeyOf(c)}': reserved keyword '${c.keyword}' vs ${c.construct} ${c.feature}`)
            .join('');
        expect(
            unrecorded.map(featureKeyOf),
            `MEMO extension features collide with SysML v2 reserved keywords and are not in the allow-list.${detail}\n\n`
            + 'Either rename the feature, or add the entry to ALLOWED_FEATURES with a reason.\n',
        ).toEqual([]);
    });

    it('the feature allow-list holds no entry that has stopped colliding', async () => {
        if (!existsSync(EXTENSIONS)) return;
        const live = new Set((await extensionFeatureCollisions()).map(featureKeyOf));
        const stale = Object.keys(ALLOWED_FEATURES).filter(key => !live.has(key));
        expect(stale, `Feature allow-list entries whose collision no longer exists:\n  ${stale.join('\n  ')}\n`).toEqual([]);
    });
});
