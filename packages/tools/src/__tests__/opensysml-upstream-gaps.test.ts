import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';
import type { ApiElement } from '../stage2/api-model.js';

// ─── OpenSysML's API JSON where it departs from the SysML v2 metamodel ───────
//
// Each test pins how OpenSysML exports one construct TODAY, where that differs
// from what the textual BNF and SysML.ecore require. Stage 2 is not bent around
// any of them (the specification is the authority), so what depends on the
// construct — an Architect glyph, an edge label — is asserted only under a
// compiler that exports it as the spec says.
//
// These tests are meant to FAIL when OpenSysML fixes the gap. When one does,
// delete it here and tighten what its message names. The upstream write-ups are
// in memo-meta's plans/opensysml-upstream-drafts.md.
// ─────────────────────────────────────────────────────────────────────────────

const underOpenSysML = compilerConfigured && process.env.MEMO_TOOLCHAIN_COMPILER !== 'syside';

async function exported(source: string): Promise<ApiElement[]> {
    const { api } = await compileSources([{ filePath: 'gap.sysml', source }]);
    return (api.output.documents ?? []).flatMap(document => document.elements);
}

const typeOf = (elements: ApiElement[], qualifiedName: string) =>
    elements.find(element => element.qualifiedName === qualifiedName)?.['@type'];

const types = (elements: ApiElement[]) => new Set(elements.map(element => element['@type']));

describe.runIf(underOpenSysML)('OpenSysML API JSON gaps that are still open upstream', () => {
    it('an accept action node is an ActionUsage, not an AcceptActionUsage (issue A)', async () => {
        const elements = await exported(`package Orders {
            item def Order;
            action def Process {
                action receiveOrder accept order : Order;
            }
        }`);
        expect(typeOf(elements, 'Orders::Process::receiveOrder'),
            'OpenSysML now exports AcceptActionUsage: delete this test and assert the accept glyph under every '
            + 'compiler in memo-architect maxgraph-scene.test.ts').toBe('ActionUsage');
    });

    it('a named send is an ActionUsage owning an unnamed SendActionUsage (issue B)', async () => {
        const elements = await exported(`package Orders {
            item def Receipt;
            part def Target;
            action def Process {
                in item receipt : Receipt;
                in part target : Target;
                action sendReceipt send receipt to target;
            }
        }`);
        expect(typeOf(elements, 'Orders::Process::sendReceipt'),
            'OpenSysML now exports a named send as one SendActionUsage: delete this test and assert the send '
            + 'glyph under every compiler in memo-architect maxgraph-scene.test.ts').toBe('ActionUsage');
    });

    it('include of a reference states no ReferenceSubsetting (issue C)', async () => {
        const elements = await exported(`package Inc {
            use case def Pay;
            use case pay : Pay;
            use case def Checkout {
                include pay;
            }
        }`);
        expect(typeOf(elements, 'Inc::Checkout')).toBe('UseCaseDefinition');
        expect(types(elements).has('ReferenceSubsetting'),
            'OpenSysML now writes the ReferenceSubsetting of `include pay;`: delete this test').toBe(false);
    });

    it("a transition's guard is owned by a plain OwningMembership (fix submitted upstream)", async () => {
        const elements = await exported(`package Flow {
            state def Machine {
                state idle;
                state busy;
                transition first idle if true then busy;
            }
        }`);
        expect(types(elements).has('TransitionFeatureMembership'),
            "OpenSysML now owns a guard through a TransitionFeatureMembership: delete this test and assert the "
            + "'[true]' label under every compiler in memo-architect maxgraph-scene.test.ts").toBe(false);
    });

    it('a keyword-less guarded first in an action body is a SuccessionAsUsage (issue E)', async () => {
        const elements = await exported(`package Flow {
            action def Route {
                action routeOrder;
                action processOrder;
                first routeOrder if true then processOrder;
            }
        }`);
        expect(types(elements).has('TransitionUsage'),
            'OpenSysML now makes `first a if g then b;` a TransitionUsage: delete this test').toBe(false);
    });

    it('a guarded target succession is a SuccessionAsUsage (issue D)', async () => {
        const elements = await exported(`package Flow {
            private import ScalarValues::Integer;
            action def Charge {
                attribute level : Integer;
                action check;
                then decide;
                    if level < 100 then addCharge;
                    if level >= 100 then stop;
                action addCharge;
                action stop;
            }
        }`);
        expect(types(elements).has('TransitionUsage'),
            'OpenSysML now makes `if g then b;` a TransitionUsage: delete this test').toBe(false);
    });
});
