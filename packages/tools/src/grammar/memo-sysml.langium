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

NamespaceMember:
    PackageDeclaration | ImportDeclaration;

// ─── Package ─────────────────────────────────────────────────────────────────

// Standard SysML v2: a package DECLARATION takes a single-identifier name.
// Qualified names (`::`) are for references only; deep namespaces are expressed by
// NESTING packages (`package memo { package arch { … } }`). The model builder
// reconstructs the full FQN from the nesting (builder.ts: parentPackage::pkg.name).
PackageDeclaration:
    isLibrary?='library'? 'package' name=ID '{'
        members+=PackageMember*
    '}';

PackageMember:
    PackageDeclaration
    | AliasDeclaration
    | ImportDeclaration
    | DefinitionMember
    | UsageMember
    | ConnectionUsage
    | AllocateUsage
    | MetadataApplication
    | DocComment;

// Namespace indirection used by the canonical memo::* facade. Each source file
// owns a unique package for reliable SysIDE indexing; aliases reconstruct the
// user-facing hierarchy without reopening packages across documents.
AliasDeclaration:
    'alias' name=ID 'for' target=QualifiedName ';';

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

ActionDefinition:
    isAbstract?='abstract'? behaviorKind=('action' | 'operator' | 'function') 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=ActionDefBodyMember* '}' | ';');

ItemDefinition:
    isAbstract?='abstract'? 'item' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

PortDefinition:
    isAbstract?='abstract'? 'port' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

InterfaceDefinition:
    isAbstract?='abstract'? 'interface' 'def' name=ID specialization=Specialization? (',' additionalSpecializations+=QualifiedName)*
    ('{' body+=DefinitionBodyMember* '}' | ';');

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
    'end' name=FeatureName (':' type=QualifiedName)? multiplicity=Multiplicity? ';';

Multiplicity:
    '[' lower=INT '..' (upper=INT | unbounded?='*') ']'
    | '[' unbounded?='*' ']'
    | '[' exact=INT ']';

// ─── Enum literal ────────────────────────────────────────────────────────────

EnumLiteral:
    'enum' name=EnumLiteralName ';';

EnumLiteralName returns string:
    ID | 'in' | 'out' | 'inout' | 'part' | 'requirement' | 'action' | 'item' | 'port'
    | 'interface' | 'connection' | 'attribute' | 'constraint' | 'enum' | 'view' | 'viewpoint'
    | 'ref' | 'import' | 'package' | 'flow' | 'first' | 'allocate' | 'library' | 'private' | 'public';

// ─── Usages (instances) ─────────────────────────────────────────────────────

UsageMember:
    PartUsage
    | RequirementUsage
    | ActionUsage
    | PortUsage
    | ViewUsage;

PartUsage:
    'part' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

RequirementUsage:
    'requirement' name=ID ':' type=QualifiedName
    ('{' body+=UsageBodyMember* '}' | ';');

// ActionUsage supports both typed (action name : Type;) and composite
// (action name { nested-actions, flows, successions }) forms.
ActionUsage:
    behaviorKind=('action' | 'operator' | 'function') name=ID (':' type=QualifiedName)?
    ('{' body+=ActionUsageBodyMember* '}' | ';');

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

ConnectionUsage:
    'connection' (':' type=QualifiedName)?
    'connect' source=ConnectionEnd 'to' target=ConnectionEnd ';';

ConnectionEnd:
    endName=FeatureName '::>' ref=ReferenceName;

// ─── Behavior: Action definition body ───────────────────────────────────────
// Action defs can have in/out/inout parameters plus regular body members

ActionDefBodyMember:
    ActionParameterMember | DefinitionBodyMember;

ActionParameterMember:
    direction=('in' | 'out' | 'inout') name=ID ':' type=QualifiedName ';';

// ─── Behavior: Action usage body ────────────────────────────────────────────
// Composite actions contain nested actions, flow connections, successions

ActionUsageBodyMember:
    ActionUsage | ControlNodeUsage | FlowConnectionUsage | SuccessionUsage | UsageBodyMember;

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
    controlKind=('fork' | 'join') name=ID ';';

// ─── Behavior: Flow connection usage ────────────────────────────────────────
// Syntax: flow of ItemType from source.port to target.port ;

FlowConnectionUsage:
    'flow' 'of' itemType=QualifiedName 'from' source=FlowEnd 'to' target=FlowEnd ';';

FlowEnd:
    ref=DottedName;

// Dot-separated qualified name for flow endpoints (e.g. receive.prescription)
DottedName returns string:
    ID ('.' ID)*;

// ─── Behavior: Succession usage ─────────────────────────────────────────────
// Syntax: first start then action1 then action2 then done ;

SuccessionUsage:
    'first' steps+=SuccessionStep ('then' steps+=SuccessionStep)+ ';';

SuccessionStep:
    ref=SuccessionRef;

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
    AttributeMember | PartMember | PortUsage | ViewUsage | RefMember | RequireConstraintMember | MetadataApplication | DocComment;

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
    AttributeMember | PartMember | PortUsage | ViewUsage | MetadataApplication | DocComment;

// ─── Attribute member ────────────────────────────────────────────────────────
// Two forms:
//   attribute name : Type ;              (type declaration)
//   attribute redefines name = value ;   (value assignment / redefinition)

AttributeMember:
    'attribute' redefines?=('redefines' | ':>>')? name=ID
    (':' type=QualifiedName multiplicity=Multiplicity? ';' | '=' value=AttributeValue ';');

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
// Three forms:
//   part subsystems : Subsystem[0..*];        (typed nested part)
//   part requirement = reqSingleMode;          (feature value binding to a reference)
//   part protectedAsset :> therapyAsset;       (subsetting an existing element)
// The binding forms carry the source/target ends of semantic *Link instances,
// which the model builder projects into navigable relationships.

PartMember:
    'part'
    (bindingOp=':>>' name=MemberName ('=' boundRef=QualifiedName)?
    | name=MemberName
      (':' type=QualifiedName multiplicity=Multiplicity?)?
      (bindingOp=('=' | ':>') boundRef=QualifiedName)?)
    ('{' body+=UsageBodyMember* '}' | ';');

// ─── Reference member ───────────────────────────────────────────────────────
// e.g. ref subject : TraceableElement[*];

RefMember:
    'ref' name=ID ':' type=QualifiedName multiplicity=Multiplicity? ';';

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
    ID | 'library';

// Non-first segments may be keywords so enum literals declared via
// EnumLiteralName (e.g. DirectionKind::in, UseErrorCategoryKind::action)
// are referenceable in attribute values. The first segment stays strict to
// avoid ambiguity with usage prefixes at statement start.
QualifiedNameTailSegment returns string:
    QualifiedNameSegment
    | 'in' | 'out' | 'inout' | 'part' | 'requirement' | 'action' | 'item' | 'port'
    | 'interface' | 'connection' | 'attribute' | 'constraint' | 'enum' | 'view' | 'viewpoint'
    | 'ref' | 'import' | 'package' | 'flow' | 'first' | 'allocate' | 'private' | 'public';

// Allow keywords as identifiers in member/feature contexts
MemberName returns string:
    ID | 'requirement' | 'action' | 'item' | 'port' | 'interface' | 'connection'
    | 'attribute' | 'constraint' | 'view' | 'viewpoint' | 'ref' | 'part';

FeatureName returns string:
    ID | 'part' | 'requirement' | 'action' | 'item' | 'port' | 'interface'
    | 'connection' | 'flow' | 'view' | 'viewpoint' | 'attribute' | 'constraint'
    | 'ref' | 'allocate' | 'end' | 'enum' | 'function' | 'operator';

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
terminal STRING: /"(?:[^"\\]|\\.)*"/;
// REAL must be declared before INT so the longest-match lexer emits a single
// REAL token for `20.0` rather than INT `.` INT.
terminal REAL: /[0-9]+\.[0-9]+/;
terminal INT: /[0-9]+/;
