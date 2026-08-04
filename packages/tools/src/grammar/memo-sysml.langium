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
    | ConnectionUsage
    | AllocateUsage
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
    | AttributeDefinition
    | ConstraintDefinition
    | EnumDefinition
    | ViewpointDefinition
    | ViewDefinition
    | MetadataDefinition;

// SysML v2 semantic-metadata definition — the standard, portable mechanism for
// extending the ontology with domain semantics. Applied to elements via `@Name`.
MetadataDefinition:
    'metadata' 'def' name=ID specialization=Specialization?
    ('{' body+=DefinitionBodyMember* '}' | ';');

// Metadata application: `@AnnotationType;` or `@AnnotationType { redefinitions }`
// applies a metadata def to the enclosing element (standard SysML v2 `@` annotation).
MetadataApplication:
    '@' type=QualifiedName ('{' body+=UsageBodyMember* '}' | ';');

PartDefinition:
    isAbstract?='abstract'? 'part' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
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
    isAbstract?='abstract'? 'item' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
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

AttributeDefinition:
    isAbstract?='abstract'? 'attribute' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

ConstraintDefinition:
    isAbstract?='abstract'? 'constraint' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

EnumDefinition:
    'enum' 'def' name=ID '{'
        literals+=EnumLiteral*
    '}';

ViewpointDefinition:
    isAbstract?='abstract'? 'viewpoint' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

ViewDefinition:
    isAbstract?='abstract'? 'view' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

// ─── Connection definition body ─────────────────────────────────────────────

ConnectionBodyMember:
    EndDeclaration | DefinitionBodyMember;

EndDeclaration:
    'end' name=FeatureName (':' isConjugated?='~'? type=QualifiedName)? multiplicity=Multiplicity? ';';

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

// SysML v2 interface usage: `interface siData : Interface { … }`.
InterfaceUsage:
    'interface' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

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

TerminateUsage:
    {infer TerminateUsage} followsPrevious?='then'? 'terminate' ';';

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

// ─── Behavior: Action definition body ───────────────────────────────────────
// Action defs can have in/out/inout parameters plus regular body members

ActionDefBodyMember:
    ActionParameterMember | ActionUsage | AcceptActionUsage | SendActionUsage | TerminateUsage | ControlNodeUsage | RequireConstraintMember | UsageBodyMember;

ActionParameterMember:
    direction=('in' | 'out' | 'inout') name=ID ':' type=QualifiedName ';';

// ─── Behavior: Action usage body ────────────────────────────────────────────
// Composite actions contain nested actions, flow connections, successions

// FlowConnectionUsage / SuccessionUsage / ConnectionUsage are contributed by
// UsageBodyMember; listing them again here would make the alternatives ambiguous.
ActionUsageBodyMember:
    ActionParameterMember | ActionUsage | AcceptActionUsage | SendActionUsage | TerminateUsage | ControlNodeUsage | UsageBodyMember;

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

FlowConnectionUsage:
    'flow' 'of' itemType=QualifiedName 'from' source=FlowEnd 'to' target=FlowEnd ';';

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

AllocateUsage:
    'allocate' source=ReferenceName 'to' target=ReferenceName ';';

// Element references may be package-qualified (`a::b`) or feature-qualified
// (`action.step`). Both forms occur in standard SysML relationship ends.
ReferenceName returns string:
    ID (('::' | '.') ID)*;

// ─── Body members ────────────────────────────────────────────────────────────

DefinitionBodyMember:
    AttributeMember | PartMember | PortUsage | ItemUsage | ViewUsage | RefMember | RequireConstraintMember | MetadataApplication | DocComment;

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
    AttributeMember | PartMember | PortUsage | ItemUsage | RefMember | ViewUsage | FlowConnectionUsage | SuccessionUsage | ConnectionUsage | MetadataApplication | DocComment;

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
    'attribute' redefines?=('redefines' | ':>>')? name=MemberName
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

// Enum literal reference: e.g. SeverityLevel::Catastrophic
EnumValue:
    enumRef=QualifiedName;

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
    'part'
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

terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
// SysML v2 unrestricted name: any text in single quotes, used when a name would
// otherwise collide with a reserved word (e.g. enum 'verification';).
terminal UNRESTRICTED_NAME: /'(?:[^'\\]|\\.)*'/;
terminal STRING: /"(?:[^"\\]|\\.)*"/;
// REAL must be declared before INT so the longest-match lexer emits a single
// REAL token for `20.0` rather than INT `.` INT.
terminal REAL: /[0-9]+\.[0-9]+/;
terminal INT: /[0-9]+/;
