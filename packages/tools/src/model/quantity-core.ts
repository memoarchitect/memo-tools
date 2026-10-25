// ─── Quantities (browser-safe core): `20 [milli*second]` as a number ─────────────────────────────
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

import type { UnitSymbolsDTO } from './quantity-format.js';

/** A scale and the powers of the base units: `Hz` is 1 and `{ s: -1 }`. */
interface Dimensioned {
    factor: number;
    powers: ReadonlyMap<string, number>;
    /**
     * Set on a unit of an interval scale (`°C_abs`): a value is `x * factor + offset` in the scale's reference
     * unit. Such a unit stands alone: it cannot be multiplied, divided or raised to a power.
     */
    offset?: number;
}

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

const alone = (a: Dimensioned, b?: Dimensioned) => {
    if (a.offset !== undefined || b?.offset !== undefined) {
        throw new Error('A unit of an interval scale (such as an absolute temperature in degrees Celsius) cannot be combined with another unit');
    }
};

const times = (a: Dimensioned, b: Dimensioned, sign: 1 | -1 = 1): Dimensioned => {
    alone(a, b);
    const powers = new Map(a.powers);
    for (const [unit, power] of b.powers) {
        const next = (powers.get(unit) ?? 0) + sign * power;
        if (next === 0) powers.delete(unit); else powers.set(unit, next);
    }
    return { factor: sign === 1 ? a.factor * b.factor : a.factor / b.factor, powers };
};

const NONE: Dimensioned = { factor: 1, powers: new Map() };

const power = (a: Dimensioned, exponent: number): Dimensioned => {
    alone(a);
    return {
        factor: a.factor ** exponent,
        powers: new Map([...a.powers].map(([unit, p]) => [unit, p * exponent] as const)),
    };
};

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
    // A declaration is `attribute <short> name : …Unit`, then an expression (`= s^-1`), a body (`{ … }`) or `;`. The body
    // can run over lines (°C's conversion does), so it is matched by its braces.
    for (const head of si.matchAll(/attribute\s+(?:<([^>]+)>\s*)?('[^']+'|\w+)\s*:\s*\w+Unit\b/g)) {
        const [, short, name] = head;
        const entry: Declared = { short: short ? bare(short) : undefined };
        let at = head.index! + head[0].length;
        let expression = '';
        let body = '';
        for (; at < si.length; at++) {
            const c = si[at];
            if (c === ';') break;
            if (c === '{') {
                let depth = 1;
                const start = at + 1;
                for (at = start; at < si.length && depth > 0; at++) depth += si[at] === '{' ? 1 : si[at] === '}' ? -1 : 0;
                body = si.slice(start, at);
                break;
            }
            expression += c;
        }
        const defined = expression.match(/=\s*([^,]+?)\s*$/);
        if (defined) entry.expression = defined[1];
        const reference = body.match(/referenceUnit\s*=\s*('[^']+'|\w+)/);
        const factor = body.match(/conversionFactor\s*=\s*([0-9.eE+/-]+)/);
        const prefix = body.match(/:>>\s*prefix\s*=\s*(\w+)/);
        if (reference) entry.reference = bare(reference[1]);
        if (factor) { const [n, d] = factor[1].split('/').map(Number); entry.factor = n / (d ?? 1); }
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
            if (entry.expression?.trim() === DIMENSION_ONE) {
                // The library gives the byte, the bit, the decibel, the erlang… the same definition, `= one`, though they
                // are units of different things (1 B is not 1 bit, a level is not a ratio). Each is its own base unit,
                // so two of them compare only when they are the same unit.
                result = { factor: 1, powers: new Map([[entry.short ?? name, 1]]) };
            } else if (entry.expression) {
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

    // Interval scales (`°C_abs`) carry a zero shift: the scale's zero in a reference unit, declared beside them as
    // `zeroDegreeCelsiusInKelvin : ThermodynamicTemperatureValue = 273.15 [K]`.
    for (const m of si.matchAll(/attribute\s+(?:<([^>]+)>\s*)?('[^']+'|\w+)\s*:\s*IntervalScale\s*\{/g)) {
        const start = m.index! + m[0].length;
        let depth = 1;
        let end = start;
        for (; end < si.length && depth > 0; end++) depth += si[end] === '{' ? 1 : si[end] === '}' ? -1 : 0;
        const block = si.slice(start, end);
        const scale = block.match(/:>>\s*unit\s*=\s*('[^']+'|\w+)/);
        const zero = block.match(/zero\w*\s*:\s*\w+\s*=\s*([-0-9.eE+/]+)\s*\[('[^']+'|\w+)\]/);
        const base = scale && unit(bare(scale[1]));
        const reference = zero && unit(bare(zero[2]));
        if (!base || !reference || !zero) continue;
        const [num, den] = zero[1].split('/').map(Number);
        const shift = (num / (den ?? 1)) * reference.factor;
        const result: Dimensioned = { factor: base.factor, powers: base.powers, offset: shift };
        units.set(bare(m[2]), result);
        if (m[1]) units.set(bare(m[1]), result);
        unitSymbols[bare(m[2])] = m[1] ? bare(m[1]) : bare(m[2]);
        if (m[1]) unitSymbols[bare(m[1])] = bare(m[1]);
    }
    return { prefixes, units, symbols: { prefixes: prefixSymbols, units: unitSymbols } };
}

/** A unit table as plain data, so the model can carry it to a surface that cannot read the library. */
export interface UnitTableDTO {
    prefixes: Record<string, number>;
    units: Record<string, { factor: number; powers: Record<string, number>; offset?: number }>;
    symbols: UnitSymbolsDTO;
}

export function unitTableToDTO(table: UnitTable): UnitTableDTO {
    return {
        prefixes: Object.fromEntries(table.prefixes),
        units: Object.fromEntries([...table.units].map(([name, u]) => [name, { factor: u.factor, powers: Object.fromEntries(u.powers), ...(u.offset !== undefined ? { offset: u.offset } : {}) }])),
        symbols: table.symbols,
    };
}

export function unitTableFromDTO(dto: UnitTableDTO): UnitTable {
    return {
        prefixes: new Map(Object.entries(dto.prefixes)),
        units: new Map(Object.entries(dto.units).map(([name, u]) => [name, { factor: u.factor, powers: new Map(Object.entries(u.powers)), ...(u.offset !== undefined ? { offset: u.offset } : {}) }])),
        symbols: dto.symbols,
    };
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
export function parseQuantity(text: string, units: UnitTable): Quantity | undefined {
    const m = text.match(QUANTITY);
    if (!m) return undefined;
    const lookup = (name: string): Dimensioned | undefined => {
        const prefix = units.prefixes.get(name);
        if (name === DIMENSION_ONE) return NONE;
        return prefix !== undefined ? { factor: prefix, powers: new Map() } : units.units.get(name);
    };
    const unit = evaluateExpression(m[2], lookup);
    return { value: Number(m[1]) * unit.factor + (unit.offset ?? 0), dimension: describe(unit.powers) };
}


/**
 * A quantity's number in `unit` (a unit expression, as written inside the brackets), through the base units: the
 * scale and, for an interval scale, the shift. Throws, saying why, when the text is not a quantity or is not in
 * the unit's dimension.
 */
export function convertQuantity(text: string, unit: string, units: UnitTable): number {
    const quantity = parseQuantity(text, units);
    if (!quantity) throw new Error(`"${text}" is not a quantity, so it cannot be shown in ${unit}`);
    const zero = parseQuantity(`0 [${unit}]`, units)!;
    const one = parseQuantity(`1 [${unit}]`, units)!;
    if (quantity.dimension !== one.dimension) {
        throw new Error(`"${text}" (${quantity.dimension}) is not a quantity in ${unit} (${one.dimension})`);
    }
    return Number(((quantity.value - zero.value) / (one.value - zero.value)).toPrecision(6));
}
