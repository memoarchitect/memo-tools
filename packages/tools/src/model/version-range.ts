// ─── Does a version satisfy a range ──────────────────────────────────────────
//
// The ranges a dependency names: `*` or nothing (any), an exact `1.2.0`, `^1.2.0`
// (the same major; a 0.x caret keeps the minor), `~1.2.0` (the same minor) and
// `>=1.2.0`. Prerelease and build tags are ignored. A range this does not
// recognise is not satisfied by anything, so a typo is an error and not a pass.
// ─────────────────────────────────────────────────────────────────────────────

const parts = (version: string): [number, number, number] | undefined => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined;
};

const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function satisfiesRange(version: string | undefined, range: string | undefined): boolean {
    const wanted = (range ?? '').trim();
    if (wanted === '' || wanted === '*') return true;
    const have = version ? parts(version) : undefined;
    if (!have) return false;
    const op = /^(\^|~|>=)?\s*(.+)$/.exec(wanted);
    const base = op ? parts(op[2]) : undefined;
    if (!op || !base) return false;
    switch (op[1]) {
        case '>=': return compare(have, base) >= 0;
        case '~': return compare(have, base) >= 0 && have[0] === base[0] && have[1] === base[1];
        case '^': {
            if (compare(have, base) < 0) return false;
            if (base[0] > 0) return have[0] === base[0];
            return have[0] === 0 && have[1] === base[1];
        }
        default: return compare(have, base) === 0;
    }
}
