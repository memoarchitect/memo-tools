// =============================================================================
// MEMO SysML v2 Grammar — Langium definition
//
// Covers the SysML v2 subset needed for MEMO systems engineering modeling:
//   package, part def, requirement def, action def, item def, port def,
//   interface def, connection def, attribute def, enum def,
//   viewpoint def, view def, import, specialization (:>),
//   typed connections, doc comments
//
// Behavior constructs (Phase 5):
//   action def with in/out/inout parameters, action usage (composite),
//   flow connection usage, succession usage, allocate usage, item def
//
// Design notes:
//   - DOC_COMMENT is a non-hidden terminal that captures `doc /* ... */`
//     as a single token, preventing the hidden ML_COMMENT from consuming it
//   - FeatureName allows 'part' keyword as identifier in end/connection contexts
//     (SysML v2 uses `end part[0..*]` in connection defs)
//   - QualifiedName is a data type rule returning string; cross-references
//     are resolved programmatically in the semantic model layer
// =============================================================================

grammar MemoSysML

// ─── Entry point ─────────────────────────────────────────────────────────────

entry Model:
    members+=NamespaceMember*;

// The root namespace accepts definitions, not only packages. SysML v2 permits
// members at the root of a file and SysIDE accepts `part def X;` standing alone,
// so rejecting it here was a MEMO-only restriction: valid source failed to
// parse, and the AST-based loaders then reported the file as contributing
// nothing. MEMO's own content still nests everything in packages — the
// portability gate requires that for qualified naming — but the grammar must
// not reject source the compiler of record accepts.
NamespaceMember:
    PackageDeclaration
    | ImportDeclaration
    | AliasDeclaration
    | DefinitionMember
    | UseCaseDeclaration
    | Dependency
    | DocComment;

// ─── Package ─────────────────────────────────────────────────────────────────

// Standard SysML v2: a package DECLARATION takes a single-identifier name.
// Qualified names (`::`) are for references only; deep namespaces are expressed by
// NESTING packages (`package memo { package arch { … } }`). The model builder
// reconstructs the full FQN from the nesting (builder.ts: parentPackage::pkg.name).
// `standard` comes from the normative `LibraryPackage` production
// (`bnf/KerML-textual-bnf.kebnf:1446`), where it is the flag that marks a
// library package as part of the standard library rather than a user one. Every
// one of the 94 vendored normative library files opens with `standard library
// package`, so without it the parser fails on line 1 of the entire corpus.
PackageDeclaration:
    isStandard?='standard'? isLibrary?='library'? 'package' name=ID '{'
        members+=PackageMember*
    '}';

// Flows and successions are legal package members, not only usage-body members:
// a flow between two action usages declared side by side in a package has no
// enclosing action to sit inside. SysIDE accepts them here, so the grammar does.
PackageMember:
    PackageDeclaration
    | AliasDeclaration
    | ImportDeclaration
    | DefinitionMember
    | UsageMember
    | ItemUsage
    | AttributeMember
    | UseCaseDeclaration
    | FlowConnectionUsage
    | SuccessionUsage
    | AbstractConnectionUsage
    | ConnectionUsage
    | SatisfyRequirementUsage
    // Contributes AllocateUsage along with the thirteen other native
    // mechanisms. MEMO declares its actors, stakeholders and concerns as
    // PACKAGE members (`part usrClinician : User;`), so their native spellings
    // have to be legal in the same place or the migration could not be a
    // spelling change.
    | ArcadiaMember
    | Dependency
    | MetadataApplication
    | DocComment;

// Namespace indirection used by the canonical memo::* facade. Each source file
// owns a unique package for reliable SysIDE indexing; aliases reconstruct the
// user-facing hierarchy without reopening packages across documents.
AliasDeclaration:
    'alias' name=AliasName 'for' target=QualifiedName ';';

// UNRESTRICTED_NAME carries the facade segments SysIDE reserves as keywords
// (`'analysis'`, `'verification'`), which is how SysML v2 spells them.
AliasName returns string:
    ID | UNRESTRICTED_NAME | 'verification';

// ─── Import ──────────────────────────────────────────────────────────────────

ImportDeclaration:
    visibility=('private' | 'public')? 'import' path=ImportPath ';';

// Separate rule to handle wildcard imports (e.g. `import MEMO_Ontology_Medical::*`)
// without LL parser ambiguity on `::` lookahead in QualifiedName
ImportPath returns string:
    ID ('::' (ID | '*'))*;

// ─── Definitions ─────────────────────────────────────────────────────────────

DefinitionMember:
    PartDefinition
    | RequirementDefinition
    | VerificationDefinition
    | StateDefinition
    | ActionDefinition
    | ItemDefinition
    | PortDefinition
    | InterfaceDefinition
    | ConnectionDefinition
    | AllocationDefinition
    | ConcernDefinition
    | AttributeDefinition
    | ConstraintDefinition
    | EnumDefinition
    | ViewpointDefinition
    | ViewDefinition
    | MetadataDefinition;

// SysML v2 semantic-metadata definition — the standard, portable mechanism for
// extending the ontology with domain semantics. Applied to elements via `@Name`.
// The optional `<shortName>` is SysML v2's Identification short name, and for a
// SemanticMetadata it is the KEYWORD the metadata introduces — `<derive>` in the
// OMG's own `metadata def <derive> DerivedRequirementMetadata :> SemanticMetadata`
// (Domain Libraries/Requirement Derivation/RequirementDerivation.sysml). Without
// it a metadata def cannot say which word it defines, which is most of the point.
//
// The short name is lexed as ONE token rather than as `'<' ID '>'`, because the
// word it introduces is almost always already a keyword — `<allocate>` and
// `<derive>` both fail an ID match. A keyword is exactly what a metadata def
// exists to introduce, so the production must not be restricted to non-keywords.
MetadataDefinition:
    'metadata' 'def' shortName=SHORT_NAME? name=ID specialization=Specialization?
    ('{' body+=DefinitionBodyMember* '}' | ';');

// Metadata application: `@AnnotationType;` or `@AnnotationType { redefinitions }`
// applies a metadata def to the enclosing element (standard SysML v2 `@` annotation).
MetadataApplication:
    '@' type=QualifiedName ('{' body+=UsageBodyMember* '}' | ';');

// `isVariation` is the second half of the normative `BasicDefinitionPrefix`
// (`isAbstract ?= 'abstract' | isVariation ?= 'variation'`,
// SysML-textual-bnf.kebnf:224). A variation definition is a CHOICE POINT: its
// `variant` members are the alternatives, exactly one of which a configuration
// picks. That is the construct ARCADIA configurations and situations need, and
// the one AADL mode-conditioned configuration needs (plan §C4); MEMO could not
// express either. It is declared on part / attribute / item, which is where a
// choice point can occur in MEMO's content — not on every definition, because a
// production nobody can reach is not coverage.
PartDefinition:
    isAbstract?='abstract'? isVariation?='variation'? 'part' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

RequirementDefinition:
    isAbstract?='abstract'? 'requirement' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// SysML v2 verification case definition (VerificationCases::VerificationCase).
// A behaviour, so it may not specialize a part-based MEMO base.
VerificationDefinition:
    isAbstract?='abstract'? 'verification' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// SysML v2 state definition (States::StateAction) — a behaviour. MEMO uses it
// for state machines and their mode states; transitions stay part-based.
StateDefinition:
    isAbstract?='abstract'? 'state' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

ActionDefinition:
    isAbstract?='abstract'? behaviorKind=('action' | 'operator' | 'function') 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=ActionDefBodyMember* '}' | ';');

ItemDefinition:
    isAbstract?='abstract'? isVariation?='variation'? 'item' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

PortDefinition:
    isAbstract?='abstract'? 'port' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// Interface defs, like connection defs, may declare `end` features naming the
// two sides of the interface (e.g. end providerPort / end consumerPort).
InterfaceDefinition:
    isAbstract?='abstract'? 'interface' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=ConnectionBodyMember* '}' | ';');

ConnectionDefinition:
    isAbstract?='abstract'? 'connection' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=ConnectionBodyMember* '}' | ';');

// SysML v2 allocation definition (`AllocationDefinition = OccurrenceDefinitionPrefix
// 'allocation' 'def' Definition`, SysML-textual-bnf.kebnf:792). An allocation IS a
// connection — `Allocations::Allocation :> BinaryConnection` — so it takes the same
// body as a connection def, and `allocation def X :> Allocations::Allocation` is
// what lets MEMO's AllocatedTo / DeploysTo / BuildsInto root on the standard's
// allocation base instead of standing beside it (plan B2).
AllocationDefinition:
    isAbstract?='abstract'? 'allocation' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=ConnectionBodyMember* '}' | ';');

// SysML v2 concern definition (`ConcernDefinition = OccurrenceDefinitionPrefix
// 'concern' 'def' DefinitionDeclaration RequirementBody`, :1493). ISO 42010's
// concern, which MEMO spells `part def Concern`. Its body is a requirement body,
// so it may carry `subject`, `stakeholder`, and `frame` members. Those reach it
// through DefinitionBodyMember rather than through a concern-only body rule —
// the same choice the grammar already makes for `verify`, and for the same
// reason: SysIDE is the compiler of record for where a member is legal, and a
// per-construct body rule here would only duplicate that judgement less well.
ConcernDefinition:
    isAbstract?='abstract'? 'concern' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

AttributeDefinition:
    isAbstract?='abstract'? isVariation?='variation'? 'attribute' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

ConstraintDefinition:
    isAbstract?='abstract'? 'constraint' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// An enum body may carry doc comments between its literals. SysIDE accepts
// them and MEMO did not, so a documented enumeration — which is the only place
// the meaning of a literal can be written down — failed to parse. `literals`
// keeps its name and its contents so every existing consumer is unaffected.
EnumDefinition:
    'enum' 'def' name=ID '{'
        (literals+=EnumLiteral | docs+=DocComment)*
    '}';

ViewpointDefinition:
    isAbstract?='abstract'? 'viewpoint' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

ViewDefinition:
    isAbstract?='abstract'? 'view' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// ─── Connection definition body ─────────────────────────────────────────────

ConnectionBodyMember:
    EndDeclaration | FlowConnectionUsage | DefinitionBodyMember;

// An end may redefine the inherited end of its supertype — in MEMO every
// relation binds its two ends to Connections::BinaryConnection::source and
// ::target, so the ends of a MEMO relation are readable as ordinary SysML
// connection ends by any conforming tool.
EndDeclaration:
    'end' name=FeatureName (':' isConjugated?='~'? type=QualifiedName)? multiplicity=Multiplicity?
    (redefines?=(':>>' | 'redefines') redefinedEnd=QualifiedName)? ';';

Multiplicity:
    '[' lower=INT '..' (upper=INT | unbounded?='*') ']'
    | '[' unbounded?='*' ']'
    | '[' exact=INT ']';

// ─── Enum literal ────────────────────────────────────────────────────────────

EnumLiteral:
    'enum' name=EnumLiteralName ';';

EnumLiteralName returns string:
    ID | UNRESTRICTED_NAME
    | 'in' | 'out' | 'inout' | 'part' | 'requirement' | 'action' | 'item' | 'port'
    | 'interface' | 'connection' | 'attribute' | 'constraint' | 'enum' | 'view' | 'viewpoint'
    | 'ref' | 'import' | 'package' | 'flow' | 'first' | 'allocate' | 'library' | 'private' | 'public' | 'state' | 'verification'
    | 'satisfy' | 'verify'
    | 'use' | 'fork' | 'join';

// ─── Usages (instances) ─────────────────────────────────────────────────────

UsageMember:
    PartUsage
    | RequirementUsage
    | VerificationUsage
    | StateUsage
    | InterfaceUsage
    | ActionUsage
    | PortUsage
    | ViewUsage;

PartUsage:
    'part' name=ID (':' type=QualifiedName)?
    ('{' body+=UsageBodyMember* '}' | ';');

// SysML v2 `use case def` / `use case` share a single leading `use case` token
// pair. Branching inside one rule keeps the def-vs-usage decision local instead
// of forcing cross-alternative lookahead past the `case` keyword.
UseCaseDeclaration:
    isAbstract?='abstract'? 'use' 'case'
    (   isDefinition?='def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
        ('{' body+=DefinitionBodyMember* '}' | ';')
      | name=ID (':' type=QualifiedName)?
        ('{' usageBody+=UsageBodyMember* '}' | ';')
    );

// Item usage: standalone (`item x : T { … }`), directioned port payload
// (`in item reading : T;` / `out item command : T;`), or a bound feature value.
ItemUsage:
    direction=('in' | 'out' | 'inout')? 'item' name=MemberName preMultiplicity=Multiplicity?
    (':' type=QualifiedName multiplicity=Multiplicity?)?
    ('=' boundRef=QualifiedName)?
    ('{' body+=UsageBodyMember* '}' | ';');

RequirementUsage:
    'requirement' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

// SysML v2 verification case usage: `verification vc : SomeCase { … }`.
VerificationUsage:
    'verification' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

// SysML v2 state usage: `state modeIdle : ModeState { … }`.
StateUsage:
    'state' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

// SysML v2 interface usage, including the normative typed-connect form:
// `interface fuel : FuelInterface connect tank.port to engine.port { … }`.
InterfaceUsage:
    'interface' name=ID (':' type=QualifiedName)?
    (   'connect' source=ReferenceName 'to' target=ReferenceName
        ('{' body+=UsageBodyMember* '}' | ';')
      | ('{' body+=UsageBodyMember* '}' | ';')
    );

// ActionUsage supports both typed (action name : Type;) and composite
// (action name { nested-actions, flows, successions }) forms.
ActionUsage:
    behaviorKind=('action' | 'operator' | 'function') name=ActionName (':' type=QualifiedName)?
    ('{' body+=ActionUsageBodyMember* '}' | ';');

// Activity actions use their own concrete forms. Keep the payload and endpoint
// references structural: they are semantic inputs for lowering, not display text.
AcceptActionUsage:
    'action' name=ActionName 'accept' payloadName=ID ':' payloadType=QualifiedName ';';

// `then` on a body member is a succession from the member before it, so it is
// captured rather than consumed — a discarded `then` leaves the node floating
// with no incoming control flow.
SendActionUsage:
    followsPrevious?='then'? 'action' name=ActionName 'send' receiver=FeatureReference 'to' target=ReferenceName ';';

FeatureReference:
    segments+=ID ('.' segments+=ID)*;

ActionName returns string:
    ID | 'accept' | 'send' | 'terminate';

// SysML v2 terminate actions may be anonymous (`terminate;`, `then terminate;`)
// or named (`action rejected terminate;`). A name is important in diagrams
// with several distinct activity-final outcomes because it supplies the label
// and a stable identity for each final node.
TerminateUsage:
    {infer TerminateUsage} followsPrevious?='then'?
    (('action' name=ID)? 'terminate') ';';

PortUsage:
    direction=('in' | 'out' | 'inout')? 'port' isConjugated?='~'? name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

ViewUsage:
    'view' name=ID (':' type=QualifiedName)?
    ('{' body+=ViewBodyMember* '}' | ';');

ViewBodyMember:
    UsageBodyMember | ExposeMember;

ExposeMember:
    'expose' path=ExposePath ';';

ExposePath returns string:
    ID (('::' | '.') ID)* ('::' ('*' | '**'))?;

// ─── Connection usage (typed relationship instances) ─────────────────────────
// Syntax: connection : Type connect end1 ::> ref1 to end2 ::> ref2 ;

// A connection usage may carry a name. Named connections get a stable
// relationship ID that survives rebuilds, which authoring needs for
// inspection, deletion, and deep links.
ConnectionUsage:
    'connection' name=ID? (':' type=QualifiedName)?
    (   'connect' source=ConnectionEnd 'to' target=ConnectionEnd
        ('{' body+=UsageBodyMember* '}' | ';')
      | '{' body+=UsageBodyMember*
        'connect' source=ConnectionEnd 'to' target=ConnectionEnd ';'
        '}'
    );

ConnectionEnd:
    endName=FeatureName '::>' ref=ReferenceName;

// The BASE FEATURE of a connection definition — `abstract connection derivations
// : Derivation[*];` in the OMG's DerivationConnections. It is not a link; it is
// the feature every usage of that definition subsets, and it is what a
// SemanticMetadata's `baseType` has to point at. Without one, `baseType` has
// nothing to name.
//
// The leading `abstract` is what keeps this out of ConnectionUsage's way: that
// rule always continues to `connect` or `{`, this one always ends at `;`.
AbstractConnectionUsage:
    isAbstract?='abstract' 'connection' name=ID ':' type=QualifiedName multiplicity=Multiplicity? ';';

// ─── Behavior: Action definition body ───────────────────────────────────────
// Action defs can have in/out/inout parameters plus regular body members

ActionDefBodyMember:
    ActionParameterMember | TerminateUsage | ActionUsage | AcceptActionUsage | SendActionUsage | ControlNodeUsage | RequireConstraintMember | UsageBodyMember;

ActionParameterMember:
    direction=('in' | 'out' | 'inout') name=ID ':' type=QualifiedName ';';

// ─── Behavior: Action usage body ────────────────────────────────────────────
// Composite actions contain nested actions, flow connections, successions

// FlowConnectionUsage / SuccessionUsage / ConnectionUsage are contributed by
// UsageBodyMember; listing them again here would make the alternatives ambiguous.
ActionUsageBodyMember:
    ActionParameterMember | TerminateUsage | ActionUsage | AcceptActionUsage | SendActionUsage | ControlNodeUsage | UsageBodyMember;

// ─── Behavior: Control nodes (fork / join) ──────────────────────────────────
// SysML v2 activity control nodes. A `fork` splits one incoming control flow
// into concurrent outgoing flows; a `join` synchronizes concurrent flows back
// into a single flow. They carry no parameters — ordering and the branches
// they split/merge are expressed by the surrounding succession usages that
// reference the node by name.
//   fork parallelPrep;
//   first verify then parallelPrep;
//   first parallelPrep then prime;
//   first parallelPrep then selfTest;
ControlNodeUsage:
    controlKind=('fork' | 'join' | 'decide' | 'merge') name=ID ';';

// ─── Behavior: Flow connection usage ────────────────────────────────────────
// Syntax: flow of ItemType from source.port to target.port ;

// A flow usage may carry a NAME and a BODY, both of which this production used
// to drop. The normative grammar is
// `FlowUsage = OccurrenceUsagePrefix 'flow' FlowDeclaration DefinitionBody`
// with `FlowDeclaration : UsageDeclaration ValuePart? ('of' …)`
// (SysML-textual-bnf.kebnf:829, :837) — so a conforming flow takes a name from
// its UsageDeclaration and owns attributes in its body like any other usage.
//
// Dropping them was a MEMO divergence, not a language limit, and it was
// load-bearing: an anonymous, attribute-less flow can carry no `id`, hold no
// latency budget, and be referred to by nothing, which is irreconcilable with
// the identification core every MEMO element rests on. That is the whole reason
// FunctionalExchange and ComponentExchange exist as part defs beside the flows
// they stand in for.
FlowConnectionUsage:
    'flow' name=ID? 'of' itemType=QualifiedName 'from' source=FlowEnd 'to' target=FlowEnd
    ('{' body+=UsageBodyMember* '}' | ';');

FlowEnd:
    ref=DottedName;

// Dot-separated qualified name for flow endpoints (e.g. receive.prescription)
DottedName returns string:
    DottedNameSegment ('.' DottedNameSegment)*;

DottedNameSegment returns string:
    ID | 'accept' | 'send' | 'terminate';

// ─── Behavior: Succession usage ─────────────────────────────────────────────
// Syntax: first start then action1 then action2 then done ;

SuccessionUsage:
    'succession'? 'first' steps+=SuccessionStep ('then' steps+=SuccessionStep)+ ';';

SuccessionStep:
    ref=SuccessionRef ('if' guard=OrExpr)?;

SuccessionRef returns string:
    'start' | 'done' | ID;

// ─── Behavior: Allocate usage ───────────────────────────────────────────────
// Syntax: allocate actionUsage to partUsage ;
//
// The `allocation` prefix is the TYPED form — `AllocationUsage = 'allocation'
// UsageDeclaration UsageBody` (SysML-textual-bnf.kebnf:794), written in the
// corpus as
//
//   allocation torqueGenAlloc : LogicalToPhysical allocate torqueGenerator to powerTrain;
//
// It is the same statement as bare `allocate` plus a name and an `allocation
// def` to type it, which is what carries MEMO's per-allocation distinctions
// (function allocation vs. deployment vs. build) without a private connection
// def per case. Folded into this rule rather than added as a sibling, because
// both forms end in the same `allocate … to …` and splitting them would make
// the alternatives ambiguous.
AllocateUsage:
    ('allocation' name=ID? (':' type=QualifiedName)?)?
    'allocate' source=ReferenceName 'to' target=ReferenceName
    ('{' body+=UsageBodyMember* '}' | ';');

// ─── Requirements: native satisfaction and verification ─────────────────────
//
// The two relations SysML v2 already provides for requirement traceability.
// MEMO spells them today as the `SatisfiedBy` / `VerifiedBy` connection defs;
// the language spells them as usages, and every conforming tool reads the
// language spelling. Both parse, and the model builder projects both onto the
// same trace edge, so a model may use either while the migration runs.
//
// `SatisfyRequirementUsage` (SysML-textual-bnf.kebnf:1470) declares the
// assertion prefix as `'assert' ('not')?`. The normative training files write
// the bare form — `satisfy vehicleSpecification by vehicle_design;`
// ("32. Requirements/Requirement Satisfaction.sysml") — so the prefix is
// optional here and `isNegated` records a negative satisfaction claim, which
// is the property a `connection def` cannot express at all.
//
// The `by` part is optional in the normative grammar: inside a requirement
// body the satisfying subject is inherited rather than restated.
SatisfyRequirementUsage:
    (isAsserted?='assert' isNegated?='not'?)? 'satisfy' requirement=ReferenceName
    ('by' satisfyingFeature=ReferenceName)?
    ('{' body+=UsageBodyMember* '}' | ';');

// `RequirementVerificationMember` (SysML-textual-bnf.kebnf:1551) is a member of
// a requirement body — in practice the `objective` of a verification case:
//
//   verification def VehicleMassTest {
//       objective { verify vehicleMassRequirement; }
//   }
//
// The verifying case is the enclosing element, not a written end, so the
// builder takes it from the containment.
RequirementVerificationMember:
    'verify' requirement=ReferenceName
    ('{' body+=UsageBodyMember* '}' | ';');

// ─── ARCADIA mechanisms the language already spells ─────────────────────────
//
// Fourteen keywords MEMO had no production for, each one a mechanism MEMO
// spells privately as a `connection def` or a `part def` (plan §4). Every form
// below is taken from the normative BNF and checked against the training files
// that use it; none is a MEMO extension. Each has a builder path projecting the
// native usage onto the SAME trace edge MEMO's connection produces, so both
// spellings mean one thing while the migration runs.

// `PerformActionUsage = OccurrenceUsagePrefix 'perform' PerformActionUsageDeclaration
// ActionBody` (:948). One end is written, the other is the owner — the same
// shape as `verify`, with the ends swapped: `verify` names its source and owns
// its target, `perform` owns its source (the performer) and names its target.
//
//   part actorPrescriber { perform oaPrescribe; }
//   part camera { perform action takePhoto references takePicture; }
PerformActionUsage:
    'perform' (isAction?='action' name=ID (':' type=QualifiedName)? ('references' performed=ReferenceName)?
              | performed=ReferenceName)
    ('{' body+=UsageBodyMember* '}' | ';');

// `IncludeUseCaseUsage = OccurrenceUsagePrefix 'include' …` (:1572). A use case
// includes a sub-case; MEMO spells it `IncludesStep` / `Includes`.
IncludeUseCaseUsage:
    'include' (isUseCase?='use' 'case' name=ID (':' type=QualifiedName)?
              | included=ReferenceName)
    ('{' body+=UsageBodyMember* '}' | ';');

// `ExhibitStateUsage = OccurrenceUsagePrefix 'exhibit' …` (:1272). A component
// exhibits a state or mode; MEMO spells it `ExhibitsMode`.
ExhibitStateUsage:
    'exhibit' (isState?='state' name=ID (':' type=QualifiedName)?
              | exhibited=ReferenceName)
    ('{' body+=UsageBodyMember* '}' | ';');

// `SubjectUsage : ReferenceUsage = 'subject' UsageExtensionKeyword* Usage`
// (:1423) and `ObjectiveMember … 'objective' ObjectiveRequirementUsage` (:1523).
//
// The pair is what the standard uses instead of a verification link to a
// non-requirement: the verified thing becomes the case's SUBJECT and the
// requirement its OBJECTIVE, as in "34. Verification":
//
//   verification def VehicleMassTest {
//       subject testVehicle : Vehicle;
//       objective { verify vehicleMassRequirement; }
//   }
//
// That is what memo-native-requirement-relations decision 1 remodels 61 of 99
// VerifiedBy links onto, and it is also what makes that training file parse.
SubjectMember:
    'subject' name=MemberName (':' type=QualifiedName multiplicity=Multiplicity?)?
    (bindingOp=('=' | ':>' | ':>>') boundRef=ReferenceName)?
    ('{' body+=UsageBodyMember* '}' | ';');

ObjectiveMember:
    'objective' name=ID? (':' type=QualifiedName)?
    ('{' body+=UsageBodyMember* '}' | ';');

// `ActorUsage : PartUsage = 'actor' UsageExtensionKeyword* Usage` (:1454) and
// `StakeholderUsage : PartUsage = 'stakeholder' …` (:1460). ARCADIA operational
// analysis and ISO 42010; MEMO spells them `part def User` / `Actor` and
// `part def Stakeholder`.
ActorMember:
    'actor' name=MemberName (':' type=QualifiedName multiplicity=Multiplicity?)?
    (bindingOp=('=' | ':>' | ':>>') boundRef=ReferenceName)?
    ('{' body+=UsageBodyMember* '}' | ';');

StakeholderMember:
    'stakeholder' name=MemberName (':' type=QualifiedName multiplicity=Multiplicity?)?
    (bindingOp=('=' | ':>' | ':>>') boundRef=ReferenceName)?
    ('{' body+=UsageBodyMember* '}' | ';');

// `ConcernUsage = OccurrenceUsagePrefix 'concern' ConstraintUsageDeclaration
// RequirementBody` (:1497) and `FramedConcernMember … 'frame' FramedConcernUsage`
// (:1441). A viewpoint FRAMES a concern; MEMO spells that `FramesConcern` and
// `HasConcern`.
ConcernUsage:
    'concern' name=ID (':' type=QualifiedName)?
    ('{' body+=UsageBodyMember* '}' | ';');

FramedConcernMember:
    'frame' (isConcern?='concern' name=ID (':' type=QualifiedName)?
            | framed=ReferenceName)
    ('{' body+=UsageBodyMember* '}' | ';');

// `Dependency = ( PrefixMetadataAnnotation )* 'dependency' DependencyDeclaration
// RelationshipBody` (:51), with `DependencyDeclaration = ( Identification 'from' )?
// client ( ',' client )* 'to' supplier ( ',' supplier )*` (:56).
//
// THIS ONE CHANGES METACLASS. A dependency is a Relationship, not a Connection:
// it has no ends to redefine, it takes n clients and n suppliers rather than a
// source and a target, and it is annotated by a PREFIX metadata (`#refinement`)
// rather than by a connection def's `metadata def`. So `Realizes` does not
// become an allocation-shaped row — it becomes `#refinement dependency a to b;`,
// and the registry and serializer both have to treat it differently.
//
// `Identification` may be empty, which is why `dependency from a to b;` and
// `dependency Named from a to b;` are both the same alternative, and
// `dependency a to b;` is the one without it.
Dependency:
    (prefixMetadata+=PrefixMetadataAnnotation)*
    'dependency' (name=ID? 'from')?
    clients+=ReferenceName (',' clients+=ReferenceName)*
    'to' suppliers+=ReferenceName (',' suppliers+=ReferenceName)*
    ('{' body+=DocComment* '}' | ';');

// `#Name` — the standard's prefix form of a metadata application, distinct from
// the `@Name` postfix form MetadataApplication already covers. A dependency can
// only be annotated this way, and `#refinement` (ModelingMetadata.sysml:132) is
// the annotation that makes a dependency a refinement.
PrefixMetadataAnnotation:
    '#' type=QualifiedName;

// `TransitionUsage = 'transition' ( UsageDeclaration 'first' )? FeatureChainMember
// … 'then' TransitionSuccessionMember ActionBody` (:1281). MEMO models this as
// `part def Transition` with String pseudo-references; the language puts it
// inside a `state def`, where source and target really are the states.
//
// The name is only writable with `first`, which is what disambiguates
// `transition initial then off;` (no name, `initial` is the source) from
// `transition off_to_starting first off … then starting;`.
// The optional type comes from `UsageDeclaration = Identification
// FeatureSpecializationPart?`, so `transition tStart : Transition first …` is
// the normative spelling of a transition classified by a definition. MEMO needs
// it: the builder resolves an element's kind from its written type and from
// nothing else, so an untyped transition would have to be given the kind
// `Transition` by a hardcoded name in TypeScript — which is the thing
// [memo-tools-interprets-ontology-drives] forbids.
TransitionUsage:
    'transition' (name=ID (':' type=QualifiedName)? 'first')? source=ReferenceName
    ('accept' trigger=ReferenceName)?
    ('if' guard=OrExpr)?
    ('do' effect=ReferenceName)?
    'then' target=ReferenceName
    ('{' body+=UsageBodyMember* '}' | ';');

// `VariantUsageMember : VariantMembership = MemberPrefix 'variant'
// VariantUsageElement` (:254). One alternative of a `variation` choice point —
// either a nested usage (`variant part transmissionManual : TransmissionManual;`)
// or a reference to an existing one (`variant manualTransmission;`).
VariantMember:
    'variant' (usageKind=('part' | 'attribute' | 'item' | 'action' | 'port' | 'ref'))? name=MemberName
    (':' type=QualifiedName multiplicity=Multiplicity?)?
    ('=' value=AttributeValue)?
    ('{' body+=UsageBodyMember* '}' | ';');

// Element references may be package-qualified (`a::b`) or feature-qualified
// (`action.step`). Both forms occur in standard SysML relationship ends.
ReferenceName returns string:
    ID (('::' | '.') ID)*;

// ─── Body members ────────────────────────────────────────────────────────────

DefinitionBodyMember:
    AttributeMember | PartMember | PortUsage | ItemUsage | ViewUsage | RefMember | FeatureMembershipMember | RequireConstraintMember | RequirementVerificationMember | ArcadiaMember | MetadataApplication | DocComment;

// The fourteen native mechanisms, gathered once so both body rules stay
// readable and neither can drift out of step with the other.
ArcadiaMember:
    PerformActionUsage
    | IncludeUseCaseUsage
    | ExhibitStateUsage
    | SubjectMember
    | ObjectiveMember
    | ActorMember
    | StakeholderMember
    | ConcernUsage
    | FramedConcernMember
    | TransitionUsage
    | VariantMember
    | AllocateUsage;

// ─── Constraint expression (KerML boolean subset — ADR-1-18) ─────────────────
// Authored inside constraint def / requirement def bodies as:
//   require constraint { <boolean expr> }
//   assert  constraint { <boolean expr> }
// Precedence (loosest→tightest): or < and < cmp < add < mul < not < postfix(->) < primary.

RequireConstraintMember:
    kind=('require' | 'assert')? 'constraint' '{' expression=OrExpr '}';

OrExpr infers ConstraintExpr:
    AndExpr ({infer BinaryExpr.left=current} op='or' right=AndExpr)*;

AndExpr infers ConstraintExpr:
    CmpExpr ({infer BinaryExpr.left=current} op='and' right=CmpExpr)*;

CmpExpr infers ConstraintExpr:
    AddExpr ({infer BinaryExpr.left=current} op=('==' | '!=' | '>=' | '<=' | '>' | '<') right=AddExpr)?;

AddExpr infers ConstraintExpr:
    MulExpr ({infer BinaryExpr.left=current} op=('+' | '-') right=MulExpr)*;

MulExpr infers ConstraintExpr:
    UnaryExpr ({infer BinaryExpr.left=current} op=('*' | '/') right=UnaryExpr)*;

UnaryExpr infers ConstraintExpr:
    {infer UnaryExpr} op='not' operand=UnaryExpr
    | PostfixExpr;

PostfixExpr infers ConstraintExpr:
    PrimaryExpr ({infer CollectionOp.target=current} '->' op=ID '(' (argument=OrExpr)? ')')*;

PrimaryExpr infers ConstraintExpr:
      {infer LiteralExpr} intValue=INT
    | {infer LiteralExpr} strValue=STRING
    | {infer LiteralExpr} boolValue=('true' | 'false')
    | {infer FeatureChain} segments+=ID ('.' segments+=ID)*
    | '(' OrExpr ')';

// Standard SysML v2 requires a redefinition operator (`redefines` / `:>>`) to bind a
// value — the bare `name = value;` shorthand is non-standard and is not accepted.
// Use `attribute redefines name = value;` (the form the serializer emits).
UsageBodyMember:
    AttributeMember | PartMember | PortUsage | ItemUsage | RefMember | ViewUsage | FlowConnectionUsage | SuccessionUsage | ConnectionUsage | SatisfyRequirementUsage | RequirementVerificationMember | ArcadiaMember | Dependency | MetadataApplication | DocComment;

// ─── Attribute member ────────────────────────────────────────────────────────
// Three forms:
//   attribute name : Type ;              (type declaration)
//   attribute redefines name = value ;   (value assignment / redefinition)
//   attribute redefines name { … }       (structured value: nested redefinitions)
//
// The third form is how a value of an `attribute def` with several features is
// assigned — you cannot write it with `=`, because the value is not a literal.
// It is what SysIDE accepts for e.g. a RegionBounds:
//
//   attribute :>> bounds { attribute :>> x = 0.1; attribute :>> width = 0.4; }

// A fourth form is a TYPED attribute carrying a default:
//
//   attribute id : String = "CR-MED-040";
//
// SysIDE accepts it and MEMO rejected it, which session 1 logged as a grammar
// gap and section 18.2 deliverable 8 assigned to session 2. It stopped being
// theoretical once rules and policies started declaring typed attributes with
// defaults. SysIDE is the compiler of record, so the grammar follows it.

AttributeMember:
    isVariation?='variation'? 'attribute' redefines?=('redefines' | ':>>')? name=MemberName
    (':' type=QualifiedName multiplicity=Multiplicity?
        ('=' value=AttributeValue ';' | '{' body+=UsageBodyMember* '}' | ';')
    | '=' value=AttributeValue ';'
    | '{' body+=UsageBodyMember* '}');

AttributeValue:
    StringValue | RealValue | IntValue | BooleanValue | SetLiteral | EnumValue;

StringValue:
    value=STRING;

// Real (rational) literal, e.g. 20.0 — must precede IntValue so the lexer
// prefers REAL over INT for the integral part.
RealValue:
    value=REAL;

IntValue:
    value=INT;

BooleanValue:
    value=('true' | 'false');

SetLiteral:
    ('{' elements+=SetElement (',' elements+=SetElement)* '}'
    | '(' elements+=SetElement (',' elements+=SetElement)* ')');

SetElement:
    value=QualifiedName | stringValue=STRING;

// Enum literal reference (e.g. SeverityLevel::Catastrophic), or a metaclass
// cast. `x meta SysML::Usage` is the standard's MetadataAccessExpression: it
// yields the metaobject of `x` as an instance of the named metaclass, and it is
// how a SemanticMetadata binds its required `baseType`
// (`:>> baseType = derivations meta SysML::Usage`). Folded into this rule
// rather than added as a sibling alternative, because both start with a
// QualifiedName and only the trailing `meta` tells them apart.
EnumValue:
    enumRef=QualifiedName ('meta' metaclass=QualifiedName)?;

// ─── Nested part member ──────────────────────────────────────────────────────
// Four forms:
//   part subsystems : Subsystem[0..*];        (typed nested part)
//   part requirement = reqSingleMode;          (feature value binding to a reference)
//   part protectedAsset :> therapyAsset;       (subsetting an existing element)
//   part vpLogical :> viewpointDefinition = logicalArchitectureViewpoint;
//                                              (subsetting AND supplying a value)
// The binding forms carry the source/target ends of semantic *Link instances,
// which the model builder projects into navigable relationships.
//
// The fourth form is how a MULTI-VALUED feature takes several values. Repeating
// `part :>> viewpointDefinition = x;` redefines the same feature each time and
// SysIDE rejects it as shadowing, so each value has to subset the feature under
// its own member name. `viewpointDefinition : Viewpoint[1..*]` is exactly that
// case: a view governed by three viewpoints needs three members.
//
// SysIDE accepts this and the MEMO grammar did not, which is the wrong way
// round — SysIDE is the compiler of record, so the grammar follows it.
// `subsetValue` holds the value; `boundRef` keeps meaning the subsetted
// feature, so every existing `:>` consumer is unaffected.

PartMember:
    isVariation?='variation'? 'part'
    (bindingOp=':>>' name=MemberName ('=' boundRef=QualifiedName)?
    | name=MemberName
      (':' type=QualifiedName multiplicity=Multiplicity?)?
      (bindingOp=('=' | ':>') boundRef=QualifiedName ('=' subsetValue=QualifiedName)?)?)
    ('{' body+=UsageBodyMember* '}' | ';');

// ─── Reference member ───────────────────────────────────────────────────────
// Forms:
//   ref subject : TraceableElement[*];        (typed reference feature)
//   ref function : SystemFunction[0..1];      (keyword-named reference)
//   ref item exchangedItem : ExchangeItem;    (item-typed reference payload)
//   ref :>> definition = syringeDef;          (redefining a reference to a value)

RefMember:
    'ref' (isItem?='item')? (redefines?=':>>')? name=FeatureName
    (':' isConjugated?='~'? type=QualifiedName multiplicity=Multiplicity?)?
    ('=' value=AttributeValue)?
    ';';

// ─── Bare feature-membership member ──────────────────────────────────────────
// SysML v2 lets a definition body subset or redefine an inherited feature
// without restating its metaclass keyword. The standard library's own metadata
// defs are written that way and cannot be written any other way:
//
//   :> annotatedElement : SysML::ConnectionDefinition;
//   :>> baseType = derivations meta SysML::Usage;
//
// MEMO accepted only `attribute :>> name = value`, which covers redefinition of
// an attribute and nothing else — not subsetting, and not a non-attribute
// feature. `:>` is the form that matters here: `annotatedElement` is declared
// once per accepted metaclass, so it must SUBSET rather than redefine, or the
// second declaration would shadow the first.

FeatureMembershipMember:
    (isRedefinition?=':>>' | ':>') feature=QualifiedName
    (':' type=QualifiedName)? multiplicity=Multiplicity?
    ('=' value=AttributeValue)? ';';

// ─── Doc comment ─────────────────────────────────────────────────────────────
// Captured as a single terminal to prevent hidden ML_COMMENT from consuming it

DocComment:
    content=DOC_COMMENT;

// ─── Specialization ──────────────────────────────────────────────────────────

Specialization:
    (':>' | 'specializes') superType=QualifiedName;

// ─── Qualified name (data type rule → returns string) ────────────────────────

QualifiedName returns string:
    QualifiedNameSegment ('::' QualifiedNameTailSegment)*;

QualifiedNameSegment returns string:
    ID | 'library' | 'standard';

// Non-first segments may be keywords so enum literals declared via
// EnumLiteralName (e.g. DirectionKind::in, UseErrorCategoryKind::action)
// are referenceable in attribute values. The first segment stays strict to
// avoid ambiguity with usage prefixes at statement start.
QualifiedNameTailSegment returns string:
    QualifiedNameSegment
    | UNRESTRICTED_NAME
    | 'in' | 'out' | 'inout' | 'part' | 'requirement' | 'action' | 'item' | 'port'
    | 'interface' | 'connection' | 'attribute' | 'constraint' | 'enum' | 'view' | 'viewpoint'
    | 'ref' | 'import' | 'package' | 'flow' | 'first' | 'allocate' | 'private' | 'public' | 'state' | 'verification'
    | 'use' | 'fork' | 'join';

// Allow keywords as identifiers in member/feature contexts
// `standard` joins these for the same reason the others are here: making it a
// keyword for `standard library package` would otherwise stop it being a name,
// and MEMO's compliance ontology declares `attribute standard : String`.
MemberName returns string:
    ID | 'requirement' | 'action' | 'item' | 'port' | 'interface' | 'connection'
    | 'attribute' | 'constraint' | 'view' | 'viewpoint' | 'ref' | 'part' | 'state' | 'verification'
    | 'standard';

FeatureName returns string:
    ID | 'part' | 'requirement' | 'action' | 'item' | 'port' | 'interface'
    | 'connection' | 'flow' | 'view' | 'viewpoint' | 'attribute' | 'constraint'
    | 'ref' | 'allocate' | 'end' | 'enum' | 'function' | 'operator' | 'state' | 'verification'
    | 'standard';

// ─── Hidden terminals (skipped by lexer) ─────────────────────────────────────

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;

// ─── Visible terminals ──────────────────────────────────────────────────────

// DOC_COMMENT captures `doc /* ... */` as a single token.
// The `doc\s+` prefix ensures it only matches when preceded by the `doc` keyword,
// preventing conflict with ML_COMMENT for standalone /* ... */ comments.
terminal DOC_COMMENT: /doc\s+\/\*[\s\S]*?\*\//;

// A bracketed short name, e.g. `<derive>`. Whole-token so the inner word may be
// a keyword. Cannot collide with the comparison operators: `<=` does not match
// (a letter must follow `<`), and `a<b>c` is not valid MEMO in any position.
terminal SHORT_NAME: /<[a-zA-Z_][a-zA-Z0-9_]*>/;
terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
// SysML v2 unrestricted name: any text in single quotes, used when a name would
// otherwise collide with a reserved word (e.g. enum 'verification';).
terminal UNRESTRICTED_NAME: /'(?:[^'\\]|\\.)*'/;
terminal STRING: /"(?:[^"\\]|\\.)*"/;
// REAL must be declared before INT so the longest-match lexer emits a single
// REAL token for `20.0` rather than INT `.` INT.
terminal REAL: /[0-9]+\.[0-9]+/;
terminal INT: /[0-9]+/;
