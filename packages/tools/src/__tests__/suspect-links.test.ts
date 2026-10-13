import { describe, expect, it } from 'vitest';
import { computeSuspectLinks } from '../analysis/suspect-links.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// O10. An imported element carries `@ExternalSource` (SysML metadata usage with
// a nested attribute body: MetadataBodyUsage, SysML-textual-bnf.kebnf:1694), and
// a MEMO-authored link to it carries `@TraceBaseline`. A `satisfy` takes it in
// its RequirementBody (kebnf:1470 -> 1408 -> DefinitionBodyItem 241), a typed
// connection in its usage body, a `dependency` in its annotation body.
const source = (revision: string, extra = '') => `package imp {
    private import ScalarValues::*;
    private import memo_assurance_requirements::*;
    private import memo_core_semantics::*;
    private import memo_core_relationships::*;
    requirement reqImported : Requirement {
        @ExternalSource {
            :>> externalReference {
                :>> sourceSystem = "reqtool";
                :>> identifier = "REQ-1";
                :>> revision = "${revision}";
            }
            :>> sourceMastered = true;
            ${extra}
        }
    }
    requirement reqOwn : Requirement;
    part def Widget;
    part widget : Widget;
    satisfy reqImported by widget {
        @TraceBaseline { :>> sourceRevision = "B"; }
    }
    connection derives : DerivesFrom connect sourceDriver ::> reqOwn to targetRequirement ::> reqImported {
        @TraceBaseline { :>> sourceRevision = "B"; }
    }
    dependency traced from reqOwn to reqImported {
        @TraceBaseline { :>> sourceRevision = "B"; }
    }
}`;

const suspects = (revision: string, extra?: string) =>
    withExample({ 'model/catalog/imp.sysml': source(revision, extra) }, project => ({
        element: project.model.elements.get('imp::reqImported')?.attributes,
        links: project.model.relationships.filter(r => r.file.endsWith('imp.sysml') && r.attributes?.['sourceRevision'])
            .map(r => r.type).sort(),
        suspect: computeSuspectLinks(project.model).filter(s => s.elementId === 'imp::reqImported')
            .map(s => `${s.relationshipType}:${s.reason}`).sort(),
    }));

describe.runIf(compilerConfigured && examplesPresent)('suspect links', () => {
    it('reads the source record and the baselines off an imported requirement and its links', async () => {
        const { element, links } = await suspects('B');
        expect(element).toMatchObject({
            'externalReference.sourceSystem': 'reqtool',
            'externalReference.identifier': 'REQ-1',
            'externalReference.revision': 'B',
            sourceMastered: 'true',
        });
        expect(links).toEqual(['dependency', 'derivesFrom', 'satisfiedBy']);
    }, 120000);

    it('has no suspect link while every baseline is the current revision', async () => {
        expect((await suspects('B')).suspect).toEqual([]);
    }, 120000);

    it('marks every link suspect once the source revision moves', async () => {
        expect((await suspects('C')).suspect).toEqual([
            'dependency:revision-moved', 'derivesFrom:revision-moved', 'satisfiedBy:revision-moved',
        ]);
    }, 120000);

    it('marks the links of a withdrawn element, whatever its revision', async () => {
        expect((await suspects('B', ':>> sourceWithdrawn = true;')).suspect).toEqual([
            'dependency:source-withdrawn', 'derivesFrom:source-withdrawn', 'satisfiedBy:source-withdrawn',
        ]);
    }, 120000);
});
