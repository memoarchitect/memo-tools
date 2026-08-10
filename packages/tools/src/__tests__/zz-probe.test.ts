import { describe, it } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';

const CASES: Record<string, string> = {
    'omg full form': `package p {
    private import Metaobjects::SemanticMetadata;
    abstract connection allocations : AllocatedTo[*];
    metadata def <allocate> AllocatedToMetadata :> SemanticMetadata {
        :> annotatedElement : SysML::ConnectionDefinition;
        :>> baseType = allocations meta SysML::Usage;
    }
}`,
    'short name only': `package p {
    metadata def <allocate> AllocatedToMetadata :> SemanticMetadata;
}`,
    'no short name, ref annotatedElement': `package p {
    metadata def AllocatedToMetadata :> SemanticMetadata {
        ref annotatedElement : SysML::ConnectionDefinition;
    }
}`,
    'baseType only': `package p {
    metadata def AllocatedToMetadata :> SemanticMetadata {
        attribute :>> baseType = allocations meta SysML::Usage;
    }
}`,
    'plain specialization': `package p {
    metadata def AllocatedToMetadata :> SemanticMetadata { attribute keyword : String; }
}`,
    'abstract connection usage': `package p {
    abstract connection allocations : AllocatedTo[*];
}`,
    'named flow': `package p {
    flow ceOpCmdToTlm of OperatorCommands from portOpCmdIn to tlm.OP_CMD_IN;
}`,
    'anonymous flow dotted': `package p {
    flow of OperatorCommands from portOpCmdIn to tlm.OP_CMD_IN;
}`,
};

describe('grammar probe', () => {
    it('reports which forms parse', async () => {
        const services = createMemoSysMLServices(EmptyFileSystem).MemoSysML;
        const parse = parseHelper<Model>(services);
        for (const [label, text] of Object.entries(CASES)) {
            const doc = await parse(text);
            const errs = doc.parseResult.parserErrors;
            console.log(`${errs.length === 0 ? 'PARSES ' : 'FAILS  '} ${label}` +
                (errs.length ? `  → ${errs[0].message.slice(0, 120)}` : ''));
        }
    });
});
