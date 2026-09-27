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
// Usage: node scripts/diff-memo-graph.mjs BASELINE.json CANDIDATE.json [--limit N] [--elements-only]
// `--elements-only` compares elements alone, leaving out relationships, rule
// findings and the fields relationships set (`allocatedTo`): the check for a
// builder that does not build relationships yet.
//
// `--by-meaning` compares three things by what they mean rather than how they
// are spelled, because a graph built from standard API JSON has the element but
// not the source's spelling of it:
//   - `expose` paths, by the element or package each path resolves to (`fmea`,
//     `pkg::fmea` and the full qualified name are one expose);
//   - numeric attribute values, numerically (`0.20` and `0.2`);
//   - an anonymous terminate node's display name, which MEMO's own grammar set to
//     its private node-type name `TerminateUsage`; the kind says what it is.
// Exit 0 when equal, 1 when they differ, 2 on bad input.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args.splice(limitAt, 2)[1]) : 20;
const elementsOnlyAt = args.indexOf('--elements-only');
const elementsOnly = elementsOnlyAt >= 0 && Boolean(args.splice(elementsOnlyAt, 1));
const byMeaningAt = args.indexOf('--by-meaning');
const byMeaning = byMeaningAt >= 0 && Boolean(args.splice(byMeaningAt, 1));
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
    if (byMeaning) normalize(elements, model.packages ?? []);
    if (elementsOnly) {
        for (const element of elements.values()) delete element.allocatedTo;
        return { elements, relationships: [], violations: [] };
    }
    return { elements, relationships: model.relationships, violations: raw.validation?.violations ?? [] };
}

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Rewrite the three spelling-only fields to a canonical meaning (see the header). */
function normalize(elements, packages) {
    const names = [...elements.keys(), ...packages.map(p => p.qualifiedName)];
    const resolvePath = path => {
        const suffix = path.match(/::\*\*?$/)?.[0] ?? '';
        const bare = suffix ? path.slice(0, -suffix.length) : path;
        const hits = names.filter(n => n === bare || n.endsWith(`::${bare}`));
        return `${hits.length === 1 ? hits[0] : bare}${suffix}`;
    };
    for (const element of elements.values()) {
        const attributes = element.attributes ?? {};
        if (attributes.expose) attributes.expose = attributes.expose.split(',').map(resolvePath).sort().join(',');
        for (const [key, value] of Object.entries(attributes)) {
            if (typeof value === 'string' && NUMBER.test(value)) attributes[key] = String(Number(value));
        }
        if (element.kind === 'ActivityFinalNodeUsage') element.name = element.kind;
    }
}

// Fields that say what an element IS. Source offsets and derived presentation
// are left out on purpose (see the header).
const ELEMENT_FIELDS = [
    'kind', 'construct', 'layer', 'file', 'package', 'name', 'shortName', 'doc', 'owner', 'parentAction',
    'isDefinition', 'portSpec', 'parameters', 'ownedPorts', 'allocatedTo',
];

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
