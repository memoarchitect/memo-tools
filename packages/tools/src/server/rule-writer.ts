// ─── Rule writer ─────────────────────────────────────────────────────────────
//
// Turn a rule a user designed into the `constraint def` that states it, and
// say what it would flag before it is saved.
//
// The editor names what the rule applies to, the condition, the severity, the
// rationale and the clauses it enforces; this renders the SysML. The browser
// never composes model source (design 18.4), so a rule authored in a form and
// one typed in a text editor are the same construct in the same file, subject
// to the same checks. The refusals are enforced here, not in the form: a check
// in a React component is a suggestion, because the message can come from
// anywhere. A user's own rule is an `organisation` rule.
// (plans/memo-rules-domain-trace-and-editor.md)
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateConstraintSubjects, parseConstraintExpression } from '../validator/constraint-eval.js';
import type { ClauseFact } from '../validator/rule-clauses.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type { MemoModel } from '../model/semantic.js';
import { appendToLastPackage } from './persistor.js';

export interface NewRuleRequest {
    /** The rule's durable id, e.g. `ORG-001`. */
    id: string;
    /** The `constraint def` name, which a policy references. */
    typeName: string;
    /** The kind the rule is checked on (`Hazard`, `Requirement[requirementType=system]`, `Model`). */
    appliesTo: string;
    /** The condition, in the rule expression language. True means the element is fine. */
    predicateExpression: string;
    severity: 'error' | 'warning' | 'info';
    rationaleText: string;
    /** Default `methodology`: a methodology may tailor a user's rule. */
    tailoring?: 'assurance' | 'methodology';
    /** Qualified names of the clauses the rule enforces. Optional for a user's rule. */
    enforces?: string[];
    /** Project-relative `.sysml` file the rule is written into. */
    file: string;
}

export interface NewRuleContext {
    existingIds: ReadonlySet<string>;
    existingTypeNames: ReadonlySet<string>;
    /** Every kind name the project resolves; absent when the compiler does not state them. */
    kindNames?: ReadonlySet<string>;
    clauses: readonly ClauseFact[];
}

export interface NewRuleRefusal {
    code:
        | 'bad-id' | 'duplicate-id' | 'bad-type-name' | 'duplicate-type-name'
        | 'unknown-kind' | 'invalid-predicate' | 'missing-rationale' | 'bad-severity'
        | 'unknown-clause' | 'bad-file' | 'bad-tailoring';
    message: string;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** Check a new rule against the project. Returns the refusal rather than throwing, so a form can show it. */
export function checkNewRule(request: NewRuleRequest, context: NewRuleContext): NewRuleRefusal | undefined {
    if (!IDENTIFIER.test(request.id)) {
        return { code: 'bad-id', message: `"${request.id}" is not a rule id: start with a letter, then letters, digits, "-" or "_".` };
    }
    if (context.existingIds.has(request.id)) {
        return { code: 'duplicate-id', message: `A rule with id ${request.id} already exists. A rule's id is its audit identity and must be unique.` };
    }
    if (!TYPE_NAME.test(request.typeName)) {
        return { code: 'bad-type-name', message: `"${request.typeName}" is not a definition name: start with a capital, then letters and digits.` };
    }
    if (context.existingTypeNames.has(request.typeName)) {
        return { code: 'duplicate-type-name', message: `A definition named ${request.typeName} already exists. A name must resolve to exactly one type.` };
    }
    const kind = request.appliesTo.replace(/\[.*\]$/, '').trim();
    if (!kind || (kind !== 'Model' && context.kindNames && !context.kindNames.has(kind))) {
        return { code: 'unknown-kind', message: `"${kind}" is not a kind this project resolves, and not "Model".` };
    }
    if (!['error', 'warning', 'info'].includes(request.severity)) {
        return { code: 'bad-severity', message: `Severity must be error, warning or info, not "${request.severity}".` };
    }
    if (request.tailoring !== undefined && !['assurance', 'methodology'].includes(request.tailoring)) {
        return { code: 'bad-tailoring', message: `Tailoring must be assurance or methodology, not "${request.tailoring}". An invariant is the ontology's own, not a user's.` };
    }
    if (!request.rationaleText.trim()) {
        return { code: 'missing-rationale', message: 'A rule needs a written rationale: why it exists is what a reviewer reads.' };
    }
    try {
        parseConstraintExpression(request.predicateExpression);
    } catch (error) {
        return { code: 'invalid-predicate', message: `The condition does not parse: ${error instanceof Error ? error.message : String(error)}` };
    }
    const known = new Set(context.clauses.map(c => c.qualifiedName));
    for (const clause of request.enforces ?? []) {
        if (!known.has(clause)) {
            return { code: 'unknown-clause', message: `${clause} is not a clause this project's standards carry.` };
        }
    }
    if (!/\.sysml$/.test(request.file) || request.file.split(/[\\/]/).includes('..') || request.file.startsWith('/')) {
        return { code: 'bad-file', message: `"${request.file}" must be a project-relative .sysml file.` };
    }
    return undefined;
}

/**
 * Resolve what a person typed to a clause: the qualified name, or
 * `<designation> §<number>` (any unambiguous part of the designation will do,
 * `62304 §5.2`). Undefined when it names none or several.
 */
export function resolveClauseReference(clauses: readonly ClauseFact[], text: string): ClauseFact | undefined {
    const exact = clauses.find(c => c.qualifiedName === text.trim());
    if (exact) return exact;
    const match = /^(.*?)\s*§\s*(\S+)$/.exec(text.trim());
    if (!match) return undefined;
    const [, standard, number] = match;
    const found = clauses.filter(c => c.clauseNumber === number && c.standard.toLowerCase().includes(standard.toLowerCase()));
    return found.length === 1 ? found[0] : undefined;
}

/** A clause's qualified name as the dotted path a rule writes, and the package it needs imported. */
function clausePath(qualifiedName: string): { importPackage: string; path: string } {
    const [importPackage, ...rest] = qualifiedName.split('::');
    return { importPackage, path: rest.join('.') };
}

/** The `constraint def` for a rule, and the imports it needs. */
export function renderRule(request: NewRuleRequest, indent = '    '): { imports: string[]; text: string } {
    const imports = [
        'memo_core_consistency_rules::*',
        'memo_core_enumerations::*',
        'memo_core_common::MemoIdentity',
    ];
    const lines = [
        `${indent}constraint def ${request.typeName} :> MemoConsistencyRule {`,
        `${indent}    @MemoIdentity { :>> providedId = ${JSON.stringify(request.id)}; }`,
        `${indent}    attribute tailoring = RuleTailoringKind::${request.tailoring ?? 'methodology'};`,
        `${indent}    attribute domain = RuleDomainKind::organisation;`,
        `${indent}    attribute appliesTo = ${JSON.stringify(request.appliesTo)};`,
        `${indent}    attribute severity = RuleSeverityKind::${request.severity};`,
        `${indent}    attribute rationaleText = ${JSON.stringify(request.rationaleText)};`,
        `${indent}    attribute predicateExpression = ${JSON.stringify(request.predicateExpression)};`,
    ];
    const clauses = (request.enforces ?? []).map(clausePath);
    if (clauses.length > 0) {
        imports.push('memo_artifacts_standards_traceability::StandardClause');
        for (const { importPackage } of clauses) imports.push(`${importPackage}::*`);
        const value = clauses.length === 1 ? clauses[0].path : `(${clauses.map(c => c.path).join(', ')})`;
        lines.push(`${indent}    ref enforces : StandardClause[1..*] = ${value};`);
    }
    lines.push(`${indent}    constraint { true }`, `${indent}}`);
    return { imports: [...new Set(imports)], text: lines.join('\n') };
}

/**
 * Add the rule to a file's last package, with the imports it needs that the
 * file does not already state. Returns undefined when the file declares no
 * package, so the caller reports it instead of writing a rule into open space.
 */
export function insertRule(source: string, request: NewRuleRequest): string | undefined {
    if (!/\bpackage\s+\w+\s*\{/.test(source)) return undefined;
    const { imports, text } = renderRule(request, '');
    const missing = imports.filter(name => !source.includes(`import ${name};`));
    const block = [...missing.map(name => `private import ${name};`), text].join('\n');
    return appendToLastPackage(source, `\n${block}`);
}

// ─── Dry run ─────────────────────────────────────────────────────────────────

export interface DryRunResult {
    /** How many elements the rule is checked on. */
    subjects: number;
    /** The elements it would flag. */
    flagged: { elementId: string; elementKind: string; elementName: string }[];
}

/**
 * What a rule would flag in the model as it stands, without saving it. Uses the
 * evaluator `memo validate` uses, so the answer is the one the saved rule gives.
 */
export function dryRunRule(
    rule: Pick<NewRuleRequest, 'appliesTo' | 'predicateExpression' | 'severity'>,
    model: MemoModel,
    kindRegistry?: KindRegistry,
): DryRunResult {
    const ast = parseConstraintExpression(rule.predicateExpression);
    const { violations, subjectCount } = evaluateConstraintSubjects({
        id: 'DRY-RUN',
        description: 'dry run',
        appliesToKind: rule.appliesTo,
        severity: rule.severity,
    }, ast, model, kindRegistry);
    return {
        subjects: subjectCount,
        flagged: violations.map(v => ({ elementId: v.elementId, elementKind: v.elementKind, elementName: v.elementName })),
    };
}

// ─── Conditions ──────────────────────────────────────────────────────────────

/**
 * What a form asks for. The server turns it into the rule expression, so the
 * browser never writes the language; `expression` is the way out for anything
 * the three shapes do not say.
 */
export type ConditionSpec =
    | { kind: 'atLeast' | 'atMost'; relation: string; count: number }
    | { kind: 'attributeSet'; attribute: string }
    | { kind: 'expression'; expression: string };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The expression a condition stands for. Throws on a name or count that is not one. */
export function conditionExpression(spec: ConditionSpec): string {
    switch (spec.kind) {
        case 'atLeast':
        case 'atMost':
            if (!NAME.test(spec.relation)) throw new Error(`"${spec.relation}" is not a relation name.`);
            if (!Number.isInteger(spec.count) || spec.count < 0) throw new Error('The count must be a whole number, zero or more.');
            return `${spec.relation}->size() ${spec.kind === 'atLeast' ? '>=' : '<='} ${spec.count}`;
        case 'attributeSet':
            if (!NAME.test(spec.attribute)) throw new Error(`"${spec.attribute}" is not an attribute name.`);
            return `attributes.${spec.attribute} != ''`;
        case 'expression':
            if (!spec.expression.trim()) throw new Error('The condition is empty.');
            return spec.expression.trim();
        default:
            throw new Error('Unknown condition.');
    }
}
