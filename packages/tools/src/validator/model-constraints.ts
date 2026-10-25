// ─── The constraints a model declares, evaluated ─────────────────────────────
//
// `require constraint { rtControlLoop.wcetMs <= 10 [milli*s] }` in a requirement and
// `assert constraint { … }` in a verification case are native SysML, and the builder records each as an
// element carrying its expression as text. This reads the names in that text against the model and
// evaluates it with the same evaluator the rules use, so a quantity compares as a quantity.
//
// A name is resolved from the constraint's own scope outward: an attribute of the element that owns the
// constraint, then an element declared in its package, then an element whose short name is unique in the
// model; what follows a dot is an attribute of that element. A constraint that names something this
// cannot resolve, or that is not a boolean expression over such names, is reported as not evaluated, not
// passed.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModel } from '../model/semantic.js';
import { evaluateClosedExpression } from './constraint-eval.js';
import type { Violation } from './types.js';

/** The rule id a violated or unevaluable model constraint is reported under. */
export const MODEL_CONSTRAINT_RULE_ID = 'MC-001';

const KEYWORDS = new Set(['and', 'or', 'not', 'xor', 'implies', 'true', 'false', 'if', 'then', 'else']);

const QUANTITY_LITERAL = /(?<![\w.])([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*\[([^\]]+)\]/g;

/** An element's own value for a name: a field of the record, else an attribute. */
function valueOf(element: MemoElement, name: string): string | undefined {
    const attribute = element.attributes?.[name];
    if (attribute !== undefined) return attribute;
    const field = (element as unknown as Record<string, unknown>)[name];
    return typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean' ? String(field) : undefined;
}

function resolveFirst(model: MemoModel, constraint: MemoElement, name: string): MemoElement | string | undefined {
    const owner = constraint.owner ? model.elements.get(constraint.owner) : undefined;
    if (owner) {
        const own = valueOf(owner, name);
        if (own !== undefined) return own;
    }
    const inPackage = constraint.package ? model.elements.get(`${constraint.package}::${name}`) : undefined;
    if (inPackage) return inPackage;
    const named = [...model.elements.values()].filter(e => e.shortName === name || e.id === name);
    return named.length === 1 ? named[0] : undefined;
}

/** The text of an expression with every name replaced by its value as a string literal. */
function substitute(model: MemoModel, constraint: MemoElement, expression: string): string {
    // String literals and quantity literals first, so what is inside them is not read as a name.
    const literals: string[] = [];
    const hold = (text: string) => { literals.push(text); return `\u0000${literals.length - 1}\u0000`; };
    let work = expression.replace(/"[^"]*"/g, hold).replace(QUANTITY_LITERAL, (_m, n: string, unit: string) => hold(JSON.stringify(`${n} [${unit}]`)));
    work = work.replace(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g, chain => {
        if (KEYWORDS.has(chain)) return chain;
        const [head, ...rest] = chain.split('.');
        let current = resolveFirst(model, constraint, head);
        for (const segment of rest) {
            if (current === undefined || typeof current === 'string') throw new Error(`"${chain}": "${segment}" follows a value, not an element`);
            current = valueOf(current, segment);
        }
        if (current === undefined) throw new Error(`"${chain}" names nothing the model declares`);
        if (typeof current !== 'string') throw new Error(`"${chain}" is an element, not a value`);
        return hold(JSON.stringify(current));
    });
    return work.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => literals[Number(i)]);
}

/**
 * Evaluate every constraint element the model declares. A violated constraint is an error against the element
 * that owns it; one that cannot be evaluated is an info finding saying why, so it never reads as passed.
 */
export function validateModelConstraints(model: MemoModel): Violation[] {
    const violations: Violation[] = [];
    for (const element of model.elements.values()) {
        if (element.construct !== 'constraint' || element.isDefinition) continue;
        if (element.provenance?.declaration.origin === 'dependency') continue;
        const expression = element.attributes?.expression;
        if (!expression) continue;
        const owner = (element.owner ? model.elements.get(element.owner) : undefined) ?? element;
        const finding = (severity: Violation['severity'], description: string): Violation => ({
            ruleId: MODEL_CONSTRAINT_RULE_ID, severity, description,
            elementId: owner.id, elementKind: owner.kind, elementName: owner.name, layer: owner.layer,
        });
        try {
            if (!evaluateClosedExpression(substitute(model, element, expression), model)) {
                violations.push(finding('error', `${element.attributes.constraintRole ?? 'constraint'} ${element.name} does not hold: ${expression}`));
            }
        } catch (e) {
            violations.push(finding('info', `${element.attributes.constraintRole ?? 'constraint'} ${element.name} was not evaluated: ${e instanceof Error ? e.message : String(e)}`));
        }
    }
    return violations;
}
