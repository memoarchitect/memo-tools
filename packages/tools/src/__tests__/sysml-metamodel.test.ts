// ─── The generated metamodel (Track B B2) ────────────────────────────────────
//
// Two things are worth testing about generated code, and they are not the same
// thing. The first is that regenerating produces exactly what is committed —
// otherwise the committed file is a snapshot of some past input and nobody can
// tell. The second is that what was generated is a faithful reading of
// `SysML.ecore` rather than a plausible-looking subset, which is what the shape
// assertions below are for: they are stated against Session 0's measurement, so
// a regex that silently stops matching shows up as a number that moved.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    SYSML_ECORE_COMMIT,
    SYSML_ECORE_RELEASE,
    SYSML_ECORE_SHA256,
    SYSML_METACLASSES,
    SYSML_METACLASS_NAMES,
    SYSML_METAMODEL_COUNTS,
    allFeatures,
    allSuperTypes,
    conformsTo,
    declaredFeatures,
    VISIBILITY_KIND_LITERALS,
} from '@memoarchitect/sysml-ir';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const generator = resolve(repoRoot, 'scripts/generate-sysml-ir.mjs');

const features = Object.values(SYSML_METACLASSES).flatMap(metaclass => Object.values(metaclass.features));

describe('generated SysML metamodel', () => {
    it('regenerates to exactly what is committed', () => {
        expect(() => execFileSync(process.execPath, [generator, '--check'], { cwd: repoRoot })).not.toThrow();
    });

    it('records the pinned source it was generated from', () => {
        expect(SYSML_ECORE_RELEASE).toBe('2026-05');
        expect(SYSML_ECORE_COMMIT).toBe('fa709f2');
        expect(SYSML_ECORE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('covers the whole metamodel Session 0 measured', () => {
        expect(SYSML_METACLASS_NAMES).toHaveLength(SYSML_METAMODEL_COUNTS.metaclasses);
        expect(features).toHaveLength(SYSML_METAMODEL_COUNTS.features);
        expect(features.filter(feature => feature.derived || feature.volatile))
            .toHaveLength(SYSML_METAMODEL_COUNTS.derived);
        expect(Object.values(SYSML_METACLASSES).flatMap(metaclass => metaclass.operations))
            .toHaveLength(SYSML_METAMODEL_COUNTS.operations);
    });

    it('emits enumerations as literal unions with their literals', () => {
        expect(VISIBILITY_KIND_LITERALS).toEqual(['private', 'protected', 'public']);
    });

    it('distinguishes containment from reference, and both from attributes', () => {
        expect(SYSML_METACLASSES.Element.features.declaredName.kind).toBe('attribute');
        // `ownedRelationship` is the metamodel's containment spine: an element
        // owns its relationships, and a reference here would make ownership
        // unrepresentable.
        expect(SYSML_METACLASSES.Element.features.ownedRelationship).toMatchObject({ kind: 'reference', containment: true });
        expect(SYSML_METACLASSES.Element.features.owningRelationship).toMatchObject({ kind: 'reference', containment: false });
    });

    it('carries multiplicity, not just a many flag', () => {
        expect(SYSML_METACLASSES.Element.features.ownedRelationship).toMatchObject({ lowerBound: 0, upperBound: -1, many: true });
        expect(SYSML_METACLASSES.Element.features.isImpliedIncluded).toMatchObject({ lowerBound: 1, upperBound: 1, many: false });
        // Bounded-but-plural exists in exactly one place, and a `many` boolean
        // alone would lose it.
        const bounded = features.filter(feature => feature.upperBound > 1);
        expect(bounded.length).toBeGreaterThan(0);
        expect(bounded.every(feature => feature.many)).toBe(true);
    });

    it('keeps the 70 real opposite pairs mutual, and invents no others', () => {
        const opposites = features.filter(feature => feature.opposite);
        expect(opposites).toHaveLength(SYSML_METAMODEL_COUNTS.opposites);
        for (const feature of opposites) {
            const [owner, name] = (feature.opposite as string).split('/');
            const target = SYSML_METACLASSES[owner]?.features[name];
            expect(target, `${feature.opposite} exists`).toBeDefined();
            expect(target?.opposite).toBeDefined();
        }
    });

    it('records subsets and redefines as metadata', () => {
        expect(features.filter(feature => feature.subsets)).toHaveLength(SYSML_METAMODEL_COUNTS.subsets);
        expect(features.filter(feature => feature.redefines)).toHaveLength(SYSML_METAMODEL_COUNTS.redefines);
        expect(features.filter(feature => feature.union)).toHaveLength(SYSML_METAMODEL_COUNTS.union);
        expect(SYSML_METACLASSES.Association.features.sourceType).toMatchObject({
            subsets: ['Association/relatedType'],
            redefines: ['Relationship/source'],
        });
    });

    it('cites the specification OCL for every derivation the metamodel states', async () => {
        const derived = features.filter(feature => feature.derived || feature.volatile);
        expect(derived.filter(feature => feature.hasDerivation)).toHaveLength(SYSML_METAMODEL_COUNTS.derivations);

        // The clause lives apart from the structural metamodel — it is B3's
        // input, and shipping it to every consumer would double the module for
        // an audience of one.
        const { SYSML_FEATURE_DERIVATIONS, derivationOf, operationBodyOf } =
            await import('@memoarchitect/sysml-ir/lib/generated/sysml-derivations.js');
        expect(Object.keys(SYSML_FEATURE_DERIVATIONS)).toHaveLength(SYSML_METAMODEL_COUNTS.derivations);
        expect(derivationOf('AcceptActionUsage', 'payloadArgument')).toBe('payloadArgument = argument(1)');
        // Seven operations state no body at all, `Namespace::resolveGlobal`
        // among them; the metamodel says so rather than inventing one.
        expect(operationBodyOf('Namespace', 'resolveGlobal')).toBeUndefined();
        expect(operationBodyOf('AcceptActionUsage', 'isTriggerAction')).toContain('TransitionUsage');
    });

    it('generates no derivation bodies — declarations only', async () => {
        // The guarantee of §1.5.1 rule 2, asserted rather than assumed. The OCL
        // is present in the file, but only as comment text and as `derivation`
        // strings; nothing in it executes. What proves that is the runtime
        // export surface: constants, the metadata table, and four reflective
        // helpers. A generated computation would have to appear here.
        const module = await import('@memoarchitect/sysml-ir/lib/generated/sysml-metamodel.js');
        const callable = Object.entries(module)
            .filter(([, value]) => typeof value === 'function')
            .map(([name]) => name)
            .sort();
        expect(callable).toEqual(['allFeatures', 'allSuperTypes', 'conformsTo', 'declaredFeatures']);
        // And a derived feature is declared read-only, so a consumer cannot
        // mistake the declaration for a place to store a computed value.
        const source = readFileSync(resolve(repoRoot, 'packages/sysml-ir/src/generated/sysml-metamodel.ts'), 'utf8');
        const readonlyNames = new Set([...source.matchAll(/\n {4}readonly (\w+)\??: /g)].map(match => match[1]));
        const derivedNames = new Set(features.filter(feature => feature.derived || feature.volatile).map(feature => feature.name));
        expect([...readonlyNames].filter(name => !derivedNames.has(name))).toEqual([]);
        expect([...derivedNames].filter(name => !readonlyNames.has(name))).toEqual([]);
    });

    it('resolves inheritance across the generalization graph', () => {
        expect(allSuperTypes('PartUsage')).toContain('Element');
        expect(conformsTo('PartUsage', 'Feature')).toBe(true);
        expect(conformsTo('PartUsage', 'Association')).toBe(false);
        expect(declaredFeatures('PartUsage').length).toBeLessThan(allFeatures('PartUsage').length);
        expect(allFeatures('PartUsage').some(feature => feature.name === 'declaredName')).toBe(true);
    });
});
