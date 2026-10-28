// ─── Evaluating a calculation over a built model ─────────────────────────────
//
// Walks the expression tree of a `calc def` (calc-ast.ts) with the model's elements as values. What it
// implements is the SysML v2 standard library's behaviour, and nothing of any one calculation: the
// control and quantity functions a body may call (`collect`, `select`, `exists`, `sum`, `product`,
// `size`), the operators, and the library features a model element answers to (`enclosedPerformances`
// and the like, read from the edges the builder makes of nesting, `perform` and `include`). A feature
// a model sets is read from the element's attributes; one it leaves unset is read from the default its
// definition declares. A function it does not implement is an error that names it, never a guess.

import type { MemoElement, MemoModel } from '../../model/semantic.js';
import type { ApiModel } from '../../stage2/api-model.js';
import type { CalcDefinition, Expr } from './calc-ast.js';
import { CalcReader } from './calc-ast.js';
import { add, isQuantity, multiply, parseQuantity, type Quantity } from './units.js';

/** What a calculation produces: a number or quantity, a model element, an enum member, a boolean, a string, a list. */
export type Value = number | string | boolean | Quantity | MemoElement | CalcResult | Value[];

/** The result of a calculation used by name: `calc cost : ProcedureCost { … }` answers `cost.cost`. */
export interface CalcResult { named: Record<string, Value> }

const isElement = (value: unknown): value is MemoElement =>
    typeof value === 'object' && value !== null && 'id' in value && 'kind' in value;
const isCalcResult = (value: unknown): value is CalcResult =>
    typeof value === 'object' && value !== null && 'named' in value && !('id' in value);

const last = (qualified: string) => qualified.split('::').pop() ?? qualified;

export const flatten = (value: Value | undefined): Value[] =>
    value === undefined ? [] : Array.isArray(value) ? value.flatMap(flatten) : [value];

export class UnsupportedCalculation extends Error {}

type Env = ReadonlyMap<string, Value>;
type Callable = (args: Value[]) => Value;

export class CalcEvaluator {
    private readonly reader: CalcReader;
    private readonly definitions: Map<string, CalcDefinition>;
    private depth = 0;

    constructor(
        private readonly api: ApiModel,
        private readonly model: MemoModel,
        private readonly conformsTo: (kind: string, expected: string) => boolean,
        definitions?: Map<string, CalcDefinition>,
        reader?: CalcReader,
    ) {
        this.reader = reader ?? new CalcReader(api);
        this.definitions = definitions ?? this.reader.definitions();
    }

    // ─── Expressions ────────────────────────────────────────────────────────

    eval(expr: Expr, env: Env): Value {
        switch (expr.k) {
            case 'lit': return expr.v;
            case 'ref': return this.reference(expr.feature, env);
            case 'chain': {
                let value = this.eval(expr.target, env);
                for (const feature of expr.features) value = this.navigate(value, feature);
                return value;
            }
            case 'op': return this.operator(expr, env);
            case 'call': return this.call(expr, env);
            case 'thunk': return this.eval(expr.body, env);
            case 'lambda': throw new UnsupportedCalculation('a lambda used as a value');
            case 'unknown': throw new UnsupportedCalculation(`an expression of kind ${expr.what}`);
        }
    }

    private reference(feature: string, env: Env): Value {
        const simple = last(feature);
        if (env.has(simple)) return env.get(simple)!;
        const element = this.model.elements.get(feature);
        if (element) return element;
        // an enumeration member: `ScenarioKind::nominal`
        const parts = feature.split('::');
        return parts.length >= 2 ? `${parts[parts.length - 2]}::${parts[parts.length - 1]}` : feature;
    }

    private operator(expr: Extract<Expr, { k: 'op' }>, env: Env): Value {
        const { op, args } = expr;
        const value = (index: number) => this.eval(args[index], env);
        const numeric = (v: Value): number | Quantity => {
            const items = flatten(v);
            if (items.length !== 1 || (typeof items[0] !== 'number' && !isQuantity(items[0]))) {
                throw new UnsupportedCalculation(`arithmetic on ${items.length === 0 ? 'nothing' : 'a non-number'}`);
            }
            return items[0] as number | Quantity;
        };
        switch (op) {
            case ',': return args.flatMap(arg => flatten(this.eval(arg, env)));
            case 'if': return truthy(value(0)) ? this.eval(args[1], env) : this.eval(args[2], env);
            case 'or': return truthy(value(0)) || truthy(value(1));
            case 'and': return truthy(value(0)) && truthy(value(1));
            case 'not': return !truthy(value(0));
            case '==': return equal(value(0), value(1));
            case '!=': return !equal(value(0), value(1));
            case '*': { const [a, b] = [value(0), value(1)]; return flatten(a).length === 0 || flatten(b).length === 0 ? [] : multiply(numeric(a), numeric(b)); }
            case '+': return add([numeric(value(0)), numeric(value(1))]);
            case '-': { const b = numeric(value(1)); return add([numeric(value(0)), typeof b === 'number' ? -b : { num: -b.num, units: b.units }]); }
            case '<': case '<=': case '>': case '>=': return compare(op, numeric(value(0)), numeric(value(1)));
            case 'istype': case 'hastype': {
                const items = flatten(value(0));
                return items.length > 0 && items.every(item => isElement(item) && expr.type !== undefined && this.conformsTo(item.kind, last(expr.type)));
            }
            case 'as': return value(0); // a coercion to a quantity type: the value already is one
            default: throw new UnsupportedCalculation(`the operator ${op}`);
        }
    }

    // ─── Calls ──────────────────────────────────────────────────────────────

    private call(expr: Extract<Expr, { k: 'call' }>, env: Env): Value {
        const definition = this.definitions.get(expr.fn);
        if (definition) return this.invoke(definition, expr.args.map(arg => ({ name: arg.name, value: this.eval(arg.value, env) })));
        const evaluated = expr.args.map(arg => arg.value.k === 'lambda'
            ? this.closure(arg.value, env)
            : this.eval(arg.value, env));
        switch (expr.fn) {
            case 'ControlFunctions::collect': return flatten(evaluated[0] as Value).flatMap(item => flatten((evaluated[1] as unknown as Callable)([item])));
            case 'ControlFunctions::select': return flatten(evaluated[0] as Value).filter(item => truthy((evaluated[1] as unknown as Callable)([item])));
            case 'ControlFunctions::exists': return flatten(evaluated[0] as Value).some(item => truthy((evaluated[1] as unknown as Callable)([item])));
            case 'ControlFunctions::forAll': return flatten(evaluated[0] as Value).every(item => truthy((evaluated[1] as unknown as Callable)([item])));
            case 'SequenceFunctions::size': return flatten(evaluated[0] as Value).length;
            case 'QuantityCalculations::sum': case 'NumericalFunctions::sum':
                return add(flatten(evaluated[0] as Value).filter((v): v is number | Quantity => typeof v === 'number' || isQuantity(v)));
            case 'QuantityCalculations::product': case 'NumericalFunctions::product':
                return flatten(evaluated[0] as Value).filter((v): v is number | Quantity => typeof v === 'number' || isQuantity(v))
                    .reduce<number | Quantity>((product, v) => multiply(product, v), 1);
            default: throw new UnsupportedCalculation(`the function ${expr.fn || '(unnamed)'}`);
        }
    }

    private closure(lambda: Extract<Expr, { k: 'lambda' }>, env: Env): Callable {
        return args => {
            const scope = new Map(env);
            lambda.params.forEach((param, index) => scope.set(param, args[index] as Value));
            return this.eval(lambda.body, scope);
        };
    }

    /** Run a calculation definition with named arguments. */
    invoke(definition: CalcDefinition, args: { name?: string; value: Value }[]): Value {
        if (!definition.body) throw new UnsupportedCalculation(`${definition.name} has no body`);
        if (++this.depth > 200) { this.depth = 0; throw new UnsupportedCalculation(`${definition.name} recurses without end`); }
        try {
            const scope = new Map<string, Value>();
            args.forEach((arg, index) => {
                const name = arg.name ?? definition.parameters[index]?.name;
                if (name) scope.set(name, arg.value);
            });
            return this.eval(definition.body, scope);
        } finally {
            this.depth--;
        }
    }

    definition(qualifiedOrName: string): CalcDefinition | undefined {
        return this.definitions.get(qualifiedOrName) ?? [...this.definitions.values()].find(d => d.name === qualifiedOrName);
    }

    // ─── Features ───────────────────────────────────────────────────────────

    navigate(value: Value, feature: string): Value {
        if (Array.isArray(value)) return value.flatMap(item => flatten(this.navigate(item, feature)));
        const name = last(feature);
        if (isQuantity(value)) return name === 'num' ? value.num : [];
        if (isCalcResult(value)) return value.named[name] ?? [];
        if (!isElement(value)) return [];
        const graph = this.libraryFeature(value, name);
        if (graph) return graph;
        const set = value.attributes[name];
        if (set !== undefined) return this.fromAttribute(value, set);
        // a feature that is a usage the element owns (`workflow.scNominal`): the element it declares
        const owned = this.model.elements.get(`${value.id}::${name}`);
        if (owned) return owned;
        return this.defaultOf(feature);
    }

    /** The features the standard library gives every behaviour, read from the edges the builder makes. */
    private libraryFeature(element: MemoElement, name: string): MemoElement[] | undefined {
        const edges = (type: string) => (this.model.outgoing.get(element.id) ?? []).filter(r => r.type === type)
            .map(r => this.model.elements.get(r.targetId)).filter((e): e is MemoElement => e !== undefined);
        const isBehaviour = (e: MemoElement) => e.construct === 'action' || e.construct === 'use case';
        switch (name) {
            case 'subactions': case 'ownedActions': return edges('composes').filter(e => e.construct === 'action');
            case 'includedUseCases': return edges('includesStep');
            case 'enclosedPerformances': return [...edges('composes'), ...edges('performs'), ...edges('includesStep')].filter(isBehaviour);
            default: return undefined;
        }
    }

    /** What the definition that declares a feature gives it when the model sets none. */
    private defaultOf(feature: string): Value {
        const declared = this.api.resolve(feature);
        const expr = declared ? this.reader.valueOf(declared['@id']) : undefined;
        if (!expr) return [];
        try { return this.eval(expr, new Map()); } catch { return []; }
    }

    private fromAttribute(owner: MemoElement, text: string): Value {
        const quantity = parseQuantity(text);
        if (quantity !== undefined) return quantity;
        if (text === 'true') return true;
        if (text === 'false') return false;
        if (text.includes('::')) return text;
        const parts = text.split(',').map(part => part.trim()).filter(Boolean);
        const resolved = parts.map(part => this.resolveElement(part, owner));
        return resolved.length > 0 && resolved.every(Boolean) ? (resolved as MemoElement[]) : text;
    }

    /** A name a model writes (`platform.ourRobot`) as the element it names, looked for from the writer outwards. */
    private resolveElement(name: string, from: MemoElement): MemoElement | undefined {
        const path = name.split('.').join('::');
        const segments = from.id.split('::');
        for (let length = segments.length; length >= 1; length--) {
            const found = this.model.elements.get(`${segments.slice(0, length).join('::')}::${path}`);
            if (found) return found;
        }
        return undefined;
    }
}

const truthy = (value: Value): boolean => {
    const items = flatten(value);
    return items.length > 0 && items.every(item => item !== false && item !== 0);
};

const norm = (value: Value): string | number | boolean => {
    if (isElement(value)) return value.id;
    if (isQuantity(value)) return value.num;
    if (typeof value === 'string') return value.split('::').slice(-2).join('::');
    return value as string | number | boolean;
};

function equal(a: Value, b: Value): boolean {
    const left = flatten(a); const right = flatten(b);
    if (left.length !== right.length) return false;
    return left.every((item, index) => norm(item) === norm(right[index]));
}

function compare(op: string, a: number | Quantity, b: number | Quantity): boolean {
    const x = typeof a === 'number' ? a : a.num; const y = typeof b === 'number' ? b : b.num;
    return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}
