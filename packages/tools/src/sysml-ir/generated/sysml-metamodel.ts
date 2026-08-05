// GENERATED from SysML.ecore by scripts/generate-sysml-ir.mjs. DO NOT EDIT.
//
// Source: OMG SysML v2 Pilot Implementation, release 2026-05, commit fa709f2.
// SHA-256: 7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0
//
// Derived features are declarations only. Their specification OCL is reproduced
// verbatim in the doc comment as a citation; the computation lives in the
// hand-written resolution core (plan §1.5.1 rule 2, §4.1 B3).

export const SYSML_ECORE_SHA256 = "7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0";
export const SYSML_ECORE_RELEASE = "2026-05";
export const SYSML_ECORE_COMMIT = "fa709f2";

// ─── Enumerations ───────────────────────────────────────────────────────────

/** `FeatureDirectionKind` enumeration. */
export type FeatureDirectionKind = "in" | "inout" | "out";
export const FEATURE_DIRECTION_KIND_LITERALS: readonly FeatureDirectionKind[] = ["in", "inout", "out"];

/** `PortionKind` enumeration. */
export type PortionKind = "timeslice" | "snapshot";
export const PORTION_KIND_LITERALS: readonly PortionKind[] = ["timeslice", "snapshot"];

/** `RequirementConstraintKind` enumeration. */
export type RequirementConstraintKind = "assumption" | "requirement";
export const REQUIREMENT_CONSTRAINT_KIND_LITERALS: readonly RequirementConstraintKind[] = ["assumption", "requirement"];

/** `StateSubactionKind` enumeration. */
export type StateSubactionKind = "entry" | "do" | "exit";
export const STATE_SUBACTION_KIND_LITERALS: readonly StateSubactionKind[] = ["entry", "do", "exit"];

/** `TransitionFeatureKind` enumeration. */
export type TransitionFeatureKind = "trigger" | "guard" | "effect";
export const TRANSITION_FEATURE_KIND_LITERALS: readonly TransitionFeatureKind[] = ["trigger", "guard", "effect"];

/** `TriggerKind` enumeration. */
export type TriggerKind = "when" | "at" | "after";
export const TRIGGER_KIND_LITERALS: readonly TriggerKind[] = ["when", "at", "after"];

/** `VisibilityKind` enumeration. */
export type VisibilityKind = "private" | "protected" | "public";
export const VISIBILITY_KIND_LITERALS: readonly VisibilityKind[] = ["private", "protected", "public"];

// ─── Metaclasses ────────────────────────────────────────────────────────────

/**
 * `AcceptActionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface AcceptActionUsage extends ActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * payloadArgument = argument(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly payloadArgument?: Expression;
    /**
     * Reference 1..1, derived.
     * Subsets: `Usage/nestedReference`, `Step/parameter`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * payloadParameter =
     *  if parameter->isEmpty() then null
     *  else parameter->first() endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly payloadParameter?: ReferenceUsage;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * receiverArgument = argument(2)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly receiverArgument?: Expression;
}

/**
 * `ActionDefinition`.
 * Generalizes: `OccurrenceDefinition`, `Behavior`.
 */
export interface ActionDefinition extends OccurrenceDefinition, Behavior {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Behavior/step`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * action = usage->selectByKind(ActionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly action?: ActionUsage[];
}

/**
 * `ActionUsage`.
 * Generalizes: `OccurrenceUsage`, `Step`.
 */
export interface ActionUsage extends OccurrenceUsage, Step {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Step/behavior`, `OccurrenceUsage/occurrenceDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly actionDefinition?: Behavior[];
}

/**
 * `ActorMembership`.
 * Generalizes: `ParameterMembership`.
 */
export interface ActorMembership extends ParameterMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `ParameterMembership/ownedMemberParameter`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedActorParameter?: PartUsage;
}

/**
 * `AllocationDefinition`.
 * Generalizes: `ConnectionDefinition`.
 */
export interface AllocationDefinition extends ConnectionDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * allocation = usage->selectAsKind(AllocationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly allocation?: AllocationUsage[];
}

/**
 * `AllocationUsage`.
 * Generalizes: `ConnectionUsage`.
 */
export interface AllocationUsage extends ConnectionUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `ConnectionUsage/connectionDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly allocationDefinition?: AllocationDefinition[];
}

/**
 * `AnalysisCaseDefinition`.
 * Generalizes: `CaseDefinition`.
 */
export interface AnalysisCaseDefinition extends CaseDefinition {
    /**
     * Reference 0..1, derived.
     * Subsets: `Function/expression`, `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * resultExpression =
     *     let results : OrderedSet(ResultExpressionMembership) =
     *         featureMembersip->
     *             selectByKind(ResultExpressionMembership) in
     *     if results->isEmpty() then null
     *     else results->first().ownedResultExpression
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly resultExpression?: Expression;
}

/**
 * `AnalysisCaseUsage`.
 * Generalizes: `CaseUsage`.
 */
export interface AnalysisCaseUsage extends CaseUsage {
    /**
     * Reference 0..1, derived.
     * Redefines: `CaseUsage/caseDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly analysisCaseDefinition?: AnalysisCaseDefinition;
    /**
     * Reference 0..1, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * resultExpression =
     *     let results : OrderedSet(ResultExpressionMembership) =
     *         featureMembersip->
     *             selectByKind(ResultExpressionMembership) in
     *     if results->isEmpty() then null
     *     else results->first().ownedResultExpression
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly resultExpression?: Expression;
}

/**
 * `AnnotatingElement`.
 * Generalizes: `Element`.
 */
export interface AnnotatingElement extends Element {
    /**
     * Reference 1..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * annotatedElement =
     *  if annotation->notEmpty() then annotation.annotatedElement
     *  else Sequence{owningNamespace} endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly annotatedElement?: Element[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Annotation/annotatingElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * annotation =
     *     if owningAnnotatingRelationship = null then ownedAnnotatingRelationship
     *     else owningAnnotatingRelationship->prepend(owningAnnotatingRelationship)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly annotation?: Annotation[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Annotation/owningAnnotatingElement`.
     * Subsets: `AnnotatingElement/annotation`, `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAnnotatingRelationship = ownedRelationship->
     *     selectByKind(Annotation)->
     *     select(a | a.annotatedElement <> self)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAnnotatingRelationship?: Annotation[];
    /**
     * Reference 0..1, derived.
     * Opposite: `Annotation/ownedAnnotatingElement`.
     * Subsets: `Element/owningRelationship`, `AnnotatingElement/annotation`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningAnnotatingRelationship?: Annotation;
}

/**
 * `Annotation`.
 * Generalizes: `Relationship`.
 */
export interface Annotation extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    annotatedElement: Element;
    /**
     * Reference 1..1, derived.
     * Opposite: `AnnotatingElement/annotation`.
     * Redefines: `Relationship/source`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * annotatingElement =
     *     if ownedAnnotatingElement <> null then ownedAnnotatingElement
     *     else owningAnnotatingElement
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly annotatingElement?: AnnotatingElement;
    /**
     * Reference 0..1, derived.
     * Opposite: `AnnotatingElement/owningAnnotatingRelationship`.
     * Subsets: `Annotation/annotatingElement`, `Relationship/ownedRelatedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAnnotatingElement =
     *     let ownedAnnotatingElements : Sequence(AnnotatingElement) =
     *         ownedRelatedElement->selectByKind(AnnotatingElement) in
     *     if ownedAnnotatingElements->isEmpty() then null
     *     else ownedAnnotatingElements->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAnnotatingElement?: AnnotatingElement;
    /**
     * Reference 0..1, derived.
     * Opposite: `Element/ownedAnnotation`.
     * Subsets: `Annotation/annotatedElement`, `Relationship/owningRelatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningAnnotatedElement?: Element;
    /**
     * Reference 0..1, derived.
     * Opposite: `AnnotatingElement/ownedAnnotatingRelationship`.
     * Subsets: `Annotation/annotatingElement`, `Relationship/owningRelatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningAnnotatingElement?: AnnotatingElement;
}

/**
 * `AssertConstraintUsage`.
 * Generalizes: `ConstraintUsage`, `Invariant`.
 */
export interface AssertConstraintUsage extends ConstraintUsage, Invariant {
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * assertedConstraint =
     *     if referencedFeatureTarget() = null then self
     *     else if referencedFeatureTarget().oclIsKindOf(ConstraintUsage) then
     *         referencedFeatureTarget().oclAsType(ConstraintUsage)
     *     else null
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly assertedConstraint?: ConstraintUsage;
}

/**
 * `AssignmentActionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface AssignmentActionUsage extends ActionUsage {
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * referent =
     *     let unownedFeatures : Sequence(Feature) = ownedMembership->
     *         reject(oclIsKindOf(FeatureMembership)).memberElement->
     *         select(oclIsKindOf(Feature) and
     *                not oclIsKindOf(MetadataFeature)) in
     *     if unownedFeatures->isEmpty() then null
     *     else unownedFeatures->first().oclAsType(Feature)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referent?: Feature;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * targetArgument = argument(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly targetArgument?: Expression;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * valueExpression = argument(2)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly valueExpression?: Expression;
}

/**
 * `Association`.
 * Generalizes: `Classifier`, `Relationship`.
 */
export interface Association extends Classifier, Relationship {
    /**
     * Reference 0..*, derived.
     * Redefines: `Type/endFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly associationEnd?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Relationship/relatedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * relatedType = associationEnd.type
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly relatedType?: Type[];
    /**
     * Reference 0..1, derived.
     * Subsets: `Association/relatedType`.
     * Redefines: `Relationship/source`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * sourceType =
     *     if relatedType->isEmpty() then null
     *     else relatedType->first() endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly sourceType?: Type;
    /**
     * Reference 0..*, derived.
     * Subsets: `Association/relatedType`.
     * Redefines: `Relationship/target`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * targetType =
     *     if relatedType->size() < 2 then OrderedSet{}
     *     else
     *         relatedType->
     *             subSequence(2, relatedType->size())->
     *             asOrderedSet()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly targetType?: Type[];
}

/**
 * `AssociationStructure`.
 * Generalizes: `Association`, `Structure`.
 */
export interface AssociationStructure extends Association, Structure {}

/**
 * `AttributeDefinition`.
 * Generalizes: `Definition`, `DataType`.
 */
export interface AttributeDefinition extends Definition, DataType {}

/**
 * `AttributeUsage`.
 * Generalizes: `Usage`.
 */
export interface AttributeUsage extends Usage {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Usage/definition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly attributeDefinition?: DataType[];
}

/**
 * `Behavior`.
 * Generalizes: `Class`.
 */
export interface Behavior extends Class {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Type/directedFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly parameter?: Feature[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * step = feature->selectByKind(Step)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly step?: Step[];
}

/**
 * `BindingConnector`.
 * Generalizes: `Connector`.
 */
export interface BindingConnector extends Connector {}

/**
 * `BindingConnectorAsUsage`.
 * Generalizes: `ConnectorAsUsage`, `BindingConnector`.
 */
export interface BindingConnectorAsUsage extends ConnectorAsUsage, BindingConnector {}

/**
 * `BooleanExpression`.
 * Generalizes: `Expression`.
 */
export interface BooleanExpression extends Expression {
    /**
     * Reference 0..1, derived.
     * Redefines: `Expression/function`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly predicate?: Predicate;
}

/**
 * `CalculationDefinition`.
 * Generalizes: `ActionDefinition`, `Function`.
 */
export interface CalculationDefinition extends ActionDefinition, Function {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `ActionDefinition/action`, `Function/expression`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * calculation = action->selectByKind(CalculationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly calculation?: CalculationUsage[];
}

/**
 * `CalculationUsage`.
 * Generalizes: `ActionUsage`, `Expression`.
 */
export interface CalculationUsage extends ActionUsage, Expression {
    /**
     * Reference 0..1, ordered, derived.
     * Redefines: `Expression/function`, `ActionUsage/actionDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly calculationDefinition?: Function;
}

/**
 * `CaseDefinition`.
 * Generalizes: `CalculationDefinition`.
 */
export interface CaseDefinition extends CalculationDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Behavior/parameter`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * actorParameter = featureMembership->
     *     selectByKind(ActorMembership).
     *     ownedActorParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly actorParameter?: PartUsage[];
    /**
     * Reference 0..1, ordered, derived.
     * Subsets: `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * objectiveRequirement =
     *     let objectives: OrderedSet(RequirementUsage) =
     *         featureMembership->
     *             selectByKind(ObjectiveMembership).
     *             ownedRequirement in
     *     if objectives->isEmpty() then null
     *     else objectives->first().ownedObjectiveRequirement
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly objectiveRequirement?: RequirementUsage;
    /**
     * Reference 1..1, derived.
     * Subsets: `Behavior/parameter`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * subjectParameter =
     *     let subjectMems : OrderedSet(SubjectMembership) =
     *         featureMembership->selectByKind(SubjectMembership) in
     *     if subjectMems->isEmpty() then null
     *     else subjectMems->first().ownedSubjectParameter
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly subjectParameter?: Usage;
}

/**
 * `CaseUsage`.
 * Generalizes: `CalculationUsage`.
 */
export interface CaseUsage extends CalculationUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Step/parameter`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * actorParameter = featureMembership->
     *     selectByKind(ActorMembership).
     *     ownedActorParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly actorParameter?: PartUsage[];
    /**
     * Reference 0..1, derived.
     * Redefines: `CalculationUsage/calculationDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly caseDefinition?: CaseDefinition;
    /**
     * Reference 0..1, ordered, derived.
     * Subsets: `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * objectiveRequirement =
     *     let objectives: OrderedSet(RequirementUsage) =
     *         featureMembership->
     *             selectByKind(ObjectiveMembership).
     *             ownedRequirement in
     *     if objectives->isEmpty() then null
     *     else objectives->first().ownedObjectiveRequirement
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly objectiveRequirement?: RequirementUsage;
    /**
     * Reference 1..1, derived.
     * Subsets: `Step/parameter`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * subjectParameter =
     *     let subjects : OrderedSet(SubjectMembership) =
     *         featureMembership->selectByKind(SubjectMembership) in
     *     if subjects->isEmpty() then null
     *     else subjects->first().ownedSubjectParameter
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly subjectParameter?: Usage;
}

/**
 * `Class`.
 * Generalizes: `Classifier`.
 */
export interface Class extends Classifier {}

/**
 * `Classifier`.
 * Generalizes: `Type`.
 */
export interface Classifier extends Type {
    /**
     * Reference 0..*, derived.
     * Opposite: `Subclassification/owningClassifier`.
     * Subsets: `Type/ownedSpecialization`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedSubclassification =
     *     ownedSpecialization->selectByKind(Subclassification)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedSubclassification?: Subclassification[];
}

/**
 * `CollectExpression`.
 * Generalizes: `OperatorExpression`.
 */
export interface CollectExpression extends OperatorExpression {}

/**
 * `Comment`.
 * Generalizes: `AnnotatingElement`.
 */
export interface Comment extends AnnotatingElement {
    /** Attribute 1..1. */
    body: string;
    /** Attribute 0..1. */
    locale?: string;
}

/**
 * `ConcernDefinition`.
 * Generalizes: `RequirementDefinition`.
 */
export interface ConcernDefinition extends RequirementDefinition {}

/**
 * `ConcernUsage`.
 * Generalizes: `RequirementUsage`.
 */
export interface ConcernUsage extends RequirementUsage {
    /**
     * Reference 0..1, derived.
     * Redefines: `RequirementUsage/requirementDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly concernDefinition?: ConcernDefinition;
}

/**
 * `ConjugatedPortDefinition`.
 * Generalizes: `PortDefinition`.
 */
export interface ConjugatedPortDefinition extends PortDefinition {
    /**
     * Reference 1..1, derived.
     * Opposite: `PortDefinition/conjugatedPortDefinition`.
     * Redefines: `Element/owningNamespace`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly originalPortDefinition?: PortDefinition;
    /**
     * Reference 1..1, derived.
     * Opposite: `PortConjugation/conjugatedPortDefinition`.
     * Redefines: `Type/ownedConjugator`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedPortConjugator?: PortConjugation;
}

/**
 * `ConjugatedPortTyping`.
 * Generalizes: `FeatureTyping`.
 */
export interface ConjugatedPortTyping extends FeatureTyping {
    /**
     * Reference 1..1.
     * Redefines: `FeatureTyping/type`.
     */
    conjugatedPortDefinition: ConjugatedPortDefinition;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * portDefinition = conjugatedPortDefinition.originalPortDefinition
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly portDefinition?: PortDefinition;
}

/**
 * `Conjugation`.
 * Generalizes: `Relationship`.
 */
export interface Conjugation extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/source`.
     */
    conjugatedType: Type;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    originalType: Type;
    /**
     * Reference 0..1, derived.
     * Opposite: `Type/ownedConjugator`.
     * Subsets: `Conjugation/conjugatedType`, `Relationship/owningRelatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningType?: Type;
}

/**
 * `ConnectionDefinition`.
 * Generalizes: `PartDefinition`, `AssociationStructure`.
 */
export interface ConnectionDefinition extends PartDefinition, AssociationStructure {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Association/associationEnd`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly connectionEnd?: Usage[];
}

/**
 * `ConnectionUsage`.
 * Generalizes: `ConnectorAsUsage`, `PartUsage`.
 */
export interface ConnectionUsage extends ConnectorAsUsage, PartUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `ItemUsage/itemDefinition`.
     * Redefines: `Connector/association`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly connectionDefinition?: AssociationStructure[];
}

/**
 * `Connector`.
 * Generalizes: `Feature`, `Relationship`.
 */
export interface Connector extends Feature, Relationship {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Feature/type`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly association?: Association[];
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Type/endFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly connectorEnd?: Feature[];
    /**
     * Reference 0..1, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly defaultFeaturingType?: Type;
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Relationship/relatedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * relatedFeature = connectorEnd.ownedReferenceSubsetting->
     *     select(s | s <> null).subsettedFeature
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly relatedFeature?: Feature[];
    /**
     * Reference 0..1, ordered, derived.
     * Subsets: `Connector/relatedFeature`.
     * Redefines: `Relationship/source`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * sourceFeature =
     *     if relatedFeature->isEmpty() then null
     *     else relatedFeature->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly sourceFeature?: Feature;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Connector/relatedFeature`.
     * Redefines: `Relationship/target`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * targetFeature =
     *     if relatedFeature->size() < 2 then OrderedSet{}
     *     else
     *         relatedFeature->
     *             subSequence(2, relatedFeature->size())->
     *             asOrderedSet()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly targetFeature?: Feature[];
}

/**
 * `ConnectorAsUsage` (abstract).
 * Generalizes: `Usage`, `Connector`.
 */
export interface ConnectorAsUsage extends Usage, Connector {}

/**
 * `ConstraintDefinition`.
 * Generalizes: `OccurrenceDefinition`, `Predicate`.
 */
export interface ConstraintDefinition extends OccurrenceDefinition, Predicate {}

/**
 * `ConstraintUsage`.
 * Generalizes: `OccurrenceUsage`, `BooleanExpression`.
 */
export interface ConstraintUsage extends OccurrenceUsage, BooleanExpression {
    /**
     * Reference 0..1, derived.
     * Redefines: `BooleanExpression/predicate`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly constraintDefinition?: Predicate;
}

/**
 * `ConstructorExpression`.
 * Generalizes: `InstantiationExpression`.
 */
export interface ConstructorExpression extends InstantiationExpression {}

/**
 * `ControlNode` (abstract).
 * Generalizes: `ActionUsage`.
 */
export interface ControlNode extends ActionUsage {}

/**
 * `CrossSubsetting`.
 * Generalizes: `Subsetting`.
 */
export interface CrossSubsetting extends Subsetting {
    /**
     * Reference 1..1.
     * Redefines: `Subsetting/subsettedFeature`.
     */
    crossedFeature: Feature;
    /**
     * Reference 1..1, derived.
     * Opposite: `Feature/ownedCrossSubsetting`.
     * Redefines: `Subsetting/owningFeature`, `Subsetting/subsettingFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly crossingFeature?: Feature;
}

/**
 * `DataType`.
 * Generalizes: `Classifier`.
 */
export interface DataType extends Classifier {}

/**
 * `DecisionNode`.
 * Generalizes: `ControlNode`.
 */
export interface DecisionNode extends ControlNode {}

/**
 * `Definition`.
 * Generalizes: `Classifier`.
 */
export interface Definition extends Classifier {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/directedFeature`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * directedUsage = directedFeature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly directedUsage?: Usage[];
    /** Attribute 1..1. */
    isVariation: boolean;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAction = ownedUsage->selectByKind(ActionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAction?: ActionUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAllocation = ownedUsage->selectByKind(AllocationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAllocation?: AllocationUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAnalysisCase = ownedUsage->selectByKind(AnalysisCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAnalysisCase?: AnalysisCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAttribute = ownedUsage->selectByKind(AttributeUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAttribute?: AttributeUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedAction`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedCalculation = ownedUsage->selectByKind(CalculationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedCalculation?: CalculationUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedCalculation`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedCase = ownedUsage->selectByKind(CaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedCase?: CaseUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Definition/ownedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedConcern = ownedUsage->selectByKind(ConcernUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConcern?: ConcernUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedConnection = ownedUsage->selectByKind(ConnectorAsUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConnection?: ConnectorAsUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedConstraint = ownedUsage->selectByKind(ConstraintUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConstraint?: ConstraintUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedAttribute`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedEnumeration = ownedUsage->selectByKind(EnumerationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedEnumeration?: EnumerationUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Definition/ownedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedFlow = ownedUsage->selectByKind(FlowUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedFlow?: FlowUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedInterface = ownedUsage->selectByKind(ReferenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedInterface?: InterfaceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedItem = ownedUsage->selectByKind(ItemUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedItem?: ItemUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedItem`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedMetadata = ownedMember->selectByKind(MetadataUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMetadata?: MetadataUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedOccurrence = ownedUsage->selectByKind(OccurrenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedOccurrence?: OccurrenceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedItem`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedPart = ownedUsage->selectByKind(PartUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedPart?: PartUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedPort = ownedUsage->selectByKind(PortUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedPort?: PortUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedReference = ownedUsage->selectByKind(ReferenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedReference?: ReferenceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedPart`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedRendering = ownedUsage->selectByKind(RenderingUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedRendering?: RenderingUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedConstraint`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedRequirement = ownedUsage->selectByKind(RequirementUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedRequirement?: RequirementUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedAction`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedState = ownedUsage->selectByKind(StateUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedState?: StateUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Definition/ownedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedTransition = ownedUsage->selectByKind(TransitionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedTransition?: TransitionUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Usage/owningDefinition`.
     * Subsets: `Type/ownedFeature`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedUsage = ownedFeature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedUsage?: Usage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedUseCase = ownedUsage->selectByKind(UseCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedUseCase?: UseCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedVerificationCase = ownedUsage->selectByKind(VerificationCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedVerificationCase?: VerificationCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedPart`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedView = ownedUsage->selectByKind(ViewUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedView?: ViewUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedViewpoint = ownedUsage->selectByKind(ViewpointUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedViewpoint?: ViewpointUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * usage = feature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly usage?: Usage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * variant = variantMembership.ownedVariantUsage
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly variant?: Usage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Namespace/ownedMembership`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * variantMembership = ownedMembership->selectByKind(VariantMembership)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly variantMembership?: VariantMembership[];
}

/**
 * `Dependency`.
 * Generalizes: `Relationship`.
 */
export interface Dependency extends Relationship {
    /**
     * Reference 1..*, ordered.
     * Redefines: `Relationship/source`.
     */
    client: Element[];
    /**
     * Reference 1..*, ordered.
     * Redefines: `Relationship/target`.
     */
    supplier: Element[];
}

/**
 * `Differencing`.
 * Generalizes: `Relationship`.
 */
export interface Differencing extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    differencingType: Type;
    /**
     * Reference 1..1, derived.
     * Opposite: `Type/ownedDifferencing`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly typeDifferenced?: Type;
}

/**
 * `Disjoining`.
 * Generalizes: `Relationship`.
 */
export interface Disjoining extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    disjoiningType: Type;
    /**
     * Reference 0..1, derived.
     * Opposite: `Type/ownedDisjoining`.
     * Subsets: `Relationship/owningRelatedElement`, `Disjoining/typeDisjoined`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningType?: Type;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/source`.
     */
    typeDisjoined: Type;
}

/**
 * `Documentation`.
 * Generalizes: `Comment`.
 */
export interface Documentation extends Comment {
    /**
     * Reference 1..1, derived.
     * Opposite: `Element/documentation`.
     * Subsets: `Element/owner`.
     * Redefines: `AnnotatingElement/annotatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly documentedElement?: Element;
}

/**
 * `Element` (abstract).
 * Root metaclass.
 */
export interface Element {
    /** Attribute 0..*, ordered. */
    aliasIds?: string[];
    /** Attribute 0..1. */
    declaredName?: string;
    /** Attribute 0..1. */
    declaredShortName?: string;
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Documentation/documentedElement`.
     * Subsets: `Element/ownedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * documentation = ownedElement->selectByKind(Documentation)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly documentation?: Documentation[];
    /** Attribute 1..1. */
    elementId: string;
    /** Attribute 1..1. */
    isImpliedIncluded: boolean;
    /**
     * Attribute 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * isLibraryElement = libraryNamespace() <> null
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly isLibraryElement?: boolean;
    /**
     * Attribute 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * name = effectiveName()
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly name?: string;
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Annotation/owningAnnotatedElement`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedAnnotation = ownedRelationship->
     *     selectByKind(Annotation)->
     *     select(a | a.annotatedElement = self)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedAnnotation?: Annotation[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Element/owner`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedElement = ownedRelationship.ownedRelatedElement
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedElement?: Element[];
    /**
     * Containment 0..*, ordered.
     * Opposite: `Relationship/owningRelatedElement`.
     */
    ownedRelationship?: Relationship[];
    /**
     * Reference 0..1, derived.
     * Opposite: `Element/ownedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * owner = owningRelationship.owningRelatedElement
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owner?: Element;
    /**
     * Reference 0..1, derived.
     * Opposite: `OwningMembership/ownedMemberElement`.
     * Subsets: `Element/owningRelationship`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningMembership?: OwningMembership;
    /**
     * Reference 0..1, derived.
     * Opposite: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * owningNamespace =
     *     if owningMembership = null then null
     *     else owningMembership.membershipOwningNamespace
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningNamespace?: Namespace;
    /**
     * Reference 0..1.
     * Opposite: `Relationship/ownedRelatedElement`.
     */
    owningRelationship?: Relationship;
    /**
     * Attribute 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * qualifiedName =
     *     if owningNamespace = null then null
     *     else if name <> null and
     *         owningNamespace.ownedMember->
     *         select(m | m.name = name).indexOf(self) <> 1 then null
     *     else if owningNamespace.owner = null then escapedName()
     *     else if owningNamespace.qualifiedName = null or
     *             escapedName() = null then null
     *     else owningNamespace.qualifiedName + '::' + escapedName()
     *     endif endif endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly qualifiedName?: string;
    /**
     * Attribute 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * shortName = effectiveShortName()
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly shortName?: string;
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `TextualRepresentation/representedElement`.
     * Subsets: `Element/ownedElement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * textualRepresentation = ownedElement->selectByKind(TextualRepresentation)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly textualRepresentation?: TextualRepresentation[];
}

/**
 * `ElementFilterMembership`.
 * Generalizes: `OwningMembership`.
 */
export interface ElementFilterMembership extends OwningMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `OwningMembership/ownedMemberElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly condition?: Expression;
}

/**
 * `EndFeatureMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface EndFeatureMembership extends FeatureMembership {}

/**
 * `EnumerationDefinition`.
 * Generalizes: `AttributeDefinition`.
 */
export interface EnumerationDefinition extends AttributeDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Definition/variant`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly enumeratedValue?: EnumerationUsage[];
}

/**
 * `EnumerationUsage`.
 * Generalizes: `AttributeUsage`.
 */
export interface EnumerationUsage extends AttributeUsage {
    /**
     * Reference 1..1, derived.
     * Redefines: `AttributeUsage/attributeDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly enumerationDefinition?: EnumerationDefinition;
}

/**
 * `EventOccurrenceUsage`.
 * Generalizes: `OccurrenceUsage`.
 */
export interface EventOccurrenceUsage extends OccurrenceUsage {
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * eventOccurrence =
     *     if referencedFeatureTarget() = null then self
     *     else if referencedFeatureTarget().oclIsKindOf(OccurrenceUsage) then
     *         referencedFeatureTarget().oclAsType(OccurrenceUsage)
     *     else null
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly eventOccurrence?: OccurrenceUsage;
}

/**
 * `ExhibitStateUsage`.
 * Generalizes: `StateUsage`, `PerformActionUsage`.
 */
export interface ExhibitStateUsage extends StateUsage, PerformActionUsage {
    /**
     * Reference 1..1, derived.
     * Redefines: `PerformActionUsage/performedAction`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly exhibitedState?: StateUsage;
}

/**
 * `Expose` (abstract).
 * Generalizes: `Import`.
 */
export interface Expose extends Import {}

/**
 * `Expression`.
 * Generalizes: `Step`.
 */
export interface Expression extends Step {
    /**
     * Reference 0..1, derived.
     * Redefines: `Step/behavior`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly function?: Function;
    /**
     * Attribute 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * isModelLevelEvaluable = modelLevelEvaluable(Set(Element){})
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly isModelLevelEvaluable?: boolean;
    /**
     * Reference 1..1, derived.
     * Subsets: `Type/output`, `Step/parameter`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * result =
     *     let resultParams : Sequence(Feature) =
     *         featureMemberships->
     *             selectByKind(ReturnParameterMembership).
     *             ownedMemberParameter in
     *     if resultParams->notEmpty() then resultParams->first()
     *     else null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly result?: Feature;
}

/**
 * `Feature`.
 * Generalizes: `Type`.
 */
export interface Feature extends Type {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * chainingFeature = ownedFeatureChaining.chainingFeature
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly chainingFeature?: Feature[];
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * crossFeature =
     *     if ownedCrossSubsetting = null then null
     *     else
     *         let chainingFeatures: Sequence(Feature) =
     *             ownedCrossSubsetting.crossedFeature.chainingFeature in
     *         if chainingFeatures->size() < 2 then null
     *         else chainingFeatures->at(2)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly crossFeature?: Feature;
    /** Attribute 0..1. */
    direction?: FeatureDirectionKind;
    /**
     * Reference 0..1, derived.
     * Opposite: `Type/ownedEndFeature`.
     * Subsets: `Feature/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly endOwningType?: Type;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * featureTarget = if chainingFeature->isEmpty() then self else chainingFeature->last() endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly featureTarget?: Feature;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * featuringType =
     *     let featuringTypes : OrderedSet(Type) =
     *         typeFeaturing.type->asOrderedSet() in
     *     if chainingFeature->isEmpty() then featuringTypes
     *     else
     *         featuringTypes->
     *             union(chainingFeature->first().featuringType)->
     *             asOrderedSet()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly featuringType?: Type[];
    /** Attribute 1..1. */
    isComposite: boolean;
    /** Attribute 1..1. */
    isConstant: boolean;
    /** Attribute 1..1. */
    isDerived: boolean;
    /** Attribute 1..1. */
    isEnd: boolean;
    /** Attribute 1..1. */
    isOrdered: boolean;
    /** Attribute 1..1. */
    isPortion: boolean;
    /** Attribute 1..1. */
    isUnique: boolean;
    /** Attribute 1..1. */
    isVariable: boolean;
    /**
     * Reference 0..1, derived.
     * Opposite: `CrossSubsetting/crossingFeature`.
     * Subsets: `Feature/ownedSubsetting`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedCrossSubsetting =
     *     let crossSubsettings: Sequence(CrossSubsetting) =
     *         ownedSubsetting->selectByKind(CrossSubsetting) in
     *     if crossSubsettings->isEmpty() then null
     *     else crossSubsettings->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedCrossSubsetting?: CrossSubsetting;
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `FeatureChaining/featureChained`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedFeatureChaining = ownedRelationship->selectByKind(FeatureChaining)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedFeatureChaining?: FeatureChaining[];
    /**
     * Reference 0..*, derived.
     * Opposite: `FeatureInverting/owningFeature`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedFeatureInverting = ownedRelationship->selectByKind(FeatureInverting)->
     *     select(fi | fi.featureInverted = self)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedFeatureInverting?: FeatureInverting[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Feature/ownedSubsetting`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedRedefinition = ownedSubsetting->selectByKind(Redefinition)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedRedefinition?: Redefinition[];
    /**
     * Reference 0..1, derived.
     * Opposite: `ReferenceSubsetting/referencingFeature`.
     * Subsets: `Feature/ownedSubsetting`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedReferenceSubsetting =
     *     let referenceSubsettings : OrderedSet(ReferenceSubsetting) =
     *         ownedSubsetting->selectByKind(ReferenceSubsetting) in
     *     if referenceSubsettings->isEmpty() then null
     *     else referenceSubsettings->first() endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedReferenceSubsetting?: ReferenceSubsetting;
    /**
     * Reference 0..*, derived.
     * Opposite: `Subsetting/owningFeature`.
     * Subsets: `Type/ownedSpecialization`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedSubsetting = ownedSpecialization->selectByKind(Subsetting)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedSubsetting?: Subsetting[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `TypeFeaturing/owningFeatureOfType`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedTypeFeaturing = ownedRelationship->selectByKind(TypeFeaturing)->
     *     select(tf | tf.featureOfType = self)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedTypeFeaturing?: TypeFeaturing[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `FeatureTyping/owningFeature`.
     * Subsets: `Type/ownedSpecialization`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedTyping = ownedGeneralization->selectByKind(FeatureTyping)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedTyping?: FeatureTyping[];
    /**
     * Reference 0..1, derived.
     * Opposite: `FeatureMembership/ownedMemberFeature`.
     * Subsets: `Element/owningMembership`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningFeatureMembership?: FeatureMembership;
    /**
     * Reference 0..1, derived.
     * Opposite: `Type/ownedFeature`.
     * Subsets: `Element/owningNamespace`, `Feature/featuringType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningType?: Type;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * type =
     *     let types : OrderedSet(Types) = OrderedSet{self}->
     *         -- Note: The closure operation automatically handles circular relationships.
     *         closure(typingFeatures()).typing.type->asOrderedSet() in
     *     types->reject(t1 | types->exist(t2 | t2 <> t1 and t2.specializes(t1)))
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly type?: Type[];
}

/**
 * `FeatureChainExpression`.
 * Generalizes: `OperatorExpression`.
 */
export interface FeatureChainExpression extends OperatorExpression {
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * targetFeature =
     *     let nonParameterMemberships : Sequence(Membership) = ownedMembership->
     *         reject(oclIsKindOf(ParameterMembership)) in
     *     if nonParameterMemberships->isEmpty() or
     *        not nonParameterMemberships->first().memberElement.oclIsKindOf(Feature)
     *     then null
     *     else nonParameterMemberships->first().memberElement.oclAsType(Feature)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly targetFeature?: Feature;
}

/**
 * `FeatureChaining`.
 * Generalizes: `Relationship`.
 */
export interface FeatureChaining extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    chainingFeature: Feature;
    /**
     * Reference 1..1, derived.
     * Opposite: `Feature/ownedFeatureChaining`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly featureChained?: Feature;
}

/**
 * `FeatureInverting`.
 * Generalizes: `Relationship`.
 */
export interface FeatureInverting extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/source`.
     */
    featureInverted: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    invertingFeature: Feature;
    /**
     * Reference 0..1, derived.
     * Opposite: `Feature/ownedFeatureInverting`.
     * Subsets: `FeatureInverting/featureInverted`, `Relationship/owningRelatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningFeature?: Feature;
}

/**
 * `FeatureMembership`.
 * Generalizes: `OwningMembership`.
 */
export interface FeatureMembership extends OwningMembership {
    /**
     * Reference 1..1, derived.
     * Opposite: `Feature/owningFeatureMembership`.
     * Redefines: `OwningMembership/ownedMemberElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberFeature?: Feature;
    /**
     * Reference 1..1, derived.
     * Opposite: `Type/ownedFeatureMembership`.
     * Redefines: `Membership/membershipOwningNamespace`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningType?: Type;
}

/**
 * `FeatureReferenceExpression`.
 * Generalizes: `Expression`.
 */
export interface FeatureReferenceExpression extends Expression {
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * referent =
     *     let nonParameterMemberships : Sequence(Membership) = ownedMembership->
     *         reject(oclIsKindOf(ParameterMembership)) in
     *     if nonParameterMemberships->isEmpty() or
     *        not nonParameterMemberships->first().memberElement.oclIsKindOf(Feature)
     *     then null
     *     else nonParameterMemberships->first().memberElement.oclAsType(Feature)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referent?: Feature;
}

/**
 * `FeatureTyping`.
 * Generalizes: `Specialization`.
 */
export interface FeatureTyping extends Specialization {
    /**
     * Reference 0..1, derived.
     * Opposite: `Feature/ownedTyping`.
     * Subsets: `FeatureTyping/typedFeature`.
     * Redefines: `Specialization/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningFeature?: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/general`.
     */
    type: Type;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/specific`.
     */
    typedFeature: Feature;
}

/**
 * `FeatureValue`.
 * Generalizes: `OwningMembership`.
 */
export interface FeatureValue extends OwningMembership {
    /**
     * Reference 1..1, derived.
     * Subsets: `Membership/membershipOwningNamespace`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly featureWithValue?: Feature;
    /** Attribute 1..1. */
    isDefault: boolean;
    /** Attribute 1..1. */
    isInitial: boolean;
    /**
     * Reference 1..1, derived.
     * Redefines: `OwningMembership/ownedMemberElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly value?: Expression;
}

/**
 * `Flow`.
 * Generalizes: `Connector`, `Step`.
 */
export interface Flow extends Connector, Step {
    /**
     * Reference 0..2, ordered, derived.
     * Subsets: `Connector/connectorEnd`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * flowEnd = connectorEnd->selectByKind(FlowEnd)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly flowEnd?: FlowEnd[];
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Connector/association`, `Step/behavior`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly interaction?: Interaction[];
    /**
     * Reference 0..1, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * payloadFeature =
     *     let payloadFeatures : Sequence(PayloadFeature) =
     *         ownedFeature->selectByKind(PayloadFeature) in
     *     if payloadFeatures->isEmpty() then null
     *     else payloadFeatures->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly payloadFeature?: PayloadFeature;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * payloadType =
     *     if payloadFeature = null then Sequence{}
     *     else payloadFeature.type
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly payloadType?: Classifier[];
    /**
     * Reference 0..1, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * sourceOutputFeature =
     *     if connectorEnd->isEmpty() or
     *         connectorEnd.ownedFeature->isEmpty()
     *     then null
     *     else connectorEnd.ownedFeature->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly sourceOutputFeature?: Feature;
    /**
     * Reference 0..1, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * targetInputFeature =
     *     if connectorEnd->size() < 2 or
     *         connectorEnd->at(2).ownedFeature->isEmpty()
     *     then null
     *     else connectorEnd->at(2).ownedFeature->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly targetInputFeature?: Feature;
}

/**
 * `FlowDefinition`.
 * Generalizes: `ActionDefinition`, `Interaction`.
 */
export interface FlowDefinition extends ActionDefinition, Interaction {
    /**
     * Reference 0..*, derived.
     * Redefines: `Association/associationEnd`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly flowEnd?: Usage[];
}

/**
 * `FlowEnd`.
 * Generalizes: `Feature`.
 */
export interface FlowEnd extends Feature {}

/**
 * `FlowUsage`.
 * Generalizes: `ConnectorAsUsage`, `ActionUsage`, `Flow`.
 */
export interface FlowUsage extends ConnectorAsUsage, ActionUsage, Flow {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `ActionUsage/actionDefinition`, `Flow/interaction`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly flowDefinition?: Interaction[];
}

/**
 * `ForLoopActionUsage`.
 * Generalizes: `LoopActionUsage`.
 */
export interface ForLoopActionUsage extends LoopActionUsage {
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * loopVariable =
     *     if ownedFeature->isEmpty() or
     *         not ownedFeature->first().oclIsKindOf(ReferenceUsage) then
     *         null
     *     else
     *         ownedFeature->first().oclAsType(ReferenceUsage)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly loopVariable?: ReferenceUsage;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * seqArgument = argument(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly seqArgument?: Expression;
}

/**
 * `ForkNode`.
 * Generalizes: `ControlNode`.
 */
export interface ForkNode extends ControlNode {}

/**
 * `FramedConcernMembership`.
 * Generalizes: `RequirementConstraintMembership`.
 */
export interface FramedConcernMembership extends RequirementConstraintMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `RequirementConstraintMembership/ownedConstraint`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConcern?: ConcernUsage;
    /**
     * Reference 1..1, derived.
     * Redefines: `RequirementConstraintMembership/referencedConstraint`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referencedConcern?: ConcernUsage;
}

/**
 * `Function`.
 * Generalizes: `Behavior`.
 */
export interface Function extends Behavior {
    /**
     * Reference 0..*, derived.
     * Subsets: `Behavior/step`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly expression?: Expression[];
    /**
     * Attribute 1..1, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly isModelLevelEvaluable?: boolean;
    /**
     * Reference 1..1, derived.
     * Subsets: `Type/output`, `Behavior/parameter`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * result =
     *     let resultParams : Sequence(Feature) =
     *         featureMemberships->
     *             selectByKind(ReturnParameterMembership).
     *             ownedMemberParameter in
     *     if resultParams->notEmpty() then resultParams->first()
     *     else null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly result?: Feature;
}

/**
 * `IfActionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface IfActionUsage extends ActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * elseAction =
     *     let parameter : Feature = inputParameter(3) in
     *     if parameter <> null and parameter.oclIsKindOf(ActionUsage) then
     *         parameter.oclAsType(ActionUsage)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly elseAction?: ActionUsage;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ifArgument =
     *     let parameter : Feature = inputParameter(1) in
     *     if parameter <> null and parameter.oclIsKindOf(Expression) then
     *         parameter.oclAsType(Expression)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ifArgument?: Expression;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * thenAction =
     *     let parameter : Feature = inputParameter(2) in
     *     if parameter <> null and parameter.oclIsKindOf(ActionUsage) then
     *         parameter.oclAsType(ActionUsage)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly thenAction?: ActionUsage;
}

/**
 * `Import` (abstract).
 * Generalizes: `Relationship`.
 */
export interface Import extends Relationship {
    /**
     * Reference 1..1, derived.
     * Opposite: `Namespace/ownedImport`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly importOwningNamespace?: Namespace;
    /**
     * Reference 1..1, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly importedElement?: Element;
    /** Attribute 1..1. */
    isImportAll: boolean;
    /** Attribute 1..1. */
    isRecursive: boolean;
    /** Attribute 1..1. */
    visibility: VisibilityKind;
}

/**
 * `IncludeUseCaseUsage`.
 * Generalizes: `UseCaseUsage`, `PerformActionUsage`.
 */
export interface IncludeUseCaseUsage extends UseCaseUsage, PerformActionUsage {
    /**
     * Reference 1..1, derived.
     * Redefines: `PerformActionUsage/performedAction`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly useCaseIncluded?: UseCaseUsage;
}

/**
 * `IndexExpression`.
 * Generalizes: `OperatorExpression`.
 */
export interface IndexExpression extends OperatorExpression {}

/**
 * `InstantiationExpression` (abstract).
 * Generalizes: `Expression`.
 */
export interface InstantiationExpression extends Expression {
    /**
     * Reference 0..*, ordered, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly argument?: Expression[];
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * instantiatedType = instantiatedType()
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly instantiatedType?: Type;
}

/**
 * `Interaction`.
 * Generalizes: `Association`, `Behavior`.
 */
export interface Interaction extends Association, Behavior {}

/**
 * `InterfaceDefinition`.
 * Generalizes: `ConnectionDefinition`.
 */
export interface InterfaceDefinition extends ConnectionDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `ConnectionDefinition/connectionEnd`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly interfaceEnd?: PortUsage[];
}

/**
 * `InterfaceUsage`.
 * Generalizes: `ConnectionUsage`.
 */
export interface InterfaceUsage extends ConnectionUsage {
    /**
     * Reference 0..*, derived.
     * Redefines: `ConnectionUsage/connectionDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly interfaceDefinition?: InterfaceDefinition[];
}

/**
 * `Intersecting`.
 * Generalizes: `Relationship`.
 */
export interface Intersecting extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    intersectingType: Type;
    /**
     * Reference 1..1, derived.
     * Opposite: `Type/ownedIntersecting`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly typeIntersected?: Type;
}

/**
 * `Invariant`.
 * Generalizes: `BooleanExpression`.
 */
export interface Invariant extends BooleanExpression {
    /** Attribute 1..1. */
    isNegated: boolean;
}

/**
 * `InvocationExpression`.
 * Generalizes: `InstantiationExpression`.
 */
export interface InvocationExpression extends InstantiationExpression {
    /**
     * Containment 0..*, ordered, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly operand?: Expression[];
}

/**
 * `ItemDefinition`.
 * Generalizes: `OccurrenceDefinition`, `Structure`.
 */
export interface ItemDefinition extends OccurrenceDefinition, Structure {}

/**
 * `ItemUsage`.
 * Generalizes: `OccurrenceUsage`.
 */
export interface ItemUsage extends OccurrenceUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `OccurrenceUsage/occurrenceDefinition`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * itemDefinition = occurrenceDefinition->selectByKind(Structure)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly itemDefinition?: Structure[];
}

/**
 * `JoinNode`.
 * Generalizes: `ControlNode`.
 */
export interface JoinNode extends ControlNode {}

/**
 * `LibraryPackage`.
 * Generalizes: `Package`.
 */
export interface LibraryPackage extends Package {
    /** Attribute 1..1. */
    isStandard: boolean;
}

/**
 * `LiteralBoolean`.
 * Generalizes: `LiteralExpression`.
 */
export interface LiteralBoolean extends LiteralExpression {
    /** Attribute 1..1. */
    value: boolean;
}

/**
 * `LiteralExpression`.
 * Generalizes: `Expression`.
 */
export interface LiteralExpression extends Expression {}

/**
 * `LiteralInfinity`.
 * Generalizes: `LiteralExpression`.
 */
export interface LiteralInfinity extends LiteralExpression {}

/**
 * `LiteralInteger`.
 * Generalizes: `LiteralExpression`.
 */
export interface LiteralInteger extends LiteralExpression {
    /** Attribute 1..1. */
    value: number;
}

/**
 * `LiteralRational`.
 * Generalizes: `LiteralExpression`.
 */
export interface LiteralRational extends LiteralExpression {
    /** Attribute 1..1. */
    value: number;
}

/**
 * `LiteralString`.
 * Generalizes: `LiteralExpression`.
 */
export interface LiteralString extends LiteralExpression {
    /** Attribute 1..1. */
    value: string;
}

/**
 * `LoopActionUsage` (abstract).
 * Generalizes: `ActionUsage`.
 */
export interface LoopActionUsage extends ActionUsage {
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * bodyAction =
     *     let parameter : Feature = inputParameter(2) in
     *     if parameter <> null and parameter.oclIsKindOf(Action) then
     *         parameter.oclAsType(Action)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly bodyAction?: ActionUsage;
}

/**
 * `Membership`.
 * Generalizes: `Relationship`.
 */
export interface Membership extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    memberElement: Element;
    /**
     * Attribute 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * memberElementId = memberElement.elementId
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly memberElementId?: string;
    /** Attribute 0..1. */
    memberName?: string;
    /** Attribute 0..1. */
    memberShortName?: string;
    /**
     * Reference 1..1, derived.
     * Opposite: `Namespace/ownedMembership`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly membershipOwningNamespace?: Namespace;
    /** Attribute 1..1. */
    visibility: VisibilityKind;
}

/**
 * `MembershipExpose`.
 * Generalizes: `MembershipImport`, `Expose`.
 */
export interface MembershipExpose extends MembershipImport, Expose {}

/**
 * `MembershipImport`.
 * Generalizes: `Import`.
 */
export interface MembershipImport extends Import {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    importedMembership: Membership;
}

/**
 * `MergeNode`.
 * Generalizes: `ControlNode`.
 */
export interface MergeNode extends ControlNode {}

/**
 * `Metaclass`.
 * Generalizes: `Structure`.
 */
export interface Metaclass extends Structure {}

/**
 * `MetadataAccessExpression`.
 * Generalizes: `Expression`.
 */
export interface MetadataAccessExpression extends Expression {
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * referencedElement =
     *     let elements : Sequence(Element) = ownedMembership->
     *         reject(oclIsKindOf(FeatureMembership)).memberElement in
     *     if elements->isEmpty() then null
     *     else elements->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referencedElement?: Element;
}

/**
 * `MetadataDefinition`.
 * Generalizes: `ItemDefinition`, `Metaclass`.
 */
export interface MetadataDefinition extends ItemDefinition, Metaclass {}

/**
 * `MetadataFeature`.
 * Generalizes: `Feature`, `AnnotatingElement`.
 */
export interface MetadataFeature extends Feature, AnnotatingElement {
    /**
     * Reference 0..1, derived.
     * Subsets: `Feature/type`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * metaclass =
     *     let metaclassTypes : Sequence(Type) = type->selectByKind(Metaclass) in
     *     if metaclassTypes->isEmpty() then null
     *     else metaClassTypes->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly metaclass?: Metaclass;
}

/**
 * `MetadataUsage`.
 * Generalizes: `ItemUsage`, `MetadataFeature`.
 */
export interface MetadataUsage extends ItemUsage, MetadataFeature {
    /**
     * Reference 0..1, derived.
     * Redefines: `ItemUsage/itemDefinition`, `MetadataFeature/metaclass`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly metadataDefinition?: Metaclass;
}

/**
 * `Multiplicity`.
 * Generalizes: `Feature`.
 */
export interface Multiplicity extends Feature {}

/**
 * `MultiplicityRange`.
 * Generalizes: `Multiplicity`.
 */
export interface MultiplicityRange extends Multiplicity {
    /**
     * Reference 1..2, ordered, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * bound =
     *     if upperBound = null then Sequence{}
     *     else if lowerBound = null then Sequence{upperBound}
     *     else Sequence{lowerBound, upperBound}
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly bound?: Expression[];
    /**
     * Reference 0..1, derived.
     * Subsets: `MultiplicityRange/bound`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * lowerBound =
     *     let ownedExpressions : Sequence(Expression) =
     *         ownedMember->selectByKind(Expression) in
     *     if ownedExpressions->size() < 2 then null
     *     else ownedExpressions->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly lowerBound?: Expression;
    /**
     * Reference 1..1, derived.
     * Subsets: `MultiplicityRange/bound`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * upperBound =
     *     let ownedExpressions : Sequence(Expression) =
     *         ownedMember->selectByKind(Expression) in
     *     if ownedExpressions->isEmpty() then null
     *     else if ownedExpressions->size() = 1 then ownedExpressions->at(1)
     *     else ownedExpressions->at(2)
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly upperBound?: Expression;
}

/**
 * `Namespace`.
 * Generalizes: `Element`.
 */
export interface Namespace extends Element {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/membership`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * importedMembership = importedMemberships(Set{})
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly importedMembership?: Membership[];
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * member = membership.memberElement
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly member?: Element[];
    /**
     * Reference 0..*, ordered, derived.
     * Derived union.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly membership?: Membership[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Import/importOwningNamespace`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedImport = ownedRelationship->selectByKind(Import)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedImport?: Import[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Element/owningNamespace`.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedMember = ownedMembership->selectByKind(OwningMembership).ownedMemberElement
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMember?: Element[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Membership/membershipOwningNamespace`.
     * Subsets: `Namespace/membership`, `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedMembership = ownedRelationship->selectByKind(Membership)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMembership?: Membership[];
}

/**
 * `NamespaceExpose`.
 * Generalizes: `NamespaceImport`, `Expose`.
 */
export interface NamespaceExpose extends NamespaceImport, Expose {}

/**
 * `NamespaceImport`.
 * Generalizes: `Import`.
 */
export interface NamespaceImport extends Import {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    importedNamespace: Namespace;
}

/**
 * `NullExpression`.
 * Generalizes: `Expression`.
 */
export interface NullExpression extends Expression {}

/**
 * `ObjectiveMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface ObjectiveMembership extends FeatureMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedObjectiveRequirement?: RequirementUsage;
}

/**
 * `OccurrenceDefinition`.
 * Generalizes: `Definition`, `Class`.
 */
export interface OccurrenceDefinition extends Definition, Class {
    /** Attribute 1..1. */
    isIndividual: boolean;
}

/**
 * `OccurrenceUsage`.
 * Generalizes: `Usage`.
 */
export interface OccurrenceUsage extends Usage {
    /**
     * Reference 0..1, derived.
     * Subsets: `OccurrenceUsage/occurrenceDefinition`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * individualDefinition =
     *     let individualDefinitions : OrderedSet(OccurrenceDefinition) =
     *         occurrenceDefinition->
     *             selectByKind(OccurrenceDefinition)->
     *             select(isIndividual) in
     *     if individualDefinitions->isEmpty() then null
     *     else individualDefinitions->first() endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly individualDefinition?: OccurrenceDefinition;
    /** Attribute 1..1. */
    isIndividual: boolean;
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Usage/definition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly occurrenceDefinition?: Class[];
    /** Attribute 0..1. */
    portionKind?: PortionKind;
}

/**
 * `OperatorExpression`.
 * Generalizes: `InvocationExpression`.
 */
export interface OperatorExpression extends InvocationExpression {
    /** Attribute 1..1. */
    operator: string;
}

/**
 * `OwningMembership`.
 * Generalizes: `Membership`.
 */
export interface OwningMembership extends Membership {
    /**
     * Reference 1..1, derived.
     * Opposite: `Element/owningMembership`.
     * Subsets: `Relationship/ownedRelatedElement`.
     * Redefines: `Membership/memberElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberElement?: Element;
    /**
     * Attribute 1..1, derived.
     * Redefines: `Membership/memberElementId`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberElementId?: string;
    /**
     * Attribute 0..1, derived.
     * Redefines: `Membership/memberName`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedMemberName = ownedMemberElement.name
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberName?: string;
    /**
     * Attribute 0..1, derived.
     * Redefines: `Membership/memberShortName`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedMemberShortName = ownedMemberElement.shortName
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberShortName?: string;
}

/**
 * `Package`.
 * Generalizes: `Namespace`.
 */
export interface Package extends Namespace {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * filterCondition = ownedMembership->
     *     selectByKind(ElementFilterMembership).condition
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly filterCondition?: Expression[];
}

/**
 * `ParameterMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface ParameterMembership extends FeatureMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedMemberParameter?: Feature;
}

/**
 * `PartDefinition`.
 * Generalizes: `ItemDefinition`.
 */
export interface PartDefinition extends ItemDefinition {}

/**
 * `PartUsage`.
 * Generalizes: `ItemUsage`.
 */
export interface PartUsage extends ItemUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `ItemUsage/itemDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly partDefinition?: PartDefinition[];
}

/**
 * `PayloadFeature`.
 * Generalizes: `Feature`.
 */
export interface PayloadFeature extends Feature {}

/**
 * `PerformActionUsage`.
 * Generalizes: `ActionUsage`, `EventOccurrenceUsage`.
 */
export interface PerformActionUsage extends ActionUsage, EventOccurrenceUsage {
    /**
     * Reference 1..1, derived.
     * Redefines: `EventOccurrenceUsage/eventOccurrence`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly performedAction?: ActionUsage;
}

/**
 * `PortConjugation`.
 * Generalizes: `Conjugation`.
 */
export interface PortConjugation extends Conjugation {
    /**
     * Reference 1..1, derived.
     * Opposite: `ConjugatedPortDefinition/ownedPortConjugator`.
     * Redefines: `Conjugation/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly conjugatedPortDefinition?: ConjugatedPortDefinition;
    /**
     * Reference 1..1.
     * Redefines: `Conjugation/originalType`.
     */
    originalPortDefinition: PortDefinition;
}

/**
 * `PortDefinition`.
 * Generalizes: `OccurrenceDefinition`, `Structure`.
 */
export interface PortDefinition extends OccurrenceDefinition, Structure {
    /**
     * Reference 0..1, derived.
     * Opposite: `ConjugatedPortDefinition/originalPortDefinition`.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * conjugatedPortDefinition =
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly conjugatedPortDefinition?: ConjugatedPortDefinition;
}

/**
 * `PortUsage`.
 * Generalizes: `OccurrenceUsage`.
 */
export interface PortUsage extends OccurrenceUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `OccurrenceUsage/occurrenceDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly portDefinition?: PortDefinition[];
}

/**
 * `Predicate`.
 * Generalizes: `Function`.
 */
export interface Predicate extends Function {}

/**
 * `Redefinition`.
 * Generalizes: `Subsetting`.
 */
export interface Redefinition extends Subsetting {
    /**
     * Reference 1..1.
     * Redefines: `Subsetting/subsettedFeature`.
     */
    redefinedFeature: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Subsetting/subsettingFeature`.
     */
    redefiningFeature: Feature;
}

/**
 * `ReferenceSubsetting`.
 * Generalizes: `Subsetting`.
 */
export interface ReferenceSubsetting extends Subsetting {
    /**
     * Reference 1..1.
     * Redefines: `Subsetting/subsettedFeature`.
     */
    referencedFeature: Feature;
    /**
     * Reference 1..1, derived.
     * Opposite: `Feature/ownedReferenceSubsetting`.
     * Redefines: `Subsetting/owningFeature`, `Subsetting/subsettingFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referencingFeature?: Feature;
}

/**
 * `ReferenceUsage`.
 * Generalizes: `Usage`.
 */
export interface ReferenceUsage extends Usage {}

/**
 * `Relationship` (abstract).
 * Generalizes: `Element`.
 */
export interface Relationship extends Element {
    /** Attribute 1..1. */
    isImplied: boolean;
    /**
     * Containment 0..*, ordered.
     * Opposite: `Element/owningRelationship`.
     * Subsets: `Relationship/relatedElement`.
     */
    ownedRelatedElement?: Element[];
    /**
     * Reference 0..1.
     * Opposite: `Element/ownedRelationship`.
     * Subsets: `Relationship/relatedElement`.
     */
    owningRelatedElement?: Element;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * relatedElement = source->union(target)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly relatedElement?: Element[];
    /**
     * Reference 0..*, ordered.
     * Subsets: `Relationship/relatedElement`.
     */
    source?: Element[];
    /**
     * Reference 0..*, ordered.
     * Subsets: `Relationship/relatedElement`.
     */
    target?: Element[];
}

/**
 * `RenderingDefinition`.
 * Generalizes: `PartDefinition`.
 */
export interface RenderingDefinition extends PartDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * rendering = usages->selectByKind(RenderingUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly rendering?: RenderingUsage[];
}

/**
 * `RenderingUsage`.
 * Generalizes: `PartUsage`.
 */
export interface RenderingUsage extends PartUsage {
    /**
     * Reference 0..1, derived.
     * Redefines: `PartUsage/partDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly renderingDefinition?: RenderingDefinition;
}

/**
 * `RequirementConstraintMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface RequirementConstraintMembership extends FeatureMembership {
    /** Attribute 1..1. */
    kind: RequirementConstraintKind;
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConstraint?: ConstraintUsage;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * referencedConstraint =
     *     let referencedFeature : Feature =
     *         ownedConstraint.referencedFeatureTarget() in
     *     if referencedFeature = null then ownedConstraint
     *     else if referencedFeature.oclIsKindOf(ConstraintUsage) then
     *         refrencedFeature.oclAsType(ConstraintUsage)
     *     else null
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referencedConstraint?: ConstraintUsage;
}

/**
 * `RequirementDefinition`.
 * Generalizes: `ConstraintDefinition`.
 */
export interface RequirementDefinition extends ConstraintDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Behavior/parameter`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * actorParameter = featureMembership->
     *     selectByKind(ActorMembership).
     *     ownedActorParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly actorParameter?: PartUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * assumedConstraint = ownedFeatureMembership->
     *     selectByKind(RequirementConstraintMembership)->
     *     select(kind = RequirementConstraintKind::assumption).
     *     ownedConstraint
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly assumedConstraint?: ConstraintUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `RequirementDefinition/requiredConstraint`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * framedConcern = featureMembership->
     *     selectByKind(FramedConcernMembership).
     *     ownedConcern
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly framedConcern?: ConcernUsage[];
    /**
     * Attribute 0..1.
     * Redefines: `Element/declaredShortName`.
     */
    reqId?: string;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * requiredConstraint = ownedFeatureMembership->
     *     selectByKind(RequirementConstraintMembership)->
     *     select(kind = RequirementConstraintKind::requirement).
     *     ownedConstraint
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly requiredConstraint?: ConstraintUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Behavior/parameter`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * stakeholderParameter = featureMembership->
     *     selectByKind(StakholderMembership).
     *     ownedStakeholderParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly stakeholderParameter?: PartUsage[];
    /**
     * Reference 1..1, derived.
     * Subsets: `Behavior/parameter`, `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * subjectParameter =
     *     let subjects : OrderedSet(SubjectMembership) =
     *         featureMembership->selectByKind(SubjectMembership) in
     *     if subjects->isEmpty() then null
     *     else subjects->first().ownedSubjectParameter
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly subjectParameter?: Usage;
    /**
     * Attribute 0..*, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * text = documentation.body
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly text?: string[];
}

/**
 * `RequirementUsage`.
 * Generalizes: `ConstraintUsage`.
 */
export interface RequirementUsage extends ConstraintUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Step/parameter`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * actorParameter = featureMembership->
     *     selectByKind(ActorMembership).
     *     ownedActorParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly actorParameter?: PartUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * assumedConstraint = ownedFeatureMembership->
     *     selectByKind(RequirementConstraintMembership)->
     *     select(kind = RequirementConstraintKind::assumption).
     *     ownedConstraint
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly assumedConstraint?: ConstraintUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `RequirementUsage/requiredConstraint`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * framedConcern = featureMembership->
     *     selectByKind(FramedConcernMembership).
     *     ownedConcern
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly framedConcern?: ConcernUsage[];
    /**
     * Attribute 0..1.
     * Redefines: `Element/declaredShortName`.
     */
    reqId?: string;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * requiredConstraint = ownedFeatureMembership->
     *     selectByKind(RequirementConstraintMembership)->
     *     select(kind = RequirementConstraintKind::requirement).
     *     ownedConstraint
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly requiredConstraint?: ConstraintUsage[];
    /**
     * Reference 0..1, derived.
     * Redefines: `ConstraintUsage/constraintDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly requirementDefinition?: RequirementDefinition;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Step/parameter`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * stakeholderParameter = featureMembership->
     *     selectByKind(AStakholderMembership).
     *     ownedStakeholderParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly stakeholderParameter?: PartUsage[];
    /**
     * Reference 1..1, derived.
     * Subsets: `Step/parameter`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * subjectParameter =
     *     let subjects : OrderedSet(SubjectMembership) =
     *         featureMembership->selectByKind(SubjectMembership) in
     *     if subjects->isEmpty() then null
     *     else subjects->first().ownedSubjectParameter
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly subjectParameter?: Usage;
    /**
     * Attribute 0..*, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * text = documentation.body
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly text?: string[];
}

/**
 * `RequirementVerificationMembership`.
 * Generalizes: `RequirementConstraintMembership`.
 */
export interface RequirementVerificationMembership extends RequirementConstraintMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `RequirementConstraintMembership/ownedConstraint`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedRequirement?: RequirementUsage;
    /**
     * Reference 1..1, derived.
     * Redefines: `RequirementConstraintMembership/referencedConstraint`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly verifiedRequirement?: RequirementUsage;
}

/**
 * `ResultExpressionMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface ResultExpressionMembership extends FeatureMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedResultExpression?: Expression;
}

/**
 * `ReturnParameterMembership`.
 * Generalizes: `ParameterMembership`.
 */
export interface ReturnParameterMembership extends ParameterMembership {}

/**
 * `SatisfyRequirementUsage`.
 * Generalizes: `RequirementUsage`, `AssertConstraintUsage`.
 */
export interface SatisfyRequirementUsage extends RequirementUsage, AssertConstraintUsage {
    /**
     * Reference 1..1, derived.
     * Redefines: `AssertConstraintUsage/assertedConstraint`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly satisfiedRequirement?: RequirementUsage;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * satisfyingFeature =
     *     let bindings: BindingConnector = ownedMember->
     *         selectByKind(BindingConnector)->
     *         select(b | b.relatedElement->includes(subjectParameter)) in
     *     if bindings->isEmpty() or
     *        not bindings->first().relatedElement->exits(r | r <> subjectParameter)
     *     then null
     *     else bindings->first().relatedElement->any(r | r <> subjectParameter)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly satisfyingFeature?: Feature;
}

/**
 * `SelectExpression`.
 * Generalizes: `OperatorExpression`.
 */
export interface SelectExpression extends OperatorExpression {}

/**
 * `SendActionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface SendActionUsage extends ActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * payloadArgument = argument(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly payloadArgument?: Expression;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * receiverArgument = argument(3)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly receiverArgument?: Expression;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * senderArgument = argument(2)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly senderArgument?: Expression;
}

/**
 * `Specialization`.
 * Generalizes: `Relationship`.
 */
export interface Specialization extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    general: Type;
    /**
     * Reference 0..1, derived.
     * Opposite: `Type/ownedSpecialization`.
     * Subsets: `Relationship/owningRelatedElement`, `Specialization/specific`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningType?: Type;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/source`.
     */
    specific: Type;
}

/**
 * `StakeholderMembership`.
 * Generalizes: `ParameterMembership`.
 */
export interface StakeholderMembership extends ParameterMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `ParameterMembership/ownedMemberParameter`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedStakeholderParameter?: PartUsage;
}

/**
 * `StateDefinition`.
 * Generalizes: `ActionDefinition`.
 */
export interface StateDefinition extends ActionDefinition {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * doAction =
     *     let doMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::do) in
     *     if doMemberships->isEmpty() then null
     *     else doMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly doAction?: ActionUsage;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * entryAction =
     *     let entryMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::entry) in
     *     if entryMemberships->isEmpty() then null
     *     else entryMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly entryAction?: ActionUsage;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * exitAction =
     *     let exitMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::exit) in
     *     if exitMemberships->isEmpty() then null
     *     else exitMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly exitAction?: ActionUsage;
    /** Attribute 1..1. */
    isParallel: boolean;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `ActionDefinition/action`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * state = action->selectByKind(StateUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly state?: StateUsage[];
}

/**
 * `StateSubactionMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface StateSubactionMembership extends FeatureMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly action?: ActionUsage;
    /** Attribute 1..1. */
    kind: StateSubactionKind;
}

/**
 * `StateUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface StateUsage extends ActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * doAction =
     *     let doMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::do) in
     *     if doMemberships->isEmpty() then null
     *     else doMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly doAction?: ActionUsage;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * entryAction =
     *     let entryMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::entry) in
     *     if entryMemberships->isEmpty() then null
     *     else entryMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly entryAction?: ActionUsage;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * exitAction =
     *     let exitMemberships : Sequence(StateSubactionMembership) =
     *         ownedMembership->
     *             selectByKind(StateSubactionMembership)->
     *             select(kind = StateSubactionKind::exit) in
     *     if exitMemberships->isEmpty() then null
     *     else exitMemberships->at(1)
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly exitAction?: ActionUsage;
    /** Attribute 1..1. */
    isParallel: boolean;
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `ActionUsage/actionDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly stateDefinition?: Behavior[];
}

/**
 * `Step`.
 * Generalizes: `Feature`.
 */
export interface Step extends Feature {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Feature/type`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * behavior = type->selectByKind(Behavior)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly behavior?: Behavior[];
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Type/directedFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly parameter?: Feature[];
}

/**
 * `Structure`.
 * Generalizes: `Class`.
 */
export interface Structure extends Class {}

/**
 * `Subclassification`.
 * Generalizes: `Specialization`.
 */
export interface Subclassification extends Specialization {
    /**
     * Reference 0..1, derived.
     * Opposite: `Classifier/ownedSubclassification`.
     * Redefines: `Specialization/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningClassifier?: Classifier;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/specific`.
     */
    subclassifier: Classifier;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/general`.
     */
    superclassifier: Classifier;
}

/**
 * `SubjectMembership`.
 * Generalizes: `ParameterMembership`.
 */
export interface SubjectMembership extends ParameterMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `ParameterMembership/ownedMemberParameter`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedSubjectParameter?: Usage;
}

/**
 * `Subsetting`.
 * Generalizes: `Specialization`.
 */
export interface Subsetting extends Specialization {
    /**
     * Reference 0..1, derived.
     * Opposite: `Feature/ownedSubsetting`.
     * Subsets: `Subsetting/subsettingFeature`.
     * Redefines: `Specialization/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningFeature?: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/general`.
     */
    subsettedFeature: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Specialization/specific`.
     */
    subsettingFeature: Feature;
}

/**
 * `Succession`.
 * Generalizes: `Connector`.
 */
export interface Succession extends Connector {}

/**
 * `SuccessionAsUsage`.
 * Generalizes: `ConnectorAsUsage`, `Succession`.
 */
export interface SuccessionAsUsage extends ConnectorAsUsage, Succession {}

/**
 * `SuccessionFlow`.
 * Generalizes: `Flow`, `Succession`.
 */
export interface SuccessionFlow extends Flow, Succession {}

/**
 * `SuccessionFlowUsage`.
 * Generalizes: `FlowUsage`, `SuccessionFlow`.
 */
export interface SuccessionFlowUsage extends FlowUsage, SuccessionFlow {}

/**
 * `TerminateActionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface TerminateActionUsage extends ActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * terminatedOccurrenceArgument = argument(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly terminatedOccurrenceArgument?: Expression;
}

/**
 * `TextualRepresentation`.
 * Generalizes: `AnnotatingElement`.
 */
export interface TextualRepresentation extends AnnotatingElement {
    /** Attribute 1..1. */
    body: string;
    /** Attribute 1..1. */
    language: string;
    /**
     * Reference 1..1, derived.
     * Opposite: `Element/textualRepresentation`.
     * Subsets: `Element/owner`.
     * Redefines: `AnnotatingElement/annotatedElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly representedElement?: Element;
}

/**
 * `TransitionFeatureMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface TransitionFeatureMembership extends FeatureMembership {
    /** Attribute 1..1. */
    kind: TransitionFeatureKind;
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly transitionFeature?: Step;
}

/**
 * `TransitionUsage`.
 * Generalizes: `ActionUsage`.
 */
export interface TransitionUsage extends ActionUsage {
    /**
     * Reference 0..*, derived.
     * Subsets: `Type/feature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly effectAction?: ActionUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * guardExpression = ownedFeatureMembership->
     *     selectByKind(TransitionFeatureMembership)->
     *     select(kind = TransitionFeatureKind::trigger).transitionFeature->
     *     selectByKind(Expression)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly guardExpression?: Expression[];
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * source =
     *     let sourceFeature : Feature = sourceFeature() in
     *     if sourceFeature = null then null
     *     else sourceFeature.featureTarget.oclAsType(ActionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly source?: ActionUsage;
    /**
     * Reference 1..1, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * succession = ownedMember->selectByKind(Succession)->at(1)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly succession?: Succession;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * target =
     *     if succession.targetFeature->isEmpty() then null
     *     else
     *         let targetFeature : Feature =
     *             succession.targetFeature->first().featureTarget in
     *         if not targetFeature.oclIsKindOf(ActionUsage) then null
     *         else targetFeature.oclAsType(ActionUsage)
     *         endif
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly target?: ActionUsage;
    /**
     * Reference 0..*, derived.
     * Subsets: `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * triggerAction = ownedFeatureMembership->
     *     selectByKind(TransitionFeatureMembership)->
     *     select(kind = TransitionFeatureKind::trigger).transitionFeature->
     *     selectByKind(AcceptActionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly triggerAction?: AcceptActionUsage[];
}

/**
 * `TriggerInvocationExpression`.
 * Generalizes: `InvocationExpression`.
 */
export interface TriggerInvocationExpression extends InvocationExpression {
    /** Attribute 1..1. */
    kind: TriggerKind;
}

/**
 * `Type`.
 * Generalizes: `Namespace`.
 */
export interface Type extends Namespace {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * differencingType = ownedDifferencing.differencingType
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly differencingType?: Type[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * directedFeature = feature->select(f | directionOf(f) <> null)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly directedFeature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * endFeature = feature->select(isEnd)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly endFeature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * feature = featureMembership.ownedMemberFeature
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly feature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * featureMembership = ownedFeatureMembership->union(
     *     inheritedMembership->selectByKind(FeatureMembership))
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly featureMembership?: FeatureMembership[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * inheritedFeature = inheritedMemberships->
     *     selectByKind(FeatureMembership).memberFeature
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly inheritedFeature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/membership`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * inheritedMembership = inheritedMemberships(Set{}, Set{}, false)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly inheritedMembership?: Membership[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/directedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * input = feature->select(f |
     *     let direction: FeatureDirectionKind = directionOf(f) in
     *     direction = FeatureDirectionKind::_'in' or
     *     direction = FeatureDirectionKind::inout)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly input?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * intersectingType = ownedIntersecting.intersectingType
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly intersectingType?: Type[];
    /** Attribute 1..1. */
    isAbstract: boolean;
    /**
     * Attribute 1..1, derived.
     *
     * No OCL clause and no derivation annotation: must be read out of the specification text.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly isConjugated?: boolean;
    /** Attribute 1..1. */
    isSufficient: boolean;
    /**
     * Reference 0..1, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * multiplicity =
     *     let ownedMultiplicities: Sequence(Multiplicity) =
     *         ownedMember->selectByKind(Multiplicity) in
     *     if ownedMultiplicities->isEmpty() then null
     *     else ownedMultiplicities->first()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly multiplicity?: Multiplicity;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/directedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * output = feature->select(f |
     *     let direction: FeatureDirectionKind = directionOf(f) in
     *     direction = FeatureDirectionKind::out or
     *     direction = FeatureDirectionKind::inout)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly output?: Feature[];
    /**
     * Reference 0..1, derived.
     * Opposite: `Conjugation/owningType`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedConjugator =
     *     let ownedConjugators: Sequence(Conjugator) =
     *         ownedRelationship->selectByKind(Conjugation) in
     *     if ownedConjugators->isEmpty() then null
     *     else ownedConjugators->at(1) endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedConjugator?: Conjugation;
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Differencing/typeDifferenced`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedDifferencing =
     *     ownedRelationship->selectByKind(Differencing)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedDifferencing?: Differencing[];
    /**
     * Reference 0..*, derived.
     * Opposite: `Disjoining/owningType`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedDisjoining =
     *     ownedRelationship->selectByKind(Disjoining)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedDisjoining?: Disjoining[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Feature/endOwningType`.
     * Subsets: `Type/endFeature`, `Type/ownedFeature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedEndFeature = ownedFeature->select(isEnd)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedEndFeature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Feature/owningType`.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedFeature = ownedFeatureMembership.ownedMemberFeature
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedFeature?: Feature[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `FeatureMembership/owningType`.
     * Subsets: `Namespace/ownedMembership`, `Type/featureMembership`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedFeatureMembership = ownedRelationship->selectByKind(FeatureMembership)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedFeatureMembership?: FeatureMembership[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Intersecting/typeIntersected`.
     * Subsets: `Element/ownedRelationship`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedIntersecting?: Intersecting[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Specialization/owningType`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedSpecialization = ownedRelationship->selectByKind(Specialization)->
     *     select(s | s.special = self)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedSpecialization?: Specialization[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Unioning/typeUnioned`.
     * Subsets: `Element/ownedRelationship`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * ownedUnioning =
     *     ownedRelationship->selectByKind(Unioning)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedUnioning?: Unioning[];
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * unioningType = ownedUnioning.unioningType
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly unioningType?: Type[];
}

/**
 * `TypeFeaturing`.
 * Generalizes: `Relationship`.
 */
export interface TypeFeaturing extends Relationship {
    /**
     * Reference 1..1.
     * Redefines: `Relationship/source`.
     */
    featureOfType: Feature;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    featuringType: Type;
    /**
     * Reference 0..1, derived.
     * Opposite: `Feature/ownedTypeFeaturing`.
     * Subsets: `Relationship/owningRelatedElement`, `TypeFeaturing/featureOfType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningFeatureOfType?: Feature;
}

/**
 * `Unioning`.
 * Generalizes: `Relationship`.
 */
export interface Unioning extends Relationship {
    /**
     * Reference 1..1, derived.
     * Opposite: `Type/ownedUnioning`.
     * Subsets: `Relationship/owningRelatedElement`.
     * Redefines: `Relationship/source`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly typeUnioned?: Type;
    /**
     * Reference 1..1.
     * Redefines: `Relationship/target`.
     */
    unioningType: Type;
}

/**
 * `Usage`.
 * Generalizes: `Feature`.
 */
export interface Usage extends Feature {
    /**
     * Reference 0..*, ordered, derived.
     * Redefines: `Feature/type`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly definition?: Classifier[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/directedFeature`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * directedUsage = directedFeature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly directedUsage?: Usage[];
    /**
     * Attribute 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * isReference = not isComposite
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly isReference?: boolean;
    /** Attribute 1..1. */
    isVariation: boolean;
    /**
     * Attribute 1..1, derived.
     * Redefines: `Feature/isVariable`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * mayTimeVary =
     *     owningType <> null and
     *     owningType.specializesFromLibrary('Occurrences::Occurrence') and
     *     not (
     *         isPortion or
     *         specializesFromLibrary('Links::SelfLink') or
     *         specializesFromLibrary('Occurrences::HappensLink') or
     *         isComposite and specializesFromLibrary('Actions::Action')
     *     )
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly mayTimeVary?: boolean;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedAction = nestedUsage->selectByKind(ActionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedAction?: ActionUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedAllocation = nestedUsage->selectByKind(AllocationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedAllocation?: AllocationUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedAnalysisCase = nestedUsage->selectByKind(AnalysisCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedAnalysisCase?: AnalysisCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedAttribute = nestedUsage->selectByKind(AttributeUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedAttribute?: AttributeUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedAction`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedCalculation = nestedUsage->selectByKind(CalculationUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedCalculation?: CalculationUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedCalculation`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedCase = nestedUsage->selectByKind(CaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedCase?: CaseUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Usage/nestedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedConcern = nestedUsage->selectByKind(ConcernUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedConcern?: ConcernUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedConnection = nestedUsage->selectByKind(ConnectorAsUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedConnection?: ConnectorAsUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedConstraint = nestedUsage->selectByKind(ConstraintUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedConstraint?: ConstraintUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedAttribute`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedEnumeration?: EnumerationUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Usage/nestedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedFlow = nestedUsage->selectByKind(FlowUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedFlow?: FlowUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedConnection`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedInterface = nestedUsage->selectByKind(ReferenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedInterface?: InterfaceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedOccurrence`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedItem = nestedUsage->selectByKind(ItemUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedItem?: ItemUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedItem`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedMetadata = nestedUsage->selectByKind(MetadataUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedMetadata?: MetadataUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedOccurrence = nestedUsage->selectByKind(OccurrenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedOccurrence?: OccurrenceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedItem`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedPart = nestedUsage->selectByKind(PartUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedPart?: PartUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedPort = nestedUsage->selectByKind(PortUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedPort?: PortUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedReference = nestedUsage->selectByKind(ReferenceUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedReference?: ReferenceUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedPart`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedRendering = nestedUsage->selectByKind(RenderingUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedRendering?: RenderingUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedConstraint`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedRequirement = nestedUsage->selectByKind(RequirementUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedRequirement?: RequirementUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedAction`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedState = nestedUsage->selectByKind(StateUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedState?: StateUsage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Usage/nestedUsage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedTransition = nestedUsage->selectByKind(TransitionUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedTransition?: TransitionUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Opposite: `Usage/owningUsage`.
     * Subsets: `Type/ownedFeature`, `Usage/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedUsage = ownedFeature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedUsage?: Usage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedUseCase = nestedUsage->selectByKind(UseCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedUseCase?: UseCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedCase`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedVerificationCase = nestedUsage->selectByKind(VerificationCaseUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedVerificationCase?: VerificationCaseUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedPart`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedView = nestedUsage->selectByKind(ViewUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedView?: ViewUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * nestedViewpoint = nestedUsage->selectByKind(ViewpointUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly nestedViewpoint?: ViewpointUsage[];
    /**
     * Reference 0..1, derived.
     * Opposite: `Definition/ownedUsage`.
     * Subsets: `Feature/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningDefinition?: Definition;
    /**
     * Reference 0..1, derived.
     * Opposite: `Usage/nestedUsage`.
     * Subsets: `Feature/owningType`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly owningUsage?: Usage;
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Type/feature`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * usage = feature->selectByKind(Usage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly usage?: Usage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * variant = variantMembership.ownedVariantUsage
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly variant?: Usage[];
    /**
     * Reference 0..*, derived.
     * Subsets: `Namespace/ownedMembership`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * variantMembership = ownedMembership->selectByKind(VariantMembership)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly variantMembership?: VariantMembership[];
}

/**
 * `UseCaseDefinition`.
 * Generalizes: `CaseDefinition`.
 */
export interface UseCaseDefinition extends CaseDefinition {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * includedUseCase = ownedUseCase->
     *     selectByKind(IncludeUseCaseUsage).
     *     useCaseIncluded
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly includedUseCase?: UseCaseUsage[];
}

/**
 * `UseCaseUsage`.
 * Generalizes: `CaseUsage`.
 */
export interface UseCaseUsage extends CaseUsage {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * includedUseCase = ownedUseCase->
     *     selectByKind(IncludeUseCaseUsage).
     *     useCaseIncluded
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly includedUseCase?: UseCaseUsage[];
    /**
     * Reference 0..1, derived.
     * Redefines: `CaseUsage/caseDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly useCaseDefinition?: UseCaseDefinition;
}

/**
 * `VariantMembership`.
 * Generalizes: `OwningMembership`.
 */
export interface VariantMembership extends OwningMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `OwningMembership/ownedMemberElement`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedVariantUsage?: Usage;
}

/**
 * `VerificationCaseDefinition`.
 * Generalizes: `CaseDefinition`.
 */
export interface VerificationCaseDefinition extends CaseDefinition {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * verifiedRequirement =
     *     if objectiveRequirement = null then OrderedSet{}
     *     else
     *         objectiveRequirement.featureMembership->
     *             selectByKind(RequirementVerificationMembership).
     *             verifiedRequirement->asOrderedSet()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly verifiedRequirement?: RequirementUsage[];
}

/**
 * `VerificationCaseUsage`.
 * Generalizes: `CaseUsage`.
 */
export interface VerificationCaseUsage extends CaseUsage {
    /**
     * Reference 0..1, derived.
     * Subsets: `CaseUsage/caseDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly verificationCaseDefinition?: VerificationCaseDefinition;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * verifiedRequirement =
     *     if objectiveRequirement = null then OrderedSet{}
     *     else
     *         objectiveRequirement.featureMembership->
     *             selectByKind(RequirementVerificationMembership).
     *             verifiedRequirement->asOrderedSet()
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly verifiedRequirement?: RequirementUsage[];
}

/**
 * `ViewDefinition`.
 * Generalizes: `PartDefinition`.
 */
export interface ViewDefinition extends PartDefinition {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/ownedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * satisfiedViewpoint = ownedRequirement->
     *     selectByKind(ViewpointUsage)->
     *     select(isComposite)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly satisfiedViewpoint?: ViewpointUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Definition/usage`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * view = usage->selectByKind(ViewUsage)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly view?: ViewUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewCondition = ownedMembership->
     *     selectByKind(ElementFilterMembership).
     *     condition
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewCondition?: Expression[];
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewRendering =
     *     let renderings: OrderedSet(ViewRenderingMembership) =
     *         featureMembership->selectByKind(ViewRenderingMembership) in
     *     if renderings->isEmpty() then null
     *     else renderings->first().referencedRendering
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewRendering?: RenderingUsage;
}

/**
 * `ViewRenderingMembership`.
 * Generalizes: `FeatureMembership`.
 */
export interface ViewRenderingMembership extends FeatureMembership {
    /**
     * Reference 1..1, derived.
     * Redefines: `FeatureMembership/ownedMemberFeature`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly ownedRendering?: RenderingUsage;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * referencedRendering =
     *     let referencedFeature : Feature =
     *         ownedRendering.referencedFeatureTarget() in
     *     if referencedFeature = null then ownedRendering
     *     else if referencedFeature.oclIsKindOf(RenderingUsage) then
     *         refrencedFeature.oclAsType(RenderingUsage)
     *     else null
     *     endif endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly referencedRendering?: RenderingUsage;
}

/**
 * `ViewUsage`.
 * Generalizes: `PartUsage`.
 */
export interface ViewUsage extends PartUsage {
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/member`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * exposedElement = ownedImport->selectByKind(Expose).
     *     importedMemberships(Set{}).memberElement->
     *     select(elm | includeAsExposed(elm))->
     *     asOrderedSet()
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly exposedElement?: Element[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Usage/nestedRequirement`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * satisfiedViewpoint = ownedRequirement->
     *     selectByKind(ViewpointUsage)->
     *     select(isComposite)
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly satisfiedViewpoint?: ViewpointUsage[];
    /**
     * Reference 0..*, ordered, derived.
     * Subsets: `Namespace/ownedMember`.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewCondition = ownedMembership->
     *     selectByKind(ElementFilterMembership).
     *     condition
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewCondition?: Expression[];
    /**
     * Reference 0..1, derived.
     * Redefines: `PartUsage/partDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewDefinition?: ViewDefinition;
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewRendering =
     *     let renderings: OrderedSet(ViewRenderingMembership) =
     *         featureMembership->selectByKind(ViewRenderingMembership) in
     *     if renderings->isEmpty() then null
     *     else renderings->first().referencedRendering
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewRendering?: RenderingUsage;
}

/**
 * `ViewpointDefinition`.
 * Generalizes: `RequirementDefinition`.
 */
export interface ViewpointDefinition extends RequirementDefinition {
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewpointStakeholder = framedConcern.featureMemberhsip->
     *     selectByKind(StakeholderMembership).
     *     ownedStakeholderParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewpointStakeholder?: PartUsage[];
}

/**
 * `ViewpointUsage`.
 * Generalizes: `RequirementUsage`.
 */
export interface ViewpointUsage extends RequirementUsage {
    /**
     * Reference 0..1, derived.
     * Redefines: `RequirementUsage/requirementDefinition`.
     *
     * No OCL clause in the metamodel; derivable as a filtered view of the feature(s) above.
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewpointDefinition?: ViewpointDefinition;
    /**
     * Reference 0..*, ordered, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * viewpointStakeholder = framedConcern.featureMemberhsip->
     *     selectByKind(StakeholderMembership).
     *     ownedStakeholderParameter
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly viewpointStakeholder?: PartUsage[];
}

/**
 * `WhileLoopActionUsage`.
 * Generalizes: `LoopActionUsage`.
 */
export interface WhileLoopActionUsage extends LoopActionUsage {
    /**
     * Reference 0..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * untilArgument =
     *     let parameter : Feature = inputParameter(3) in
     *     if parameter <> null and parameter.oclIsKindOf(Expression) then
     *         parameter.oclAsType(Expression)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly untilArgument?: Expression;
    /**
     * Reference 1..1, derived.
     *
     * Specification OCL, verbatim from SysML.ecore:
     * ```ocl
     * whileArgument =
     *     let parameter : Feature = inputParameter(1) in
     *     if parameter <> null and parameter.oclIsKindOf(Expression) then
     *         parameter.oclAsType(Expression)
     *     else
     *         null
     *     endif
     * ```
     * Resolved by the hand-written resolution core, never by a generated body.
     */
    readonly whileArgument?: Expression;
}

// ─── Reflective metadata ────────────────────────────────────────────────────
//
// The same metamodel as data, for code that must reason about features it was
// not written against — the resolution core, the lowering pass, and any tool
// that walks a metaclass it does not have a TypeScript name for.

/** Whether a feature holds a value, or points at another element. */
export type FeatureKind = 'attribute' | 'reference';

export interface FeatureDescriptor {
    /** Name as emitted on the interface. */
    name: string;
    /** Name in SysML.ecore; differs from `name` only where it is reserved. */
    ecoreName: string;
    kind: FeatureKind;
    /** Metaclass, enum or Ecore primitive name of the value. */
    type: string;
    lowerBound: number;
    /** `-1` for unbounded. */
    upperBound: number;
    many: boolean;
    ordered: boolean;
    /** True where the value is owned rather than referenced. */
    containment: boolean;
    derived: boolean;
    volatile: boolean;
    /** `Metaclass/feature` of the navigable inverse, for the 70 real pairs. */
    opposite?: string;
    /** `Metaclass/feature` references from the `subsets` annotation. */
    subsets?: string[];
    /** `Metaclass/feature` references from the `redefines` annotation. */
    redefines?: string[];
    /** Set on the single derived union, `Namespace::membership`. */
    union?: true;
    /**
     * Set where the metamodel states an OCL derivation for this feature.
     *
     * The clause itself is in `generated/sysml-derivations.ts` — it is B3's
     * input, it is large, and no consumer of the structural metamodel needs it.
     */
    hasDerivation?: true;
}

export interface OperationParameterDescriptor { name: string; type: string; many: boolean; }

export interface OperationDescriptor {
    name: string;
    type: string;
    lowerBound: number;
    upperBound: number;
    parameters: OperationParameterDescriptor[];
    /** Set where the metamodel states an OCL body; absent for the seven without. */
    hasBody?: true;
}

export interface MetaclassDescriptor {
    name: string;
    abstract: boolean;
    superTypes: string[];
    features: Record<string, FeatureDescriptor>;
    operations: OperationDescriptor[];
}

export const SYSML_METACLASSES: Record<string, MetaclassDescriptor> = {
    "AcceptActionUsage": {
        name: "AcceptActionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "payloadArgument": {"name":"payloadArgument","ecoreName":"payloadArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "payloadParameter": {"name":"payloadParameter","ecoreName":"payloadParameter","kind":"reference","type":"ReferenceUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedReference","Step/parameter"],"hasDerivation":true},
        "receiverArgument": {"name":"receiverArgument","ecoreName":"receiverArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [
        {"name":"isTriggerAction","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "ActionDefinition": {
        name: "ActionDefinition",
        abstract: false,
        superTypes: ["OccurrenceDefinition","Behavior"],
        features: {
        "action": {"name":"action","ecoreName":"action","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/step","Definition/usage"],"hasDerivation":true},
        },
        operations: [],
    },
    "ActionUsage": {
        name: "ActionUsage",
        abstract: false,
        superTypes: ["OccurrenceUsage","Step"],
        features: {
        "actionDefinition": {"name":"actionDefinition","ecoreName":"actionDefinition","kind":"reference","type":"Behavior","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Step/behavior","OccurrenceUsage/occurrenceDefinition"]},
        },
        operations: [
        {"name":"argument","type":"Expression","lowerBound":0,"upperBound":1,"parameters":[{"name":"i","type":"number","many":false}],"hasBody":true},
        {"name":"inputParameter","type":"Feature","lowerBound":0,"upperBound":1,"parameters":[{"name":"i","type":"number","many":false}],"hasBody":true},
        {"name":"inputParameters","type":"Feature","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        {"name":"isSubactionUsage","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "ActorMembership": {
        name: "ActorMembership",
        abstract: false,
        superTypes: ["ParameterMembership"],
        features: {
        "ownedActorParameter": {"name":"ownedActorParameter","ecoreName":"ownedActorParameter","kind":"reference","type":"PartUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ParameterMembership/ownedMemberParameter"]},
        },
        operations: [],
    },
    "AllocationDefinition": {
        name: "AllocationDefinition",
        abstract: false,
        superTypes: ["ConnectionDefinition"],
        features: {
        "allocation": {"name":"allocation","ecoreName":"allocation","kind":"reference","type":"AllocationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/usage"],"hasDerivation":true},
        },
        operations: [],
    },
    "AllocationUsage": {
        name: "AllocationUsage",
        abstract: false,
        superTypes: ["ConnectionUsage"],
        features: {
        "allocationDefinition": {"name":"allocationDefinition","ecoreName":"allocationDefinition","kind":"reference","type":"AllocationDefinition","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["ConnectionUsage/connectionDefinition"]},
        },
        operations: [],
    },
    "AnalysisCaseDefinition": {
        name: "AnalysisCaseDefinition",
        abstract: false,
        superTypes: ["CaseDefinition"],
        features: {
        "resultExpression": {"name":"resultExpression","ecoreName":"resultExpression","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Function/expression","Type/ownedFeature"],"hasDerivation":true},
        },
        operations: [],
    },
    "AnalysisCaseUsage": {
        name: "AnalysisCaseUsage",
        abstract: false,
        superTypes: ["CaseUsage"],
        features: {
        "analysisCaseDefinition": {"name":"analysisCaseDefinition","ecoreName":"analysisCaseDefinition","kind":"reference","type":"AnalysisCaseDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["CaseUsage/caseDefinition"]},
        "resultExpression": {"name":"resultExpression","ecoreName":"resultExpression","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        },
        operations: [],
    },
    "AnnotatingElement": {
        name: "AnnotatingElement",
        abstract: false,
        superTypes: ["Element"],
        features: {
        "annotatedElement": {"name":"annotatedElement","ecoreName":"annotatedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "annotation": {"name":"annotation","ecoreName":"annotation","kind":"reference","type":"Annotation","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Annotation/annotatingElement","hasDerivation":true},
        "ownedAnnotatingRelationship": {"name":"ownedAnnotatingRelationship","ecoreName":"ownedAnnotatingRelationship","kind":"reference","type":"Annotation","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Annotation/owningAnnotatingElement","subsets":["AnnotatingElement/annotation","Element/ownedRelationship"],"hasDerivation":true},
        "owningAnnotatingRelationship": {"name":"owningAnnotatingRelationship","ecoreName":"owningAnnotatingRelationship","kind":"reference","type":"Annotation","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Annotation/ownedAnnotatingElement","subsets":["Element/owningRelationship","AnnotatingElement/annotation"]},
        },
        operations: [],
    },
    "Annotation": {
        name: "Annotation",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "annotatedElement": {"name":"annotatedElement","ecoreName":"annotatedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "annotatingElement": {"name":"annotatingElement","ecoreName":"annotatingElement","kind":"reference","type":"AnnotatingElement","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"AnnotatingElement/annotation","redefines":["Relationship/source"],"hasDerivation":true},
        "ownedAnnotatingElement": {"name":"ownedAnnotatingElement","ecoreName":"ownedAnnotatingElement","kind":"reference","type":"AnnotatingElement","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"AnnotatingElement/owningAnnotatingRelationship","subsets":["Annotation/annotatingElement","Relationship/ownedRelatedElement"],"hasDerivation":true},
        "owningAnnotatedElement": {"name":"owningAnnotatedElement","ecoreName":"owningAnnotatedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Element/ownedAnnotation","subsets":["Annotation/annotatedElement","Relationship/owningRelatedElement"]},
        "owningAnnotatingElement": {"name":"owningAnnotatingElement","ecoreName":"owningAnnotatingElement","kind":"reference","type":"AnnotatingElement","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"AnnotatingElement/ownedAnnotatingRelationship","subsets":["Annotation/annotatingElement","Relationship/owningRelatedElement"]},
        },
        operations: [],
    },
    "AssertConstraintUsage": {
        name: "AssertConstraintUsage",
        abstract: false,
        superTypes: ["ConstraintUsage","Invariant"],
        features: {
        "assertedConstraint": {"name":"assertedConstraint","ecoreName":"assertedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "AssignmentActionUsage": {
        name: "AssignmentActionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "referent": {"name":"referent","ecoreName":"referent","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        "targetArgument": {"name":"targetArgument","ecoreName":"targetArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "valueExpression": {"name":"valueExpression","ecoreName":"valueExpression","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "Association": {
        name: "Association",
        abstract: false,
        superTypes: ["Classifier","Relationship"],
        features: {
        "associationEnd": {"name":"associationEnd","ecoreName":"associationEnd","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Type/endFeature"]},
        "relatedType": {"name":"relatedType","ecoreName":"relatedType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Relationship/relatedElement"],"hasDerivation":true},
        "sourceType": {"name":"sourceType","ecoreName":"sourceType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Association/relatedType"],"redefines":["Relationship/source"],"hasDerivation":true},
        "targetType": {"name":"targetType","ecoreName":"targetType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Association/relatedType"],"redefines":["Relationship/target"],"hasDerivation":true},
        },
        operations: [],
    },
    "AssociationStructure": {
        name: "AssociationStructure",
        abstract: false,
        superTypes: ["Association","Structure"],
        features: {
        },
        operations: [],
    },
    "AttributeDefinition": {
        name: "AttributeDefinition",
        abstract: false,
        superTypes: ["Definition","DataType"],
        features: {
        },
        operations: [],
    },
    "AttributeUsage": {
        name: "AttributeUsage",
        abstract: false,
        superTypes: ["Usage"],
        features: {
        "attributeDefinition": {"name":"attributeDefinition","ecoreName":"attributeDefinition","kind":"reference","type":"DataType","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Usage/definition"]},
        },
        operations: [],
    },
    "Behavior": {
        name: "Behavior",
        abstract: false,
        superTypes: ["Class"],
        features: {
        "parameter": {"name":"parameter","ecoreName":"parameter","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Type/directedFeature"]},
        "step": {"name":"step","ecoreName":"step","kind":"reference","type":"Step","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        },
        operations: [],
    },
    "BindingConnector": {
        name: "BindingConnector",
        abstract: false,
        superTypes: ["Connector"],
        features: {
        },
        operations: [],
    },
    "BindingConnectorAsUsage": {
        name: "BindingConnectorAsUsage",
        abstract: false,
        superTypes: ["ConnectorAsUsage","BindingConnector"],
        features: {
        },
        operations: [],
    },
    "BooleanExpression": {
        name: "BooleanExpression",
        abstract: false,
        superTypes: ["Expression"],
        features: {
        "predicate": {"name":"predicate","ecoreName":"predicate","kind":"reference","type":"Predicate","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Expression/function"]},
        },
        operations: [],
    },
    "CalculationDefinition": {
        name: "CalculationDefinition",
        abstract: false,
        superTypes: ["ActionDefinition","Function"],
        features: {
        "calculation": {"name":"calculation","ecoreName":"calculation","kind":"reference","type":"CalculationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["ActionDefinition/action","Function/expression"],"hasDerivation":true},
        },
        operations: [],
    },
    "CalculationUsage": {
        name: "CalculationUsage",
        abstract: false,
        superTypes: ["ActionUsage","Expression"],
        features: {
        "calculationDefinition": {"name":"calculationDefinition","ecoreName":"calculationDefinition","kind":"reference","type":"Function","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Expression/function","ActionUsage/actionDefinition"]},
        },
        operations: [],
    },
    "CaseDefinition": {
        name: "CaseDefinition",
        abstract: false,
        superTypes: ["CalculationDefinition"],
        features: {
        "actorParameter": {"name":"actorParameter","ecoreName":"actorParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/parameter","Definition/usage"],"hasDerivation":true},
        "objectiveRequirement": {"name":"objectiveRequirement","ecoreName":"objectiveRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/usage"],"hasDerivation":true},
        "subjectParameter": {"name":"subjectParameter","ecoreName":"subjectParameter","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/parameter","Definition/usage"],"hasDerivation":true},
        },
        operations: [],
    },
    "CaseUsage": {
        name: "CaseUsage",
        abstract: false,
        superTypes: ["CalculationUsage"],
        features: {
        "actorParameter": {"name":"actorParameter","ecoreName":"actorParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Step/parameter","Usage/usage"],"hasDerivation":true},
        "caseDefinition": {"name":"caseDefinition","ecoreName":"caseDefinition","kind":"reference","type":"CaseDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["CalculationUsage/calculationDefinition"]},
        "objectiveRequirement": {"name":"objectiveRequirement","ecoreName":"objectiveRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/usage"],"hasDerivation":true},
        "subjectParameter": {"name":"subjectParameter","ecoreName":"subjectParameter","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Step/parameter","Usage/usage"],"hasDerivation":true},
        },
        operations: [],
    },
    "Class": {
        name: "Class",
        abstract: false,
        superTypes: ["Classifier"],
        features: {
        },
        operations: [],
    },
    "Classifier": {
        name: "Classifier",
        abstract: false,
        superTypes: ["Type"],
        features: {
        "ownedSubclassification": {"name":"ownedSubclassification","ecoreName":"ownedSubclassification","kind":"reference","type":"Subclassification","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Subclassification/owningClassifier","subsets":["Type/ownedSpecialization"],"hasDerivation":true},
        },
        operations: [],
    },
    "CollectExpression": {
        name: "CollectExpression",
        abstract: false,
        superTypes: ["OperatorExpression"],
        features: {
        },
        operations: [],
    },
    "Comment": {
        name: "Comment",
        abstract: false,
        superTypes: ["AnnotatingElement"],
        features: {
        "body": {"name":"body","ecoreName":"body","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "locale": {"name":"locale","ecoreName":"locale","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "ConcernDefinition": {
        name: "ConcernDefinition",
        abstract: false,
        superTypes: ["RequirementDefinition"],
        features: {
        },
        operations: [],
    },
    "ConcernUsage": {
        name: "ConcernUsage",
        abstract: false,
        superTypes: ["RequirementUsage"],
        features: {
        "concernDefinition": {"name":"concernDefinition","ecoreName":"concernDefinition","kind":"reference","type":"ConcernDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementUsage/requirementDefinition"]},
        },
        operations: [],
    },
    "ConjugatedPortDefinition": {
        name: "ConjugatedPortDefinition",
        abstract: false,
        superTypes: ["PortDefinition"],
        features: {
        "originalPortDefinition": {"name":"originalPortDefinition","ecoreName":"originalPortDefinition","kind":"reference","type":"PortDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"PortDefinition/conjugatedPortDefinition","redefines":["Element/owningNamespace"]},
        "ownedPortConjugator": {"name":"ownedPortConjugator","ecoreName":"ownedPortConjugator","kind":"reference","type":"PortConjugation","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"PortConjugation/conjugatedPortDefinition","redefines":["Type/ownedConjugator"]},
        },
        operations: [],
    },
    "ConjugatedPortTyping": {
        name: "ConjugatedPortTyping",
        abstract: false,
        superTypes: ["FeatureTyping"],
        features: {
        "conjugatedPortDefinition": {"name":"conjugatedPortDefinition","ecoreName":"conjugatedPortDefinition","kind":"reference","type":"ConjugatedPortDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["FeatureTyping/type"]},
        "portDefinition": {"name":"portDefinition","ecoreName":"portDefinition","kind":"reference","type":"PortDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "Conjugation": {
        name: "Conjugation",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "conjugatedType": {"name":"conjugatedType","ecoreName":"conjugatedType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        "originalType": {"name":"originalType","ecoreName":"originalType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "owningType": {"name":"owningType","ecoreName":"owningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedConjugator","subsets":["Conjugation/conjugatedType","Relationship/owningRelatedElement"]},
        },
        operations: [],
    },
    "ConnectionDefinition": {
        name: "ConnectionDefinition",
        abstract: false,
        superTypes: ["PartDefinition","AssociationStructure"],
        features: {
        "connectionEnd": {"name":"connectionEnd","ecoreName":"connectionEnd","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Association/associationEnd"]},
        },
        operations: [],
    },
    "ConnectionUsage": {
        name: "ConnectionUsage",
        abstract: false,
        superTypes: ["ConnectorAsUsage","PartUsage"],
        features: {
        "connectionDefinition": {"name":"connectionDefinition","ecoreName":"connectionDefinition","kind":"reference","type":"AssociationStructure","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["ItemUsage/itemDefinition"],"redefines":["Connector/association"]},
        },
        operations: [],
    },
    "Connector": {
        name: "Connector",
        abstract: false,
        superTypes: ["Feature","Relationship"],
        features: {
        "association": {"name":"association","ecoreName":"association","kind":"reference","type":"Association","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Feature/type"]},
        "connectorEnd": {"name":"connectorEnd","ecoreName":"connectorEnd","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Type/endFeature"]},
        "defaultFeaturingType": {"name":"defaultFeaturingType","ecoreName":"defaultFeaturingType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true},
        "relatedFeature": {"name":"relatedFeature","ecoreName":"relatedFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Relationship/relatedElement"],"hasDerivation":true},
        "sourceFeature": {"name":"sourceFeature","ecoreName":"sourceFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Connector/relatedFeature"],"redefines":["Relationship/source"],"hasDerivation":true},
        "targetFeature": {"name":"targetFeature","ecoreName":"targetFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Connector/relatedFeature"],"redefines":["Relationship/target"],"hasDerivation":true},
        },
        operations: [],
    },
    "ConnectorAsUsage": {
        name: "ConnectorAsUsage",
        abstract: true,
        superTypes: ["Usage","Connector"],
        features: {
        },
        operations: [],
    },
    "ConstraintDefinition": {
        name: "ConstraintDefinition",
        abstract: false,
        superTypes: ["OccurrenceDefinition","Predicate"],
        features: {
        },
        operations: [],
    },
    "ConstraintUsage": {
        name: "ConstraintUsage",
        abstract: false,
        superTypes: ["OccurrenceUsage","BooleanExpression"],
        features: {
        "constraintDefinition": {"name":"constraintDefinition","ecoreName":"constraintDefinition","kind":"reference","type":"Predicate","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["BooleanExpression/predicate"]},
        },
        operations: [],
    },
    "ConstructorExpression": {
        name: "ConstructorExpression",
        abstract: false,
        superTypes: ["InstantiationExpression"],
        features: {
        },
        operations: [],
    },
    "ControlNode": {
        name: "ControlNode",
        abstract: true,
        superTypes: ["ActionUsage"],
        features: {
        },
        operations: [
        {"name":"multiplicityHasBounds","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"mult","type":"Multiplicity","many":false},{"name":"lower","type":"number","many":false},{"name":"upper","type":"number","many":false}],"hasBody":true},
        ],
    },
    "CrossSubsetting": {
        name: "CrossSubsetting",
        abstract: false,
        superTypes: ["Subsetting"],
        features: {
        "crossedFeature": {"name":"crossedFeature","ecoreName":"crossedFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Subsetting/subsettedFeature"]},
        "crossingFeature": {"name":"crossingFeature","ecoreName":"crossingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedCrossSubsetting","redefines":["Subsetting/owningFeature","Subsetting/subsettingFeature"]},
        },
        operations: [],
    },
    "DataType": {
        name: "DataType",
        abstract: false,
        superTypes: ["Classifier"],
        features: {
        },
        operations: [],
    },
    "DecisionNode": {
        name: "DecisionNode",
        abstract: false,
        superTypes: ["ControlNode"],
        features: {
        },
        operations: [],
    },
    "Definition": {
        name: "Definition",
        abstract: false,
        superTypes: ["Classifier"],
        features: {
        "directedUsage": {"name":"directedUsage","ecoreName":"directedUsage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/directedFeature","Definition/usage"],"hasDerivation":true},
        "isVariation": {"name":"isVariation","ecoreName":"isVariation","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "ownedAction": {"name":"ownedAction","ecoreName":"ownedAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedOccurrence"],"hasDerivation":true},
        "ownedAllocation": {"name":"ownedAllocation","ecoreName":"ownedAllocation","kind":"reference","type":"AllocationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedConnection"],"hasDerivation":true},
        "ownedAnalysisCase": {"name":"ownedAnalysisCase","ecoreName":"ownedAnalysisCase","kind":"reference","type":"AnalysisCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedCase"],"hasDerivation":true},
        "ownedAttribute": {"name":"ownedAttribute","ecoreName":"ownedAttribute","kind":"reference","type":"AttributeUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedCalculation": {"name":"ownedCalculation","ecoreName":"ownedCalculation","kind":"reference","type":"CalculationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedAction"],"hasDerivation":true},
        "ownedCase": {"name":"ownedCase","ecoreName":"ownedCase","kind":"reference","type":"CaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedCalculation"],"hasDerivation":true},
        "ownedConcern": {"name":"ownedConcern","ecoreName":"ownedConcern","kind":"reference","type":"ConcernUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedRequirement"],"hasDerivation":true},
        "ownedConnection": {"name":"ownedConnection","ecoreName":"ownedConnection","kind":"reference","type":"ConnectorAsUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedConstraint": {"name":"ownedConstraint","ecoreName":"ownedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedOccurrence"],"hasDerivation":true},
        "ownedEnumeration": {"name":"ownedEnumeration","ecoreName":"ownedEnumeration","kind":"reference","type":"EnumerationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedAttribute"],"hasDerivation":true},
        "ownedFlow": {"name":"ownedFlow","ecoreName":"ownedFlow","kind":"reference","type":"FlowUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedConnection"],"hasDerivation":true},
        "ownedInterface": {"name":"ownedInterface","ecoreName":"ownedInterface","kind":"reference","type":"InterfaceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedConnection"],"hasDerivation":true},
        "ownedItem": {"name":"ownedItem","ecoreName":"ownedItem","kind":"reference","type":"ItemUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedOccurrence"],"hasDerivation":true},
        "ownedMetadata": {"name":"ownedMetadata","ecoreName":"ownedMetadata","kind":"reference","type":"MetadataUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedItem"],"hasDerivation":true},
        "ownedOccurrence": {"name":"ownedOccurrence","ecoreName":"ownedOccurrence","kind":"reference","type":"OccurrenceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedPart": {"name":"ownedPart","ecoreName":"ownedPart","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedItem"],"hasDerivation":true},
        "ownedPort": {"name":"ownedPort","ecoreName":"ownedPort","kind":"reference","type":"PortUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedReference": {"name":"ownedReference","ecoreName":"ownedReference","kind":"reference","type":"ReferenceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedRendering": {"name":"ownedRendering","ecoreName":"ownedRendering","kind":"reference","type":"RenderingUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedPart"],"hasDerivation":true},
        "ownedRequirement": {"name":"ownedRequirement","ecoreName":"ownedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedConstraint"],"hasDerivation":true},
        "ownedState": {"name":"ownedState","ecoreName":"ownedState","kind":"reference","type":"StateUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedAction"],"hasDerivation":true},
        "ownedTransition": {"name":"ownedTransition","ecoreName":"ownedTransition","kind":"reference","type":"TransitionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedUsage"],"hasDerivation":true},
        "ownedUsage": {"name":"ownedUsage","ecoreName":"ownedUsage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Usage/owningDefinition","subsets":["Type/ownedFeature","Definition/usage"],"hasDerivation":true},
        "ownedUseCase": {"name":"ownedUseCase","ecoreName":"ownedUseCase","kind":"reference","type":"UseCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedCase"],"hasDerivation":true},
        "ownedVerificationCase": {"name":"ownedVerificationCase","ecoreName":"ownedVerificationCase","kind":"reference","type":"VerificationCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedCase"],"hasDerivation":true},
        "ownedView": {"name":"ownedView","ecoreName":"ownedView","kind":"reference","type":"ViewUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedPart"],"hasDerivation":true},
        "ownedViewpoint": {"name":"ownedViewpoint","ecoreName":"ownedViewpoint","kind":"reference","type":"ViewpointUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedRequirement"],"hasDerivation":true},
        "usage": {"name":"usage","ecoreName":"usage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        "variant": {"name":"variant","ecoreName":"variant","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "variantMembership": {"name":"variantMembership","ecoreName":"variantMembership","kind":"reference","type":"VariantMembership","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMembership"],"hasDerivation":true},
        },
        operations: [],
    },
    "Dependency": {
        name: "Dependency",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "client": {"name":"client","ecoreName":"client","kind":"reference","type":"Element","lowerBound":1,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        "supplier": {"name":"supplier","ecoreName":"supplier","kind":"reference","type":"Element","lowerBound":1,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        },
        operations: [],
    },
    "Differencing": {
        name: "Differencing",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "differencingType": {"name":"differencingType","ecoreName":"differencingType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "typeDifferenced": {"name":"typeDifferenced","ecoreName":"typeDifferenced","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedDifferencing","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        },
        operations: [],
    },
    "Disjoining": {
        name: "Disjoining",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "disjoiningType": {"name":"disjoiningType","ecoreName":"disjoiningType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "owningType": {"name":"owningType","ecoreName":"owningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedDisjoining","subsets":["Relationship/owningRelatedElement","Disjoining/typeDisjoined"]},
        "typeDisjoined": {"name":"typeDisjoined","ecoreName":"typeDisjoined","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        },
        operations: [],
    },
    "Documentation": {
        name: "Documentation",
        abstract: false,
        superTypes: ["Comment"],
        features: {
        "documentedElement": {"name":"documentedElement","ecoreName":"documentedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Element/documentation","subsets":["Element/owner"],"redefines":["AnnotatingElement/annotatedElement"]},
        },
        operations: [],
    },
    "Element": {
        name: "Element",
        abstract: true,
        superTypes: [],
        features: {
        "aliasIds": {"name":"aliasIds","ecoreName":"aliasIds","kind":"attribute","type":"EString","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":false,"volatile":false},
        "declaredName": {"name":"declaredName","ecoreName":"declaredName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "declaredShortName": {"name":"declaredShortName","ecoreName":"declaredShortName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "documentation": {"name":"documentation","ecoreName":"documentation","kind":"reference","type":"Documentation","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Documentation/documentedElement","subsets":["Element/ownedElement"],"hasDerivation":true},
        "elementId": {"name":"elementId","ecoreName":"elementId","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isImpliedIncluded": {"name":"isImpliedIncluded","ecoreName":"isImpliedIncluded","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isLibraryElement": {"name":"isLibraryElement","ecoreName":"isLibraryElement","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "name": {"name":"name","ecoreName":"name","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "ownedAnnotation": {"name":"ownedAnnotation","ecoreName":"ownedAnnotation","kind":"reference","type":"Annotation","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Annotation/owningAnnotatedElement","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedElement": {"name":"ownedElement","ecoreName":"ownedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Element/owner","hasDerivation":true},
        "ownedRelationship": {"name":"ownedRelationship","ecoreName":"ownedRelationship","kind":"reference","type":"Relationship","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":true,"derived":false,"volatile":false,"opposite":"Relationship/owningRelatedElement"},
        "owner": {"name":"owner","ecoreName":"owner","kind":"reference","type":"Element","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Element/ownedElement","hasDerivation":true},
        "owningMembership": {"name":"owningMembership","ecoreName":"owningMembership","kind":"reference","type":"OwningMembership","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"OwningMembership/ownedMemberElement","subsets":["Element/owningRelationship"]},
        "owningNamespace": {"name":"owningNamespace","ecoreName":"owningNamespace","kind":"reference","type":"Namespace","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Namespace/ownedMember","hasDerivation":true},
        "owningRelationship": {"name":"owningRelationship","ecoreName":"owningRelationship","kind":"reference","type":"Relationship","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"opposite":"Relationship/ownedRelatedElement"},
        "qualifiedName": {"name":"qualifiedName","ecoreName":"qualifiedName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "shortName": {"name":"shortName","ecoreName":"shortName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "textualRepresentation": {"name":"textualRepresentation","ecoreName":"textualRepresentation","kind":"reference","type":"TextualRepresentation","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"TextualRepresentation/representedElement","subsets":["Element/ownedElement"],"hasDerivation":true},
        },
        operations: [
        {"name":"effectiveName","type":"string","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"effectiveShortName","type":"string","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"escapedName","type":"string","lowerBound":0,"upperBound":1,"parameters":[]},
        {"name":"libraryNamespace","type":"Namespace","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"path","type":"string","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "ElementFilterMembership": {
        name: "ElementFilterMembership",
        abstract: false,
        superTypes: ["OwningMembership"],
        features: {
        "condition": {"name":"condition","ecoreName":"condition","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["OwningMembership/ownedMemberElement"]},
        },
        operations: [],
    },
    "EndFeatureMembership": {
        name: "EndFeatureMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        },
        operations: [],
    },
    "EnumerationDefinition": {
        name: "EnumerationDefinition",
        abstract: false,
        superTypes: ["AttributeDefinition"],
        features: {
        "enumeratedValue": {"name":"enumeratedValue","ecoreName":"enumeratedValue","kind":"reference","type":"EnumerationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Definition/variant"]},
        },
        operations: [],
    },
    "EnumerationUsage": {
        name: "EnumerationUsage",
        abstract: false,
        superTypes: ["AttributeUsage"],
        features: {
        "enumerationDefinition": {"name":"enumerationDefinition","ecoreName":"enumerationDefinition","kind":"reference","type":"EnumerationDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["AttributeUsage/attributeDefinition"]},
        },
        operations: [],
    },
    "EventOccurrenceUsage": {
        name: "EventOccurrenceUsage",
        abstract: false,
        superTypes: ["OccurrenceUsage"],
        features: {
        "eventOccurrence": {"name":"eventOccurrence","ecoreName":"eventOccurrence","kind":"reference","type":"OccurrenceUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ExhibitStateUsage": {
        name: "ExhibitStateUsage",
        abstract: false,
        superTypes: ["StateUsage","PerformActionUsage"],
        features: {
        "exhibitedState": {"name":"exhibitedState","ecoreName":"exhibitedState","kind":"reference","type":"StateUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["PerformActionUsage/performedAction"]},
        },
        operations: [],
    },
    "Expose": {
        name: "Expose",
        abstract: true,
        superTypes: ["Import"],
        features: {
        },
        operations: [],
    },
    "Expression": {
        name: "Expression",
        abstract: false,
        superTypes: ["Step"],
        features: {
        "function": {"name":"function","ecoreName":"function","kind":"reference","type":"Function","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Step/behavior"]},
        "isModelLevelEvaluable": {"name":"isModelLevelEvaluable","ecoreName":"isModelLevelEvaluable","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "result": {"name":"result","ecoreName":"result","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/output","Step/parameter"],"hasDerivation":true},
        },
        operations: [
        {"name":"checkCondition","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"target","type":"Element","many":false}],"hasBody":true},
        {"name":"evaluate","type":"Element","lowerBound":0,"upperBound":-1,"parameters":[{"name":"target","type":"Element","many":false}],"hasBody":true},
        {"name":"modelLevelEvaluable","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"visited","type":"Feature","many":true}],"hasBody":true},
        ],
    },
    "Feature": {
        name: "Feature",
        abstract: false,
        superTypes: ["Type"],
        features: {
        "chainingFeature": {"name":"chainingFeature","ecoreName":"chainingFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "crossFeature": {"name":"crossFeature","ecoreName":"crossFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "direction": {"name":"direction","ecoreName":"direction","kind":"attribute","type":"FeatureDirectionKind","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "endOwningType": {"name":"endOwningType","ecoreName":"endOwningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedEndFeature","subsets":["Feature/owningType"]},
        "featureTarget": {"name":"featureTarget","ecoreName":"featureTarget","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "featuringType": {"name":"featuringType","ecoreName":"featuringType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "isComposite": {"name":"isComposite","ecoreName":"isComposite","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isConstant": {"name":"isConstant","ecoreName":"isConstant","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isDerived": {"name":"isDerived","ecoreName":"isDerived","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isEnd": {"name":"isEnd","ecoreName":"isEnd","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isOrdered": {"name":"isOrdered","ecoreName":"isOrdered","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isPortion": {"name":"isPortion","ecoreName":"isPortion","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isUnique": {"name":"isUnique","ecoreName":"isUnique","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isVariable": {"name":"isVariable","ecoreName":"isVariable","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "ownedCrossSubsetting": {"name":"ownedCrossSubsetting","ecoreName":"ownedCrossSubsetting","kind":"reference","type":"CrossSubsetting","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"CrossSubsetting/crossingFeature","subsets":["Feature/ownedSubsetting"],"hasDerivation":true},
        "ownedFeatureChaining": {"name":"ownedFeatureChaining","ecoreName":"ownedFeatureChaining","kind":"reference","type":"FeatureChaining","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"FeatureChaining/featureChained","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedFeatureInverting": {"name":"ownedFeatureInverting","ecoreName":"ownedFeatureInverting","kind":"reference","type":"FeatureInverting","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"FeatureInverting/owningFeature","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedRedefinition": {"name":"ownedRedefinition","ecoreName":"ownedRedefinition","kind":"reference","type":"Redefinition","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Feature/ownedSubsetting"],"hasDerivation":true},
        "ownedReferenceSubsetting": {"name":"ownedReferenceSubsetting","ecoreName":"ownedReferenceSubsetting","kind":"reference","type":"ReferenceSubsetting","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"ReferenceSubsetting/referencingFeature","subsets":["Feature/ownedSubsetting"],"hasDerivation":true},
        "ownedSubsetting": {"name":"ownedSubsetting","ecoreName":"ownedSubsetting","kind":"reference","type":"Subsetting","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Subsetting/owningFeature","subsets":["Type/ownedSpecialization"],"hasDerivation":true},
        "ownedTypeFeaturing": {"name":"ownedTypeFeaturing","ecoreName":"ownedTypeFeaturing","kind":"reference","type":"TypeFeaturing","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"TypeFeaturing/owningFeatureOfType","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedTyping": {"name":"ownedTyping","ecoreName":"ownedTyping","kind":"reference","type":"FeatureTyping","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"FeatureTyping/owningFeature","subsets":["Type/ownedSpecialization"],"hasDerivation":true},
        "owningFeatureMembership": {"name":"owningFeatureMembership","ecoreName":"owningFeatureMembership","kind":"reference","type":"FeatureMembership","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"FeatureMembership/ownedMemberFeature","subsets":["Element/owningMembership"]},
        "owningType": {"name":"owningType","ecoreName":"owningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedFeature","subsets":["Element/owningNamespace","Feature/featuringType"]},
        "type": {"name":"type","ecoreName":"type","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [
        {"name":"allRedefinedFeatures","type":"Feature","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        {"name":"asCartesianProduct","type":"Type","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        {"name":"canAccess","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"feature","type":"Feature","many":false}],"hasBody":true},
        {"name":"directionFor","type":"FeatureDirectionKind","lowerBound":0,"upperBound":1,"parameters":[{"name":"type","type":"Type","many":false}],"hasBody":true},
        {"name":"isCartesianProduct","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"isFeaturedWithin","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"type","type":"Type","many":false}],"hasBody":true},
        {"name":"isFeaturingType","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"type","type":"Type","many":false}],"hasBody":true},
        {"name":"isOwnedCrossFeature","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"namingFeature","type":"Feature","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"ownedCrossFeature","type":"Feature","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"redefines","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"redefinedFeature","type":"Feature","many":false}],"hasBody":true},
        {"name":"redefinesFromLibrary","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"libraryFeatureName","type":"string","many":false}],"hasBody":true},
        {"name":"subsetsChain","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"first","type":"Feature","many":false},{"name":"second","type":"Feature","many":false}],"hasBody":true},
        {"name":"typingFeatures","type":"Feature","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        ],
    },
    "FeatureChainExpression": {
        name: "FeatureChainExpression",
        abstract: false,
        superTypes: ["OperatorExpression"],
        features: {
        "targetFeature": {"name":"targetFeature","ecoreName":"targetFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        },
        operations: [
        {"name":"sourceTargetFeature","type":"Feature","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "FeatureChaining": {
        name: "FeatureChaining",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "chainingFeature": {"name":"chainingFeature","ecoreName":"chainingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "featureChained": {"name":"featureChained","ecoreName":"featureChained","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedFeatureChaining","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        },
        operations: [],
    },
    "FeatureInverting": {
        name: "FeatureInverting",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "featureInverted": {"name":"featureInverted","ecoreName":"featureInverted","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        "invertingFeature": {"name":"invertingFeature","ecoreName":"invertingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "owningFeature": {"name":"owningFeature","ecoreName":"owningFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedFeatureInverting","subsets":["FeatureInverting/featureInverted","Relationship/owningRelatedElement"]},
        },
        operations: [],
    },
    "FeatureMembership": {
        name: "FeatureMembership",
        abstract: false,
        superTypes: ["OwningMembership"],
        features: {
        "ownedMemberFeature": {"name":"ownedMemberFeature","ecoreName":"ownedMemberFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/owningFeatureMembership","redefines":["OwningMembership/ownedMemberElement"]},
        "owningType": {"name":"owningType","ecoreName":"owningType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedFeatureMembership","redefines":["Membership/membershipOwningNamespace"]},
        },
        operations: [],
    },
    "FeatureReferenceExpression": {
        name: "FeatureReferenceExpression",
        abstract: false,
        superTypes: ["Expression"],
        features: {
        "referent": {"name":"referent","ecoreName":"referent","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        },
        operations: [],
    },
    "FeatureTyping": {
        name: "FeatureTyping",
        abstract: false,
        superTypes: ["Specialization"],
        features: {
        "owningFeature": {"name":"owningFeature","ecoreName":"owningFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedTyping","subsets":["FeatureTyping/typedFeature"],"redefines":["Specialization/owningType"]},
        "type": {"name":"type","ecoreName":"type","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/general"]},
        "typedFeature": {"name":"typedFeature","ecoreName":"typedFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/specific"]},
        },
        operations: [],
    },
    "FeatureValue": {
        name: "FeatureValue",
        abstract: false,
        superTypes: ["OwningMembership"],
        features: {
        "featureWithValue": {"name":"featureWithValue","ecoreName":"featureWithValue","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Membership/membershipOwningNamespace"]},
        "isDefault": {"name":"isDefault","ecoreName":"isDefault","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isInitial": {"name":"isInitial","ecoreName":"isInitial","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "value": {"name":"value","ecoreName":"value","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["OwningMembership/ownedMemberElement"]},
        },
        operations: [],
    },
    "Flow": {
        name: "Flow",
        abstract: false,
        superTypes: ["Connector","Step"],
        features: {
        "flowEnd": {"name":"flowEnd","ecoreName":"flowEnd","kind":"reference","type":"FlowEnd","lowerBound":0,"upperBound":2,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Connector/connectorEnd"],"hasDerivation":true},
        "interaction": {"name":"interaction","ecoreName":"interaction","kind":"reference","type":"Interaction","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Connector/association","Step/behavior"]},
        "payloadFeature": {"name":"payloadFeature","ecoreName":"payloadFeature","kind":"reference","type":"PayloadFeature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "payloadType": {"name":"payloadType","ecoreName":"payloadType","kind":"reference","type":"Classifier","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "sourceOutputFeature": {"name":"sourceOutputFeature","ecoreName":"sourceOutputFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "targetInputFeature": {"name":"targetInputFeature","ecoreName":"targetInputFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "FlowDefinition": {
        name: "FlowDefinition",
        abstract: false,
        superTypes: ["ActionDefinition","Interaction"],
        features: {
        "flowEnd": {"name":"flowEnd","ecoreName":"flowEnd","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Association/associationEnd"]},
        },
        operations: [],
    },
    "FlowEnd": {
        name: "FlowEnd",
        abstract: false,
        superTypes: ["Feature"],
        features: {
        },
        operations: [],
    },
    "FlowUsage": {
        name: "FlowUsage",
        abstract: false,
        superTypes: ["ConnectorAsUsage","ActionUsage","Flow"],
        features: {
        "flowDefinition": {"name":"flowDefinition","ecoreName":"flowDefinition","kind":"reference","type":"Interaction","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["ActionUsage/actionDefinition","Flow/interaction"]},
        },
        operations: [],
    },
    "ForLoopActionUsage": {
        name: "ForLoopActionUsage",
        abstract: false,
        superTypes: ["LoopActionUsage"],
        features: {
        "loopVariable": {"name":"loopVariable","ecoreName":"loopVariable","kind":"reference","type":"ReferenceUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "seqArgument": {"name":"seqArgument","ecoreName":"seqArgument","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ForkNode": {
        name: "ForkNode",
        abstract: false,
        superTypes: ["ControlNode"],
        features: {
        },
        operations: [],
    },
    "FramedConcernMembership": {
        name: "FramedConcernMembership",
        abstract: false,
        superTypes: ["RequirementConstraintMembership"],
        features: {
        "ownedConcern": {"name":"ownedConcern","ecoreName":"ownedConcern","kind":"reference","type":"ConcernUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementConstraintMembership/ownedConstraint"]},
        "referencedConcern": {"name":"referencedConcern","ecoreName":"referencedConcern","kind":"reference","type":"ConcernUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementConstraintMembership/referencedConstraint"]},
        },
        operations: [],
    },
    "Function": {
        name: "Function",
        abstract: false,
        superTypes: ["Behavior"],
        features: {
        "expression": {"name":"expression","ecoreName":"expression","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/step"]},
        "isModelLevelEvaluable": {"name":"isModelLevelEvaluable","ecoreName":"isModelLevelEvaluable","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true},
        "result": {"name":"result","ecoreName":"result","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/output","Behavior/parameter"],"hasDerivation":true},
        },
        operations: [],
    },
    "IfActionUsage": {
        name: "IfActionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "elseAction": {"name":"elseAction","ecoreName":"elseAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "ifArgument": {"name":"ifArgument","ecoreName":"ifArgument","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "thenAction": {"name":"thenAction","ecoreName":"thenAction","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "Import": {
        name: "Import",
        abstract: true,
        superTypes: ["Relationship"],
        features: {
        "importOwningNamespace": {"name":"importOwningNamespace","ecoreName":"importOwningNamespace","kind":"reference","type":"Namespace","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Namespace/ownedImport","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        "importedElement": {"name":"importedElement","ecoreName":"importedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true},
        "isImportAll": {"name":"isImportAll","ecoreName":"isImportAll","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isRecursive": {"name":"isRecursive","ecoreName":"isRecursive","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "visibility": {"name":"visibility","ecoreName":"visibility","kind":"attribute","type":"VisibilityKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [
        {"name":"importedMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excluded","type":"Namespace","many":true}]},
        ],
    },
    "IncludeUseCaseUsage": {
        name: "IncludeUseCaseUsage",
        abstract: false,
        superTypes: ["UseCaseUsage","PerformActionUsage"],
        features: {
        "useCaseIncluded": {"name":"useCaseIncluded","ecoreName":"useCaseIncluded","kind":"reference","type":"UseCaseUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["PerformActionUsage/performedAction"]},
        },
        operations: [],
    },
    "IndexExpression": {
        name: "IndexExpression",
        abstract: false,
        superTypes: ["OperatorExpression"],
        features: {
        },
        operations: [],
    },
    "InstantiationExpression": {
        name: "InstantiationExpression",
        abstract: true,
        superTypes: ["Expression"],
        features: {
        "argument": {"name":"argument","ecoreName":"argument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true},
        "instantiatedType": {"name":"instantiatedType","ecoreName":"instantiatedType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        },
        operations: [
        {"name":"instantiatedType","type":"Type","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "Interaction": {
        name: "Interaction",
        abstract: false,
        superTypes: ["Association","Behavior"],
        features: {
        },
        operations: [],
    },
    "InterfaceDefinition": {
        name: "InterfaceDefinition",
        abstract: false,
        superTypes: ["ConnectionDefinition"],
        features: {
        "interfaceEnd": {"name":"interfaceEnd","ecoreName":"interfaceEnd","kind":"reference","type":"PortUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["ConnectionDefinition/connectionEnd"]},
        },
        operations: [],
    },
    "InterfaceUsage": {
        name: "InterfaceUsage",
        abstract: false,
        superTypes: ["ConnectionUsage"],
        features: {
        "interfaceDefinition": {"name":"interfaceDefinition","ecoreName":"interfaceDefinition","kind":"reference","type":"InterfaceDefinition","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ConnectionUsage/connectionDefinition"]},
        },
        operations: [],
    },
    "Intersecting": {
        name: "Intersecting",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "intersectingType": {"name":"intersectingType","ecoreName":"intersectingType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "typeIntersected": {"name":"typeIntersected","ecoreName":"typeIntersected","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedIntersecting","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        },
        operations: [],
    },
    "Invariant": {
        name: "Invariant",
        abstract: false,
        superTypes: ["BooleanExpression"],
        features: {
        "isNegated": {"name":"isNegated","ecoreName":"isNegated","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "InvocationExpression": {
        name: "InvocationExpression",
        abstract: false,
        superTypes: ["InstantiationExpression"],
        features: {
        "operand": {"name":"operand","ecoreName":"operand","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":true,"derived":true,"volatile":true},
        },
        operations: [],
    },
    "ItemDefinition": {
        name: "ItemDefinition",
        abstract: false,
        superTypes: ["OccurrenceDefinition","Structure"],
        features: {
        },
        operations: [],
    },
    "ItemUsage": {
        name: "ItemUsage",
        abstract: false,
        superTypes: ["OccurrenceUsage"],
        features: {
        "itemDefinition": {"name":"itemDefinition","ecoreName":"itemDefinition","kind":"reference","type":"Structure","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["OccurrenceUsage/occurrenceDefinition"],"hasDerivation":true},
        },
        operations: [],
    },
    "JoinNode": {
        name: "JoinNode",
        abstract: false,
        superTypes: ["ControlNode"],
        features: {
        },
        operations: [],
    },
    "LibraryPackage": {
        name: "LibraryPackage",
        abstract: false,
        superTypes: ["Package"],
        features: {
        "isStandard": {"name":"isStandard","ecoreName":"isStandard","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "LiteralBoolean": {
        name: "LiteralBoolean",
        abstract: false,
        superTypes: ["LiteralExpression"],
        features: {
        "value": {"name":"value","ecoreName":"value","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "LiteralExpression": {
        name: "LiteralExpression",
        abstract: false,
        superTypes: ["Expression"],
        features: {
        },
        operations: [],
    },
    "LiteralInfinity": {
        name: "LiteralInfinity",
        abstract: false,
        superTypes: ["LiteralExpression"],
        features: {
        },
        operations: [],
    },
    "LiteralInteger": {
        name: "LiteralInteger",
        abstract: false,
        superTypes: ["LiteralExpression"],
        features: {
        "value": {"name":"value","ecoreName":"value","kind":"attribute","type":"EInt","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "LiteralRational": {
        name: "LiteralRational",
        abstract: false,
        superTypes: ["LiteralExpression"],
        features: {
        "value": {"name":"value","ecoreName":"value","kind":"attribute","type":"EDouble","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "LiteralString": {
        name: "LiteralString",
        abstract: false,
        superTypes: ["LiteralExpression"],
        features: {
        "value": {"name":"value","ecoreName":"value","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "LoopActionUsage": {
        name: "LoopActionUsage",
        abstract: true,
        superTypes: ["ActionUsage"],
        features: {
        "bodyAction": {"name":"bodyAction","ecoreName":"bodyAction","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "Membership": {
        name: "Membership",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "memberElement": {"name":"memberElement","ecoreName":"memberElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "memberElementId": {"name":"memberElementId","ecoreName":"memberElementId","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "memberName": {"name":"memberName","ecoreName":"memberName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "memberShortName": {"name":"memberShortName","ecoreName":"memberShortName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "membershipOwningNamespace": {"name":"membershipOwningNamespace","ecoreName":"membershipOwningNamespace","kind":"reference","type":"Namespace","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Namespace/ownedMembership","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        "visibility": {"name":"visibility","ecoreName":"visibility","kind":"attribute","type":"VisibilityKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [
        {"name":"isDistinguishableFrom","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"other","type":"Membership","many":false}],"hasBody":true},
        ],
    },
    "MembershipExpose": {
        name: "MembershipExpose",
        abstract: false,
        superTypes: ["MembershipImport","Expose"],
        features: {
        },
        operations: [],
    },
    "MembershipImport": {
        name: "MembershipImport",
        abstract: false,
        superTypes: ["Import"],
        features: {
        "importedMembership": {"name":"importedMembership","ecoreName":"importedMembership","kind":"reference","type":"Membership","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        },
        operations: [],
    },
    "MergeNode": {
        name: "MergeNode",
        abstract: false,
        superTypes: ["ControlNode"],
        features: {
        },
        operations: [],
    },
    "Metaclass": {
        name: "Metaclass",
        abstract: false,
        superTypes: ["Structure"],
        features: {
        },
        operations: [],
    },
    "MetadataAccessExpression": {
        name: "MetadataAccessExpression",
        abstract: false,
        superTypes: ["Expression"],
        features: {
        "referencedElement": {"name":"referencedElement","ecoreName":"referencedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        },
        operations: [
        {"name":"metaclassFeature","type":"MetadataFeature","lowerBound":1,"upperBound":1,"parameters":[]},
        ],
    },
    "MetadataDefinition": {
        name: "MetadataDefinition",
        abstract: false,
        superTypes: ["ItemDefinition","Metaclass"],
        features: {
        },
        operations: [],
    },
    "MetadataFeature": {
        name: "MetadataFeature",
        abstract: false,
        superTypes: ["Feature","AnnotatingElement"],
        features: {
        "metaclass": {"name":"metaclass","ecoreName":"metaclass","kind":"reference","type":"Metaclass","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Feature/type"],"hasDerivation":true},
        },
        operations: [
        {"name":"evaluateFeature","type":"Element","lowerBound":0,"upperBound":-1,"parameters":[{"name":"baseFeature","type":"Feature","many":false}],"hasBody":true},
        {"name":"isSemantic","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"isSyntactic","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"syntaxElement","type":"Element","lowerBound":0,"upperBound":1,"parameters":[]},
        ],
    },
    "MetadataUsage": {
        name: "MetadataUsage",
        abstract: false,
        superTypes: ["ItemUsage","MetadataFeature"],
        features: {
        "metadataDefinition": {"name":"metadataDefinition","ecoreName":"metadataDefinition","kind":"reference","type":"Metaclass","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ItemUsage/itemDefinition","MetadataFeature/metaclass"]},
        },
        operations: [],
    },
    "Multiplicity": {
        name: "Multiplicity",
        abstract: false,
        superTypes: ["Feature"],
        features: {
        },
        operations: [],
    },
    "MultiplicityRange": {
        name: "MultiplicityRange",
        abstract: false,
        superTypes: ["Multiplicity"],
        features: {
        "bound": {"name":"bound","ecoreName":"bound","kind":"reference","type":"Expression","lowerBound":1,"upperBound":2,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "lowerBound": {"name":"lowerBound","ecoreName":"lowerBound","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["MultiplicityRange/bound"],"hasDerivation":true},
        "upperBound": {"name":"upperBound","ecoreName":"upperBound","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["MultiplicityRange/bound"],"hasDerivation":true},
        },
        operations: [
        {"name":"hasBounds","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"lower","type":"number","many":false},{"name":"upper","type":"number","many":false}],"hasBody":true},
        {"name":"valueOf","type":"number","lowerBound":0,"upperBound":1,"parameters":[{"name":"bound","type":"Expression","many":false}],"hasBody":true},
        ],
    },
    "Namespace": {
        name: "Namespace",
        abstract: false,
        superTypes: ["Element"],
        features: {
        "importedMembership": {"name":"importedMembership","ecoreName":"importedMembership","kind":"reference","type":"Membership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/membership"],"hasDerivation":true},
        "member": {"name":"member","ecoreName":"member","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "membership": {"name":"membership","ecoreName":"membership","kind":"reference","type":"Membership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"union":true},
        "ownedImport": {"name":"ownedImport","ecoreName":"ownedImport","kind":"reference","type":"Import","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Import/importOwningNamespace","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedMember": {"name":"ownedMember","ecoreName":"ownedMember","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Element/owningNamespace","subsets":["Namespace/member"],"hasDerivation":true},
        "ownedMembership": {"name":"ownedMembership","ecoreName":"ownedMembership","kind":"reference","type":"Membership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Membership/membershipOwningNamespace","subsets":["Namespace/membership","Element/ownedRelationship"],"hasDerivation":true},
        },
        operations: [
        {"name":"importedMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excluded","type":"Namespace","many":true}],"hasBody":true},
        {"name":"membershipsOfVisibility","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"visibility","type":"VisibilityKind","many":false},{"name":"excluded","type":"Namespace","many":true}],"hasBody":true},
        {"name":"namesOf","type":"string","lowerBound":0,"upperBound":-1,"parameters":[{"name":"element","type":"Element","many":false}],"hasBody":true},
        {"name":"qualificationOf","type":"string","lowerBound":0,"upperBound":1,"parameters":[{"name":"qualifiedName","type":"string","many":false}]},
        {"name":"resolve","type":"Membership","lowerBound":0,"upperBound":1,"parameters":[{"name":"qualifiedName","type":"string","many":false}],"hasBody":true},
        {"name":"resolveGlobal","type":"Membership","lowerBound":0,"upperBound":1,"parameters":[{"name":"qualifiedName","type":"string","many":false}]},
        {"name":"resolveLocal","type":"Membership","lowerBound":0,"upperBound":1,"parameters":[{"name":"name","type":"string","many":false}],"hasBody":true},
        {"name":"resolveVisible","type":"Membership","lowerBound":0,"upperBound":1,"parameters":[{"name":"name","type":"string","many":false}],"hasBody":true},
        {"name":"unqualifiedNameOf","type":"string","lowerBound":1,"upperBound":1,"parameters":[{"name":"qualifiedName","type":"string","many":false}]},
        {"name":"visibilityOf","type":"VisibilityKind","lowerBound":1,"upperBound":1,"parameters":[{"name":"mem","type":"Membership","many":false}],"hasBody":true},
        {"name":"visibleMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excluded","type":"Namespace","many":true},{"name":"isRecursive","type":"boolean","many":false},{"name":"includeAll","type":"boolean","many":false}],"hasBody":true},
        ],
    },
    "NamespaceExpose": {
        name: "NamespaceExpose",
        abstract: false,
        superTypes: ["NamespaceImport","Expose"],
        features: {
        },
        operations: [],
    },
    "NamespaceImport": {
        name: "NamespaceImport",
        abstract: false,
        superTypes: ["Import"],
        features: {
        "importedNamespace": {"name":"importedNamespace","ecoreName":"importedNamespace","kind":"reference","type":"Namespace","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        },
        operations: [],
    },
    "NullExpression": {
        name: "NullExpression",
        abstract: false,
        superTypes: ["Expression"],
        features: {
        },
        operations: [],
    },
    "ObjectiveMembership": {
        name: "ObjectiveMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "ownedObjectiveRequirement": {"name":"ownedObjectiveRequirement","ecoreName":"ownedObjectiveRequirement","kind":"reference","type":"RequirementUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        },
        operations: [],
    },
    "OccurrenceDefinition": {
        name: "OccurrenceDefinition",
        abstract: false,
        superTypes: ["Definition","Class"],
        features: {
        "isIndividual": {"name":"isIndividual","ecoreName":"isIndividual","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "OccurrenceUsage": {
        name: "OccurrenceUsage",
        abstract: false,
        superTypes: ["Usage"],
        features: {
        "individualDefinition": {"name":"individualDefinition","ecoreName":"individualDefinition","kind":"reference","type":"OccurrenceDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["OccurrenceUsage/occurrenceDefinition"],"hasDerivation":true},
        "isIndividual": {"name":"isIndividual","ecoreName":"isIndividual","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "occurrenceDefinition": {"name":"occurrenceDefinition","ecoreName":"occurrenceDefinition","kind":"reference","type":"Class","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Usage/definition"]},
        "portionKind": {"name":"portionKind","ecoreName":"portionKind","kind":"attribute","type":"PortionKind","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "OperatorExpression": {
        name: "OperatorExpression",
        abstract: false,
        superTypes: ["InvocationExpression"],
        features: {
        "operator": {"name":"operator","ecoreName":"operator","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "OwningMembership": {
        name: "OwningMembership",
        abstract: false,
        superTypes: ["Membership"],
        features: {
        "ownedMemberElement": {"name":"ownedMemberElement","ecoreName":"ownedMemberElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Element/owningMembership","subsets":["Relationship/ownedRelatedElement"],"redefines":["Membership/memberElement"]},
        "ownedMemberElementId": {"name":"ownedMemberElementId","ecoreName":"ownedMemberElementId","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Membership/memberElementId"]},
        "ownedMemberName": {"name":"ownedMemberName","ecoreName":"ownedMemberName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Membership/memberName"],"hasDerivation":true},
        "ownedMemberShortName": {"name":"ownedMemberShortName","ecoreName":"ownedMemberShortName","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Membership/memberShortName"],"hasDerivation":true},
        },
        operations: [],
    },
    "Package": {
        name: "Package",
        abstract: false,
        superTypes: ["Namespace"],
        features: {
        "filterCondition": {"name":"filterCondition","ecoreName":"filterCondition","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        },
        operations: [
        {"name":"includeAsMember","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"element","type":"Element","many":false}],"hasBody":true},
        ],
    },
    "ParameterMembership": {
        name: "ParameterMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "ownedMemberParameter": {"name":"ownedMemberParameter","ecoreName":"ownedMemberParameter","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        },
        operations: [
        {"name":"parameterDirection","type":"FeatureDirectionKind","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "PartDefinition": {
        name: "PartDefinition",
        abstract: false,
        superTypes: ["ItemDefinition"],
        features: {
        },
        operations: [],
    },
    "PartUsage": {
        name: "PartUsage",
        abstract: false,
        superTypes: ["ItemUsage"],
        features: {
        "partDefinition": {"name":"partDefinition","ecoreName":"partDefinition","kind":"reference","type":"PartDefinition","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["ItemUsage/itemDefinition"]},
        },
        operations: [],
    },
    "PayloadFeature": {
        name: "PayloadFeature",
        abstract: false,
        superTypes: ["Feature"],
        features: {
        },
        operations: [],
    },
    "PerformActionUsage": {
        name: "PerformActionUsage",
        abstract: false,
        superTypes: ["ActionUsage","EventOccurrenceUsage"],
        features: {
        "performedAction": {"name":"performedAction","ecoreName":"performedAction","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["EventOccurrenceUsage/eventOccurrence"]},
        },
        operations: [],
    },
    "PortConjugation": {
        name: "PortConjugation",
        abstract: false,
        superTypes: ["Conjugation"],
        features: {
        "conjugatedPortDefinition": {"name":"conjugatedPortDefinition","ecoreName":"conjugatedPortDefinition","kind":"reference","type":"ConjugatedPortDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"ConjugatedPortDefinition/ownedPortConjugator","redefines":["Conjugation/owningType"]},
        "originalPortDefinition": {"name":"originalPortDefinition","ecoreName":"originalPortDefinition","kind":"reference","type":"PortDefinition","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Conjugation/originalType"]},
        },
        operations: [],
    },
    "PortDefinition": {
        name: "PortDefinition",
        abstract: false,
        superTypes: ["OccurrenceDefinition","Structure"],
        features: {
        "conjugatedPortDefinition": {"name":"conjugatedPortDefinition","ecoreName":"conjugatedPortDefinition","kind":"reference","type":"ConjugatedPortDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"ConjugatedPortDefinition/originalPortDefinition","subsets":["Namespace/ownedMember"],"hasDerivation":true},
        },
        operations: [],
    },
    "PortUsage": {
        name: "PortUsage",
        abstract: false,
        superTypes: ["OccurrenceUsage"],
        features: {
        "portDefinition": {"name":"portDefinition","ecoreName":"portDefinition","kind":"reference","type":"PortDefinition","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["OccurrenceUsage/occurrenceDefinition"]},
        },
        operations: [],
    },
    "Predicate": {
        name: "Predicate",
        abstract: false,
        superTypes: ["Function"],
        features: {
        },
        operations: [],
    },
    "Redefinition": {
        name: "Redefinition",
        abstract: false,
        superTypes: ["Subsetting"],
        features: {
        "redefinedFeature": {"name":"redefinedFeature","ecoreName":"redefinedFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Subsetting/subsettedFeature"]},
        "redefiningFeature": {"name":"redefiningFeature","ecoreName":"redefiningFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Subsetting/subsettingFeature"]},
        },
        operations: [],
    },
    "ReferenceSubsetting": {
        name: "ReferenceSubsetting",
        abstract: false,
        superTypes: ["Subsetting"],
        features: {
        "referencedFeature": {"name":"referencedFeature","ecoreName":"referencedFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Subsetting/subsettedFeature"]},
        "referencingFeature": {"name":"referencingFeature","ecoreName":"referencingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedReferenceSubsetting","redefines":["Subsetting/owningFeature","Subsetting/subsettingFeature"]},
        },
        operations: [],
    },
    "ReferenceUsage": {
        name: "ReferenceUsage",
        abstract: false,
        superTypes: ["Usage"],
        features: {
        },
        operations: [],
    },
    "Relationship": {
        name: "Relationship",
        abstract: true,
        superTypes: ["Element"],
        features: {
        "isImplied": {"name":"isImplied","ecoreName":"isImplied","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "ownedRelatedElement": {"name":"ownedRelatedElement","ecoreName":"ownedRelatedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":true,"derived":false,"volatile":false,"opposite":"Element/owningRelationship","subsets":["Relationship/relatedElement"]},
        "owningRelatedElement": {"name":"owningRelatedElement","ecoreName":"owningRelatedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"opposite":"Element/ownedRelationship","subsets":["Relationship/relatedElement"]},
        "relatedElement": {"name":"relatedElement","ecoreName":"relatedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "source": {"name":"source","ecoreName":"source","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":false,"volatile":false,"subsets":["Relationship/relatedElement"]},
        "target": {"name":"target","ecoreName":"target","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":false,"volatile":false,"subsets":["Relationship/relatedElement"]},
        },
        operations: [],
    },
    "RenderingDefinition": {
        name: "RenderingDefinition",
        abstract: false,
        superTypes: ["PartDefinition"],
        features: {
        "rendering": {"name":"rendering","ecoreName":"rendering","kind":"reference","type":"RenderingUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/usage"],"hasDerivation":true},
        },
        operations: [],
    },
    "RenderingUsage": {
        name: "RenderingUsage",
        abstract: false,
        superTypes: ["PartUsage"],
        features: {
        "renderingDefinition": {"name":"renderingDefinition","ecoreName":"renderingDefinition","kind":"reference","type":"RenderingDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["PartUsage/partDefinition"]},
        },
        operations: [],
    },
    "RequirementConstraintMembership": {
        name: "RequirementConstraintMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "kind": {"name":"kind","ecoreName":"kind","kind":"attribute","type":"RequirementConstraintKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "ownedConstraint": {"name":"ownedConstraint","ecoreName":"ownedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        "referencedConstraint": {"name":"referencedConstraint","ecoreName":"referencedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "RequirementDefinition": {
        name: "RequirementDefinition",
        abstract: false,
        superTypes: ["ConstraintDefinition"],
        features: {
        "actorParameter": {"name":"actorParameter","ecoreName":"actorParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/parameter","Definition/usage"],"hasDerivation":true},
        "assumedConstraint": {"name":"assumedConstraint","ecoreName":"assumedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "framedConcern": {"name":"framedConcern","ecoreName":"framedConcern","kind":"reference","type":"ConcernUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["RequirementDefinition/requiredConstraint"],"hasDerivation":true},
        "reqId": {"name":"reqId","ecoreName":"reqId","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Element/declaredShortName"]},
        "requiredConstraint": {"name":"requiredConstraint","ecoreName":"requiredConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "stakeholderParameter": {"name":"stakeholderParameter","ecoreName":"stakeholderParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/parameter","Definition/usage"],"hasDerivation":true},
        "subjectParameter": {"name":"subjectParameter","ecoreName":"subjectParameter","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Behavior/parameter","Definition/usage"],"hasDerivation":true},
        "text": {"name":"text","ecoreName":"text","kind":"attribute","type":"EString","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "RequirementUsage": {
        name: "RequirementUsage",
        abstract: false,
        superTypes: ["ConstraintUsage"],
        features: {
        "actorParameter": {"name":"actorParameter","ecoreName":"actorParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Step/parameter","Usage/usage"],"hasDerivation":true},
        "assumedConstraint": {"name":"assumedConstraint","ecoreName":"assumedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "framedConcern": {"name":"framedConcern","ecoreName":"framedConcern","kind":"reference","type":"ConcernUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["RequirementUsage/requiredConstraint"],"hasDerivation":true},
        "reqId": {"name":"reqId","ecoreName":"reqId","kind":"attribute","type":"EString","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Element/declaredShortName"]},
        "requiredConstraint": {"name":"requiredConstraint","ecoreName":"requiredConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "requirementDefinition": {"name":"requirementDefinition","ecoreName":"requirementDefinition","kind":"reference","type":"RequirementDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ConstraintUsage/constraintDefinition"]},
        "stakeholderParameter": {"name":"stakeholderParameter","ecoreName":"stakeholderParameter","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Step/parameter","Usage/usage"],"hasDerivation":true},
        "subjectParameter": {"name":"subjectParameter","ecoreName":"subjectParameter","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Step/parameter","Usage/usage"],"hasDerivation":true},
        "text": {"name":"text","ecoreName":"text","kind":"attribute","type":"EString","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "RequirementVerificationMembership": {
        name: "RequirementVerificationMembership",
        abstract: false,
        superTypes: ["RequirementConstraintMembership"],
        features: {
        "ownedRequirement": {"name":"ownedRequirement","ecoreName":"ownedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementConstraintMembership/ownedConstraint"]},
        "verifiedRequirement": {"name":"verifiedRequirement","ecoreName":"verifiedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementConstraintMembership/referencedConstraint"]},
        },
        operations: [],
    },
    "ResultExpressionMembership": {
        name: "ResultExpressionMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "ownedResultExpression": {"name":"ownedResultExpression","ecoreName":"ownedResultExpression","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        },
        operations: [],
    },
    "ReturnParameterMembership": {
        name: "ReturnParameterMembership",
        abstract: false,
        superTypes: ["ParameterMembership"],
        features: {
        },
        operations: [],
    },
    "SatisfyRequirementUsage": {
        name: "SatisfyRequirementUsage",
        abstract: false,
        superTypes: ["RequirementUsage","AssertConstraintUsage"],
        features: {
        "satisfiedRequirement": {"name":"satisfiedRequirement","ecoreName":"satisfiedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["AssertConstraintUsage/assertedConstraint"]},
        "satisfyingFeature": {"name":"satisfyingFeature","ecoreName":"satisfyingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "SelectExpression": {
        name: "SelectExpression",
        abstract: false,
        superTypes: ["OperatorExpression"],
        features: {
        },
        operations: [],
    },
    "SendActionUsage": {
        name: "SendActionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "payloadArgument": {"name":"payloadArgument","ecoreName":"payloadArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "receiverArgument": {"name":"receiverArgument","ecoreName":"receiverArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "senderArgument": {"name":"senderArgument","ecoreName":"senderArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "Specialization": {
        name: "Specialization",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "general": {"name":"general","ecoreName":"general","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "owningType": {"name":"owningType","ecoreName":"owningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedSpecialization","subsets":["Relationship/owningRelatedElement","Specialization/specific"]},
        "specific": {"name":"specific","ecoreName":"specific","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        },
        operations: [],
    },
    "StakeholderMembership": {
        name: "StakeholderMembership",
        abstract: false,
        superTypes: ["ParameterMembership"],
        features: {
        "ownedStakeholderParameter": {"name":"ownedStakeholderParameter","ecoreName":"ownedStakeholderParameter","kind":"reference","type":"PartUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ParameterMembership/ownedMemberParameter"]},
        },
        operations: [],
    },
    "StateDefinition": {
        name: "StateDefinition",
        abstract: false,
        superTypes: ["ActionDefinition"],
        features: {
        "doAction": {"name":"doAction","ecoreName":"doAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "entryAction": {"name":"entryAction","ecoreName":"entryAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "exitAction": {"name":"exitAction","ecoreName":"exitAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "isParallel": {"name":"isParallel","ecoreName":"isParallel","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "state": {"name":"state","ecoreName":"state","kind":"reference","type":"StateUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["ActionDefinition/action"],"hasDerivation":true},
        },
        operations: [],
    },
    "StateSubactionMembership": {
        name: "StateSubactionMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "action": {"name":"action","ecoreName":"action","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        "kind": {"name":"kind","ecoreName":"kind","kind":"attribute","type":"StateSubactionKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "StateUsage": {
        name: "StateUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "doAction": {"name":"doAction","ecoreName":"doAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "entryAction": {"name":"entryAction","ecoreName":"entryAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "exitAction": {"name":"exitAction","ecoreName":"exitAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "isParallel": {"name":"isParallel","ecoreName":"isParallel","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "stateDefinition": {"name":"stateDefinition","ecoreName":"stateDefinition","kind":"reference","type":"Behavior","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["ActionUsage/actionDefinition"]},
        },
        operations: [
        {"name":"isSubstateUsage","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"isParallel","type":"boolean","many":false}],"hasBody":true},
        ],
    },
    "Step": {
        name: "Step",
        abstract: false,
        superTypes: ["Feature"],
        features: {
        "behavior": {"name":"behavior","ecoreName":"behavior","kind":"reference","type":"Behavior","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Feature/type"],"hasDerivation":true},
        "parameter": {"name":"parameter","ecoreName":"parameter","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Type/directedFeature"]},
        },
        operations: [],
    },
    "Structure": {
        name: "Structure",
        abstract: false,
        superTypes: ["Class"],
        features: {
        },
        operations: [],
    },
    "Subclassification": {
        name: "Subclassification",
        abstract: false,
        superTypes: ["Specialization"],
        features: {
        "owningClassifier": {"name":"owningClassifier","ecoreName":"owningClassifier","kind":"reference","type":"Classifier","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Classifier/ownedSubclassification","redefines":["Specialization/owningType"]},
        "subclassifier": {"name":"subclassifier","ecoreName":"subclassifier","kind":"reference","type":"Classifier","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/specific"]},
        "superclassifier": {"name":"superclassifier","ecoreName":"superclassifier","kind":"reference","type":"Classifier","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/general"]},
        },
        operations: [],
    },
    "SubjectMembership": {
        name: "SubjectMembership",
        abstract: false,
        superTypes: ["ParameterMembership"],
        features: {
        "ownedSubjectParameter": {"name":"ownedSubjectParameter","ecoreName":"ownedSubjectParameter","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["ParameterMembership/ownedMemberParameter"]},
        },
        operations: [],
    },
    "Subsetting": {
        name: "Subsetting",
        abstract: false,
        superTypes: ["Specialization"],
        features: {
        "owningFeature": {"name":"owningFeature","ecoreName":"owningFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedSubsetting","subsets":["Subsetting/subsettingFeature"],"redefines":["Specialization/owningType"]},
        "subsettedFeature": {"name":"subsettedFeature","ecoreName":"subsettedFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/general"]},
        "subsettingFeature": {"name":"subsettingFeature","ecoreName":"subsettingFeature","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Specialization/specific"]},
        },
        operations: [],
    },
    "Succession": {
        name: "Succession",
        abstract: false,
        superTypes: ["Connector"],
        features: {
        },
        operations: [],
    },
    "SuccessionAsUsage": {
        name: "SuccessionAsUsage",
        abstract: false,
        superTypes: ["ConnectorAsUsage","Succession"],
        features: {
        },
        operations: [],
    },
    "SuccessionFlow": {
        name: "SuccessionFlow",
        abstract: false,
        superTypes: ["Flow","Succession"],
        features: {
        },
        operations: [],
    },
    "SuccessionFlowUsage": {
        name: "SuccessionFlowUsage",
        abstract: false,
        superTypes: ["FlowUsage","SuccessionFlow"],
        features: {
        },
        operations: [],
    },
    "TerminateActionUsage": {
        name: "TerminateActionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "terminatedOccurrenceArgument": {"name":"terminatedOccurrenceArgument","ecoreName":"terminatedOccurrenceArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "TextualRepresentation": {
        name: "TextualRepresentation",
        abstract: false,
        superTypes: ["AnnotatingElement"],
        features: {
        "body": {"name":"body","ecoreName":"body","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "language": {"name":"language","ecoreName":"language","kind":"attribute","type":"EString","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "representedElement": {"name":"representedElement","ecoreName":"representedElement","kind":"reference","type":"Element","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Element/textualRepresentation","subsets":["Element/owner"],"redefines":["AnnotatingElement/annotatedElement"]},
        },
        operations: [],
    },
    "TransitionFeatureMembership": {
        name: "TransitionFeatureMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "kind": {"name":"kind","ecoreName":"kind","kind":"attribute","type":"TransitionFeatureKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "transitionFeature": {"name":"transitionFeature","ecoreName":"transitionFeature","kind":"reference","type":"Step","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        },
        operations: [],
    },
    "TransitionUsage": {
        name: "TransitionUsage",
        abstract: false,
        superTypes: ["ActionUsage"],
        features: {
        "effectAction": {"name":"effectAction","ecoreName":"effectAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"]},
        "guardExpression": {"name":"guardExpression","ecoreName":"guardExpression","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        "source": {"name":"source","ecoreName":"source","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "succession": {"name":"succession","ecoreName":"succession","kind":"reference","type":"Succession","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "target": {"name":"target","ecoreName":"target","kind":"reference","type":"ActionUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "triggerAction": {"name":"triggerAction","ecoreName":"triggerAction","kind":"reference","type":"AcceptActionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Type/ownedFeature"],"hasDerivation":true},
        },
        operations: [
        {"name":"sourceFeature","type":"Feature","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        {"name":"triggerPayloadParameter","type":"ReferenceUsage","lowerBound":0,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "TriggerInvocationExpression": {
        name: "TriggerInvocationExpression",
        abstract: false,
        superTypes: ["InvocationExpression"],
        features: {
        "kind": {"name":"kind","ecoreName":"kind","kind":"attribute","type":"TriggerKind","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        },
        operations: [],
    },
    "Type": {
        name: "Type",
        abstract: false,
        superTypes: ["Namespace"],
        features: {
        "differencingType": {"name":"differencingType","ecoreName":"differencingType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "directedFeature": {"name":"directedFeature","ecoreName":"directedFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        "endFeature": {"name":"endFeature","ecoreName":"endFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        "feature": {"name":"feature","ecoreName":"feature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        "featureMembership": {"name":"featureMembership","ecoreName":"featureMembership","kind":"reference","type":"FeatureMembership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "inheritedFeature": {"name":"inheritedFeature","ecoreName":"inheritedFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        "inheritedMembership": {"name":"inheritedMembership","ecoreName":"inheritedMembership","kind":"reference","type":"Membership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/membership"],"hasDerivation":true},
        "input": {"name":"input","ecoreName":"input","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/directedFeature"],"hasDerivation":true},
        "intersectingType": {"name":"intersectingType","ecoreName":"intersectingType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "isAbstract": {"name":"isAbstract","ecoreName":"isAbstract","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "isConjugated": {"name":"isConjugated","ecoreName":"isConjugated","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true},
        "isSufficient": {"name":"isSufficient","ecoreName":"isSufficient","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "multiplicity": {"name":"multiplicity","ecoreName":"multiplicity","kind":"reference","type":"Multiplicity","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "output": {"name":"output","ecoreName":"output","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/directedFeature"],"hasDerivation":true},
        "ownedConjugator": {"name":"ownedConjugator","ecoreName":"ownedConjugator","kind":"reference","type":"Conjugation","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Conjugation/owningType","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedDifferencing": {"name":"ownedDifferencing","ecoreName":"ownedDifferencing","kind":"reference","type":"Differencing","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Differencing/typeDifferenced","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedDisjoining": {"name":"ownedDisjoining","ecoreName":"ownedDisjoining","kind":"reference","type":"Disjoining","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Disjoining/owningType","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedEndFeature": {"name":"ownedEndFeature","ecoreName":"ownedEndFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/endOwningType","subsets":["Type/endFeature","Type/ownedFeature"],"hasDerivation":true},
        "ownedFeature": {"name":"ownedFeature","ecoreName":"ownedFeature","kind":"reference","type":"Feature","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/owningType","subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "ownedFeatureMembership": {"name":"ownedFeatureMembership","ecoreName":"ownedFeatureMembership","kind":"reference","type":"FeatureMembership","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"FeatureMembership/owningType","subsets":["Namespace/ownedMembership","Type/featureMembership"],"hasDerivation":true},
        "ownedIntersecting": {"name":"ownedIntersecting","ecoreName":"ownedIntersecting","kind":"reference","type":"Intersecting","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Intersecting/typeIntersected","subsets":["Element/ownedRelationship"]},
        "ownedSpecialization": {"name":"ownedSpecialization","ecoreName":"ownedSpecialization","kind":"reference","type":"Specialization","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Specialization/owningType","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "ownedUnioning": {"name":"ownedUnioning","ecoreName":"ownedUnioning","kind":"reference","type":"Unioning","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Unioning/typeUnioned","subsets":["Element/ownedRelationship"],"hasDerivation":true},
        "unioningType": {"name":"unioningType","ecoreName":"unioningType","kind":"reference","type":"Type","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [
        {"name":"allRedefinedFeaturesOf","type":"Feature","lowerBound":0,"upperBound":-1,"parameters":[{"name":"membership","type":"Membership","many":false}],"hasBody":true},
        {"name":"allSupertypes","type":"Type","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        {"name":"directionOf","type":"FeatureDirectionKind","lowerBound":0,"upperBound":1,"parameters":[{"name":"feature","type":"Feature","many":false}],"hasBody":true},
        {"name":"directionOfExcluding","type":"FeatureDirectionKind","lowerBound":0,"upperBound":1,"parameters":[{"name":"feature","type":"Feature","many":false},{"name":"excluded","type":"Type","many":true}],"hasBody":true},
        {"name":"inheritableMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excludedNamespaces","type":"Namespace","many":true},{"name":"excludedTypes","type":"Type","many":true},{"name":"excludeImplied","type":"boolean","many":false}],"hasBody":true},
        {"name":"inheritedMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excludedNamespaces","type":"Namespace","many":true},{"name":"excludedTypes","type":"Type","many":true},{"name":"excludeImplied","type":"boolean","many":false}],"hasBody":true},
        {"name":"isCompatibleWith","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"otherType","type":"Type","many":false}],"hasBody":true},
        {"name":"multiplicities","type":"Multiplicity","lowerBound":0,"upperBound":-1,"parameters":[],"hasBody":true},
        {"name":"nonPrivateMemberships","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excludedNamespaces","type":"Namespace","many":true},{"name":"excludedTypes","type":"Type","many":true},{"name":"excludeImplied","type":"boolean","many":false}],"hasBody":true},
        {"name":"removeRedefinedFeatures","type":"Membership","lowerBound":0,"upperBound":-1,"parameters":[{"name":"memberships","type":"Membership","many":true}],"hasBody":true},
        {"name":"specializes","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"supertype","type":"Type","many":false}],"hasBody":true},
        {"name":"specializesFromLibrary","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"libraryTypeName","type":"string","many":false}],"hasBody":true},
        {"name":"supertypes","type":"Type","lowerBound":0,"upperBound":-1,"parameters":[{"name":"excludeImplied","type":"boolean","many":false}],"hasBody":true},
        ],
    },
    "TypeFeaturing": {
        name: "TypeFeaturing",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "featureOfType": {"name":"featureOfType","ecoreName":"featureOfType","kind":"reference","type":"Feature","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/source"]},
        "featuringType": {"name":"featuringType","ecoreName":"featuringType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        "owningFeatureOfType": {"name":"owningFeatureOfType","ecoreName":"owningFeatureOfType","kind":"reference","type":"Feature","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Feature/ownedTypeFeaturing","subsets":["Relationship/owningRelatedElement","TypeFeaturing/featureOfType"]},
        },
        operations: [],
    },
    "Unioning": {
        name: "Unioning",
        abstract: false,
        superTypes: ["Relationship"],
        features: {
        "typeUnioned": {"name":"typeUnioned","ecoreName":"typeUnioned","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Type/ownedUnioning","subsets":["Relationship/owningRelatedElement"],"redefines":["Relationship/source"]},
        "unioningType": {"name":"unioningType","ecoreName":"unioningType","kind":"reference","type":"Type","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false,"redefines":["Relationship/target"]},
        },
        operations: [],
    },
    "Usage": {
        name: "Usage",
        abstract: false,
        superTypes: ["Feature"],
        features: {
        "definition": {"name":"definition","ecoreName":"definition","kind":"reference","type":"Classifier","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"redefines":["Feature/type"]},
        "directedUsage": {"name":"directedUsage","ecoreName":"directedUsage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/directedFeature","Usage/usage"],"hasDerivation":true},
        "isReference": {"name":"isReference","ecoreName":"isReference","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "isVariation": {"name":"isVariation","ecoreName":"isVariation","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":false,"volatile":false},
        "mayTimeVary": {"name":"mayTimeVary","ecoreName":"mayTimeVary","kind":"attribute","type":"EBoolean","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["Feature/isVariable"],"hasDerivation":true},
        "nestedAction": {"name":"nestedAction","ecoreName":"nestedAction","kind":"reference","type":"ActionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedOccurrence"],"hasDerivation":true},
        "nestedAllocation": {"name":"nestedAllocation","ecoreName":"nestedAllocation","kind":"reference","type":"AllocationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedConnection"],"hasDerivation":true},
        "nestedAnalysisCase": {"name":"nestedAnalysisCase","ecoreName":"nestedAnalysisCase","kind":"reference","type":"AnalysisCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedCase"],"hasDerivation":true},
        "nestedAttribute": {"name":"nestedAttribute","ecoreName":"nestedAttribute","kind":"reference","type":"AttributeUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedCalculation": {"name":"nestedCalculation","ecoreName":"nestedCalculation","kind":"reference","type":"CalculationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedAction"],"hasDerivation":true},
        "nestedCase": {"name":"nestedCase","ecoreName":"nestedCase","kind":"reference","type":"CaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedCalculation"],"hasDerivation":true},
        "nestedConcern": {"name":"nestedConcern","ecoreName":"nestedConcern","kind":"reference","type":"ConcernUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedRequirement"],"hasDerivation":true},
        "nestedConnection": {"name":"nestedConnection","ecoreName":"nestedConnection","kind":"reference","type":"ConnectorAsUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedConstraint": {"name":"nestedConstraint","ecoreName":"nestedConstraint","kind":"reference","type":"ConstraintUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedOccurrence"],"hasDerivation":true},
        "nestedEnumeration": {"name":"nestedEnumeration","ecoreName":"nestedEnumeration","kind":"reference","type":"EnumerationUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedAttribute"]},
        "nestedFlow": {"name":"nestedFlow","ecoreName":"nestedFlow","kind":"reference","type":"FlowUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedConnection"],"hasDerivation":true},
        "nestedInterface": {"name":"nestedInterface","ecoreName":"nestedInterface","kind":"reference","type":"InterfaceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedConnection"],"hasDerivation":true},
        "nestedItem": {"name":"nestedItem","ecoreName":"nestedItem","kind":"reference","type":"ItemUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedOccurrence"],"hasDerivation":true},
        "nestedMetadata": {"name":"nestedMetadata","ecoreName":"nestedMetadata","kind":"reference","type":"MetadataUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedItem"],"hasDerivation":true},
        "nestedOccurrence": {"name":"nestedOccurrence","ecoreName":"nestedOccurrence","kind":"reference","type":"OccurrenceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedPart": {"name":"nestedPart","ecoreName":"nestedPart","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedItem"],"hasDerivation":true},
        "nestedPort": {"name":"nestedPort","ecoreName":"nestedPort","kind":"reference","type":"PortUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedReference": {"name":"nestedReference","ecoreName":"nestedReference","kind":"reference","type":"ReferenceUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedRendering": {"name":"nestedRendering","ecoreName":"nestedRendering","kind":"reference","type":"RenderingUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedPart"],"hasDerivation":true},
        "nestedRequirement": {"name":"nestedRequirement","ecoreName":"nestedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedConstraint"],"hasDerivation":true},
        "nestedState": {"name":"nestedState","ecoreName":"nestedState","kind":"reference","type":"StateUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedAction"],"hasDerivation":true},
        "nestedTransition": {"name":"nestedTransition","ecoreName":"nestedTransition","kind":"reference","type":"TransitionUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedUsage"],"hasDerivation":true},
        "nestedUsage": {"name":"nestedUsage","ecoreName":"nestedUsage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"opposite":"Usage/owningUsage","subsets":["Type/ownedFeature","Usage/usage"],"hasDerivation":true},
        "nestedUseCase": {"name":"nestedUseCase","ecoreName":"nestedUseCase","kind":"reference","type":"UseCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedCase"],"hasDerivation":true},
        "nestedVerificationCase": {"name":"nestedVerificationCase","ecoreName":"nestedVerificationCase","kind":"reference","type":"VerificationCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedCase"],"hasDerivation":true},
        "nestedView": {"name":"nestedView","ecoreName":"nestedView","kind":"reference","type":"ViewUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedPart"],"hasDerivation":true},
        "nestedViewpoint": {"name":"nestedViewpoint","ecoreName":"nestedViewpoint","kind":"reference","type":"ViewpointUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedRequirement"],"hasDerivation":true},
        "owningDefinition": {"name":"owningDefinition","ecoreName":"owningDefinition","kind":"reference","type":"Definition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Definition/ownedUsage","subsets":["Feature/owningType"]},
        "owningUsage": {"name":"owningUsage","ecoreName":"owningUsage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"opposite":"Usage/nestedUsage","subsets":["Feature/owningType"]},
        "usage": {"name":"usage","ecoreName":"usage","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Type/feature"],"hasDerivation":true},
        "variant": {"name":"variant","ecoreName":"variant","kind":"reference","type":"Usage","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "variantMembership": {"name":"variantMembership","ecoreName":"variantMembership","kind":"reference","type":"VariantMembership","lowerBound":0,"upperBound":-1,"many":true,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMembership"],"hasDerivation":true},
        },
        operations: [
        {"name":"referencedFeatureTarget","type":"Feature","lowerBound":1,"upperBound":1,"parameters":[],"hasBody":true},
        ],
    },
    "UseCaseDefinition": {
        name: "UseCaseDefinition",
        abstract: false,
        superTypes: ["CaseDefinition"],
        features: {
        "includedUseCase": {"name":"includedUseCase","ecoreName":"includedUseCase","kind":"reference","type":"UseCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "UseCaseUsage": {
        name: "UseCaseUsage",
        abstract: false,
        superTypes: ["CaseUsage"],
        features: {
        "includedUseCase": {"name":"includedUseCase","ecoreName":"includedUseCase","kind":"reference","type":"UseCaseUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "useCaseDefinition": {"name":"useCaseDefinition","ecoreName":"useCaseDefinition","kind":"reference","type":"UseCaseDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["CaseUsage/caseDefinition"]},
        },
        operations: [],
    },
    "VariantMembership": {
        name: "VariantMembership",
        abstract: false,
        superTypes: ["OwningMembership"],
        features: {
        "ownedVariantUsage": {"name":"ownedVariantUsage","ecoreName":"ownedVariantUsage","kind":"reference","type":"Usage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["OwningMembership/ownedMemberElement"]},
        },
        operations: [],
    },
    "VerificationCaseDefinition": {
        name: "VerificationCaseDefinition",
        abstract: false,
        superTypes: ["CaseDefinition"],
        features: {
        "verifiedRequirement": {"name":"verifiedRequirement","ecoreName":"verifiedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "VerificationCaseUsage": {
        name: "VerificationCaseUsage",
        abstract: false,
        superTypes: ["CaseUsage"],
        features: {
        "verificationCaseDefinition": {"name":"verificationCaseDefinition","ecoreName":"verificationCaseDefinition","kind":"reference","type":"VerificationCaseDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"subsets":["CaseUsage/caseDefinition"]},
        "verifiedRequirement": {"name":"verifiedRequirement","ecoreName":"verifiedRequirement","kind":"reference","type":"RequirementUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ViewDefinition": {
        name: "ViewDefinition",
        abstract: false,
        superTypes: ["PartDefinition"],
        features: {
        "satisfiedViewpoint": {"name":"satisfiedViewpoint","ecoreName":"satisfiedViewpoint","kind":"reference","type":"ViewpointUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/ownedRequirement"],"hasDerivation":true},
        "view": {"name":"view","ecoreName":"view","kind":"reference","type":"ViewUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Definition/usage"],"hasDerivation":true},
        "viewCondition": {"name":"viewCondition","ecoreName":"viewCondition","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "viewRendering": {"name":"viewRendering","ecoreName":"viewRendering","kind":"reference","type":"RenderingUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ViewRenderingMembership": {
        name: "ViewRenderingMembership",
        abstract: false,
        superTypes: ["FeatureMembership"],
        features: {
        "ownedRendering": {"name":"ownedRendering","ecoreName":"ownedRendering","kind":"reference","type":"RenderingUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["FeatureMembership/ownedMemberFeature"]},
        "referencedRendering": {"name":"referencedRendering","ecoreName":"referencedRendering","kind":"reference","type":"RenderingUsage","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ViewUsage": {
        name: "ViewUsage",
        abstract: false,
        superTypes: ["PartUsage"],
        features: {
        "exposedElement": {"name":"exposedElement","ecoreName":"exposedElement","kind":"reference","type":"Element","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/member"],"hasDerivation":true},
        "satisfiedViewpoint": {"name":"satisfiedViewpoint","ecoreName":"satisfiedViewpoint","kind":"reference","type":"ViewpointUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Usage/nestedRequirement"],"hasDerivation":true},
        "viewCondition": {"name":"viewCondition","ecoreName":"viewCondition","kind":"reference","type":"Expression","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"subsets":["Namespace/ownedMember"],"hasDerivation":true},
        "viewDefinition": {"name":"viewDefinition","ecoreName":"viewDefinition","kind":"reference","type":"ViewDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["PartUsage/partDefinition"]},
        "viewRendering": {"name":"viewRendering","ecoreName":"viewRendering","kind":"reference","type":"RenderingUsage","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [
        {"name":"includeAsExposed","type":"boolean","lowerBound":1,"upperBound":1,"parameters":[{"name":"element","type":"Element","many":false}],"hasBody":true},
        ],
    },
    "ViewpointDefinition": {
        name: "ViewpointDefinition",
        abstract: false,
        superTypes: ["RequirementDefinition"],
        features: {
        "viewpointStakeholder": {"name":"viewpointStakeholder","ecoreName":"viewpointStakeholder","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "ViewpointUsage": {
        name: "ViewpointUsage",
        abstract: false,
        superTypes: ["RequirementUsage"],
        features: {
        "viewpointDefinition": {"name":"viewpointDefinition","ecoreName":"viewpointDefinition","kind":"reference","type":"ViewpointDefinition","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"redefines":["RequirementUsage/requirementDefinition"]},
        "viewpointStakeholder": {"name":"viewpointStakeholder","ecoreName":"viewpointStakeholder","kind":"reference","type":"PartUsage","lowerBound":0,"upperBound":-1,"many":true,"ordered":true,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
    "WhileLoopActionUsage": {
        name: "WhileLoopActionUsage",
        abstract: false,
        superTypes: ["LoopActionUsage"],
        features: {
        "untilArgument": {"name":"untilArgument","ecoreName":"untilArgument","kind":"reference","type":"Expression","lowerBound":0,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        "whileArgument": {"name":"whileArgument","ecoreName":"whileArgument","kind":"reference","type":"Expression","lowerBound":1,"upperBound":1,"many":false,"ordered":false,"containment":false,"derived":true,"volatile":true,"hasDerivation":true},
        },
        operations: [],
    },
};

/** Every metaclass name, in metamodel order. */
export const SYSML_METACLASS_NAMES: readonly string[] = Object.keys(SYSML_METACLASSES);

/**
 * Declared features of one metaclass, excluding inherited ones.
 *
 * Kept as a function rather than a second table so there is exactly one place
 * the generated shape is read from.
 */
export function declaredFeatures(metaclass: string): FeatureDescriptor[] {
    return Object.values(SYSML_METACLASSES[metaclass]?.features ?? {});
}

/** Declared and inherited features, nearest declaration winning on name. */
export function allFeatures(metaclass: string): FeatureDescriptor[] {
    const seen = new Map<string, FeatureDescriptor>();
    const visit = (name: string): void => {
        const descriptor = SYSML_METACLASSES[name];
        if (!descriptor) return;
        for (const feature of Object.values(descriptor.features)) {
            if (!seen.has(feature.name)) seen.set(feature.name, feature);
        }
        for (const superType of descriptor.superTypes) visit(superType);
    };
    visit(metaclass);
    return [...seen.values()];
}

/** Transitive supertypes of `metaclass`, nearest first, excluding itself. */
export function allSuperTypes(metaclass: string): string[] {
    const out: string[] = [];
    const queue = [...(SYSML_METACLASSES[metaclass]?.superTypes ?? [])];
    while (queue.length > 0) {
        const name = queue.shift() as string;
        if (out.includes(name)) continue;
        out.push(name);
        queue.push(...(SYSML_METACLASSES[name]?.superTypes ?? []));
    }
    return out;
}

/** Whether `metaclass` is, or specializes, `superType`. */
export function conformsTo(metaclass: string, superType: string): boolean {
    return metaclass === superType || allSuperTypes(metaclass).includes(superType);
}

/** Counts asserted by the emitter against Session 0's measurement. */
export const SYSML_METAMODEL_COUNTS = {"metaclasses":175,"enums":7,"features":415,"derived":328,"opposites":70,"operations":70,"subsets":190,"redefines":119,"union":1,"derivations":225} as const;
