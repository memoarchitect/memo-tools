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

/**
 * Walk all parsed documents and compile every native constraint def found.
 * De-duplicated by rule id: the same ontology file can appear in more than one
 * document set (ontology load + project parse), and a rule id is unique, so a
 * later occurrence replaces an earlier one rather than double-counting.
 */
export function collectNativeConstraints(docs: ParsedDocument[]): CompiledConstraint[] {
    const byId = new Map<string, CompiledConstraint>();
    for (const doc of docs) {
        const model = doc.document.parseResult?.value as any;
        if (!model) continue;
        const found: CompiledConstraint[] = [];
        for (const member of model.members ?? []) {
            walk(member, found);
        }
        for (const c of found) byId.set(c.id, c);
    }
    return [...byId.values()];
}

function walk(node: any, out: CompiledConstraint[]): void {
    if (!node) return;
    if (node.$type === 'PackageDeclaration') {
        for (const member of node.members ?? []) walk(member, out);
    } else if (node.$type === 'ConstraintDefinition' || node.$type === 'RequirementDefinition') {
        const compiled = tryCompile(node);
        if (compiled) out.push(compiled);
    }
}

function tryCompile(def: any): CompiledConstraint | undefined {
    const body: any[] = def.body ?? [];
    const attrs = extractAttributes(body);
    const id = attrs['id'];
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
        ast,
    };
}

function parseScope(scope: string): { kind: string; attribute?: string; value?: string } {
    const match = /^([A-Za-z_]\w*)(?:\[([A-Za-z_]\w*)=([^\]]+)\])?$/.exec(scope);
    if (!match) throw new Error(`Unsupported coverage target '${scope}'.`);
    return { kind: match[1], attribute: match[2], value: match[3] };
}

function extractAttributes(body: any[]): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const member of body) {
        if (member.$type === 'AttributeMember' && member.value) {
            attrs[member.name] = extractValue(member.value);
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
