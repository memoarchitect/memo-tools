// ─── Native Constraint Loader (Epic EE-3) ─────────────────────────────────────
//
// Discovers native `constraint def` / `requirement def` declarations from parsed
// SysML documents and compiles each `require`/`assert constraint { … }` body into
// an evaluator AST (via langiumExprToNode). This replaces the proprietary
// ConsistencyRule predicate-attribute parts that RuleRegistry used to walk:
// rules are now ordinary KerML constraint expressions over a subject kind.
//
// Rule metadata travels as plain attribute members inside the def body:
//   constraint def hazardNeedsMitigation {
//       attribute id = "CR-MED-001";
//       attribute appliesTo = "Hazard";
//       attribute severity = RuleSeverityKind::error;
//       attribute rationaleText = "ISO 14971 requires risk control for each hazard.";
//       require constraint { mitigates->size() >= 1 }
//   }
// ──────────────────────────────────────────────────────────────────────────────

import type { ParsedDocument } from '../model/parser-utils.js';
import type { CompiledConstraint } from './constraint-eval.js';
import { langiumExprToNode } from './constraint-eval.js';

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

    // The boolean body: first require/assert constraint member.
    const requireMember = body.find(m => m.$type === 'RequireConstraintMember' && m.expression);
    if (!requireMember) return undefined;

    const attrs = extractAttributes(body);
    const id = attrs['id'];
    if (!id) return undefined; // metadata-less constraints are not consistency rules

    let ast;
    try {
        ast = langiumExprToNode(requireMember.expression);
    } catch {
        return undefined; // unsupported expression — skip rather than crash validation
    }

    return {
        id,
        description: attrs['description'] || attrs['rationaleText'] || id,
        appliesToKind: attrs['appliesTo'] ?? '',
        severity: mapSeverity(attrs['severity']),
        ast,
    };
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
            return value.value?.replace(/^"|"$/g, '') ?? '';
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
