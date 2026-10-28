// ─── Quantities with units ───────────────────────────────────────────────────
//
// What the calculation evaluator multiplies and adds: a number and the units it is in
// (`600 [euro/hour]`). Conversions between units come from the SysML v2 library's own declarations
// (generated/si-units.ts); a unit the library does not declare (a project's currency) is a base unit
// of its own. Two quantities add only when their units reduce to the same base units.

import { SI_PREFIXES, SI_UNITS } from './generated/si-units.js';

/** A number in units: `units` maps a unit name to its exponent (`{ euro: 1, hour: -1 }`). */
export interface Quantity {
    num: number;
    units: Record<string, number>;
}

export const isQuantity = (value: unknown): value is Quantity =>
    typeof value === 'object' && value !== null && 'num' in value && 'units' in value;

/** A base unit and the factor from `unit` to it; a unit the library does not declare is its own base. */
function toBase(unit: string, seen = new Set<string>()): { base: string; factor: number } {
    const entry = SI_UNITS[unit];
    if (!entry || seen.has(unit)) return { base: unit, factor: 1 };
    seen.add(unit);
    if (entry.ref === undefined) return { base: entry.alias ?? unit, factor: 1 };
    const reference = toBase(entry.ref, seen);
    const factor = entry.prefix !== undefined ? (SI_PREFIXES[entry.prefix] ?? 1) : (entry.factor ?? 1);
    return { base: reference.base, factor: factor * reference.factor };
}

/** The quantity in base units: the number scaled, the units reduced to base units with zero exponents dropped. */
function normalize(q: Quantity): Quantity {
    let num = q.num;
    const units: Record<string, number> = {};
    for (const [unit, exponent] of Object.entries(q.units)) {
        const { base, factor } = toBase(unit);
        num *= factor ** exponent;
        units[base] = (units[base] ?? 0) + exponent;
    }
    for (const unit of Object.keys(units)) if (units[unit] === 0) delete units[unit];
    return { num, units };
}

const sameUnits = (a: Record<string, number>, b: Record<string, number>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => (a[key] ?? 0) === (b[key] ?? 0));
};

/** `[euro/hour]`, `[minute]`, `[one]`: a unit expression of names, `*`, `/` and `^`. `one` is no unit. */
export function parseUnits(text: string): Record<string, number> {
    const units: Record<string, number> = {};
    const [numerator, ...denominators] = text.split('/');
    const add = (part: string, sign: number) => {
        for (const factor of part.split('*')) {
            const match = /^\s*([^\s^]+)\s*(?:\^\s*(-?\d+))?\s*$/.exec(factor);
            if (!match || match[1] === 'one' || match[1] === '1') continue;
            units[match[1]] = (units[match[1]] ?? 0) + sign * Number(match[2] ?? 1);
        }
    };
    add(numerator, 1);
    for (const denominator of denominators) add(denominator, -1);
    return units;
}

/** `30 [minute]` → a quantity; a bare number stays a number; anything else is not one. */
export function parseQuantity(text: string): Quantity | number | undefined {
    const bare = /^\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/.exec(text);
    if (bare) return Number(bare[1]);
    const withUnit = /^\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*\[(.+)\]\s*$/.exec(text);
    return withUnit ? { num: Number(withUnit[1]), units: parseUnits(withUnit[2]) } : undefined;
}

export function multiply(a: Quantity | number, b: Quantity | number): Quantity | number {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    const left = typeof a === 'number' ? { num: a, units: {} } : a;
    const right = typeof b === 'number' ? { num: b, units: {} } : b;
    // a dimensionless factor scales the other and leaves its units as they were written
    if (Object.keys(left.units).length === 0) return { num: left.num * right.num, units: { ...right.units } };
    if (Object.keys(right.units).length === 0) return { num: left.num * right.num, units: { ...left.units } };
    const merged: Record<string, number> = { ...left.units };
    for (const [unit, exponent] of Object.entries(right.units)) merged[unit] = (merged[unit] ?? 0) + exponent;
    return normalize({ num: left.num * right.num, units: merged });
}

/** Sum in the units of the first term. Quantities of different units are an error, not a silent zero. */
export function add(terms: (Quantity | number)[]): Quantity | number {
    if (terms.length === 0) return 0;
    if (terms.every(term => typeof term === 'number')) return (terms as number[]).reduce((sum, term) => sum + term, 0);
    const quantities = terms.map(term => (typeof term === 'number' ? { num: term, units: {} } : term));
    const first = quantities[0];
    const reference = normalize(first);
    let total = 0;
    for (const term of quantities) {
        const reduced = normalize(term);
        if (!sameUnits(reduced.units, reference.units)) {
            throw new Error(`cannot add ${formatQuantity(term)} to ${formatQuantity(first)}: different units`);
        }
        total += reduced.num;
    }
    // back into the first term's own units
    const unitFactor = normalize({ num: 1, units: first.units }).num;
    return { num: total / unitFactor, units: { ...first.units } };
}

export function formatQuantity(q: Quantity | number): string {
    if (typeof q === 'number') return String(Math.round(q * 1e6) / 1e6);
    const positive = Object.entries(q.units).filter(([, e]) => e > 0).map(([u, e]) => (e === 1 ? u : `${u}^${e}`));
    const negative = Object.entries(q.units).filter(([, e]) => e < 0).map(([u, e]) => (e === -1 ? u : `${u}^${-e}`));
    const unit = positive.length || negative.length ? `${positive.join('*') || '1'}${negative.length ? `/${negative.join('/')}` : ''}` : 'one';
    return `${Math.round(q.num * 1e4) / 1e4} [${unit}]`;
}
