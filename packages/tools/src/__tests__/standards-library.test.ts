// The standards library is what makes "adding a standard is one file and zero
// TypeScript" true rather than aspirational — and the only thing that can hold
// it to that is a test that reads every citation in every shipped template and
// insists the library answers it.
//
// The failure this pins: before Phase 2 there were five places a clause
// reference lived and they disagreed (fmea's frontmatter said ISO 14971:2019
// while DHF_DOCUMENT_TYPES said IEC 60812:2018 for the same document). In a
// regulated artifact, two registries that disagree is the defect — not either
// value. Now there is one library, and a citation that does not resolve is a
// red test rather than a plausible line in a submission.

import { describe, it, expect } from 'vitest';
import {
    loadStandardsLibrary, parseClauseReference, resolveClause,
} from '../dhf/standards-library.js';
import { listBuiltinTemplates } from '../dhf/template-resolver.js';

const library = loadStandardsLibrary();
const templates = listBuiltinTemplates();

// Templates that carry compliance content. `shared/snippets/` holds document
// fragments — an approval block claims no clause. `listBuiltinTemplates` ids
// them as `snippets/x` rather than `shared/snippets/x`, so the directory name
// is what excludes them; the `shared/` prefix never matches.
const documentTemplates = templates.filter(t => t.standard !== 'snippets' && !t.id.startsWith('shared/'));

describe('standards library', () => {
    it('is reachable from the installed ontology', () => {
        expect(library.sourceDir).not.toBeNull();
        expect(library.standards.size).toBeGreaterThan(0);
    });

    it('has no clause that composes into no standard', () => {
        // A clause with no containment link resolves to nothing and reports in
        // no coverage total — it is present in the file and absent from the
        // library, which is the silent-empty failure mode in miniature.
        expect(library.orphanClauses.map(c => c.name)).toEqual([]);
    });

    it('carries a clause number on every clause', () => {
        for (const std of library.standards.values()) {
            for (const [number, clause] of std.clauses) {
                expect(number, `${std.designation} ${clause.name}`).not.toBe('');
            }
        }
    });
});

describe('the regulatory regime axis', () => {
    it('reads the regime vocabulary from the ontology enum, not from TypeScript', () => {
        // If this list ever needs editing here, the axis has stopped being
        // ontology data. Adding UKCA must be one enum member and no TS change.
        expect(library.regimeVocabulary).toEqual(['CE', 'MDR', 'UKCA', 'FDA_510k', 'FDA_PMA']);
    });

    it('accepts only the qualified spelling of a regime', () => {
        expect(library.unknownRegimes).toEqual([]);
    });

    it('names exactly the standards no regime mandates', () => {
        // Empty `appliesToRegime` is an authored value meaning "no submission
        // regime requires this" — a method or reference standard. Because it
        // is meaningful, it must not also be able to mean "the author forgot",
        // so the regime-free set is pinned here. A pack that loses its regimes
        // fails this test instead of quietly dropping out of required().
        const regimeFree = [...library.standards.values()]
            .filter(s => s.regimes.length === 0)
            .map(s => s.designation)
            .sort();
        expect(regimeFree).toEqual(['IEC 60812:2018', 'ISO/IEC/IEEE 42010:2022']);
    });

    it('cites only members the enum declares', () => {
        for (const std of library.standards.values()) {
            for (const regime of std.regimes) {
                expect(library.regimeVocabulary, std.designation).toContain(regime);
            }
        }
    });

    it('scopes 21 CFR Part 820 to the FDA regimes only', () => {
        // The axis is worth nothing if every standard applies everywhere. This
        // is the case that makes a CE-only project's report shorter than a
        // 510(k) project's.
        expect(library.standards.get('21 CFR Part 820')?.regimes).toEqual(['FDA_510k', 'FDA_PMA']);
        expect(library.standards.get('ISO 13485:2016')?.regimes).toEqual(['CE', 'MDR', 'UKCA']);
    });
});

describe('clause reference grammar', () => {
    it('reads a bare entry against the document own standard', () => {
        const ref = parseClauseReference('5.4', 'IEC 62366-1:2015+AMD1:2020');
        expect(ref).toMatchObject({
            designation: 'IEC 62366-1:2015+AMD1:2020', clauseNumber: '5.4', qualified: false,
        });
    });

    it('reads a qualified entry against the designation it names', () => {
        const ref = parseClauseReference('ISO 14971:2019 §7', 'IEC 60812:2018');
        expect(ref).toMatchObject({
            designation: 'ISO 14971:2019', clauseNumber: '7', qualified: true,
        });
    });

    it('keeps amendments in the designation it matches on', () => {
        // Dropping "+AMD1:2020" is a CE/MDR regression, so the amended and
        // unamended designations must not be the same key.
        const ref = parseClauseReference('IEC 62366-1:2015 §5.4');
        expect(library.standards.has(ref.designation)).toBe(false);
        expect(library.standards.has('IEC 62366-1:2015+AMD1:2020')).toBe(true);
    });

    it('reports a designation the library does not carry', () => {
        const result = resolveClause(library, 'ISO 99999:2030 §1');
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe('unknown-standard');
    });

    it('reports a clause the standard does not declare', () => {
        const result = resolveClause(library, 'IEC 62304:2006+AMD1:2015 §99.99');
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe('unknown-clause');
    });
});

describe('every shipped template resolves against the library', () => {
    it('found the templates at all', () => {
        // A glob or a resolver that matches nothing is not an error by itself,
        // so the count is asserted before anything iterates over it.
        expect(documentTemplates.length).toBeGreaterThan(30);
    });

    it('names a standard the library carries', () => {
        const unresolved: string[] = [];
        for (const t of documentTemplates) {
            const designation = t.frontmatter.standard;
            if (!designation || !library.standards.has(designation)) {
                unresolved.push(`${t.id}: ${designation ?? '(none)'}`);
            }
        }
        expect(unresolved).toEqual([]);
    });

    it('cites only clauses the library declares', () => {
        const unresolved: string[] = [];
        for (const t of documentTemplates) {
            for (const entry of t.frontmatter.clauses ?? []) {
                const result = resolveClause(library, entry, t.frontmatter.standard);
                if (!result.ok) unresolved.push(`${t.id}: "${entry}" — ${result.reason}`);
            }
        }
        expect(unresolved).toEqual([]);
    });

    it('maps every standard directory to a RegulatoryStandard', () => {
        // The directory is the unit the Architect groups by and the template
        // resolver searches, so a directory whose documents claim a standard
        // the library has never heard of is a group that cannot be labelled.
        const byDirectory = new Map<string, Set<string>>();
        for (const t of documentTemplates) {
            if (!byDirectory.has(t.standard)) byDirectory.set(t.standard, new Set());
            if (t.frontmatter.standard) byDirectory.get(t.standard)!.add(t.frontmatter.standard);
        }
        expect(byDirectory.size).toBeGreaterThan(0);

        const unmapped: string[] = [];
        for (const [dir, designations] of byDirectory) {
            if (designations.size === 0) unmapped.push(`${dir}: no template names a standard`);
            for (const d of designations) {
                if (!library.standards.has(d)) unmapped.push(`${dir}: ${d}`);
            }
        }
        expect(unmapped).toEqual([]);
    });
});
