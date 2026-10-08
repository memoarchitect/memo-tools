// ─── Native Constraint Loader (Epic EE-3) ─────────────────────────────────────
//
// Compiles the native `constraint def` / `requirement def` declarations a stage 1
// handoff states (`collectApiConstraints`) and compiles each `require`/`assert constraint { … }` body into
// an evaluator AST. Rules can use a directly parseable KerML body, or keep a
// portable `true` body and provide `predicateExpression` for MEMO semantic-model
// navigation. Model-level coverage targets are compiled into extent predicates.
//
// Rule metadata travels as plain attribute members inside the def body:
//   constraint def hazardNeedsMitigation {
//       attribute id = "CR-MED-001";
//       attribute appliesTo = "Hazard";
//       attribute severity = RuleSeverityKind::error;
//       attribute rationaleText = "ISO 14971 requires risk control for each hazard.";
//       require constraint { mitigatesHazard->size() >= 1 }
//   }
// ──────────────────────────────────────────────────────────────────────────────

import type { CompiledConstraint, ConstraintNode, RuleDomain, RuleObligation } from './constraint-eval.js';
import { parseConstraintExpression } from './constraint-eval.js';

/** A rule that could not be loaded, or that conflicts with another rule. */
export interface ConstraintDiagnostic {
    kind: 'compile-failed' | 'duplicate-id';
    ruleId: string;
    file: string;
    message: string;
}

/** The rule's domain, or undefined when it states none (an enumeration literal as `Kind::member` or the bare member). */
export function mapDomain(raw?: string): RuleDomain | undefined {
    const member = raw?.includes('::') ? raw.slice(raw.lastIndexOf('::') + 2) : raw;
    return member === 'modelling' || member === 'medicalDevice' || member === 'organisation' ? member : undefined;
}

/** The rule's obligation, or undefined when it states none (`Kind::member` or the bare member). */
export function mapObligation(raw?: string): RuleObligation | undefined {
    const member = raw?.includes('::') ? raw.slice(raw.lastIndexOf('::') + 2) : raw;
    return member === 'required' || member === 'recommended' || member === 'bestPractice' ? member : undefined;
}

/** What a rule that states no severity takes from its obligation. */
const OBLIGATION_SEVERITY = { required: 'error', recommended: 'warning', bestPractice: 'info' } as const;

function mapTailoring(raw?: string): 'invariant' | 'assurance' | 'methodology' {
    // A rule with no declared class is treated as `assurance`: tailorable with
    // rationale. Defaulting to `invariant` would silently make every
    // unclassified rule untailorable, which is the harder failure to notice.
    return raw === 'invariant' || raw === 'methodology' ? raw : 'assurance';
}


/**
 * The authored identifier of a definition.
 *
 * `providedId` is where hand-authored ids live since the identification core
 * moved onto `@MemoIdentity`; `id` is the pre-migration spelling and is still
 * read so a project on the older ontology keeps working. A rule with neither
 * does not compile — silently, which is why this is one function and not an
 * inline lookup repeated at each call site.
 */
function authoredId(attrs: Record<string, string>): string | undefined {
    return attrs['providedId'] || attrs['id'] || undefined;
}

/**
 * What a rule definition states, however it was read: from MEMO's parse
 * (`collectNativeConstraints`) or from stage 1's API JSON
 * (`collectApiConstraints`). Both compile through `compileRuleDefinition`, so
 * the two paths cannot drift apart.
 */
export interface RuleDefinitionParts {
    typeName: string;
    /** Attribute values, an enumeration literal as its bare member name (`error`). */
    attrs: Record<string, string>;
    doc?: string;
    file?: string;
    /** The boolean body, in evaluator form; absent when the definition states none. */
    body?: ConstraintNode;
    /** Qualified names of the clauses the rule enforces, when the reader found them. */
    enforces?: string[];
}

/** Compile one rule definition, or undefined when it is no rule (no id, no body or coverage target). */
export function compileRuleDefinition(parts: RuleDefinitionParts): CompiledConstraint | undefined {
    const { attrs } = parts;
    const id = authoredId(attrs);
    if (!id) return undefined;

    let ast: ConstraintNode;
    let appliesToKind = attrs['appliesTo'] ?? '';
    if (parts.body) {
        ast = parts.body;
        if (ast.kind === 'bool' && ast.value && attrs['predicateExpression'] && attrs['evaluator'] !== 'architecture') {
            // Portable constraint bodies remain `true` where SysML tools cannot
            // resolve MEMO's semantic-model navigation. The executable predicate
            // is still ontology-owned and is compiled here.
            try {
                ast = parseConstraintExpression(attrs['predicateExpression']);
            } catch (error) {
                throw new Error(`Cannot compile predicateExpression for ${id} (${JSON.stringify(attrs['predicateExpression'])}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    } else if (attrs['coverageTarget']) {
        const target = parseScope(attrs['coverageTarget']);
        const filter = target.attribute
            ? `->exists(attributes.${target.attribute} == "${target.value}")`
            : '->notEmpty()';
        ast = parseConstraintExpression(`allOfKind("${target.kind}")${filter}`);
        appliesToKind = 'Model';
    } else {
        return undefined;
    }

    return {
        id,
        // Native `doc` first: the bases stopped declaring `description`, so a
        // rule written today states its prose as a doc comment. `description`
        // stays ahead of `rationaleText` for a rule that still carries the old
        // attribute — a rationale is why the rule exists, not what it checks,
        // and it is the last resort rather than an equivalent.
        description: parts.doc || attrs['description'] || attrs['rationaleText'] || id,
        appliesToKind,
        severity: mapSeverity(attrs['severity'], mapObligation(attrs['obligation'])),
        evaluator: attrs['evaluator'] || undefined,
        typeName: parts.typeName,
        tailoring: mapTailoring(attrs['tailoring']),
        sourceFile: parts.file,
        ...(mapDomain(attrs['domain']) ? { domain: mapDomain(attrs['domain']) } : {}),
        ...(mapObligation(attrs['obligation']) ? { obligation: mapObligation(attrs['obligation']) } : {}),
        ...(parts.enforces && parts.enforces.length > 0 ? { enforces: parts.enforces } : {}),
        ast,
    };
}

function parseScope(scope: string): { kind: string; attribute?: string; value?: string } {
    const match = /^([A-Za-z_]\w*)(?:\[([A-Za-z_]\w*)=([^\]]+)\])?$/.exec(scope);
    if (!match) throw new Error(`Unsupported coverage target '${scope}'.`);
    return { kind: match[1], attribute: match[2], value: match[3] };
}

function mapSeverity(severity?: string, obligation?: RuleObligation): 'error' | 'warning' | 'info' {
    if (severity === 'error' || severity === 'warning' || severity === 'info') return severity;
    return obligation ? OBLIGATION_SEVERITY[obligation] : 'warning';
}
