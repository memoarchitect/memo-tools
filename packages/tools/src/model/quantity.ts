// ─── Quantities: the unit table read from the library source ─────────────────
//
// The algebra is in quantity-core.ts (browser-safe). This module is the part that
// reads the library the package ships: the vendored SysML v2 Release's
// `SIPrefixes.sysml` and `SI.sysml`, never a table written here.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuantity as parseWith, readUnitTable, unitTableToDTO, type Quantity, type UnitTable, type UnitTableDTO } from './quantity-core.js';
import type { UnitSymbolsDTO } from './quantity-format.js';

export { looksLikeQuantity, readUnitTable, type Quantity, type UnitTable, type UnitTableDTO } from './quantity-core.js';

const LIBRARY = join('corpus', 'sysml-v2-release', 'sysml.library', 'Domain Libraries', 'Quantities and Units');

/** The library directory the factors are read from, found from this module up to the package root. */
function libraryDirectory(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++, dir = resolve(dir, '..')) {
        const candidate = join(dir, LIBRARY);
        if (existsSync(join(candidate, 'SI.sysml'))) return candidate;
    }
    throw new Error(`The unit library (${LIBRARY}) is not in this installation, so a quantity cannot be read as a number.`);
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

/** The text as a quantity in base units (see quantity-core.ts), against the shipped library by default. */
export function parseQuantity(text: string, units: UnitTable = unitTable()): Quantity | undefined {
    return parseWith(text, units);
}

/** The table as data for the model to ship, or undefined where this installation has no copy of the library. */
export function libraryUnitTable(): UnitTableDTO | undefined {
    try { return unitTableToDTO(unitTable()); } catch { return undefined; }
}
