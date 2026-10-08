// ─── Baseline comparison ──────────────────────────────────────────────────────
//
// The differ and the verdict of `verify-baseline.mjs`, apart from the capture,
// so both can be tested without compiling a project.
//
// A list of elements, relationships or violations is matched by what it names,
// not by position. Respelling an id (qualified ids, a moved package) reorders the
// arrays, and by position every row after the first read as rewritten: ui-regions
// reported 463 changed elements when the real delta was zero. An element is
// matched by its leaf name (the last `::` segment of its id), a relationship by
// its type and the leaf names of its ends, a violation by its rule and the leaf
// name of its subject. A leaf name shared by two rows is told apart by order
// among the rows that share it.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const leaf = id => (typeof id === 'string' ? id.split('::').pop() : id);

/** What a row of a list is matched by, or undefined when the list is not one of these. */
function rowKey(item) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined;
    if (typeof item.type === 'string' && 'sourceId' in item && 'targetId' in item) {
        return `${item.type}: ${leaf(item.sourceId)} → ${leaf(item.targetId)}`;
    }
    if (typeof item.rule === 'string' && 'elementId' in item) return `${item.rule} on ${leaf(item.elementId)}`;
    if (typeof item.id === 'string') return leaf(item.id);
    return undefined;
}

/** The fields that name another element, compared by leaf name so a respelling is not a change. */
const NAMING_FIELDS = new Set(['id', 'sourceId', 'targetId', 'elementId']);

function keyed(list) {
    const seen = new Map();
    const rows = new Map();
    for (const item of list) {
        const base = rowKey(item);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        rows.set(n === 1 ? base : `${base} #${n}`, item);
    }
    return rows;
}

/** Structural diff limited to the projected facts, reported as dotted paths. */
export function diff(expected, actual, path = '', field = '') {
    if (NAMING_FIELDS.has(field) && typeof expected === 'string' && typeof actual === 'string') {
        return leaf(expected) === leaf(actual) ? [] : [`${path}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`];
    }
    if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
    if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
        return [`${path || '(root)'}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`];
    }
    if (Array.isArray(expected) !== Array.isArray(actual)) {
        return [`${path}: array/object shape changed`];
    }
    if (Array.isArray(expected)) {
        const matchable = [...expected, ...actual].length > 0
            && [...expected, ...actual].every(item => rowKey(item) !== undefined);
        if (!matchable) {
            if (expected.length !== actual.length) return [`${path}: length ${expected.length} → ${actual.length}`];
            return expected.flatMap((item, i) => diff(item, actual[i], `${path}[${i}]`));
        }
        const before = keyed(expected);
        const after = keyed(actual);
        return [
            ...[...before.keys()].filter(key => !after.has(key)).map(key => `${path}: removed ${key}`),
            ...[...after.keys()].filter(key => !before.has(key)).map(key => `${path}: added ${key}`),
            ...[...before.keys()].filter(key => after.has(key))
                .flatMap(key => diff(before.get(key), after.get(key), `${path}[${key}]`)),
        ];
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap(key =>
        diff(expected[key], actual[key], path ? `${path}.${key}` : key, key));
}

/**
 * Compare each fixture's capture with its frozen baseline. `checked` is the
 * fixtures that were compared, whether they matched or not; `unchecked` is the
 * ones that were not (no baseline to compare with). A fixture that diverged was
 * checked, so it is not INCOMPLETE.
 */
export function verify({ fixtures, baselineDir, capture, prepare = spec => spec, log = console.log, error = console.error }) {
    let checked = 0;
    let diverged = 0;
    const unchecked = [];
    for (const spec of fixtures) {
        const baselinePath = resolve(baselineDir, `${spec.id}.json`);
        if (!existsSync(baselinePath)) {
            error(`MISSING baseline for ${spec.id} — run capture-baseline.mjs`);
            unchecked.push(spec.id);
            continue;
        }
        const expected = JSON.parse(readFileSync(baselinePath, 'utf-8'));
        const actual = capture(prepare(spec));
        checked++;
        const diffs = diff(expected, actual);
        if (diffs.length === 0) {
            log(`OK   ${spec.id}`);
        } else {
            diverged++;
            error(`FAIL ${spec.id}`);
            for (const d of diffs.slice(0, 20)) error(`       ${d}`);
            if (diffs.length > 20) error(`       … ${diffs.length - 20} more`);
        }
    }
    if (unchecked.length > 0) {
        error(`INCOMPLETE baseline verification: checked ${checked}/${fixtures.length} fixtures, not checked: ${unchecked.join(', ')}.`);
    }
    const ok = diverged === 0 && unchecked.length === 0;
    log(ok ? '\nAll baselines match.' : `\n${diverged} fixture(s) diverged, ${unchecked.length} not checked.`);
    return { ok, checked, diverged, unchecked };
}
