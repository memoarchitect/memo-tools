// ─── A quantity as a person writes it: `20 [milli*second]` is `20 ms` ────────
//
// Browser-safe: the symbols arrive with the model (read from the standard
// library by the tools that build it), so no surface carries a table of its own.
// ─────────────────────────────────────────────────────────────────────────────

/** The symbols the standard library gives its prefixes and units, by name. */
export interface UnitSymbolsDTO {
    /** `milli` → `m`. */
    prefixes: Record<string, string>;
    /** `second` → `s`; a unit written by its symbol maps to itself. */
    units: Record<string, string>;
}

const QUANTITY = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\[([^\]]+)\]\s*$/;

/**
 * `20 [milli*second]` as `20 ms`: a prefix followed by `*` and a unit is written
 * joined, other products keep their operator, and a name the library has no
 * symbol for stays as written. Undefined when the text is not a quantity.
 */
export function formatQuantity(text: string, symbols: UnitSymbolsDTO | undefined): string | undefined {
    const m = text.match(QUANTITY);
    if (!m || !symbols) return undefined;
    const name = (token: string) => token.replace(/^'|'$/g, '');
    const parts = m[2].split(/([*/^()])/).map(part => part.trim()).filter(Boolean);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '*' && i > 0 && i + 1 < parts.length && symbols.prefixes[name(parts[i - 1])] !== undefined && /^[^*/^()]/.test(parts[i + 1])) continue;
        if (/^[*/^()]$/.test(part)) { out += part === '*' ? '⋅' : part; continue; }
        out += symbols.prefixes[name(part)] ?? symbols.units[name(part)] ?? name(part);
    }
    return `${m[1]} ${out}`;
}
