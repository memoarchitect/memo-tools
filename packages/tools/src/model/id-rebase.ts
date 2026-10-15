// ─── Ids that two branches both handed out ───────────────────────────────────
//
// A short id is the next free number in its prefix family. Two branches that each add an element
// take the same next number (`REQ-124` on both), and both entries survive a merge of
// `memo.identity.yaml` because they are different keys. The model then has two elements with one id.
//
// This plans the repair, measured against the branch the work is going to land on:
//
//   * the target's ids are kept: an element the target already has keeps its id, whatever the
//     branch's file says;
//   * an element the target does not have, whose number is at or below the target's high-water mark
//     in its family (a number the target already handed out, or retired), gets the next free
//     number above it;
//   * a number above the mark is left alone. It collides with nothing in the target, and renumbering
//     it would repoint a reference for no reason.
//
//   * two new elements that took the same number above the mark (two sibling branches merged into
//     this one) are told apart by key order: the first keeps the number, the others are renumbered.
//
// The same is done for ids an author wrote in a `providedId` literal, which are text in a source
// file: a literal that appears more often than at the target. Which occurrences are the branch's own
// comes from the lines the branch added or changed when the caller has them (`added`, from a diff
// against the target); without that, the last occurrences in a file are taken to be the branch's.
// ─────────────────────────────────────────────────────────────────────────────

import { parseShortId } from './short-id.js';
import type { IdentityRegistry } from './identity-registry.js';

export interface IdChange {
    /** The registry key, or `file:line` for an authored id. */
    where: string;
    from: string;
    to: string;
}

export interface RegistryRebase {
    registry: IdentityRegistry;
    changes: IdChange[];
}

/** Renumber the branch's new short ids that collide with the target's. */
export function rebaseRegistry(target: IdentityRegistry, branch: IdentityRegistry): RegistryRebase {
    const highWater = new Map<string, number>();
    const take = (shortId: string | undefined) => {
        const parsed = shortId ? parseShortId(shortId) : null;
        if (parsed) highWater.set(parsed.prefix, Math.max(highWater.get(parsed.prefix) ?? 0, parsed.seq));
    };
    for (const entry of Object.values(target)) take(entry.shortId);
    const targetHigh = new Map(highWater);
    for (const [key, entry] of Object.entries(branch)) if (key in target) take(entry.shortId);

    const registry: IdentityRegistry = {};
    const changes: IdChange[] = [];
    const fresh = Object.keys(branch).filter(key => !(key in target)).sort((a, b) => {
        const pa = parseShortId(branch[a].shortId ?? ''); const pb = parseShortId(branch[b].shortId ?? '');
        return (pa?.seq ?? 0) - (pb?.seq ?? 0) || a.localeCompare(b);
    });
    for (const [key, entry] of Object.entries(branch)) if (key in target) registry[key] = target[key] ?? entry;
    // Keep the branch's own ids that do not collide, so the new numbers stay clear of them.
    // Two new elements with one number above the target's mark are two sibling branches' work merged
    // into this one: nothing in the target says which came first, so the first in key order keeps it.
    const colliding = new Set<string>();
    const kept = new Set<string>();
    for (const key of fresh) {
        const shortId = branch[key].shortId;
        const parsed = shortId ? parseShortId(shortId) : null;
        if (parsed && (parsed.seq <= (targetHigh.get(parsed.prefix) ?? 0) || kept.has(shortId!))) colliding.add(key);
        else {
            take(shortId);
            if (shortId) kept.add(shortId);
        }
    }
    for (const key of fresh) {
        const entry = branch[key];
        const parsed = entry.shortId ? parseShortId(entry.shortId) : null;
        if (!colliding.has(key) || !parsed) { registry[key] = entry; continue; }
        const next = (highWater.get(parsed.prefix) ?? 0) + 1;
        highWater.set(parsed.prefix, next);
        const to = `${parsed.prefix}-${next}`;
        registry[key] = { ...entry, shortId: to };
        changes.push({ where: key, from: entry.shortId!, to });
    }
    return { registry, changes };
}

/** `providedId = "X"` literals in a source text: the id, and where its quoted text starts and ends. */
export function providedIdLiterals(text: string): { id: string; start: number; end: number; line: number }[] {
    const out: { id: string; start: number; end: number; line: number }[] = [];
    const pattern = /providedId\s*=\s*"([^"\\]+)"/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const start = match.index + match[0].indexOf('"') + 1;
        out.push({ id: match[1], start, end: start + match[1].length, line: text.slice(0, start).split('\n').length });
    }
    return out;
}

export interface ProvidedIdRebase {
    /** New text of each file that changes, keyed by project-relative path. */
    files: Map<string, string>;
    changes: IdChange[];
}

/**
 * Renumber authored ids that two branches both wrote. `targetTexts` and `branchTexts` are the project's
 * `.sysml` files at each side. A literal is a collision when the working tree holds it more often than
 * the target does (summed over files); the surplus occurrences, taken from the files that have more of it
 * than the target's copy of that file, are the branch's.
 */
export function rebaseProvidedIds(
    targetTexts: ReadonlyMap<string, string>, branchTexts: ReadonlyMap<string, string>,
    /** Per file, the 1-based lines the branch added or changed against the target. */
    added?: ReadonlyMap<string, ReadonlySet<number>>,
): ProvidedIdRebase {
    const count = (texts: ReadonlyMap<string, string>) => {
        const total = new Map<string, number>();
        const perFile = new Map<string, Map<string, number>>();
        for (const [file, text] of texts) {
            const here = new Map<string, number>();
            for (const { id } of providedIdLiterals(text)) {
                here.set(id, (here.get(id) ?? 0) + 1);
                total.set(id, (total.get(id) ?? 0) + 1);
            }
            perFile.set(file, here);
        }
        return { total, perFile };
    };
    const target = count(targetTexts);
    const branch = count(branchTexts);
    const used = new Set(branch.total.keys());
    const highWater = new Map<string, number>();
    for (const id of new Set([...target.total.keys(), ...branch.total.keys()])) {
        const parsed = parseShortId(id);
        if (parsed) highWater.set(parsed.prefix, Math.max(highWater.get(parsed.prefix) ?? 0, parsed.seq));
    }

    const files = new Map<string, string>();
    const changes: IdChange[] = [];
    for (const [id, total] of branch.total) {
        const wasThere = target.total.get(id) ?? 0;
        const parsed = parseShortId(id);
        if (!parsed || total <= 1) continue;
        // With the diff, the branch's occurrences are the ones on lines it added. One the target never
        // had may stay once (the first), since it clashes only with a sibling's copy of it.
        const ownOf = (file: string, text: string) => providedIdLiterals(text)
            .filter(literal => literal.id === id && added?.get(file)?.has(literal.line));
        let spare = wasThere === 0 ? 1 : 0;
        for (const [file, text] of branchTexts) {
            const hereNow = branch.perFile.get(file)?.get(id) ?? 0;
            const hadHere = target.perFile.get(file)?.get(id) ?? 0;
            let surplus: ReturnType<typeof providedIdLiterals>;
            if (added) {
                const own = ownOf(file, text);
                const skip = Math.min(spare, own.length);
                spare -= skip;
                surplus = own.slice(skip);
            } else {
                // More copies than the target had: the extra ones are new, and clash.
                if (wasThere === 0 || total <= wasThere || hereNow <= hadHere) continue;
                // The surplus occurrences in this file are the last ones: the target's copies come first in
                // the file the branch only added to.
                surplus = providedIdLiterals(text).filter(literal => literal.id === id).slice(hadHere);
            }
            if (surplus.length === 0) continue;
            let edited = files.get(file) ?? text;
            for (const literal of surplus.reverse()) {
                const next = (highWater.get(parsed.prefix) ?? 0) + 1;
                highWater.set(parsed.prefix, next);
                const to = `${parsed.prefix}-${next}`;
                used.add(to);
                edited = edited.slice(0, literal.start) + to + edited.slice(literal.end);
                changes.push({ where: `${file}:${literal.line}`, from: id, to });
            }
            files.set(file, edited);
        }
    }
    return { files, changes };
}
