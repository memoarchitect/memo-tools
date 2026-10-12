import { describe, expect, it } from 'vitest';
import { shortNameOf } from '../model/element-index.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// A use case's subject is the system it is carried out with: the system of
// systems for a clinical use case, a system for a system use case
// (SubjectUsage, SysML-textual-bnf.kebnf:1423). An `include` binds the included
// case's subject to the constituent (IncludeUseCaseUsage, kebnf:1572). The
// builder used to read every bound subject outside a requirement as a
// verification case's, so the lab came out "verified by" the procedure.
const SOURCE = `package t {
    private import memo_architecture_logical_structure::*;
    private import memo_architecture_operational_use_cases::*;
    part def Lab :> SystemOfSystems {
        part pump : System :> constituentSystem;
    }
    part lab : Lab;
    use case ucPrime : UseCase {
        subject :>> supportingSystem : System;
    }
    use case ucTherapy : UseCase {
        subject :>> supportingSystem = lab;
        include ucPrime { subject :>> supportingSystem = lab.pump; }
    }
}`;

describe.runIf(compilerConfigured && examplesPresent)('a use case bound to its subject', () => {
    it('is about that subject, and the subject is not verified by it', async () => {
        const relationships = await withExample({ 'model/catalog/use_case_subject.sysml': SOURCE }, project =>
            project.model.relationships.map(r => ({
                type: r.type, source: shortNameOf(r.sourceId), target: shortNameOf(r.targetId),
            })));
        expect(relationships).toContainEqual({ type: 'hasSubject', source: 'ucTherapy', target: 'lab' });
        expect(relationships).toContainEqual({ type: 'includesStep', source: 'ucTherapy', target: 'ucPrime' });
        // The host example has verification cases of its own; none of this fixture's elements is in a verifiedBy.
        const mine = new Set(['lab', 'pump', 'ucPrime', 'ucTherapy']);
        expect(relationships.filter(r => r.type === 'verifiedBy' && (mine.has(r.source ?? '') || mine.has(r.target ?? ''))))
            .toEqual([]);
    });
});
