#!/usr/bin/env node
// ─── MEMO graph diff ─────────────────────────────────────────────────────────
//
// Compares two `memo export json` outputs: the acceptance check for re-homing
// the builder onto stage 1's API JSON (plans/memo-compiler-stages-opensysml.md,
// milestone 2). Two graphs are equal when they hold the same elements, the same
// relationships and the same rule findings.
//
// Everything is compared by IDENTITY, never by position: an element by its id
// (its qualified name), a relationship by (type, source, target), a finding by
// (rule, element). Source ranges are reported only when an element that exists
// on both sides sits in a different file; offsets are not compared, because a
// provider's positions are its own and the diff is about what the model says.
//
// Usage: node scripts/diff-memo-graph.mjs BASELINE.json CANDIDATE.json [--limit N]
// Exit 0 when equal, 1 when they differ, 2 on bad input.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args.splice(limitAt, 2)[1]) : 20;
if (args.length !== 2) {
    console.error('usage: diff-memo-graph.mjs BASELINE.json CANDIDATE.json [--limit N]');
    process.exit(2);
}

/** A `memo export json` file carries the model under `model`; a bare DTO is accepted too. */
function load(path) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const model = raw.model ?? raw;
    if (!model.elements || !model.relationships) {
        console.error(`${path}: not a MEMO model export (no elements/relationships)`);
        process.exit(2);
    }
    const elements = Array.isArray(model.elements)
        ? new Map(model.elements.map(e => [e.id, e]))
        : new Map(Object.entries(model.elements));
    return { elements, relationships: model.relationships, violations: raw.validation?.violations ?? [] };
}

// Fields that say what an element IS. Source offsets and derived presentation
// are left out on purpose (see the header).
const ELEMENT_FIELDS = ['kind', 'construct', 'layer', 'file', 'package', 'name', 'shortName'];

const stable = value => JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v);

const relationshipKey = r => `${r.type} ${r.sourceId} -> ${r.targetId}`;
const violationKey = v => `${v.ruleId} ${v.elementId}`;

function multiset(items, key) {
    const counts = new Map();
    for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
    return counts;
}

function multisetDiff(a, b) {
    const onlyA = [], onlyB = [];
    for (const [k, n] of a) for (let i = (b.get(k) ?? 0); i < n; i++) onlyA.push(k);
    for (const [k, n] of b) for (let i = (a.get(k) ?? 0); i < n; i++) onlyB.push(k);
    return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

const base = load(args[0]);
const cand = load(args[1]);

const missing = [...base.elements.keys()].filter(id => !cand.elements.has(id)).sort();
const extra = [...cand.elements.keys()].filter(id => !base.elements.has(id)).sort();
const changed = [];
for (const [id, b] of base.elements) {
    const c = cand.elements.get(id);
    if (!c) continue;
    const fields = ELEMENT_FIELDS.filter(f => stable(b[f]) !== stable(c[f]));
    if (stable(b.attributes ?? {}) !== stable(c.attributes ?? {})) fields.push('attributes');
    if (fields.length) changed.push({ id, fields, base: b, cand: c });
}
const rels = multisetDiff(multiset(base.relationships, relationshipKey), multiset(cand.relationships, relationshipKey));
const viol = multisetDiff(multiset(base.violations, violationKey), multiset(cand.violations, violationKey));

const show = (title, list, render = x => x) => {
    console.log(`${title}: ${list.length}`);
    for (const item of list.slice(0, limit)) console.log(`  ${render(item)}`);
    if (list.length > limit) console.log(`  … ${list.length - limit} more`);
};
console.log(`elements   ${base.elements.size} → ${cand.elements.size}`);
console.log(`relations  ${base.relationships.length} → ${cand.relationships.length}`);
console.log(`findings   ${base.violations.length} → ${cand.violations.length}`);
show('elements missing from candidate', missing);
show('elements only in candidate', extra);
show('elements that differ', changed, ({ id, fields, base: b, cand: c }) =>
    `${id}: ${fields.map(f => f === 'attributes' ? 'attributes' : `${f} ${JSON.stringify(b[f])} → ${JSON.stringify(c[f])}`).join('; ')}`);
show('relationships missing from candidate', rels.onlyA);
show('relationships only in candidate', rels.onlyB);
show('findings missing from candidate', viol.onlyA);
show('findings only in candidate', viol.onlyB);

const equal = !missing.length && !extra.length && !changed.length
    && !rels.onlyA.length && !rels.onlyB.length && !viol.onlyA.length && !viol.onlyB.length;
console.log(equal ? 'EQUAL' : 'DIFFERENT');
process.exit(equal ? 0 : 1);
