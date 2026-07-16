// ─── Native Constraint Evaluator (Epic EE) ────────────────────────────────────
//
// Proves the keystone thesis: MEMO evaluates SysML v2 / KerML-style constraint
// EXPRESSIONS directly against the built MemoModel, instead of interpreting the
// proprietary ClosureRule enum (validator/rule-engine.ts) or the predicate-attribute
// pseudo-rules produced by RuleRegistry (validator/rule-registry.ts).
//
// SCOPE (after EE-2 — see docs/design/constraint-evaluator.md and ADR-1-18):
//   - Feature/relationship navigation, including multi-segment feature chains and
//     attribute access (`kind`, `attributes["safetyClass"]`).
//   - Collection operations: ->size()/->notEmpty()/->isEmpty() and the quantifiers
//     ->forAll(expr)/->exists(expr)/->select(expr) (sub-expression evaluated with
//     each collection element as the implicit subject).
//   - Operators: or < and < comparison < additive (+ -) < multiplicative (* /) <
//     not < postfix(->) < primary.
//   - Literals: integer, string ("…"), boolean.
//   - `subject` root reference and `allOfKind("Kind")` extent accessor — these give
//     uniqueAttribute-class rules a native form (EE-3 migration contract).
//
// Navigation semantics (matches ClosureRule direction default 'any'):
//   a feature-chain segment resolves to a RELATIONSHIP (collection, either
//   direction) if its lowercased name is a key in model.relationshipsByType,
//   else to an ATTRIBUTE/typed-field scalar on the element. The `attributes`
//   segment is the attribute-map accessor: the following segment (or `["key"]`
//   index) names the attribute key.
// ──────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from '../model/semantic.js';
import type { Violation } from './types.js';
import type { ConstraintExpr } from '../language/generated/ast.js';

/** A constraint authored as a KerML-subset boolean expression over a subject element. */
export interface NativeConstraint {
    /** Stable rule id, e.g. "EE-ALLOC-001". */
    id: string;
    /** Human-readable description (surfaced in the violation). */
    description: string;
    /** The element kind this constraint quantifies over (the SysML `subject`). */
    appliesToKind: string;
    /** KerML-subset boolean expression; the subject element is implicit. */
    expression: string;
    /** Severity when the expression is false for a subject. */
    severity: 'error' | 'warning' | 'info';
}

/** Constraint metadata without the expression body — used by the AST entry point. */
export type ConstraintMeta = Omit<NativeConstraint, 'expression'>;

/** A constraint whose boolean body has already been parsed to an evaluator AST. */
export interface CompiledConstraint extends ConstraintMeta {
    /** Parsed boolean body; the subject element is the implicit root. */
    ast: ConstraintNode;
}

/** Evaluate one native constraint (expression as source string) against its subject kind. */
export function evaluateNativeConstraint(constraint: NativeConstraint, model: MemoModel): Violation[] {
    const ast = parseExpression(constraint.expression);
    const { expression: _drop, ...meta } = constraint;
    return evaluateConstraintNode(meta, ast, model);
}

/**
 * Evaluate a pre-parsed constraint body against every element of its subject kind.
 * This is the shared core used by both the string entry point (above) and the
 * ontology loader, which compiles `constraint def` bodies via {@link langiumExprToNode}.
 */
export function evaluateConstraintNode(meta: ConstraintMeta, ast: ConstraintNode, model: MemoModel): Violation[] {
    const subjects = model.elementsByKind.get(meta.appliesToKind) ?? [];
    const violations: Violation[] = [];

    for (const element of subjects) {
        const ok = toBool(evalNode(ast, { root: element, current: element }, model));
        if (!ok) {
            violations.push({
                ruleId: meta.id,
                description: meta.description,
                severity: meta.severity,
                elementId: element.id,
                elementKind: element.kind,
                elementName: element.name,
                layer: element.layer,
            });
        }
    }
    return violations;
}

// ─── AST ────────────────────────────────────────────────────────────────────

type CmpOp = '==' | '!=' | '>=' | '<=' | '>' | '<';
type ArithOp = '+' | '-' | '*' | '/';

type Node =
    | { kind: 'bool'; value: boolean }
    | { kind: 'int'; value: number }
    | { kind: 'str'; value: string }
    /** Feature chain resolved against the current element (or the root subject). */
    | { kind: 'feature'; root: 'current' | 'subject'; segments: string[] }
    /** All elements of a named kind (the kind extent). */
    | { kind: 'allOfKind'; kindName: string }
    | { kind: 'method'; target: Node; name: 'size' | 'notEmpty' | 'isEmpty' }
    | { kind: 'quant'; target: Node; name: 'forAll' | 'exists' | 'select'; body: Node }
    | { kind: 'arith'; op: ArithOp; left: Node; right: Node }
    | { kind: 'cmp'; op: CmpOp; left: Node; right: Node }
    | { kind: 'and'; left: Node; right: Node }
    | { kind: 'or'; left: Node; right: Node }
    | { kind: 'not'; operand: Node };

/** Public alias for the evaluator AST node (the compiled form of a constraint body). */
export type ConstraintNode = Node;

/** A scalar element, a collection of elements, or a primitive. */
type Value = boolean | number | string | MemoElement | MemoElement[];

/** Evaluation scope: `root` is the constraint subject; `current` is the implicit
 *  subject of the innermost quantifier body (equals `root` outside quantifiers). */
interface Env {
    root: MemoElement;
    current: MemoElement;
}

/** Typed fields on MemoElement that a bare feature segment may resolve to. */
const TYPED_FIELDS = new Set(['kind', 'layer', 'construct', 'allocatedTo', 'name', 'id', 'package', 'shortId']);

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type Token = { t: string; v?: string };

function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    const re = /\s*(->|==|!=|>=|<=|"[^"]*"|[<>()[\].+\-*/]|[A-Za-z_][A-Za-z0-9_]*|\d+)/y;
    let m: RegExpExecArray | null;
    let pos = 0;
    while (pos < src.length) {
        re.lastIndex = pos;
        m = re.exec(src);
        if (!m) throw new Error(`Constraint parse error near: "${src.slice(pos)}"`);
        pos = re.lastIndex;
        const raw = m[1];
        if (/^\d+$/.test(raw)) tokens.push({ t: 'int', v: raw });
        else if (raw[0] === '"') tokens.push({ t: 'str', v: raw.slice(1, -1) });
        else if (/^[A-Za-z_]/.test(raw)) tokens.push({ t: 'ident', v: raw });
        else tokens.push({ t: raw });
    }
    tokens.push({ t: 'eof' });
    return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────
// Precedence (loosest→tightest): or < and < cmp < add < mul < not < postfix < primary.

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);
const COLLECTION_OPS = new Set(['size', 'notEmpty', 'isEmpty']);
const QUANTIFIER_OPS = new Set(['forAll', 'exists', 'select']);

function parseExpression(src: string): Node {
    const tokens = tokenize(src);
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    const expect = (t: string) => {
        if (peek().t !== t) throw new Error(`Expected '${t}', got '${peek().t}'`);
        return next();
    };

    function parseOr(): Node {
        let left = parseAnd();
        while (peek().t === 'ident' && peek().v === 'or') { next(); left = { kind: 'or', left, right: parseAnd() }; }
        return left;
    }
    function parseAnd(): Node {
        let left = parseCmp();
        while (peek().t === 'ident' && peek().v === 'and') { next(); left = { kind: 'and', left, right: parseCmp() }; }
        return left;
    }
    function parseCmp(): Node {
        const left = parseAdd();
        const op = peek().t;
        if (op === '==' || op === '!=' || op === '>=' || op === '<=' || op === '>' || op === '<') {
            next();
            return { kind: 'cmp', op, left, right: parseAdd() };
        }
        return left;
    }
    function parseAdd(): Node {
        let left = parseMul();
        while (peek().t === '+' || peek().t === '-') {
            const op = next().t as ArithOp;
            left = { kind: 'arith', op, left, right: parseMul() };
        }
        return left;
    }
    function parseMul(): Node {
        let left = parseNot();
        while (peek().t === '*' || peek().t === '/') {
            const op = next().t as ArithOp;
            left = { kind: 'arith', op, left, right: parseNot() };
        }
        return left;
    }
    function parseNot(): Node {
        if (peek().t === 'ident' && peek().v === 'not') { next(); return { kind: 'not', operand: parseNot() }; }
        return parsePostfix();
    }
    function parsePostfix(): Node {
        let node = parsePrimary();
        while (peek().t === '->') {
            next();
            const name = expect('ident').v!;
            expect('(');
            if (COLLECTION_OPS.has(name)) {
                expect(')');
                node = { kind: 'method', target: node, name: name as 'size' | 'notEmpty' | 'isEmpty' };
            } else if (QUANTIFIER_OPS.has(name)) {
                const body = parseOr();
                expect(')');
                node = { kind: 'quant', target: node, name: name as 'forAll' | 'exists' | 'select', body };
            } else {
                throw new Error(`Unsupported collection op '->${name}()'`);
            }
        }
        return node;
    }
    function parsePrimary(): Node {
        const tok = peek();
        if (tok.t === '(') { next(); const e = parseOr(); expect(')'); return e; }
        if (tok.t === 'int') { next(); return { kind: 'int', value: parseInt(tok.v!, 10) }; }
        if (tok.t === 'str') { next(); return { kind: 'str', value: tok.v! }; }
        if (tok.t === 'ident') {
            if (tok.v === 'true' || tok.v === 'false') { next(); return { kind: 'bool', value: tok.v === 'true' }; }
            if (tok.v === 'allOfKind') {
                next();
                expect('(');
                const arg = peek();
                if (arg.t !== 'str') throw new Error(`allOfKind expects a string kind name, got '${arg.t}'`);
                next();
                expect(')');
                return { kind: 'allOfKind', kindName: arg.v! };
            }
            if (KEYWORDS.has(tok.v!)) throw new Error(`Unexpected keyword '${tok.v}'`);
            return parseFeature();
        }
        throw new Error(`Unexpected token '${tok.t}'`);
    }
    function parseFeature(): Node {
        const first = next().v!;
        const root: 'current' | 'subject' = first === 'subject' ? 'subject' : 'current';
        const segments: string[] = first === 'subject' ? [] : [first];
        for (;;) {
            if (peek().t === '.') { next(); segments.push(expect('ident').v!); continue; }
            if (peek().t === '[') { next(); segments.push(expect('str').v!); expect(']'); continue; }
            break;
        }
        return { kind: 'feature', root, segments };
    }

    const ast = parseOr();
    if (peek().t !== 'eof') throw new Error(`Trailing tokens after expression: '${peek().t}'`);
    return ast;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function evalNode(node: Node, env: Env, model: MemoModel): Value {
    switch (node.kind) {
        case 'bool': return node.value;
        case 'int': return node.value;
        case 'str': return node.value;
        case 'feature': return resolveFeature(node.root === 'subject' ? env.root : env.current, node.segments, model);
        case 'allOfKind': return model.elementsByKind.get(node.kindName) ?? [];
        case 'method': {
            const len = lengthOf(evalNode(node.target, env, model));
            if (node.name === 'size') return len;
            if (node.name === 'notEmpty') return len > 0;
            return len === 0; // isEmpty
        }
        case 'quant': {
            const coll = asCollection(evalNode(node.target, env, model));
            if (node.name === 'forAll') return coll.every(e => toBool(evalNode(node.body, { root: env.root, current: e }, model)));
            if (node.name === 'exists') return coll.some(e => toBool(evalNode(node.body, { root: env.root, current: e }, model)));
            return coll.filter(e => toBool(evalNode(node.body, { root: env.root, current: e }, model))); // select
        }
        case 'arith': {
            const l = toNumber(evalNode(node.left, env, model));
            const r = toNumber(evalNode(node.right, env, model));
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
            }
        }
        // eslint-disable-next-line no-fallthrough
        case 'cmp': return compare(node.op, evalNode(node.left, env, model), evalNode(node.right, env, model));
        case 'and': return toBool(evalNode(node.left, env, model)) && toBool(evalNode(node.right, env, model));
        case 'or': return toBool(evalNode(node.left, env, model)) || toBool(evalNode(node.right, env, model));
        case 'not': return !toBool(evalNode(node.operand, env, model));
    }
}

/** True if `seg` names a relationship type, compared case-insensitively (keys are camelCase). */
function isRelType(model: MemoModel, seg: string): boolean {
    if (model.relationshipsByType.has(seg)) return true;
    const low = seg.toLowerCase();
    for (const k of model.relationshipsByType.keys()) if (k.toLowerCase() === low) return true;
    return false;
}

/** Resolve a feature chain starting from `start`. See navigation semantics in header. */
function resolveFeature(start: MemoElement, segments: string[], model: MemoModel): Value {
    let val: Value = start;
    for (let k = 0; k < segments.length; k++) {
        const seg = segments[k];
        if (isElement(val)) {
            if (seg === 'attributes') {
                const key = segments[++k];
                if (key === undefined) throw new Error("'attributes' must be followed by an attribute key");
                val = val.attributes[key] ?? '';
            } else if (isRelType(model, seg)) {
                val = navigate(val, seg.toLowerCase(), model);
            } else if (TYPED_FIELDS.has(seg)) {
                val = (val as unknown as Record<string, string | undefined>)[seg] ?? '';
            } else {
                val = val.attributes[seg] ?? '';
            }
        } else if (Array.isArray(val)) {
            if (!isRelType(model, seg)) {
                throw new Error(`Cannot resolve attribute '${seg}' on a collection; only relationship navigation chains across collections`);
            }
            val = val.flatMap(e => navigate(e, seg.toLowerCase(), model));
        } else {
            throw new Error(`Cannot navigate '${seg}' on a primitive value`);
        }
    }
    return val;
}

/**
 * Elements related to `subject` by a relationship of `relType`, in either direction.
 *
 * Navigation is bidirectional by the relation's single forward name on purpose:
 * a rule reaches the edge from either endpoint under one name (e.g. a Hazard
 * satisfies `mitigatesHazard->size() >= 1` via the incoming scan, even though the
 * edge is authored riskControl → hazard). This is load-bearing for the rule packs;
 * do not make the bare name forward-only.
 *
 * There is deliberately no per-edge inverse name: an inverse reading is the same
 * fact viewed from the other end, not a distinct relation. If a reflexive relation
 * ever needs its two readings separated (e.g. `derivesInto` ancestors vs
 * descendants), add it as an *additive* directional token plus a `reverseName` on
 * the relation type in the registry — keeping the bare name bidirectional — rather
 * than reviving a stored inverse field.
 */
function navigate(subject: MemoElement, relType: string, model: MemoModel): MemoElement[] {
    const out: MemoElement[] = [];
    // A relationship matches the requested name by its (forward) type; we then
    // return the element at the opposite end, scanning both directions so the
    // single forward name is navigable from either endpoint.
    // Case-insensitive: relationshipsByType is keyed by camelCase rel.type
    // (e.g. "verifiedBy"), but nav segments arrive lowercased.
    const want = relType.toLowerCase();
    const matches = (rel: { type: string }) => rel.type.toLowerCase() === want;
    for (const rel of model.outgoing.get(subject.id) ?? []) {
        if (matches(rel)) {
            const e = model.elements.get(rel.targetId);
            if (e) out.push(e);
        }
    }
    for (const rel of model.incoming.get(subject.id) ?? []) {
        if (matches(rel)) {
            const e = model.elements.get(rel.sourceId);
            if (e) out.push(e);
        }
    }
    return out;
}

function compare(op: CmpOp, l: Value, r: Value): boolean {
    if (typeof l === 'string' || typeof r === 'string') {
        const ls = toStringValue(l);
        const rs = toStringValue(r);
        switch (op) {
            case '==': return ls === rs;
            case '!=': return ls !== rs;
            case '>=': return ls >= rs;
            case '<=': return ls <= rs;
            case '>': return ls > rs;
            case '<': return ls < rs;
        }
    }
    const ln = toNumber(l);
    const rn = toNumber(r);
    switch (op) {
        case '==': return ln === rn;
        case '!=': return ln !== rn;
        case '>=': return ln >= rn;
        case '<=': return ln <= rn;
        case '>': return ln > rn;
        case '<': return ln < rn;
    }
}

function isElement(v: Value): v is MemoElement {
    return typeof v === 'object' && !Array.isArray(v);
}
function asCollection(v: Value): MemoElement[] {
    if (Array.isArray(v)) return v;
    throw new Error('Quantifier applied to non-collection value');
}
/** Length of a collection or string; the basis for size/notEmpty/isEmpty. */
function lengthOf(v: Value): number {
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string') return v.length;
    throw new Error('Collection operation applied to a non-collection, non-string value');
}
function toBool(v: Value): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0; // a bare collection is truthy iff non-empty
    return true; // a single element is truthy
}
function toNumber(v: Value): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
    if (Array.isArray(v)) return v.length; // a bare collection compares by size
    return 1;
}
function toStringValue(v: Value): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return String(v.length);
    return v.id;
}

// ─── Langium AST → evaluator AST (EE-1 grammar → EE-2 evaluator) ──────────────
//
// EE-1 moved expression PARSING into the Langium grammar (memo-sysml.langium,
// ConstraintExpr rule family). EE-2 extends the evaluator to the full ADR-1-18
// subset, so this mapping no longer defers attribute access, quantifiers,
// arithmetic, string literals, or multi-segment feature chains. See ADR-1-18.

const COMPARISON_OPS = new Set(['==', '!=', '>=', '<=', '>', '<']);
const ARITH_OPS = new Set(['+', '-', '*', '/']);

/** Map a Langium-parsed constraint expression to the evaluator AST. */
export function langiumExprToNode(expr: ConstraintExpr): Node {
    switch (expr.$type) {
        case 'LiteralExpr': {
            if (expr.intValue !== undefined) return { kind: 'int', value: parseInt(expr.intValue, 10) };
            if (expr.boolValue !== undefined) return { kind: 'bool', value: expr.boolValue === 'true' };
            return { kind: 'str', value: expr.strValue ?? '' };
        }
        case 'FeatureChain':
            return { kind: 'feature', root: 'current', segments: [...expr.segments] };
        case 'CollectionOp': {
            if (COLLECTION_OPS.has(expr.op)) {
                if (expr.argument) throw new Error(`'->${expr.op}()' takes no argument`);
                return { kind: 'method', target: langiumExprToNode(expr.target), name: expr.op as 'size' | 'notEmpty' | 'isEmpty' };
            }
            if (QUANTIFIER_OPS.has(expr.op)) {
                if (!expr.argument) throw new Error(`'->${expr.op}(expr)' requires a sub-expression`);
                return { kind: 'quant', target: langiumExprToNode(expr.target), name: expr.op as 'forAll' | 'exists' | 'select', body: langiumExprToNode(expr.argument) };
            }
            throw new Error(`Unsupported collection op '->${expr.op}()' (not in ADR-1-18 subset)`);
        }
        case 'UnaryExpr':
            return { kind: 'not', operand: langiumExprToNode(expr.operand) };
        case 'BinaryExpr': {
            if (expr.op === 'and') return { kind: 'and', left: langiumExprToNode(expr.left), right: langiumExprToNode(expr.right) };
            if (expr.op === 'or') return { kind: 'or', left: langiumExprToNode(expr.left), right: langiumExprToNode(expr.right) };
            if (COMPARISON_OPS.has(expr.op)) {
                return { kind: 'cmp', op: expr.op as CmpOp, left: langiumExprToNode(expr.left), right: langiumExprToNode(expr.right) };
            }
            if (ARITH_OPS.has(expr.op)) {
                return { kind: 'arith', op: expr.op as ArithOp, left: langiumExprToNode(expr.left), right: langiumExprToNode(expr.right) };
            }
            throw new Error(`Unsupported operator '${expr.op}'`);
        }
    }
}
