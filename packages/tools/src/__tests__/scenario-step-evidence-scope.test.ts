import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import { KindRegistry } from '../model/kind-registry.js';
import { modelToDTO, type MemoModel } from '../model/semantic.js';
import { evaluateNativeConstraint } from '../validator/constraint-eval.js';

// ─── A repeated scenario step keeps its own identity and evidence scope ──────
//
// Two acceptance cases from §12 of the Arcadia-aligned architecture plan:
//
//   - the same definition used at two scenario positions keeps separate
//     usages, sequence positions and evidence targets through extraction and
//     export;
//   - evidence scoped to the button path does not cover the touchscreen path.
//
// Measured 2026-09-25: both already hold. Every step is an element under its
// qualified id, successions and `perform` name the step, and a verification
// subject yields one `verifiedBy` edge to exactly what it names. Nothing
// propagates evidence from a definition to its usages or between sibling
// usages. This file is here so that stays true — a key by local name, or a
// "helpful" inheritance of `verifiedBy` from the definition, would merge the
// two positions and make one test look like coverage of both.
// ─────────────────────────────────────────────────────────────────────────────

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);
const config: MEMOConfig = { projectName: 'test' } as MEMOConfig;

async function build(source: string, kinds: string[] = []): Promise<MemoModel> {
    const doc = await parse(source);
    const errors = [
        ...doc.parseResult.lexerErrors.map(e => e.message),
        ...doc.parseResult.parserErrors.map(e => e.message),
    ];
    expect(errors, `failed to parse:\n${source}`).toEqual([]);
    return buildMemoModel([{ document: doc, filePath: 'test.sysml' }], config, [], { kindRegistry: registry(kinds) });
}

function registry(kinds: string[]): KindRegistry {
    const r = new KindRegistry();
    for (const name of kinds) r.register({ name, label: name, layer: 'functional', sysmlConstruct: 'action def' });
    return r;
}

const edges = (model: MemoModel, type: string) =>
    model.relationships.filter(r => r.type === type).map(r => `${r.sourceId} -> ${r.targetId}`);

/**
 * The library review's reduced pattern (§"Proposed structural direction"),
 * compiler-checked there with `syside check --diagnose all`: one reusable
 * contract, a usage of it on each path, each performed under its own local
 * name, and a test whose subject is the button path's usage only.
 */
const PATHS = `
package P {
    item def Request; item def Decision;
    action def EvaluateRequest { in item request : Request; out item decision : Decision; }
    part def Controller;
    action buttonPath {
        action evaluate : EvaluateRequest;
        action log;
        first start then evaluate;
        first evaluate then log;
        first log then done;
    }
    action touchscreenPath {
        action evaluate : EvaluateRequest;
        first start then evaluate;
        first evaluate then done;
    }
    part controller : Controller {
        perform action buttonEvaluation references buttonPath.evaluate;
        perform action touchscreenEvaluation references touchscreenPath.evaluate;
    }
    verification def LockoutCase;
    verification vcButtonLockout : LockoutCase {
        subject verified : Base::Anything[*] = (buttonPath.evaluate);
    }
}`;

describe('one contract used on two paths', () => {
    it('keeps each usage as its own element, typed by the shared contract', async () => {
        const model = await build(PATHS);
        const button = model.elements.get('P::buttonPath::evaluate');
        const touch = model.elements.get('P::touchscreenPath::evaluate');

        expect(button).toBeDefined();
        expect(touch).toBeDefined();
        expect(button).not.toBe(touch);
        expect(button!.attributes.usageType).toBe('EvaluateRequest');
        expect(touch!.attributes.usageType).toBe('EvaluateRequest');
    });

    it('keeps each position in its own sequence', async () => {
        const model = await build(PATHS);
        expect(edges(model, 'succession')).toEqual([
            'P::buttonPath__start -> P::buttonPath::evaluate',
            'P::buttonPath::evaluate -> P::buttonPath::log',
            'P::buttonPath::log -> P::buttonPath__done',
            'P::touchscreenPath__start -> P::touchscreenPath::evaluate',
            'P::touchscreenPath::evaluate -> P::touchscreenPath__done',
        ]);
    });

    it('performs each position separately', async () => {
        const model = await build(PATHS);
        expect(edges(model, 'performs')).toEqual([
            'P::controller -> P::buttonPath::evaluate',
            'P::controller -> P::touchscreenPath::evaluate',
        ]);
    });

    it('scopes the button test to the button path', async () => {
        const model = await build(PATHS);
        expect(edges(model, 'verifiedBy')).toEqual(['P::buttonPath::evaluate -> P::vcButtonLockout']);
    });

    it('survives export with both positions and one evidence target', async () => {
        const dto = modelToDTO(await build(PATHS));
        expect(Object.keys(dto.elements).filter(id => id.endsWith('::evaluate')).sort())
            .toEqual(['P::buttonPath::evaluate', 'P::touchscreenPath::evaluate']);
        expect(dto.relationships.filter(r => r.type === 'verifiedBy').map(r => r.sourceId))
            .toEqual(['P::buttonPath::evaluate']);
        expect(dto.relationships.filter(r => r.type === 'succession').map(r => r.targetId))
            .toContain('P::touchscreenPath::evaluate');
    });
});

/**
 * gpca-pump's own repeated step: `fnAcquireSensors` is performed by both
 * `fcsBolusSense` (in `fcPatientBolus`) and `fcsAlarmSense` (in
 * `fcAlarmStop`). Written in the example's spelling — each step an action
 * nested in its flow that subsets the function — with a test naming only the
 * alarm step.
 */
const GPCA_SHAPE = `
package P {
    action def SystemFunction;
    action def FunctionalFlow;
    action fnAcquireSensors : SystemFunction;
    action fnLogEvents : SystemFunction;
    action fnAnnunciate : SystemFunction;
    action fcPatientBolus : FunctionalFlow {
        action fcsBolusSense :> fnAcquireSensors;
        action fcsBolusLog :> fnLogEvents;
        first fcsBolusSense then fcsBolusLog;
    }
    action fcAlarmStop : FunctionalFlow {
        action fcsAlarmSense :> fnAcquireSensors;
        action fcsAlarmAnnunciate :> fnAnnunciate;
        first fcsAlarmSense then fcsAlarmAnnunciate;
    }
    verification def VerificationCase;
    verification vcAirInLine : VerificationCase {
        subject verified : Base::Anything[*] = (fcAlarmStop.fcsAlarmSense);
    }
}`;

const KINDS = ['SystemFunction', 'FunctionalFlow'];

const verifiedRule = (kind: string) => ({
    id: 'CR-TEST-STEP',
    description: 'every element of the kind traces to a verification case',
    appliesToKind: kind,
    expression: 'verifiedBy->size() >= 1',
    severity: 'error' as const,
});

describe('one function at two flow steps', () => {
    const BOLUS = 'P::fcPatientBolus::fcsBolusSense';
    const ALARM = 'P::fcAlarmStop::fcsAlarmSense';

    it('keeps both steps, each subsetting the one function', async () => {
        const model = await build(GPCA_SHAPE, KINDS);
        for (const id of [BOLUS, ALARM]) {
            expect(model.elements.get(id)).toMatchObject({ kind: 'ActionUsage' });
            expect(model.elements.get(id)!.attributes.subsets).toBe('fnAcquireSensors');
        }
        expect(edges(model, 'performs')).toEqual(expect.arrayContaining([
            'P::fcPatientBolus -> P::fnAcquireSensors',
            'P::fcAlarmStop -> P::fnAcquireSensors',
        ]));
    });

    it('counts the alarm-step test as evidence for the alarm step only', async () => {
        const model = await build(GPCA_SHAPE, KINDS);
        expect(edges(model, 'verifiedBy')).toEqual([`${ALARM} -> P::vcAirInLine`]);
    });

    // Verified, specified and used are separate properties: a test of one
    // position is not a test of the function the position subsets, and a
    // test of the function would not be a test of either position.
    it('does not lift step evidence onto the function', async () => {
        const model = await build(GPCA_SHAPE, KINDS);
        const unverified = evaluateNativeConstraint(verifiedRule('SystemFunction'), model, registry(KINDS))
            .map(v => v.elementName);
        expect(unverified).toEqual(['fnAcquireSensors', 'fnLogEvents', 'fnAnnunciate']);
    });
});
