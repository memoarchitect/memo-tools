import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel, UNRESOLVED_BINDING_END, UNRESOLVED_FLOW_END } from '../model/builder.js';
import type { ParsedDocument } from '../model/parser-utils.js';

// ─── A flow or binding whose end names nothing is reported ──────────────────
//
// `resolveFlowConnection` and `resolveBinding` used to `return` when an end
// did not resolve: the edge was left out and nothing said so. A named flow is
// the one record of a functional exchange and a named binding the one record
// of a delegation, so that lost an identity only a census drop would show.
// The same shape in `interface … connect` became `unresolved-interface-end`
// (native-interface-exchange.test.ts); these are its two siblings.
// ─────────────────────────────────────────────────────────────────────────────

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);
const config: MEMOConfig = { projectName: 'test' } as MEMOConfig;

async function build(source: string) {
    const document = await parse(source);
    const parseErrors = [
        ...document.parseResult.lexerErrors.map(e => e.message),
        ...document.parseResult.parserErrors.map(e => e.message),
    ];
    expect(parseErrors, `failed to parse:\n${source}`).toEqual([]);
    const doc: ParsedDocument = { document, filePath: 'test.sysml' };
    return buildMemoModel([doc], config);
}

describe('a flow with an end naming nothing', () => {
    it('is reported with its name, the end, and the line', async () => {
        const model = await build(`
package P {
    item def Dose;
    action deliver {
        action prescribe { out dose : Dose; }
        action infuse { in dose : Dose; }
        flow exDose of Dose from prescribe.dose to infuze.dose;
    }
}
`);
        expect(model.relationships.filter(r => r.type === 'flow')).toEqual([]);
        const reported = model.errors.filter(e => e.code === UNRESOLVED_FLOW_END);
        expect(reported).toHaveLength(1);
        expect(reported[0].message).toContain("The flow 'exDose'");
        expect(reported[0].message).toContain("target 'infuze.dose'");
        expect(reported[0].message).not.toContain('source');
        expect(reported[0].line).toBe(7);
    });

    it('is reported when anonymous, naming both ends', async () => {
        const model = await build(`
package P {
    action deliver {
        flow from nowhere.out1 to elsewhere.in1;
    }
}
`);
        const reported = model.errors.filter(e => e.code === UNRESOLVED_FLOW_END);
        expect(reported).toHaveLength(1);
        expect(reported[0].message).toContain('A flow connects');
        expect(reported[0].message).toContain("source 'nowhere.out1' and target 'elsewhere.in1'");
    });

    it('is not reported when both ends resolve', async () => {
        const model = await build(`
package P {
    item def Dose;
    action deliver {
        action prescribe { out dose : Dose; }
        action infuse { in dose : Dose; }
        flow exDose of Dose from prescribe.dose to infuse.dose;
    }
}
`);
        expect(model.errors.filter(e => e.code === UNRESOLVED_FLOW_END)).toEqual([]);
        expect(model.relationships.filter(r => r.type === 'flow')).toHaveLength(1);
    });
});

describe('a binding with an end naming nothing', () => {
    // Package level, as gpca-pump writes its CE-1xx delegations: the grammar
    // does not yet take a named `binding` inside a part body.
    const source = (binding: string) => `
package P {
    port def CmdPort;
    part def Motor { in port pIn : CmdPort; }
    part device {
        in port pCmd : CmdPort;
        part motor : Motor;
    }
    ${binding}
}
`;

    it('is reported with its name, the end, and the line', async () => {
        const model = await build(source('binding ceCmd bind device.pCmd = devise.motor.pIn;'));
        expect(model.relationships.filter(r => r.type === 'bind')).toEqual([]);
        const reported = model.errors.filter(e => e.code === UNRESOLVED_BINDING_END);
        expect(reported).toHaveLength(1);
        expect(reported[0].message).toContain("Binding 'ceCmd'");
        expect(reported[0].message).toContain("target 'devise.motor.pIn'");
        expect(reported[0].message).not.toContain('source');
        expect(reported[0].line).toBe(9);
    });

    it('is reported when anonymous', async () => {
        const model = await build(source('bind nothing.pCmd = device.motor.pIn;'));
        const reported = model.errors.filter(e => e.code === UNRESOLVED_BINDING_END);
        expect(reported).toHaveLength(1);
        expect(reported[0].message).toContain("A binding binds source 'nothing.pCmd'");
    });

    it('is not reported when both ends resolve', async () => {
        const model = await build(source('binding ceCmd bind device.pCmd = device.motor.pIn;'));
        expect(model.errors.filter(e => e.code === UNRESOLVED_BINDING_END)).toEqual([]);
        expect(model.relationships.filter(r => r.type === 'bind')).toHaveLength(1);
    });
});
