// GENERATED from SysML.ecore (SysML v2 Pilot release 2026-05, commit fa709f2). DO NOT EDIT.
// Source SHA-256: 7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0

export const SYSML_ECORE_SHA256 = '7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0';
export const SYSML_ECORE_RELEASE = '2026-05';

export type FeatureDirectionKind = "in" | "inout" | "out";
export type PortionKind = "timeslice" | "snapshot";
export type RequirementConstraintKind = "assumption" | "requirement";
export type StateSubactionKind = "entry" | "do" | "exit";
export type TransitionFeatureKind = "trigger" | "guard" | "effect";
export type TriggerKind = "when" | "at" | "after";
export type VisibilityKind = "private" | "protected" | "public";

export interface AcceptActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly payloadArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly payloadParameter?: ReferenceUsage;
    /** Derived declaration; resolved by the native core. */
    readonly receiverArgument?: Expression;
}

export interface ActionDefinition extends OccurrenceDefinition, Behavior {
    /** Derived declaration; resolved by the native core. */
    readonly action?: ActionUsage[];
}

export interface ActionUsage extends OccurrenceUsage, Step {
    /** Derived declaration; resolved by the native core. */
    readonly actionDefinition?: Behavior[];
}

export interface ActorMembership extends ParameterMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedActorParameter?: PartUsage;
}

export interface AllocationDefinition extends ConnectionDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly allocation?: AllocationUsage[];
}

export interface AllocationUsage extends ConnectionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly allocationDefinition?: AllocationDefinition[];
}

export interface AnalysisCaseDefinition extends CaseDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly resultExpression?: Expression;
}

export interface AnalysisCaseUsage extends CaseUsage {
    /** Derived declaration; resolved by the native core. */
    readonly analysisCaseDefinition?: AnalysisCaseDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly resultExpression?: Expression;
}

export interface AnnotatingElement extends Element {
    /** Derived declaration; resolved by the native core. */
    readonly annotatedElement?: Element[];
    /** Derived declaration; resolved by the native core. */
    readonly annotation?: Annotation[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedAnnotatingRelationship?: Annotation[];
    /** Derived declaration; resolved by the native core. */
    readonly owningAnnotatingRelationship?: Annotation;
}

export interface Annotation extends Relationship {
    /** Reference or attribute. */
    annotatedElement?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly annotatingElement?: AnnotatingElement;
    /** Derived declaration; resolved by the native core. */
    readonly ownedAnnotatingElement?: AnnotatingElement;
    /** Derived declaration; resolved by the native core. */
    readonly owningAnnotatedElement?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly owningAnnotatingElement?: AnnotatingElement;
}

export interface AssertConstraintUsage extends ConstraintUsage, Invariant {
    /** Derived declaration; resolved by the native core. */
    readonly assertedConstraint?: ConstraintUsage;
}

export interface AssignmentActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly referent?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly targetArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly valueExpression?: Expression;
}

export interface Association extends Classifier, Relationship {
    /** Derived declaration; resolved by the native core. */
    readonly associationEnd?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly relatedType?: Type[];
    /** Derived declaration; resolved by the native core. */
    readonly sourceType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly targetType?: Type[];
}

export interface AssociationStructure extends Association, Structure {

}

export interface AttributeDefinition extends Definition, DataType {

}

export interface AttributeUsage extends Usage {
    /** Derived declaration; resolved by the native core. */
    readonly attributeDefinition?: DataType[];
}

export interface Behavior extends Class {
    /** Derived declaration; resolved by the native core. */
    readonly parameter?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly step?: Step[];
}

export interface BindingConnector extends Connector {

}

export interface BindingConnectorAsUsage extends ConnectorAsUsage, BindingConnector {

}

export interface BooleanExpression extends Expression {
    /** Derived declaration; resolved by the native core. */
    readonly predicate?: Predicate;
}

export interface CalculationDefinition extends ActionDefinition, Function {
    /** Derived declaration; resolved by the native core. */
    readonly calculation?: CalculationUsage[];
}

export interface CalculationUsage extends ActionUsage, Expression {
    /** Derived declaration; resolved by the native core. */
    readonly calculationDefinition?: Function;
}

export interface CaseDefinition extends CalculationDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly actorParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly objectiveRequirement?: RequirementUsage;
    /** Derived declaration; resolved by the native core. */
    readonly subjectParameter?: Usage;
}

export interface CaseUsage extends CalculationUsage {
    /** Derived declaration; resolved by the native core. */
    readonly actorParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly caseDefinition?: CaseDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly objectiveRequirement?: RequirementUsage;
    /** Derived declaration; resolved by the native core. */
    readonly subjectParameter?: Usage;
}

export interface Class extends Classifier {

}

export interface Classifier extends Type {
    /** Derived declaration; resolved by the native core. */
    readonly ownedSubclassification?: Subclassification[];
}

export interface CollectExpression extends OperatorExpression {

}

export interface Comment extends AnnotatingElement {
    /** Reference or attribute. */
    body?: string;
    /** Reference or attribute. */
    locale?: string;
}

export interface ConcernDefinition extends RequirementDefinition {

}

export interface ConcernUsage extends RequirementUsage {
    /** Derived declaration; resolved by the native core. */
    readonly concernDefinition?: ConcernDefinition;
}

export interface ConjugatedPortDefinition extends PortDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly originalPortDefinition?: PortDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly ownedPortConjugator?: PortConjugation;
}

export interface ConjugatedPortTyping extends FeatureTyping {
    /** Reference or attribute. */
    conjugatedPortDefinition?: ConjugatedPortDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly portDefinition?: PortDefinition;
}

export interface Conjugation extends Relationship {
    /** Reference or attribute. */
    conjugatedType?: Type;
    /** Reference or attribute. */
    originalType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly owningType?: Type;
}

export interface ConnectionDefinition extends PartDefinition, AssociationStructure {
    /** Derived declaration; resolved by the native core. */
    readonly connectionEnd?: Usage[];
}

export interface ConnectionUsage extends ConnectorAsUsage, PartUsage {
    /** Derived declaration; resolved by the native core. */
    readonly connectionDefinition?: AssociationStructure[];
}

export interface Connector extends Feature, Relationship {
    /** Derived declaration; resolved by the native core. */
    readonly association?: Association[];
    /** Derived declaration; resolved by the native core. */
    readonly connectorEnd?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly defaultFeaturingType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly relatedFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly sourceFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly targetFeature?: Feature[];
}

export interface ConnectorAsUsage extends Usage, Connector {

}

export interface ConstraintDefinition extends OccurrenceDefinition, Predicate {

}

export interface ConstraintUsage extends OccurrenceUsage, BooleanExpression {
    /** Derived declaration; resolved by the native core. */
    readonly constraintDefinition?: Predicate;
}

export interface ConstructorExpression extends InstantiationExpression {

}

export interface ControlNode extends ActionUsage {

}

export interface CrossSubsetting extends Subsetting {
    /** Reference or attribute. */
    crossedFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly crossingFeature?: Feature;
}

export interface DataType extends Classifier {

}

export interface DecisionNode extends ControlNode {

}

export interface Definition extends Classifier {
    /** Derived declaration; resolved by the native core. */
    readonly directedUsage?: Usage[];
    /** Reference or attribute. */
    isVariation?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly ownedAction?: ActionUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedAllocation?: AllocationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedAnalysisCase?: AnalysisCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedAttribute?: AttributeUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedCalculation?: CalculationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedCase?: CaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedConcern?: ConcernUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedConnection?: ConnectorAsUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedEnumeration?: EnumerationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedFlow?: FlowUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedInterface?: InterfaceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedItem?: ItemUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedMetadata?: MetadataUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedOccurrence?: OccurrenceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedPart?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedPort?: PortUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedReference?: ReferenceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedRendering?: RenderingUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedRequirement?: RequirementUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedState?: StateUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedTransition?: TransitionUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedUsage?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedUseCase?: UseCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedVerificationCase?: VerificationCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedView?: ViewUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedViewpoint?: ViewpointUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly usage?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly variant?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly variantMembership?: VariantMembership[];
}

export interface Dependency extends Relationship {
    /** Reference or attribute. */
    client?: Element[];
    /** Reference or attribute. */
    supplier?: Element[];
}

export interface Differencing extends Relationship {
    /** Reference or attribute. */
    differencingType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly typeDifferenced?: Type;
}

export interface Disjoining extends Relationship {
    /** Reference or attribute. */
    disjoiningType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly owningType?: Type;
    /** Reference or attribute. */
    typeDisjoined?: Type;
}

export interface Documentation extends Comment {
    /** Derived declaration; resolved by the native core. */
    readonly documentedElement?: Element;
}

export interface Element {
    /** Reference or attribute. */
    aliasIds?: string[];
    /** Reference or attribute. */
    declaredName?: string;
    /** Reference or attribute. */
    declaredShortName?: string;
    /** Derived declaration; resolved by the native core. */
    readonly documentation?: Documentation[];
    /** Reference or attribute. */
    elementId?: string;
    /** Reference or attribute. */
    isImpliedIncluded?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly isLibraryElement?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly name?: string;
    /** Derived declaration; resolved by the native core. */
    readonly ownedAnnotation?: Annotation[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedElement?: Element[];
    /** Containment. */
    ownedRelationship?: Relationship[];
    /** Derived declaration; resolved by the native core. */
    readonly owner?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly owningMembership?: OwningMembership;
    /** Derived declaration; resolved by the native core. */
    readonly owningNamespace?: Namespace;
    /** Reference or attribute. */
    owningRelationship?: Relationship;
    /** Derived declaration; resolved by the native core. */
    readonly qualifiedName?: string;
    /** Derived declaration; resolved by the native core. */
    readonly shortName?: string;
    /** Derived declaration; resolved by the native core. */
    readonly textualRepresentation?: TextualRepresentation[];
}

export interface ElementFilterMembership extends OwningMembership {
    /** Derived declaration; resolved by the native core. */
    readonly condition?: Expression;
}

export interface EndFeatureMembership extends FeatureMembership {

}

export interface EnumerationDefinition extends AttributeDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly enumeratedValue?: EnumerationUsage[];
}

export interface EnumerationUsage extends AttributeUsage {
    /** Derived declaration; resolved by the native core. */
    readonly enumerationDefinition?: EnumerationDefinition;
}

export interface EventOccurrenceUsage extends OccurrenceUsage {
    /** Derived declaration; resolved by the native core. */
    readonly eventOccurrence?: OccurrenceUsage;
}

export interface ExhibitStateUsage extends StateUsage, PerformActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly exhibitedState?: StateUsage;
}

export interface Expose extends Import {

}

export interface Expression extends Step {
    /** Derived declaration; resolved by the native core. */
    readonly function?: Function;
    /** Derived declaration; resolved by the native core. */
    readonly isModelLevelEvaluable?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly result?: Feature;
}

export interface Feature extends Type {
    /** Derived declaration; resolved by the native core. */
    readonly chainingFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly crossFeature?: Feature;
    /** Reference or attribute. */
    direction?: FeatureDirectionKind;
    /** Derived declaration; resolved by the native core. */
    readonly endOwningType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly featureTarget?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly featuringType?: Type[];
    /** Reference or attribute. */
    isComposite?: boolean;
    /** Reference or attribute. */
    isConstant?: boolean;
    /** Reference or attribute. */
    isDerived?: boolean;
    /** Reference or attribute. */
    isEnd?: boolean;
    /** Reference or attribute. */
    isOrdered?: boolean;
    /** Reference or attribute. */
    isPortion?: boolean;
    /** Reference or attribute. */
    isUnique?: boolean;
    /** Reference or attribute. */
    isVariable?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly ownedCrossSubsetting?: CrossSubsetting;
    /** Derived declaration; resolved by the native core. */
    readonly ownedFeatureChaining?: FeatureChaining[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedFeatureInverting?: FeatureInverting[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedRedefinition?: Redefinition[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedReferenceSubsetting?: ReferenceSubsetting;
    /** Derived declaration; resolved by the native core. */
    readonly ownedSubsetting?: Subsetting[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedTypeFeaturing?: TypeFeaturing[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedTyping?: FeatureTyping[];
    /** Derived declaration; resolved by the native core. */
    readonly owningFeatureMembership?: FeatureMembership;
    /** Derived declaration; resolved by the native core. */
    readonly owningType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly type?: Type[];
}

export interface FeatureChainExpression extends OperatorExpression {
    /** Derived declaration; resolved by the native core. */
    readonly targetFeature?: Feature;
}

export interface FeatureChaining extends Relationship {
    /** Reference or attribute. */
    chainingFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly featureChained?: Feature;
}

export interface FeatureInverting extends Relationship {
    /** Reference or attribute. */
    featureInverted?: Feature;
    /** Reference or attribute. */
    invertingFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly owningFeature?: Feature;
}

export interface FeatureMembership extends OwningMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly owningType?: Type;
}

export interface FeatureReferenceExpression extends Expression {
    /** Derived declaration; resolved by the native core. */
    readonly referent?: Feature;
}

export interface FeatureTyping extends Specialization {
    /** Derived declaration; resolved by the native core. */
    readonly owningFeature?: Feature;
    /** Reference or attribute. */
    type?: Type;
    /** Reference or attribute. */
    typedFeature?: Feature;
}

export interface FeatureValue extends OwningMembership {
    /** Derived declaration; resolved by the native core. */
    readonly featureWithValue?: Feature;
    /** Reference or attribute. */
    isDefault?: boolean;
    /** Reference or attribute. */
    isInitial?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly value?: Expression;
}

export interface Flow extends Connector, Step {
    /** Derived declaration; resolved by the native core. */
    readonly flowEnd?: FlowEnd[];
    /** Derived declaration; resolved by the native core. */
    readonly interaction?: Interaction[];
    /** Derived declaration; resolved by the native core. */
    readonly payloadFeature?: PayloadFeature;
    /** Derived declaration; resolved by the native core. */
    readonly payloadType?: Classifier[];
    /** Derived declaration; resolved by the native core. */
    readonly sourceOutputFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly targetInputFeature?: Feature;
}

export interface FlowDefinition extends ActionDefinition, Interaction {
    /** Derived declaration; resolved by the native core. */
    readonly flowEnd?: Usage[];
}

export interface FlowEnd extends Feature {

}

export interface FlowUsage extends ConnectorAsUsage, ActionUsage, Flow {
    /** Derived declaration; resolved by the native core. */
    readonly flowDefinition?: Interaction[];
}

export interface ForLoopActionUsage extends LoopActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly loopVariable?: ReferenceUsage;
    /** Derived declaration; resolved by the native core. */
    readonly seqArgument?: Expression;
}

export interface ForkNode extends ControlNode {

}

export interface FramedConcernMembership extends RequirementConstraintMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedConcern?: ConcernUsage;
    /** Derived declaration; resolved by the native core. */
    readonly referencedConcern?: ConcernUsage;
}

export interface Function extends Behavior {
    /** Derived declaration; resolved by the native core. */
    readonly expression?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly isModelLevelEvaluable?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly result?: Feature;
}

export interface IfActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly elseAction?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly ifArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly thenAction?: ActionUsage;
}

export interface Import extends Relationship {
    /** Derived declaration; resolved by the native core. */
    readonly importOwningNamespace?: Namespace;
    /** Derived declaration; resolved by the native core. */
    readonly importedElement?: Element;
    /** Reference or attribute. */
    isImportAll?: boolean;
    /** Reference or attribute. */
    isRecursive?: boolean;
    /** Reference or attribute. */
    visibility?: VisibilityKind;
}

export interface IncludeUseCaseUsage extends UseCaseUsage, PerformActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly useCaseIncluded?: UseCaseUsage;
}

export interface IndexExpression extends OperatorExpression {

}

export interface InstantiationExpression extends Expression {
    /** Derived declaration; resolved by the native core. */
    readonly argument?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly instantiatedType?: Type;
}

export interface Interaction extends Association, Behavior {

}

export interface InterfaceDefinition extends ConnectionDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly interfaceEnd?: PortUsage[];
}

export interface InterfaceUsage extends ConnectionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly interfaceDefinition?: InterfaceDefinition[];
}

export interface Intersecting extends Relationship {
    /** Reference or attribute. */
    intersectingType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly typeIntersected?: Type;
}

export interface Invariant extends BooleanExpression {
    /** Reference or attribute. */
    isNegated?: boolean;
}

export interface InvocationExpression extends InstantiationExpression {
    /** Derived declaration; resolved by the native core. */
    readonly operand?: Expression[];
}

export interface ItemDefinition extends OccurrenceDefinition, Structure {

}

export interface ItemUsage extends OccurrenceUsage {
    /** Derived declaration; resolved by the native core. */
    readonly itemDefinition?: Structure[];
}

export interface JoinNode extends ControlNode {

}

export interface LibraryPackage extends Package {
    /** Reference or attribute. */
    isStandard?: boolean;
}

export interface LiteralBoolean extends LiteralExpression {
    /** Reference or attribute. */
    value?: boolean;
}

export interface LiteralExpression extends Expression {

}

export interface LiteralInfinity extends LiteralExpression {

}

export interface LiteralInteger extends LiteralExpression {
    /** Reference or attribute. */
    value?: number;
}

export interface LiteralRational extends LiteralExpression {
    /** Reference or attribute. */
    value?: number;
}

export interface LiteralString extends LiteralExpression {
    /** Reference or attribute. */
    value?: string;
}

export interface LoopActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly bodyAction?: ActionUsage;
}

export interface Membership extends Relationship {
    /** Reference or attribute. */
    memberElement?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly memberElementId?: string;
    /** Reference or attribute. */
    memberName?: string;
    /** Reference or attribute. */
    memberShortName?: string;
    /** Derived declaration; resolved by the native core. */
    readonly membershipOwningNamespace?: Namespace;
    /** Reference or attribute. */
    visibility?: VisibilityKind;
}

export interface MembershipExpose extends MembershipImport, Expose {

}

export interface MembershipImport extends Import {
    /** Reference or attribute. */
    importedMembership?: Membership;
}

export interface MergeNode extends ControlNode {

}

export interface Metaclass extends Structure {

}

export interface MetadataAccessExpression extends Expression {
    /** Derived declaration; resolved by the native core. */
    readonly referencedElement?: Element;
}

export interface MetadataDefinition extends ItemDefinition, Metaclass {

}

export interface MetadataFeature extends Feature, AnnotatingElement {
    /** Derived declaration; resolved by the native core. */
    readonly metaclass?: Metaclass;
}

export interface MetadataUsage extends ItemUsage, MetadataFeature {
    /** Derived declaration; resolved by the native core. */
    readonly metadataDefinition?: Metaclass;
}

export interface Multiplicity extends Feature {

}

export interface MultiplicityRange extends Multiplicity {
    /** Derived declaration; resolved by the native core. */
    readonly bound?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly lowerBound?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly upperBound?: Expression;
}

export interface Namespace extends Element {
    /** Derived declaration; resolved by the native core. */
    readonly importedMembership?: Membership[];
    /** Derived declaration; resolved by the native core. */
    readonly member?: Element[];
    /** Derived declaration; resolved by the native core. */
    readonly membership?: Membership[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedImport?: Import[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedMember?: Element[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedMembership?: Membership[];
}

export interface NamespaceExpose extends NamespaceImport, Expose {

}

export interface NamespaceImport extends Import {
    /** Reference or attribute. */
    importedNamespace?: Namespace;
}

export interface NullExpression extends Expression {

}

export interface ObjectiveMembership extends FeatureMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedObjectiveRequirement?: RequirementUsage;
}

export interface OccurrenceDefinition extends Definition, Class {
    /** Reference or attribute. */
    isIndividual?: boolean;
}

export interface OccurrenceUsage extends Usage {
    /** Derived declaration; resolved by the native core. */
    readonly individualDefinition?: OccurrenceDefinition;
    /** Reference or attribute. */
    isIndividual?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly occurrenceDefinition?: Class[];
    /** Reference or attribute. */
    portionKind?: PortionKind;
}

export interface OperatorExpression extends InvocationExpression {
    /** Reference or attribute. */
    operator?: string;
}

export interface OwningMembership extends Membership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberElement?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberElementId?: string;
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberName?: string;
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberShortName?: string;
}

export interface Package extends Namespace {
    /** Derived declaration; resolved by the native core. */
    readonly filterCondition?: Expression[];
}

export interface ParameterMembership extends FeatureMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedMemberParameter?: Feature;
}

export interface PartDefinition extends ItemDefinition {

}

export interface PartUsage extends ItemUsage {
    /** Derived declaration; resolved by the native core. */
    readonly partDefinition?: PartDefinition[];
}

export interface PayloadFeature extends Feature {

}

export interface PerformActionUsage extends ActionUsage, EventOccurrenceUsage {
    /** Derived declaration; resolved by the native core. */
    readonly performedAction?: ActionUsage;
}

export interface PortConjugation extends Conjugation {
    /** Derived declaration; resolved by the native core. */
    readonly conjugatedPortDefinition?: ConjugatedPortDefinition;
    /** Reference or attribute. */
    originalPortDefinition?: PortDefinition;
}

export interface PortDefinition extends OccurrenceDefinition, Structure {
    /** Derived declaration; resolved by the native core. */
    readonly conjugatedPortDefinition?: ConjugatedPortDefinition;
}

export interface PortUsage extends OccurrenceUsage {
    /** Derived declaration; resolved by the native core. */
    readonly portDefinition?: PortDefinition[];
}

export interface Predicate extends Function {

}

export interface Redefinition extends Subsetting {
    /** Reference or attribute. */
    redefinedFeature?: Feature;
    /** Reference or attribute. */
    redefiningFeature?: Feature;
}

export interface ReferenceSubsetting extends Subsetting {
    /** Reference or attribute. */
    referencedFeature?: Feature;
    /** Derived declaration; resolved by the native core. */
    readonly referencingFeature?: Feature;
}

export interface ReferenceUsage extends Usage {

}

export interface Relationship extends Element {
    /** Reference or attribute. */
    isImplied?: boolean;
    /** Containment. */
    ownedRelatedElement?: Element[];
    /** Reference or attribute. */
    owningRelatedElement?: Element;
    /** Derived declaration; resolved by the native core. */
    readonly relatedElement?: Element[];
    /** Reference or attribute. */
    source?: Element[];
    /** Reference or attribute. */
    target?: Element[];
}

export interface RenderingDefinition extends PartDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly rendering?: RenderingUsage[];
}

export interface RenderingUsage extends PartUsage {
    /** Derived declaration; resolved by the native core. */
    readonly renderingDefinition?: RenderingDefinition;
}

export interface RequirementConstraintMembership extends FeatureMembership {
    /** Reference or attribute. */
    kind?: RequirementConstraintKind;
    /** Derived declaration; resolved by the native core. */
    readonly ownedConstraint?: ConstraintUsage;
    /** Derived declaration; resolved by the native core. */
    readonly referencedConstraint?: ConstraintUsage;
}

export interface RequirementDefinition extends ConstraintDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly actorParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly assumedConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly framedConcern?: ConcernUsage[];
    /** Reference or attribute. */
    reqId?: string;
    /** Derived declaration; resolved by the native core. */
    readonly requiredConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly stakeholderParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly subjectParameter?: Usage;
    /** Derived declaration; resolved by the native core. */
    readonly text?: string[];
}

export interface RequirementUsage extends ConstraintUsage {
    /** Derived declaration; resolved by the native core. */
    readonly actorParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly assumedConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly framedConcern?: ConcernUsage[];
    /** Reference or attribute. */
    reqId?: string;
    /** Derived declaration; resolved by the native core. */
    readonly requiredConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly requirementDefinition?: RequirementDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly stakeholderParameter?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly subjectParameter?: Usage;
    /** Derived declaration; resolved by the native core. */
    readonly text?: string[];
}

export interface RequirementVerificationMembership extends RequirementConstraintMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedRequirement?: RequirementUsage;
    /** Derived declaration; resolved by the native core. */
    readonly verifiedRequirement?: RequirementUsage;
}

export interface ResultExpressionMembership extends FeatureMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedResultExpression?: Expression;
}

export interface ReturnParameterMembership extends ParameterMembership {

}

export interface SatisfyRequirementUsage extends RequirementUsage, AssertConstraintUsage {
    /** Derived declaration; resolved by the native core. */
    readonly satisfiedRequirement?: RequirementUsage;
    /** Derived declaration; resolved by the native core. */
    readonly satisfyingFeature?: Feature;
}

export interface SelectExpression extends OperatorExpression {

}

export interface SendActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly payloadArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly receiverArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly senderArgument?: Expression;
}

export interface Specialization extends Relationship {
    /** Reference or attribute. */
    general?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly owningType?: Type;
    /** Reference or attribute. */
    specific?: Type;
}

export interface StakeholderMembership extends ParameterMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedStakeholderParameter?: PartUsage;
}

export interface StateDefinition extends ActionDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly doAction?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly entryAction?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly exitAction?: ActionUsage;
    /** Reference or attribute. */
    isParallel?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly state?: StateUsage[];
}

export interface StateSubactionMembership extends FeatureMembership {
    /** Derived declaration; resolved by the native core. */
    readonly action?: ActionUsage;
    /** Reference or attribute. */
    kind?: StateSubactionKind;
}

export interface StateUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly doAction?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly entryAction?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly exitAction?: ActionUsage;
    /** Reference or attribute. */
    isParallel?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly stateDefinition?: Behavior[];
}

export interface Step extends Feature {
    /** Derived declaration; resolved by the native core. */
    readonly behavior?: Behavior[];
    /** Derived declaration; resolved by the native core. */
    readonly parameter?: Feature[];
}

export interface Structure extends Class {

}

export interface Subclassification extends Specialization {
    /** Derived declaration; resolved by the native core. */
    readonly owningClassifier?: Classifier;
    /** Reference or attribute. */
    subclassifier?: Classifier;
    /** Reference or attribute. */
    superclassifier?: Classifier;
}

export interface SubjectMembership extends ParameterMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedSubjectParameter?: Usage;
}

export interface Subsetting extends Specialization {
    /** Derived declaration; resolved by the native core. */
    readonly owningFeature?: Feature;
    /** Reference or attribute. */
    subsettedFeature?: Feature;
    /** Reference or attribute. */
    subsettingFeature?: Feature;
}

export interface Succession extends Connector {

}

export interface SuccessionAsUsage extends ConnectorAsUsage, Succession {

}

export interface SuccessionFlow extends Flow, Succession {

}

export interface SuccessionFlowUsage extends FlowUsage, SuccessionFlow {

}

export interface TerminateActionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly terminatedOccurrenceArgument?: Expression;
}

export interface TextualRepresentation extends AnnotatingElement {
    /** Reference or attribute. */
    body?: string;
    /** Reference or attribute. */
    language?: string;
    /** Derived declaration; resolved by the native core. */
    readonly representedElement?: Element;
}

export interface TransitionFeatureMembership extends FeatureMembership {
    /** Reference or attribute. */
    kind?: TransitionFeatureKind;
    /** Derived declaration; resolved by the native core. */
    readonly transitionFeature?: Step;
}

export interface TransitionUsage extends ActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly effectAction?: ActionUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly guardExpression?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly source?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly succession?: Succession;
    /** Derived declaration; resolved by the native core. */
    readonly target?: ActionUsage;
    /** Derived declaration; resolved by the native core. */
    readonly triggerAction?: AcceptActionUsage[];
}

export interface TriggerInvocationExpression extends InvocationExpression {
    /** Reference or attribute. */
    kind?: TriggerKind;
}

export interface Type extends Namespace {
    /** Derived declaration; resolved by the native core. */
    readonly differencingType?: Type[];
    /** Derived declaration; resolved by the native core. */
    readonly directedFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly endFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly feature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly featureMembership?: FeatureMembership[];
    /** Derived declaration; resolved by the native core. */
    readonly inheritedFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly inheritedMembership?: Membership[];
    /** Derived declaration; resolved by the native core. */
    readonly input?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly intersectingType?: Type[];
    /** Reference or attribute. */
    isAbstract?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly isConjugated?: boolean;
    /** Reference or attribute. */
    isSufficient?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly multiplicity?: Multiplicity;
    /** Derived declaration; resolved by the native core. */
    readonly output?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedConjugator?: Conjugation;
    /** Derived declaration; resolved by the native core. */
    readonly ownedDifferencing?: Differencing[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedDisjoining?: Disjoining[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedEndFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedFeature?: Feature[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedFeatureMembership?: FeatureMembership[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedIntersecting?: Intersecting[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedSpecialization?: Specialization[];
    /** Derived declaration; resolved by the native core. */
    readonly ownedUnioning?: Unioning[];
    /** Derived declaration; resolved by the native core. */
    readonly unioningType?: Type[];
}

export interface TypeFeaturing extends Relationship {
    /** Reference or attribute. */
    featureOfType?: Feature;
    /** Reference or attribute. */
    featuringType?: Type;
    /** Derived declaration; resolved by the native core. */
    readonly owningFeatureOfType?: Feature;
}

export interface Unioning extends Relationship {
    /** Derived declaration; resolved by the native core. */
    readonly typeUnioned?: Type;
    /** Reference or attribute. */
    unioningType?: Type;
}

export interface Usage extends Feature {
    /** Derived declaration; resolved by the native core. */
    readonly definition?: Classifier[];
    /** Derived declaration; resolved by the native core. */
    readonly directedUsage?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly isReference?: boolean;
    /** Reference or attribute. */
    isVariation?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly mayTimeVary?: boolean;
    /** Derived declaration; resolved by the native core. */
    readonly nestedAction?: ActionUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedAllocation?: AllocationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedAnalysisCase?: AnalysisCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedAttribute?: AttributeUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedCalculation?: CalculationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedCase?: CaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedConcern?: ConcernUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedConnection?: ConnectorAsUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedConstraint?: ConstraintUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedEnumeration?: EnumerationUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedFlow?: FlowUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedInterface?: InterfaceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedItem?: ItemUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedMetadata?: MetadataUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedOccurrence?: OccurrenceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedPart?: PartUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedPort?: PortUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedReference?: ReferenceUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedRendering?: RenderingUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedRequirement?: RequirementUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedState?: StateUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedTransition?: TransitionUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedUsage?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedUseCase?: UseCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedVerificationCase?: VerificationCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedView?: ViewUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly nestedViewpoint?: ViewpointUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly owningDefinition?: Definition;
    /** Derived declaration; resolved by the native core. */
    readonly owningUsage?: Usage;
    /** Derived declaration; resolved by the native core. */
    readonly usage?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly variant?: Usage[];
    /** Derived declaration; resolved by the native core. */
    readonly variantMembership?: VariantMembership[];
}

export interface UseCaseDefinition extends CaseDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly includedUseCase?: UseCaseUsage[];
}

export interface UseCaseUsage extends CaseUsage {
    /** Derived declaration; resolved by the native core. */
    readonly includedUseCase?: UseCaseUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly useCaseDefinition?: UseCaseDefinition;
}

export interface VariantMembership extends OwningMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedVariantUsage?: Usage;
}

export interface VerificationCaseDefinition extends CaseDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly verifiedRequirement?: RequirementUsage[];
}

export interface VerificationCaseUsage extends CaseUsage {
    /** Derived declaration; resolved by the native core. */
    readonly verificationCaseDefinition?: VerificationCaseDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly verifiedRequirement?: RequirementUsage[];
}

export interface ViewDefinition extends PartDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly satisfiedViewpoint?: ViewpointUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly view?: ViewUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly viewCondition?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly viewRendering?: RenderingUsage;
}

export interface ViewRenderingMembership extends FeatureMembership {
    /** Derived declaration; resolved by the native core. */
    readonly ownedRendering?: RenderingUsage;
    /** Derived declaration; resolved by the native core. */
    readonly referencedRendering?: RenderingUsage;
}

export interface ViewUsage extends PartUsage {
    /** Derived declaration; resolved by the native core. */
    readonly exposedElement?: Element[];
    /** Derived declaration; resolved by the native core. */
    readonly satisfiedViewpoint?: ViewpointUsage[];
    /** Derived declaration; resolved by the native core. */
    readonly viewCondition?: Expression[];
    /** Derived declaration; resolved by the native core. */
    readonly viewDefinition?: ViewDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly viewRendering?: RenderingUsage;
}

export interface ViewpointDefinition extends RequirementDefinition {
    /** Derived declaration; resolved by the native core. */
    readonly viewpointStakeholder?: PartUsage[];
}

export interface ViewpointUsage extends RequirementUsage {
    /** Derived declaration; resolved by the native core. */
    readonly viewpointDefinition?: ViewpointDefinition;
    /** Derived declaration; resolved by the native core. */
    readonly viewpointStakeholder?: PartUsage[];
}

export interface WhileLoopActionUsage extends LoopActionUsage {
    /** Derived declaration; resolved by the native core. */
    readonly untilArgument?: Expression;
    /** Derived declaration; resolved by the native core. */
    readonly whileArgument?: Expression;
}

export interface GeneratedFeatureMetadata { name: string; type: string; many: boolean; containment: boolean; derived: boolean; opposite?: string; }
export const SYSML_METACLASS_FEATURES: Record<string, GeneratedFeatureMetadata[]> = {
    "AcceptActionUsage": [{"name":"payloadArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"payloadParameter","type":"ReferenceUsage","many":false,"containment":false,"derived":true},{"name":"receiverArgument","type":"Expression","many":false,"containment":false,"derived":true}],
    "ActionDefinition": [{"name":"action","type":"ActionUsage","many":true,"containment":false,"derived":true}],
    "ActionUsage": [{"name":"actionDefinition","type":"Behavior","many":true,"containment":false,"derived":true}],
    "ActorMembership": [{"name":"ownedActorParameter","type":"PartUsage","many":false,"containment":false,"derived":true}],
    "AllocationDefinition": [{"name":"allocation","type":"AllocationUsage","many":true,"containment":false,"derived":true}],
    "AllocationUsage": [{"name":"allocationDefinition","type":"AllocationDefinition","many":true,"containment":false,"derived":true}],
    "AnalysisCaseDefinition": [{"name":"resultExpression","type":"Expression","many":false,"containment":false,"derived":true}],
    "AnalysisCaseUsage": [{"name":"analysisCaseDefinition","type":"AnalysisCaseDefinition","many":false,"containment":false,"derived":true},{"name":"resultExpression","type":"Expression","many":false,"containment":false,"derived":true}],
    "AnnotatingElement": [{"name":"annotatedElement","type":"Element","many":true,"containment":false,"derived":true},{"name":"annotation","type":"Annotation","many":true,"containment":false,"derived":true,"opposite":"Annotation/annotatingElement"},{"name":"ownedAnnotatingRelationship","type":"Annotation","many":true,"containment":false,"derived":true,"opposite":"Annotation/owningAnnotatingElement"},{"name":"owningAnnotatingRelationship","type":"Annotation","many":false,"containment":false,"derived":true,"opposite":"Annotation/ownedAnnotatingElement"}],
    "Annotation": [{"name":"annotatedElement","type":"Element","many":false,"containment":false,"derived":false},{"name":"annotatingElement","type":"AnnotatingElement","many":false,"containment":false,"derived":true,"opposite":"AnnotatingElement/annotation"},{"name":"ownedAnnotatingElement","type":"AnnotatingElement","many":false,"containment":false,"derived":true,"opposite":"AnnotatingElement/owningAnnotatingRelationship"},{"name":"owningAnnotatedElement","type":"Element","many":false,"containment":false,"derived":true,"opposite":"Element/ownedAnnotation"},{"name":"owningAnnotatingElement","type":"AnnotatingElement","many":false,"containment":false,"derived":true,"opposite":"AnnotatingElement/ownedAnnotatingRelationship"}],
    "AssertConstraintUsage": [{"name":"assertedConstraint","type":"ConstraintUsage","many":false,"containment":false,"derived":true}],
    "AssignmentActionUsage": [{"name":"referent","type":"Feature","many":false,"containment":false,"derived":true},{"name":"targetArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"valueExpression","type":"Expression","many":false,"containment":false,"derived":true}],
    "Association": [{"name":"associationEnd","type":"Feature","many":true,"containment":false,"derived":true},{"name":"relatedType","type":"Type","many":true,"containment":false,"derived":true},{"name":"sourceType","type":"Type","many":false,"containment":false,"derived":true},{"name":"targetType","type":"Type","many":true,"containment":false,"derived":true}],
    "AssociationStructure": [],
    "AttributeDefinition": [],
    "AttributeUsage": [{"name":"attributeDefinition","type":"DataType","many":true,"containment":false,"derived":true}],
    "Behavior": [{"name":"parameter","type":"Feature","many":true,"containment":false,"derived":true},{"name":"step","type":"Step","many":true,"containment":false,"derived":true}],
    "BindingConnector": [],
    "BindingConnectorAsUsage": [],
    "BooleanExpression": [{"name":"predicate","type":"Predicate","many":false,"containment":false,"derived":true}],
    "CalculationDefinition": [{"name":"calculation","type":"CalculationUsage","many":true,"containment":false,"derived":true}],
    "CalculationUsage": [{"name":"calculationDefinition","type":"Function","many":false,"containment":false,"derived":true}],
    "CaseDefinition": [{"name":"actorParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"objectiveRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true},{"name":"subjectParameter","type":"Usage","many":false,"containment":false,"derived":true}],
    "CaseUsage": [{"name":"actorParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"caseDefinition","type":"CaseDefinition","many":false,"containment":false,"derived":true},{"name":"objectiveRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true},{"name":"subjectParameter","type":"Usage","many":false,"containment":false,"derived":true}],
    "Class": [],
    "Classifier": [{"name":"ownedSubclassification","type":"Subclassification","many":true,"containment":false,"derived":true,"opposite":"Subclassification/owningClassifier"}],
    "CollectExpression": [],
    "Comment": [{"name":"body","type":"string","many":false,"containment":false,"derived":false},{"name":"locale","type":"string","many":false,"containment":false,"derived":false}],
    "ConcernDefinition": [],
    "ConcernUsage": [{"name":"concernDefinition","type":"ConcernDefinition","many":false,"containment":false,"derived":true}],
    "ConjugatedPortDefinition": [{"name":"originalPortDefinition","type":"PortDefinition","many":false,"containment":false,"derived":true,"opposite":"PortDefinition/conjugatedPortDefinition"},{"name":"ownedPortConjugator","type":"PortConjugation","many":false,"containment":false,"derived":true,"opposite":"PortConjugation/conjugatedPortDefinition"}],
    "ConjugatedPortTyping": [{"name":"conjugatedPortDefinition","type":"ConjugatedPortDefinition","many":false,"containment":false,"derived":false},{"name":"portDefinition","type":"PortDefinition","many":false,"containment":false,"derived":true}],
    "Conjugation": [{"name":"conjugatedType","type":"Type","many":false,"containment":false,"derived":false},{"name":"originalType","type":"Type","many":false,"containment":false,"derived":false},{"name":"owningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedConjugator"}],
    "ConnectionDefinition": [{"name":"connectionEnd","type":"Usage","many":true,"containment":false,"derived":true}],
    "ConnectionUsage": [{"name":"connectionDefinition","type":"AssociationStructure","many":true,"containment":false,"derived":true}],
    "Connector": [{"name":"association","type":"Association","many":true,"containment":false,"derived":true},{"name":"connectorEnd","type":"Feature","many":true,"containment":false,"derived":true},{"name":"defaultFeaturingType","type":"Type","many":false,"containment":false,"derived":true},{"name":"relatedFeature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"sourceFeature","type":"Feature","many":false,"containment":false,"derived":true},{"name":"targetFeature","type":"Feature","many":true,"containment":false,"derived":true}],
    "ConnectorAsUsage": [],
    "ConstraintDefinition": [],
    "ConstraintUsage": [{"name":"constraintDefinition","type":"Predicate","many":false,"containment":false,"derived":true}],
    "ConstructorExpression": [],
    "ControlNode": [],
    "CrossSubsetting": [{"name":"crossedFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"crossingFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedCrossSubsetting"}],
    "DataType": [],
    "DecisionNode": [],
    "Definition": [{"name":"directedUsage","type":"Usage","many":true,"containment":false,"derived":true},{"name":"isVariation","type":"boolean","many":false,"containment":false,"derived":false},{"name":"ownedAction","type":"ActionUsage","many":true,"containment":false,"derived":true},{"name":"ownedAllocation","type":"AllocationUsage","many":true,"containment":false,"derived":true},{"name":"ownedAnalysisCase","type":"AnalysisCaseUsage","many":true,"containment":false,"derived":true},{"name":"ownedAttribute","type":"AttributeUsage","many":true,"containment":false,"derived":true},{"name":"ownedCalculation","type":"CalculationUsage","many":true,"containment":false,"derived":true},{"name":"ownedCase","type":"CaseUsage","many":true,"containment":false,"derived":true},{"name":"ownedConcern","type":"ConcernUsage","many":true,"containment":false,"derived":true},{"name":"ownedConnection","type":"ConnectorAsUsage","many":true,"containment":false,"derived":true},{"name":"ownedConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"ownedEnumeration","type":"EnumerationUsage","many":true,"containment":false,"derived":true},{"name":"ownedFlow","type":"FlowUsage","many":true,"containment":false,"derived":true},{"name":"ownedInterface","type":"InterfaceUsage","many":true,"containment":false,"derived":true},{"name":"ownedItem","type":"ItemUsage","many":true,"containment":false,"derived":true},{"name":"ownedMetadata","type":"MetadataUsage","many":true,"containment":false,"derived":true},{"name":"ownedOccurrence","type":"OccurrenceUsage","many":true,"containment":false,"derived":true},{"name":"ownedPart","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"ownedPort","type":"PortUsage","many":true,"containment":false,"derived":true},{"name":"ownedReference","type":"ReferenceUsage","many":true,"containment":false,"derived":true},{"name":"ownedRendering","type":"RenderingUsage","many":true,"containment":false,"derived":true},{"name":"ownedRequirement","type":"RequirementUsage","many":true,"containment":false,"derived":true},{"name":"ownedState","type":"StateUsage","many":true,"containment":false,"derived":true},{"name":"ownedTransition","type":"TransitionUsage","many":true,"containment":false,"derived":true},{"name":"ownedUsage","type":"Usage","many":true,"containment":false,"derived":true,"opposite":"Usage/owningDefinition"},{"name":"ownedUseCase","type":"UseCaseUsage","many":true,"containment":false,"derived":true},{"name":"ownedVerificationCase","type":"VerificationCaseUsage","many":true,"containment":false,"derived":true},{"name":"ownedView","type":"ViewUsage","many":true,"containment":false,"derived":true},{"name":"ownedViewpoint","type":"ViewpointUsage","many":true,"containment":false,"derived":true},{"name":"usage","type":"Usage","many":true,"containment":false,"derived":true},{"name":"variant","type":"Usage","many":true,"containment":false,"derived":true},{"name":"variantMembership","type":"VariantMembership","many":true,"containment":false,"derived":true}],
    "Dependency": [{"name":"client","type":"Element","many":true,"containment":false,"derived":false},{"name":"supplier","type":"Element","many":true,"containment":false,"derived":false}],
    "Differencing": [{"name":"differencingType","type":"Type","many":false,"containment":false,"derived":false},{"name":"typeDifferenced","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedDifferencing"}],
    "Disjoining": [{"name":"disjoiningType","type":"Type","many":false,"containment":false,"derived":false},{"name":"owningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedDisjoining"},{"name":"typeDisjoined","type":"Type","many":false,"containment":false,"derived":false}],
    "Documentation": [{"name":"documentedElement","type":"Element","many":false,"containment":false,"derived":true,"opposite":"Element/documentation"}],
    "Element": [{"name":"aliasIds","type":"string","many":true,"containment":false,"derived":false},{"name":"declaredName","type":"string","many":false,"containment":false,"derived":false},{"name":"declaredShortName","type":"string","many":false,"containment":false,"derived":false},{"name":"documentation","type":"Documentation","many":true,"containment":false,"derived":true,"opposite":"Documentation/documentedElement"},{"name":"elementId","type":"string","many":false,"containment":false,"derived":false},{"name":"isImpliedIncluded","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isLibraryElement","type":"boolean","many":false,"containment":false,"derived":true},{"name":"name","type":"string","many":false,"containment":false,"derived":true},{"name":"ownedAnnotation","type":"Annotation","many":true,"containment":false,"derived":true,"opposite":"Annotation/owningAnnotatedElement"},{"name":"ownedElement","type":"Element","many":true,"containment":false,"derived":true,"opposite":"Element/owner"},{"name":"ownedRelationship","type":"Relationship","many":true,"containment":true,"derived":false,"opposite":"Relationship/owningRelatedElement"},{"name":"owner","type":"Element","many":false,"containment":false,"derived":true,"opposite":"Element/ownedElement"},{"name":"owningMembership","type":"OwningMembership","many":false,"containment":false,"derived":true,"opposite":"OwningMembership/ownedMemberElement"},{"name":"owningNamespace","type":"Namespace","many":false,"containment":false,"derived":true,"opposite":"Namespace/ownedMember"},{"name":"owningRelationship","type":"Relationship","many":false,"containment":false,"derived":false,"opposite":"Relationship/ownedRelatedElement"},{"name":"qualifiedName","type":"string","many":false,"containment":false,"derived":true},{"name":"shortName","type":"string","many":false,"containment":false,"derived":true},{"name":"textualRepresentation","type":"TextualRepresentation","many":true,"containment":false,"derived":true,"opposite":"TextualRepresentation/representedElement"}],
    "ElementFilterMembership": [{"name":"condition","type":"Expression","many":false,"containment":false,"derived":true}],
    "EndFeatureMembership": [],
    "EnumerationDefinition": [{"name":"enumeratedValue","type":"EnumerationUsage","many":true,"containment":false,"derived":true}],
    "EnumerationUsage": [{"name":"enumerationDefinition","type":"EnumerationDefinition","many":false,"containment":false,"derived":true}],
    "EventOccurrenceUsage": [{"name":"eventOccurrence","type":"OccurrenceUsage","many":false,"containment":false,"derived":true}],
    "ExhibitStateUsage": [{"name":"exhibitedState","type":"StateUsage","many":false,"containment":false,"derived":true}],
    "Expose": [],
    "Expression": [{"name":"function","type":"Function","many":false,"containment":false,"derived":true},{"name":"isModelLevelEvaluable","type":"boolean","many":false,"containment":false,"derived":true},{"name":"result","type":"Feature","many":false,"containment":false,"derived":true}],
    "Feature": [{"name":"chainingFeature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"crossFeature","type":"Feature","many":false,"containment":false,"derived":true},{"name":"direction","type":"FeatureDirectionKind","many":false,"containment":false,"derived":false},{"name":"endOwningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedEndFeature"},{"name":"featureTarget","type":"Feature","many":false,"containment":false,"derived":true},{"name":"featuringType","type":"Type","many":true,"containment":false,"derived":true},{"name":"isComposite","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isConstant","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isDerived","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isEnd","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isOrdered","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isPortion","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isUnique","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isVariable","type":"boolean","many":false,"containment":false,"derived":false},{"name":"ownedCrossSubsetting","type":"CrossSubsetting","many":false,"containment":false,"derived":true,"opposite":"CrossSubsetting/crossingFeature"},{"name":"ownedFeatureChaining","type":"FeatureChaining","many":true,"containment":false,"derived":true,"opposite":"FeatureChaining/featureChained"},{"name":"ownedFeatureInverting","type":"FeatureInverting","many":true,"containment":false,"derived":true,"opposite":"FeatureInverting/owningFeature"},{"name":"ownedRedefinition","type":"Redefinition","many":true,"containment":false,"derived":true},{"name":"ownedReferenceSubsetting","type":"ReferenceSubsetting","many":false,"containment":false,"derived":true,"opposite":"ReferenceSubsetting/referencingFeature"},{"name":"ownedSubsetting","type":"Subsetting","many":true,"containment":false,"derived":true,"opposite":"Subsetting/owningFeature"},{"name":"ownedTypeFeaturing","type":"TypeFeaturing","many":true,"containment":false,"derived":true,"opposite":"TypeFeaturing/owningFeatureOfType"},{"name":"ownedTyping","type":"FeatureTyping","many":true,"containment":false,"derived":true,"opposite":"FeatureTyping/owningFeature"},{"name":"owningFeatureMembership","type":"FeatureMembership","many":false,"containment":false,"derived":true,"opposite":"FeatureMembership/ownedMemberFeature"},{"name":"owningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedFeature"},{"name":"type","type":"Type","many":true,"containment":false,"derived":true}],
    "FeatureChainExpression": [{"name":"targetFeature","type":"Feature","many":false,"containment":false,"derived":true}],
    "FeatureChaining": [{"name":"chainingFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"featureChained","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedFeatureChaining"}],
    "FeatureInverting": [{"name":"featureInverted","type":"Feature","many":false,"containment":false,"derived":false},{"name":"invertingFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"owningFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedFeatureInverting"}],
    "FeatureMembership": [{"name":"ownedMemberFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/owningFeatureMembership"},{"name":"owningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedFeatureMembership"}],
    "FeatureReferenceExpression": [{"name":"referent","type":"Feature","many":false,"containment":false,"derived":true}],
    "FeatureTyping": [{"name":"owningFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedTyping"},{"name":"type","type":"Type","many":false,"containment":false,"derived":false},{"name":"typedFeature","type":"Feature","many":false,"containment":false,"derived":false}],
    "FeatureValue": [{"name":"featureWithValue","type":"Feature","many":false,"containment":false,"derived":true},{"name":"isDefault","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isInitial","type":"boolean","many":false,"containment":false,"derived":false},{"name":"value","type":"Expression","many":false,"containment":false,"derived":true}],
    "Flow": [{"name":"flowEnd","type":"FlowEnd","many":true,"containment":false,"derived":true},{"name":"interaction","type":"Interaction","many":true,"containment":false,"derived":true},{"name":"payloadFeature","type":"PayloadFeature","many":false,"containment":false,"derived":true},{"name":"payloadType","type":"Classifier","many":true,"containment":false,"derived":true},{"name":"sourceOutputFeature","type":"Feature","many":false,"containment":false,"derived":true},{"name":"targetInputFeature","type":"Feature","many":false,"containment":false,"derived":true}],
    "FlowDefinition": [{"name":"flowEnd","type":"Usage","many":true,"containment":false,"derived":true}],
    "FlowEnd": [],
    "FlowUsage": [{"name":"flowDefinition","type":"Interaction","many":true,"containment":false,"derived":true}],
    "ForLoopActionUsage": [{"name":"loopVariable","type":"ReferenceUsage","many":false,"containment":false,"derived":true},{"name":"seqArgument","type":"Expression","many":false,"containment":false,"derived":true}],
    "ForkNode": [],
    "FramedConcernMembership": [{"name":"ownedConcern","type":"ConcernUsage","many":false,"containment":false,"derived":true},{"name":"referencedConcern","type":"ConcernUsage","many":false,"containment":false,"derived":true}],
    "Function": [{"name":"expression","type":"Expression","many":true,"containment":false,"derived":true},{"name":"isModelLevelEvaluable","type":"boolean","many":false,"containment":false,"derived":true},{"name":"result","type":"Feature","many":false,"containment":false,"derived":true}],
    "IfActionUsage": [{"name":"elseAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"ifArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"thenAction","type":"ActionUsage","many":false,"containment":false,"derived":true}],
    "Import": [{"name":"importOwningNamespace","type":"Namespace","many":false,"containment":false,"derived":true,"opposite":"Namespace/ownedImport"},{"name":"importedElement","type":"Element","many":false,"containment":false,"derived":true},{"name":"isImportAll","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isRecursive","type":"boolean","many":false,"containment":false,"derived":false},{"name":"visibility","type":"VisibilityKind","many":false,"containment":false,"derived":false}],
    "IncludeUseCaseUsage": [{"name":"useCaseIncluded","type":"UseCaseUsage","many":false,"containment":false,"derived":true}],
    "IndexExpression": [],
    "InstantiationExpression": [{"name":"argument","type":"Expression","many":true,"containment":false,"derived":true},{"name":"instantiatedType","type":"Type","many":false,"containment":false,"derived":true}],
    "Interaction": [],
    "InterfaceDefinition": [{"name":"interfaceEnd","type":"PortUsage","many":true,"containment":false,"derived":true}],
    "InterfaceUsage": [{"name":"interfaceDefinition","type":"InterfaceDefinition","many":true,"containment":false,"derived":true}],
    "Intersecting": [{"name":"intersectingType","type":"Type","many":false,"containment":false,"derived":false},{"name":"typeIntersected","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedIntersecting"}],
    "Invariant": [{"name":"isNegated","type":"boolean","many":false,"containment":false,"derived":false}],
    "InvocationExpression": [{"name":"operand","type":"Expression","many":true,"containment":true,"derived":true}],
    "ItemDefinition": [],
    "ItemUsage": [{"name":"itemDefinition","type":"Structure","many":true,"containment":false,"derived":true}],
    "JoinNode": [],
    "LibraryPackage": [{"name":"isStandard","type":"boolean","many":false,"containment":false,"derived":false}],
    "LiteralBoolean": [{"name":"value","type":"boolean","many":false,"containment":false,"derived":false}],
    "LiteralExpression": [],
    "LiteralInfinity": [],
    "LiteralInteger": [{"name":"value","type":"number","many":false,"containment":false,"derived":false}],
    "LiteralRational": [{"name":"value","type":"number","many":false,"containment":false,"derived":false}],
    "LiteralString": [{"name":"value","type":"string","many":false,"containment":false,"derived":false}],
    "LoopActionUsage": [{"name":"bodyAction","type":"ActionUsage","many":false,"containment":false,"derived":true}],
    "Membership": [{"name":"memberElement","type":"Element","many":false,"containment":false,"derived":false},{"name":"memberElementId","type":"string","many":false,"containment":false,"derived":true},{"name":"memberName","type":"string","many":false,"containment":false,"derived":false},{"name":"memberShortName","type":"string","many":false,"containment":false,"derived":false},{"name":"membershipOwningNamespace","type":"Namespace","many":false,"containment":false,"derived":true,"opposite":"Namespace/ownedMembership"},{"name":"visibility","type":"VisibilityKind","many":false,"containment":false,"derived":false}],
    "MembershipExpose": [],
    "MembershipImport": [{"name":"importedMembership","type":"Membership","many":false,"containment":false,"derived":false}],
    "MergeNode": [],
    "Metaclass": [],
    "MetadataAccessExpression": [{"name":"referencedElement","type":"Element","many":false,"containment":false,"derived":true}],
    "MetadataDefinition": [],
    "MetadataFeature": [{"name":"metaclass","type":"Metaclass","many":false,"containment":false,"derived":true}],
    "MetadataUsage": [{"name":"metadataDefinition","type":"Metaclass","many":false,"containment":false,"derived":true}],
    "Multiplicity": [],
    "MultiplicityRange": [{"name":"bound","type":"Expression","many":true,"containment":false,"derived":true},{"name":"lowerBound","type":"Expression","many":false,"containment":false,"derived":true},{"name":"upperBound","type":"Expression","many":false,"containment":false,"derived":true}],
    "Namespace": [{"name":"importedMembership","type":"Membership","many":true,"containment":false,"derived":true},{"name":"member","type":"Element","many":true,"containment":false,"derived":true},{"name":"membership","type":"Membership","many":true,"containment":false,"derived":true},{"name":"ownedImport","type":"Import","many":true,"containment":false,"derived":true,"opposite":"Import/importOwningNamespace"},{"name":"ownedMember","type":"Element","many":true,"containment":false,"derived":true,"opposite":"Element/owningNamespace"},{"name":"ownedMembership","type":"Membership","many":true,"containment":false,"derived":true,"opposite":"Membership/membershipOwningNamespace"}],
    "NamespaceExpose": [],
    "NamespaceImport": [{"name":"importedNamespace","type":"Namespace","many":false,"containment":false,"derived":false}],
    "NullExpression": [],
    "ObjectiveMembership": [{"name":"ownedObjectiveRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true}],
    "OccurrenceDefinition": [{"name":"isIndividual","type":"boolean","many":false,"containment":false,"derived":false}],
    "OccurrenceUsage": [{"name":"individualDefinition","type":"OccurrenceDefinition","many":false,"containment":false,"derived":true},{"name":"isIndividual","type":"boolean","many":false,"containment":false,"derived":false},{"name":"occurrenceDefinition","type":"Class","many":true,"containment":false,"derived":true},{"name":"portionKind","type":"PortionKind","many":false,"containment":false,"derived":false}],
    "OperatorExpression": [{"name":"operator","type":"string","many":false,"containment":false,"derived":false}],
    "OwningMembership": [{"name":"ownedMemberElement","type":"Element","many":false,"containment":false,"derived":true,"opposite":"Element/owningMembership"},{"name":"ownedMemberElementId","type":"string","many":false,"containment":false,"derived":true},{"name":"ownedMemberName","type":"string","many":false,"containment":false,"derived":true},{"name":"ownedMemberShortName","type":"string","many":false,"containment":false,"derived":true}],
    "Package": [{"name":"filterCondition","type":"Expression","many":true,"containment":false,"derived":true}],
    "ParameterMembership": [{"name":"ownedMemberParameter","type":"Feature","many":false,"containment":false,"derived":true}],
    "PartDefinition": [],
    "PartUsage": [{"name":"partDefinition","type":"PartDefinition","many":true,"containment":false,"derived":true}],
    "PayloadFeature": [],
    "PerformActionUsage": [{"name":"performedAction","type":"ActionUsage","many":false,"containment":false,"derived":true}],
    "PortConjugation": [{"name":"conjugatedPortDefinition","type":"ConjugatedPortDefinition","many":false,"containment":false,"derived":true,"opposite":"ConjugatedPortDefinition/ownedPortConjugator"},{"name":"originalPortDefinition","type":"PortDefinition","many":false,"containment":false,"derived":false}],
    "PortDefinition": [{"name":"conjugatedPortDefinition","type":"ConjugatedPortDefinition","many":false,"containment":false,"derived":true,"opposite":"ConjugatedPortDefinition/originalPortDefinition"}],
    "PortUsage": [{"name":"portDefinition","type":"PortDefinition","many":true,"containment":false,"derived":true}],
    "Predicate": [],
    "Redefinition": [{"name":"redefinedFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"redefiningFeature","type":"Feature","many":false,"containment":false,"derived":false}],
    "ReferenceSubsetting": [{"name":"referencedFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"referencingFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedReferenceSubsetting"}],
    "ReferenceUsage": [],
    "Relationship": [{"name":"isImplied","type":"boolean","many":false,"containment":false,"derived":false},{"name":"ownedRelatedElement","type":"Element","many":true,"containment":true,"derived":false,"opposite":"Element/owningRelationship"},{"name":"owningRelatedElement","type":"Element","many":false,"containment":false,"derived":false,"opposite":"Element/ownedRelationship"},{"name":"relatedElement","type":"Element","many":true,"containment":false,"derived":true},{"name":"source","type":"Element","many":true,"containment":false,"derived":false},{"name":"target","type":"Element","many":true,"containment":false,"derived":false}],
    "RenderingDefinition": [{"name":"rendering","type":"RenderingUsage","many":true,"containment":false,"derived":true}],
    "RenderingUsage": [{"name":"renderingDefinition","type":"RenderingDefinition","many":false,"containment":false,"derived":true}],
    "RequirementConstraintMembership": [{"name":"kind","type":"RequirementConstraintKind","many":false,"containment":false,"derived":false},{"name":"ownedConstraint","type":"ConstraintUsage","many":false,"containment":false,"derived":true},{"name":"referencedConstraint","type":"ConstraintUsage","many":false,"containment":false,"derived":true}],
    "RequirementDefinition": [{"name":"actorParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"assumedConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"framedConcern","type":"ConcernUsage","many":true,"containment":false,"derived":true},{"name":"reqId","type":"string","many":false,"containment":false,"derived":false},{"name":"requiredConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"stakeholderParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"subjectParameter","type":"Usage","many":false,"containment":false,"derived":true},{"name":"text","type":"string","many":true,"containment":false,"derived":true}],
    "RequirementUsage": [{"name":"actorParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"assumedConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"framedConcern","type":"ConcernUsage","many":true,"containment":false,"derived":true},{"name":"reqId","type":"string","many":false,"containment":false,"derived":false},{"name":"requiredConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"requirementDefinition","type":"RequirementDefinition","many":false,"containment":false,"derived":true},{"name":"stakeholderParameter","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"subjectParameter","type":"Usage","many":false,"containment":false,"derived":true},{"name":"text","type":"string","many":true,"containment":false,"derived":true}],
    "RequirementVerificationMembership": [{"name":"ownedRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true},{"name":"verifiedRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true}],
    "ResultExpressionMembership": [{"name":"ownedResultExpression","type":"Expression","many":false,"containment":false,"derived":true}],
    "ReturnParameterMembership": [],
    "SatisfyRequirementUsage": [{"name":"satisfiedRequirement","type":"RequirementUsage","many":false,"containment":false,"derived":true},{"name":"satisfyingFeature","type":"Feature","many":false,"containment":false,"derived":true}],
    "SelectExpression": [],
    "SendActionUsage": [{"name":"payloadArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"receiverArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"senderArgument","type":"Expression","many":false,"containment":false,"derived":true}],
    "Specialization": [{"name":"general","type":"Type","many":false,"containment":false,"derived":false},{"name":"owningType","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedSpecialization"},{"name":"specific","type":"Type","many":false,"containment":false,"derived":false}],
    "StakeholderMembership": [{"name":"ownedStakeholderParameter","type":"PartUsage","many":false,"containment":false,"derived":true}],
    "StateDefinition": [{"name":"doAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"entryAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"exitAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"isParallel","type":"boolean","many":false,"containment":false,"derived":false},{"name":"state","type":"StateUsage","many":true,"containment":false,"derived":true}],
    "StateSubactionMembership": [{"name":"action","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"kind","type":"StateSubactionKind","many":false,"containment":false,"derived":false}],
    "StateUsage": [{"name":"doAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"entryAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"exitAction","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"isParallel","type":"boolean","many":false,"containment":false,"derived":false},{"name":"stateDefinition","type":"Behavior","many":true,"containment":false,"derived":true}],
    "Step": [{"name":"behavior","type":"Behavior","many":true,"containment":false,"derived":true},{"name":"parameter","type":"Feature","many":true,"containment":false,"derived":true}],
    "Structure": [],
    "Subclassification": [{"name":"owningClassifier","type":"Classifier","many":false,"containment":false,"derived":true,"opposite":"Classifier/ownedSubclassification"},{"name":"subclassifier","type":"Classifier","many":false,"containment":false,"derived":false},{"name":"superclassifier","type":"Classifier","many":false,"containment":false,"derived":false}],
    "SubjectMembership": [{"name":"ownedSubjectParameter","type":"Usage","many":false,"containment":false,"derived":true}],
    "Subsetting": [{"name":"owningFeature","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedSubsetting"},{"name":"subsettedFeature","type":"Feature","many":false,"containment":false,"derived":false},{"name":"subsettingFeature","type":"Feature","many":false,"containment":false,"derived":false}],
    "Succession": [],
    "SuccessionAsUsage": [],
    "SuccessionFlow": [],
    "SuccessionFlowUsage": [],
    "TerminateActionUsage": [{"name":"terminatedOccurrenceArgument","type":"Expression","many":false,"containment":false,"derived":true}],
    "TextualRepresentation": [{"name":"body","type":"string","many":false,"containment":false,"derived":false},{"name":"language","type":"string","many":false,"containment":false,"derived":false},{"name":"representedElement","type":"Element","many":false,"containment":false,"derived":true,"opposite":"Element/textualRepresentation"}],
    "TransitionFeatureMembership": [{"name":"kind","type":"TransitionFeatureKind","many":false,"containment":false,"derived":false},{"name":"transitionFeature","type":"Step","many":false,"containment":false,"derived":true}],
    "TransitionUsage": [{"name":"effectAction","type":"ActionUsage","many":true,"containment":false,"derived":true},{"name":"guardExpression","type":"Expression","many":true,"containment":false,"derived":true},{"name":"source","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"succession","type":"Succession","many":false,"containment":false,"derived":true},{"name":"target","type":"ActionUsage","many":false,"containment":false,"derived":true},{"name":"triggerAction","type":"AcceptActionUsage","many":true,"containment":false,"derived":true}],
    "TriggerInvocationExpression": [{"name":"kind","type":"TriggerKind","many":false,"containment":false,"derived":false}],
    "Type": [{"name":"differencingType","type":"Type","many":true,"containment":false,"derived":true},{"name":"directedFeature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"endFeature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"feature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"featureMembership","type":"FeatureMembership","many":true,"containment":false,"derived":true},{"name":"inheritedFeature","type":"Feature","many":true,"containment":false,"derived":true},{"name":"inheritedMembership","type":"Membership","many":true,"containment":false,"derived":true},{"name":"input","type":"Feature","many":true,"containment":false,"derived":true},{"name":"intersectingType","type":"Type","many":true,"containment":false,"derived":true},{"name":"isAbstract","type":"boolean","many":false,"containment":false,"derived":false},{"name":"isConjugated","type":"boolean","many":false,"containment":false,"derived":true},{"name":"isSufficient","type":"boolean","many":false,"containment":false,"derived":false},{"name":"multiplicity","type":"Multiplicity","many":false,"containment":false,"derived":true},{"name":"output","type":"Feature","many":true,"containment":false,"derived":true},{"name":"ownedConjugator","type":"Conjugation","many":false,"containment":false,"derived":true,"opposite":"Conjugation/owningType"},{"name":"ownedDifferencing","type":"Differencing","many":true,"containment":false,"derived":true,"opposite":"Differencing/typeDifferenced"},{"name":"ownedDisjoining","type":"Disjoining","many":true,"containment":false,"derived":true,"opposite":"Disjoining/owningType"},{"name":"ownedEndFeature","type":"Feature","many":true,"containment":false,"derived":true,"opposite":"Feature/endOwningType"},{"name":"ownedFeature","type":"Feature","many":true,"containment":false,"derived":true,"opposite":"Feature/owningType"},{"name":"ownedFeatureMembership","type":"FeatureMembership","many":true,"containment":false,"derived":true,"opposite":"FeatureMembership/owningType"},{"name":"ownedIntersecting","type":"Intersecting","many":true,"containment":false,"derived":true,"opposite":"Intersecting/typeIntersected"},{"name":"ownedSpecialization","type":"Specialization","many":true,"containment":false,"derived":true,"opposite":"Specialization/owningType"},{"name":"ownedUnioning","type":"Unioning","many":true,"containment":false,"derived":true,"opposite":"Unioning/typeUnioned"},{"name":"unioningType","type":"Type","many":true,"containment":false,"derived":true}],
    "TypeFeaturing": [{"name":"featureOfType","type":"Feature","many":false,"containment":false,"derived":false},{"name":"featuringType","type":"Type","many":false,"containment":false,"derived":false},{"name":"owningFeatureOfType","type":"Feature","many":false,"containment":false,"derived":true,"opposite":"Feature/ownedTypeFeaturing"}],
    "Unioning": [{"name":"typeUnioned","type":"Type","many":false,"containment":false,"derived":true,"opposite":"Type/ownedUnioning"},{"name":"unioningType","type":"Type","many":false,"containment":false,"derived":false}],
    "Usage": [{"name":"definition","type":"Classifier","many":true,"containment":false,"derived":true},{"name":"directedUsage","type":"Usage","many":true,"containment":false,"derived":true},{"name":"isReference","type":"boolean","many":false,"containment":false,"derived":true},{"name":"isVariation","type":"boolean","many":false,"containment":false,"derived":false},{"name":"mayTimeVary","type":"boolean","many":false,"containment":false,"derived":true},{"name":"nestedAction","type":"ActionUsage","many":true,"containment":false,"derived":true},{"name":"nestedAllocation","type":"AllocationUsage","many":true,"containment":false,"derived":true},{"name":"nestedAnalysisCase","type":"AnalysisCaseUsage","many":true,"containment":false,"derived":true},{"name":"nestedAttribute","type":"AttributeUsage","many":true,"containment":false,"derived":true},{"name":"nestedCalculation","type":"CalculationUsage","many":true,"containment":false,"derived":true},{"name":"nestedCase","type":"CaseUsage","many":true,"containment":false,"derived":true},{"name":"nestedConcern","type":"ConcernUsage","many":true,"containment":false,"derived":true},{"name":"nestedConnection","type":"ConnectorAsUsage","many":true,"containment":false,"derived":true},{"name":"nestedConstraint","type":"ConstraintUsage","many":true,"containment":false,"derived":true},{"name":"nestedEnumeration","type":"EnumerationUsage","many":true,"containment":false,"derived":true},{"name":"nestedFlow","type":"FlowUsage","many":true,"containment":false,"derived":true},{"name":"nestedInterface","type":"InterfaceUsage","many":true,"containment":false,"derived":true},{"name":"nestedItem","type":"ItemUsage","many":true,"containment":false,"derived":true},{"name":"nestedMetadata","type":"MetadataUsage","many":true,"containment":false,"derived":true},{"name":"nestedOccurrence","type":"OccurrenceUsage","many":true,"containment":false,"derived":true},{"name":"nestedPart","type":"PartUsage","many":true,"containment":false,"derived":true},{"name":"nestedPort","type":"PortUsage","many":true,"containment":false,"derived":true},{"name":"nestedReference","type":"ReferenceUsage","many":true,"containment":false,"derived":true},{"name":"nestedRendering","type":"RenderingUsage","many":true,"containment":false,"derived":true},{"name":"nestedRequirement","type":"RequirementUsage","many":true,"containment":false,"derived":true},{"name":"nestedState","type":"StateUsage","many":true,"containment":false,"derived":true},{"name":"nestedTransition","type":"TransitionUsage","many":true,"containment":false,"derived":true},{"name":"nestedUsage","type":"Usage","many":true,"containment":false,"derived":true,"opposite":"Usage/owningUsage"},{"name":"nestedUseCase","type":"UseCaseUsage","many":true,"containment":false,"derived":true},{"name":"nestedVerificationCase","type":"VerificationCaseUsage","many":true,"containment":false,"derived":true},{"name":"nestedView","type":"ViewUsage","many":true,"containment":false,"derived":true},{"name":"nestedViewpoint","type":"ViewpointUsage","many":true,"containment":false,"derived":true},{"name":"owningDefinition","type":"Definition","many":false,"containment":false,"derived":true,"opposite":"Definition/ownedUsage"},{"name":"owningUsage","type":"Usage","many":false,"containment":false,"derived":true,"opposite":"Usage/nestedUsage"},{"name":"usage","type":"Usage","many":true,"containment":false,"derived":true},{"name":"variant","type":"Usage","many":true,"containment":false,"derived":true},{"name":"variantMembership","type":"VariantMembership","many":true,"containment":false,"derived":true}],
    "UseCaseDefinition": [{"name":"includedUseCase","type":"UseCaseUsage","many":true,"containment":false,"derived":true}],
    "UseCaseUsage": [{"name":"includedUseCase","type":"UseCaseUsage","many":true,"containment":false,"derived":true},{"name":"useCaseDefinition","type":"UseCaseDefinition","many":false,"containment":false,"derived":true}],
    "VariantMembership": [{"name":"ownedVariantUsage","type":"Usage","many":false,"containment":false,"derived":true}],
    "VerificationCaseDefinition": [{"name":"verifiedRequirement","type":"RequirementUsage","many":true,"containment":false,"derived":true}],
    "VerificationCaseUsage": [{"name":"verificationCaseDefinition","type":"VerificationCaseDefinition","many":false,"containment":false,"derived":true},{"name":"verifiedRequirement","type":"RequirementUsage","many":true,"containment":false,"derived":true}],
    "ViewDefinition": [{"name":"satisfiedViewpoint","type":"ViewpointUsage","many":true,"containment":false,"derived":true},{"name":"view","type":"ViewUsage","many":true,"containment":false,"derived":true},{"name":"viewCondition","type":"Expression","many":true,"containment":false,"derived":true},{"name":"viewRendering","type":"RenderingUsage","many":false,"containment":false,"derived":true}],
    "ViewRenderingMembership": [{"name":"ownedRendering","type":"RenderingUsage","many":false,"containment":false,"derived":true},{"name":"referencedRendering","type":"RenderingUsage","many":false,"containment":false,"derived":true}],
    "ViewUsage": [{"name":"exposedElement","type":"Element","many":true,"containment":false,"derived":true},{"name":"satisfiedViewpoint","type":"ViewpointUsage","many":true,"containment":false,"derived":true},{"name":"viewCondition","type":"Expression","many":true,"containment":false,"derived":true},{"name":"viewDefinition","type":"ViewDefinition","many":false,"containment":false,"derived":true},{"name":"viewRendering","type":"RenderingUsage","many":false,"containment":false,"derived":true}],
    "ViewpointDefinition": [{"name":"viewpointStakeholder","type":"PartUsage","many":true,"containment":false,"derived":true}],
    "ViewpointUsage": [{"name":"viewpointDefinition","type":"ViewpointDefinition","many":false,"containment":false,"derived":true},{"name":"viewpointStakeholder","type":"PartUsage","many":true,"containment":false,"derived":true}],
    "WhileLoopActionUsage": [{"name":"untilArgument","type":"Expression","many":false,"containment":false,"derived":true},{"name":"whileArgument","type":"Expression","many":false,"containment":false,"derived":true}],
};
