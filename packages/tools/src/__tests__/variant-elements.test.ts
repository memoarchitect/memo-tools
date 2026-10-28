import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// A `variant part` declared without a type is typed by its variation, so it is an element of the
// variation's kind with its own attributes, not a set of `variant.attr` entries on the variation.

const source = `package seeded_variants {
    private import memo_core_common::*;
    private import memo_architecture_logical_structure::*;
    abstract part def Platform :> System;
    variation part platform : Platform {
        variant part tower {
            attribute :>> origin = SystemOriginKind::external;
        }
        variant part robot {
            attribute :>> origin = SystemOriginKind::internal;
        }
    }
}`;

describe.runIf(compilerConfigured && examplesPresent)('an untyped variant part', () => {
    it('is an element of the variation\'s kind with its own attributes', async () => {
        await withExample({ 'model/catalog/seeded_variants.sysml': source }, project => {
            const byName = (name: string) => [...project.model.elements.values()].find(e => e.shortName === name);
            expect(byName('tower')?.kind).toBe(byName('platform')?.kind);
            expect(byName('tower')?.attributes.origin).toBe('SystemOriginKind::external');
            expect(byName('robot')?.attributes.origin).toBe('SystemOriginKind::internal');
        });
    }, 180_000);
});
