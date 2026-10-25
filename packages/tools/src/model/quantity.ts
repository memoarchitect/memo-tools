// ─── Quantities: `20 [milli*second]` as a number ─────────────────────────────
//
// The builder carries a typed value as the text the source wrote. Comparing two
// of them needs the factor of each unit and prefix, and those are the standard
// library's data (`SIPrefixes`, `SI`), not MEMO's: they are read from the
// library source the package ships (the vendored SysML v2 Release, pinned in
// corpus/), never written here as a table.
//
// The compilers carry the standard library inside themselves and their handoff
// holds only a name for what a model references from it (checked 2026-10-25
// against OpenSysML 0.10.0: no `milli` element), so the source is the one place
// the factors can be read from.
//
// A unit is a factor and the powers of the base units it is made of. The base
// units are the ones SI declares with no conversion and no definition (`s`, `m`,
// `g`, `A`…); a unit converted by convention or by prefix scales another, and a
// unit defined by an expression (`Hz = s^-1`, `N = kg*m/s^2`) is that
// expression's product. A quantity is written `<number> [<expression>]` with the
// same expression grammar (`*`, `/`, `^n`, parentheses, prefixes by name), so
// `m/s` and `milli*second` read the same way. Two quantities compare when
// their base-unit powers are equal.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitSymbolsDTO } from './quantity-format.js';

const LIBRARY = join('corpus', 'sysml-v2-release', 'sysml.library', 'Domain Libraries', 'Quantities and Units');

/** A scale and the powers of the base units: `Hz` is 1 and `{ s: -1 }`. */
interface Dimensioned { factor: number; powers: ReadonlyMap<string, number> }

/** What a quantity is in: the powers of base units it is made of, and its value in those. */
export interface Quantity {
    /** The value in the base units (`g`, `m`, `s`…). */
    value: number;
    /** The powers of the base units, written `m*s^-1`; `1` when there are none. */
    dimension: string;
}

export interface UnitTable {
    /** The symbols the library gives prefixes and units, for showing a quantity the way it is written in print. */
    symbols: UnitSymbolsDTO;
    prefixes: ReadonlyMap<string, number>;
    units: ReadonlyMap<string, Dimensioned>;
}

const QUANTITY = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\[([^\]]+)\]\s*$/;

/** Names are written bare or quoted; the table keys the bare spelling. */
const bare = (name: string) => name.trim().replace(/^'|'$/g, '');

/**
 * `one` is declared in MeasurementReferences.sysml (`attribute one : DimensionOneUnit`):
 * the unit of a pure number, a scale of 1 with no base units.
 */
const DIMENSION_ONE = 'one';

const times = (a: Dimensioned, b: Dimensioned, sign: 1 | -1 = 1): Dimensioned => {
    const powers = new Map(a.powers);
    for (const [unit, power] of b.powers) {
        const next = (powers.get(unit) ?? 0) + sign * power;
        if (next === 0) powers.delete(unit); else powers.set(unit, next);
    }
    return { factor: sign === 1 ? a.factor * b.factor : a.factor / b.factor, powers };
};

const NONE: Dimensioned = { factor: 1, powers: new Map() };

const power = (a: Dimensioned, exponent: number): Dimensioned => ({
    factor: a.factor ** exponent,
    powers: new Map([...a.powers].map(([unit, p]) => [unit, p * exponent] as const)),
});

/** The base units' powers as text, in name order: `m*s^-1`. */
const describe = (powers: ReadonlyMap<string, number>): string => {
    const parts = [...powers].sort(([x], [y]) => x.localeCompare(y)).map(([unit, p]) => (p === 1 ? unit : `${unit}^${p}`));
    return parts.length === 0 ? '1' : parts.join('*');
};

/**
 * A unit expression as a scale and base-unit powers, names resolved by `lookup`.
 * Grammar: `term (('*' | '/') term)*`, `term := atom ('^' integer)?`,
 * `atom := number | name | '(' expression ')'`; a name is bare or quoted.
 */
function evaluateExpression(source: string, lookup: (name: string) => Dimensioned | undefined): Dimensioned {
    const tokens = source.match(/'[^']+'|[A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF]*|\d+\.?\d*(?:[eE][-+]?\d+)?|[-*/^()]/g) ?? [];
    let at = 0;
    const next = () => tokens[at++];
    const fail = (why: string): never => { throw new Error(`The unit expression "${source}" ${why}`); };
    const atom = (): Dimensioned => {
        const token = next();
        if (token === undefined) return fail('ends early');
        if (token === '(') {
            const inner = product();
            if (next() !== ')') fail('has an unclosed parenthesis');
            return inner;
        }
        if (/^\d/.test(token)) return { factor: Number(token), powers: new Map() };
        const found = lookup(bare(token));
        return found ?? fail(`names "${bare(token)}", which the standard library does not define by a plain factor`);
    };
    const term = (): Dimensioned => {
        const base = atom();
        if (tokens[at] !== '^') return base;
        at++;
        let sign = 1;
        if (tokens[at] === '-') { sign = -1; at++; }
        const exponent = next();
        if (exponent === undefined || !/^\d+$/.test(exponent)) return fail('has a power that is not a whole number');
        return power(base, sign * Number(exponent));
    };
    const product = (): Dimensioned => {
        let result = term();
        while (tokens[at] === '*' || tokens[at] === '/') {
            const op = next();
            result = times(result, term(), op === '*' ? 1 : -1);
        }
        return result;
    };
    const result = product();
    if (at < tokens.length) fail(`has "${tokens[at]}" where an operator was expected`);
    return result;
}

/** The library directory the factors are read from, found from this module up to the package root. */
function libraryDirectory(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++, dir = resolve(dir, '..')) {
        const candidate = join(dir, LIBRARY);
        if (existsSync(join(candidate, 'SI.sysml'))) return candidate;
    }
    throw new Error(`The unit library (${LIBRARY}) is not in this installation, so a quantity cannot be read as a number.`);
}

/** The prefixes and units a library's two source files declare. */
export function readUnitTable(siPrefixes: string, si: string): UnitTable {
    const prefixes = new Map<string, number>();
    const prefixSymbols: Record<string, string> = {};
    for (const m of siPrefixes.matchAll(/attribute\s+(\w+)\s*:\s*UnitPrefix\s*\{([^}]*?conversionFactor\s*=\s*([0-9.eE+-]+)\s*;)/g)) {
        prefixes.set(m[1], Number(m[3]));
        const symbol = m[2].match(/symbol\s*=\s*"([^"]+)"/);
        if (symbol) prefixSymbols[m[1]] = symbol[1];
    }
    const unitSymbols: Record<string, string> = {};

    interface Declared { short?: string; reference?: string; factor?: number; prefix?: string; expression?: string }
    const declared = new Map<string, Declared>();
    for (const line of si.split('\n')) {
        const head = line.match(/^\s*attribute\s+(?:<([^>]+)>\s*)?('[^']+'|\w+)\s*:\s*\w+Unit\b(.*)$/);
        if (!head) continue;
        const [, short, name, rest] = head;
        const entry: Declared = { short: short ? bare(short) : undefined };
        const [outside, ...inside] = rest.split('{');
        const expression = outside.match(/=\s*([^;]+?)\s*;?\s*$/);
        if (expression) entry.expression = expression[1];
        const body = inside.join('{');
        const reference = body.match(/referenceUnit\s*=\s*('[^']+'|\w+)/);
        const factor = body.match(/conversionFactor\s*=\s*([0-9.eE+-]+)/);
        const prefix = body.match(/:>>\s*prefix\s*=\s*(\w+)/);
        if (reference) entry.reference = bare(reference[1]);
        if (factor) entry.factor = Number(factor[1]);
        if (prefix) entry.prefix = prefix[1];
        declared.set(bare(name), entry);
        if (entry.short) { declared.set(entry.short, entry); unitSymbols[bare(name)] = entry.short; unitSymbols[entry.short] = entry.short; }
    }

    const units = new Map<string, Dimensioned>();
    const pending = new Set<string>();
    const unit = (name: string): Dimensioned | undefined => {
        if (name === DIMENSION_ONE) return NONE;
        const known = units.get(name);
        if (known) return known;
        const entry = declared.get(name);
        if (!entry || pending.has(name)) return undefined;
        pending.add(name);
        try {
            let result: Dimensioned | undefined;
            if (entry.expression) {
                try { result = evaluateExpression(entry.expression, lookup); } catch { result = undefined; }
            } else if (entry.reference) {
                const reference = unit(entry.reference);
                const by = entry.prefix ? prefixes.get(entry.prefix) : entry.factor;
                result = reference && by !== undefined ? { factor: by * reference.factor, powers: reference.powers } : undefined;
            } else {
                result = { factor: 1, powers: new Map([[entry.short ?? name, 1]]) };
            }
            if (result) { units.set(name, result); if (entry.short) units.set(entry.short, result); }
            return result;
        } finally {
            pending.delete(name);
        }
    };
    const lookup = (name: string): Dimensioned | undefined =>
        (prefixes.has(name) ? { factor: prefixes.get(name)!, powers: new Map() } : unit(name));
    for (const name of declared.keys()) unit(name);
    return { prefixes, units, symbols: { prefixes: prefixSymbols, units: unitSymbols } };
}

let table: UnitTable | undefined;

/** The unit table of the shipped library, read on first use. */
export function unitTable(): UnitTable {
    if (!table) {
        const dir = libraryDirectory();
        table = readUnitTable(readFileSync(join(dir, 'SIPrefixes.sysml'), 'utf8'), readFileSync(join(dir, 'SI.sysml'), 'utf8'));
    }
    return table;
}

/** The symbols of the library's prefixes and units. */
export function unitSymbols(): UnitSymbolsDTO {
    return unitTable().symbols;
}

/** Whether the text is written as a quantity, `<number> [<unit>]`. */
export function looksLikeQuantity(text: string): boolean {
    return QUANTITY.test(text);
}

/**
 * The text as a quantity in base units. Undefined when it is not written as
 * one; throws when it is but a name in its unit is not one the library defines
 * by a plain factor.
 */
export function parseQuantity(text: string, units: UnitTable = unitTable()): Quantity | undefined {
    const m = text.match(QUANTITY);
    if (!m) return undefined;
    const lookup = (name: string): Dimensioned | undefined => {
        const prefix = units.prefixes.get(name);
        return prefix !== undefined ? { factor: prefix, powers: new Map() } : units.units.get(name);
    };
    const unit = evaluateExpression(m[2], lookup);
    return { value: Number(m[1]) * unit.factor, dimension: describe(unit.powers) };
}

/** The library's symbols, or undefined where this installation has no copy of the library to read them from. */
export function libraryUnitSymbols(): UnitSymbolsDTO | undefined {
    try { return unitSymbols(); } catch { return undefined; }
}
