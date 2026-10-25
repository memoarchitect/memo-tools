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
// Supported: `<number> [<prefix>*…<unit>]`, where a unit is declared as a base
// unit or with a `ConversionByConvention` / `ConversionByPrefix`. A unit
// defined by an expression (`Hz = s^-1`) is not read; a quantity in one is
// refused, not guessed.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY = join('corpus', 'sysml-v2-release', 'sysml.library', 'Domain Libraries', 'Quantities and Units');

/** What a quantity is in: the dimension (the unit's declared type) and the factor to that dimension's base unit. */
export interface Quantity {
    /** The value in the dimension's base unit. */
    value: number;
    /** The declaring unit type, e.g. `DurationUnit`. */
    dimension: string;
}

interface UnitEntry { dimension: string; factor: number }

export interface UnitTable {
    prefixes: ReadonlyMap<string, number>;
    units: ReadonlyMap<string, UnitEntry>;
}

const QUANTITY = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\[([^\]]+)\]\s*$/;

/** Names are written bare or quoted; the table keys the bare spelling. */
const bare = (name: string) => name.trim().replace(/^'|'$/g, '');

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
    for (const m of siPrefixes.matchAll(/attribute\s+(\w+)\s*:\s*UnitPrefix\s*\{[^}]*?conversionFactor\s*=\s*([0-9.eE+-]+)\s*;/g)) {
        prefixes.set(m[1], Number(m[2]));
    }

    interface Declared { dimension: string; short?: string; reference?: string; factor?: number; prefix?: string; derived: boolean }
    const declared = new Map<string, Declared>();
    for (const line of si.split('\n')) {
        const head = line.match(/^\s*attribute\s+(?:<([^>]+)>\s*)?('[^']+'|\w+)\s*:\s*(\w+Unit)\b(.*)$/);
        if (!head) continue;
        const [, short, name, dimension, rest] = head;
        const entry: Declared = { dimension, short: short ? bare(short) : undefined, derived: /^\s*=/.test(rest) };
        const reference = rest.match(/referenceUnit\s*=\s*('[^']+'|\w+)/);
        const factor = rest.match(/conversionFactor\s*=\s*([0-9.eE+-]+)/);
        const prefix = rest.match(/:>>\s*prefix\s*=\s*(\w+)/);
        if (reference) entry.reference = bare(reference[1]);
        if (factor) entry.factor = Number(factor[1]);
        if (prefix) entry.prefix = prefix[1];
        declared.set(bare(name), entry);
        if (entry.short) declared.set(entry.short, entry);
    }

    const units = new Map<string, UnitEntry>();
    const factorOf = (entry: Declared, depth = 0): number | undefined => {
        if (entry.derived || depth > 8) return undefined;
        if (!entry.reference) return 1;
        const reference = declared.get(entry.reference);
        const base = reference ? factorOf(reference, depth + 1) : undefined;
        if (base === undefined) return undefined;
        const by = entry.prefix ? prefixes.get(entry.prefix) : entry.factor;
        return by === undefined ? undefined : by * base;
    };
    for (const [name, entry] of declared) {
        const factor = factorOf(entry);
        if (factor !== undefined) units.set(name, { dimension: entry.dimension, factor });
    }
    return { prefixes, units };
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

/** Whether the text is written as a quantity, `<number> [<unit>]`. */
export function looksLikeQuantity(text: string): boolean {
    return QUANTITY.test(text);
}

/**
 * The text as a quantity in its dimension's base unit. Undefined when it is not
 * written as one; throws when it is but its unit is not one the library
 * defines by a plain factor.
 */
export function parseQuantity(text: string, units: UnitTable = unitTable()): Quantity | undefined {
    const m = text.match(QUANTITY);
    if (!m) return undefined;
    const names = m[2].split('*').map(bare);
    const unitName = names[names.length - 1];
    const unit = units.units.get(unitName);
    let scale = 1;
    for (const prefix of names.slice(0, -1)) {
        const factor = units.prefixes.get(prefix);
        if (factor === undefined) throw new Error(`"${prefix}" in ${text} is not a unit prefix of the standard library`);
        scale *= factor;
    }
    if (!unit) throw new Error(`"${unitName}" in ${text} is not a unit the standard library defines by a plain factor`);
    return { value: Number(m[1]) * scale * unit.factor, dimension: unit.dimension };
}
