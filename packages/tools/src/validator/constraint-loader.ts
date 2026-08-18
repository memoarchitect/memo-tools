// ─── Native Constraint Loader (Epic EE-3) ─────────────────────────────────────
//
// Discovers native `constraint def` / `requirement def` declarations from parsed
// SysML documents and compiles each `require`/`assert constraint { … }` body into
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

import type { ParsedDocument } from '../model/parser-utils.js';
import type { CompiledConstraint } from './constraint-eval.js';
import { langiumExprToNode, parseConstraintExpression } from './constraint-eval.js';

/** A rule that could not be loaded, or that conflicts with another rule. */
export interface ConstraintDiagnostic {
    kind: 'compile-failed' | 'duplicate-id';
    ruleId: string;
    file: string;
    message: string;
}

/**
 * Walk all parsed documents and compile every native constraint def found.
 *
 * De-duplication by rule id is legitimate for the SAME rule seen twice: the
 * same ontology file appears in both the ontology load and the project parse.
 * Two DIFFERENT rules sharing an id is a defect, and is reported rather than
 * silently resolved by document order.
 *
 * A rule whose predicate fails to compile is skipped and reported. It used to
 * throw, which took down the entire command: one malformed
 * `predicateExpression` anywhere in a resolved dependency meant `memo validate`
 * exited with a stack trace and validated nothing. A broken rule must be loud,
 * but it must not be fatal — the other rules still have work to do.
 *
 * Callers are expected to surface `diagnostics`; a skipped rule that nobody
 * reports is a silently disabled check, which is worse than a crash.
 */
export function collectNativeConstraints(
    docs: ParsedDocument[],
    diagnostics?: ConstraintDiagnostic[],
): CompiledConstraint[] {
    const byId = new Map<string, CompiledConstraint>();
    const sourceById = new Map<string, string>();
    for (const doc of docs) {
        const model = doc.document.parseResult?.value as any;
        if (!model) continue;
        const found: CompiledConstraint[] = [];
        for (const member of model.members ?? []) {
            walk(member, found, doc.filePath, diagnostics);
        }
        for (const c of found) {
            const previous = sourceById.get(c.id);
            if (previous !== undefined && previous !== doc.filePath) {
                diagnostics?.push({
                    kind: 'duplicate-id',
                    ruleId: c.id,
                    file: doc.filePath,
                    message: `Rule id ${c.id} is declared in both ${previous} and ${doc.filePath}. `
                        + `Rule ids must be unique; which definition wins currently depends on load order.`,
                });
            }
            sourceById.set(c.id, doc.filePath);
            byId.set(c.id, c);
        }
    }
    return [...byId.values()];
}

function walk(
    node: any,
    out: CompiledConstraint[],
    file: string,
    diagnostics?: ConstraintDiagnostic[],
): void {
    if (!node) return;
    if (node.$type === 'PackageDeclaration') {
        for (const member of node.members ?? []) walk(member, out, file, diagnostics);
    } else if (node.$type === 'ConstraintDefinition' || node.$type === 'RequirementDefinition') {
        try {
            const compiled = tryCompile(node, file);
            if (compiled) out.push(compiled);
        } catch (error) {
            diagnostics?.push({
                kind: 'compile-failed',
                ruleId: authoredId(extractAttributes(node.body ?? [])) ?? '(unknown)',
                file,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

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

function tryCompile(def: any, file?: string): CompiledConstraint | undefined {
    const body: any[] = def.body ?? [];
    const attrs = extractAttributes(body);
    const id = authoredId(attrs);
    if (!id) return undefined;

    // The boolean body: first require/assert constraint member.
    const requireMember = body.find(m => m.$type === 'RequireConstraintMember' && m.expression);
    let ast;
    let appliesToKind = attrs['appliesTo'] ?? '';
    if (requireMember) {
        ast = langiumExprToNode(requireMember.expression);
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
        description: attrs['description'] || attrs['rationaleText'] || id,
        appliesToKind,
        severity: mapSeverity(attrs['severity']),
        evaluator: attrs['evaluator'] || undefined,
        typeName: def.name,
        tailoring: mapTailoring(attrs['tailoring']),
        sourceFile: file,
        ast,
    };
}

function parseScope(scope: string): { kind: string; attribute?: string; value?: string } {
    const match = /^([A-Za-z_]\w*)(?:\[([A-Za-z_]\w*)=([^\]]+)\])?$/.exec(scope);
    if (!match) throw new Error(`Unsupported coverage target '${scope}'.`);
    return { kind: match[1], attribute: match[2], value: match[3] };
}

/**
 * The rule loader's own attribute reader.
 *
 * Deliberately separate from the builder's: rules are compiled before a model
 * exists, so this walks the raw AST. It must stay in step with the builder on
 * one point — a `MetadataApplication` (`@Foo { … }`) is a different node type
 * from an `AttributeMember`, so a reader that only walks the latter sees
 * nothing on an annotated definition. That is how every A0 rule silently
 * stopped compiling when the authored ids moved onto `@MemoIdentity`:
 * `tryCompile` returns undefined without an id, the rule is skipped, and the
 * engine enforces nothing while the suite stays green.
 */
function extractAttributes(body: any[]): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const member of body) {
        if (member.$type === 'AttributeMember' && member.value) {
            attrs[member.name] = extractValue(member.value);
        }
    }
    // Metadata last, so an annotation wins over a directly declared attribute
    // of the same name — the precedence the builder uses.
    for (const member of body) {
        if (member.$type !== 'MetadataApplication') continue;
        for (const field of member.body ?? []) {
            if (!field?.name || !field.value) continue;
            attrs[field.name] = extractValue(field.value);
        }
    }
    return attrs;
}

function extractValue(value: any): string {
    if (!value) return '';
    switch (value.$type) {
        case 'StringValue':
            try {
                return JSON.parse(value.value ?? '""');
            } catch {
                return value.value?.replace(/^"|"$/g, '') ?? '';
            }
        case 'IntValue':
        case 'RealValue':
            return String(value.value);
        case 'BooleanValue':
            return String(value.value);
        case 'EnumValue': {
            // "RuleSeverityKind::error" → "error"
            const ref: string = value.enumRef ?? '';
            const colonIdx = ref.lastIndexOf('::');
            return colonIdx >= 0 ? ref.slice(colonIdx + 2) : ref;
        }
        default:
            return String(value);
    }
}

function mapSeverity(severity?: string): 'error' | 'warning' | 'info' {
    if (severity === 'error' || severity === 'warning' || severity === 'info') return severity;
    return 'warning';
}
