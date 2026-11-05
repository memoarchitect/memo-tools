// `connection : T connect a to b;` is the normative binary form, and a connection binds its ends by
// position. So it has to build the same relationship as the form that writes the end names out,
// with each end named from the definition, not as a generic `source` and `target`.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

const FILE = 'model/catalog/connection_probe.sysml';
const source = (connect: string) => `package connection_probe {
    private import memo::*;
    part monitor : LogicalComponent;
    part primary : LogicalComponent;
    connection : IndependentOf connect ${connect};
}
`;

describe.runIf(compilerConfigured && examplesPresent)('a connection with positional ends', () => {
    it('keeps its id when another connection is added before it', async () => {
        const idOfMonitorLink = (extra: string) => withExample({ [FILE]: `package connection_probe {
    private import memo::*;
    part monitor : LogicalComponent;
    part primary : LogicalComponent;
    part other : LogicalComponent;
    ${extra}
    connection : IndependentOf connect monitor to primary;
}
` }, async (_host, root) => {
            const config = { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } };
            const { model } = await loadProjectModel({ projectRoot: root, config: config as never, cache: false });
            return model.relationships.find(r => r.sourceId === 'connection_probe::monitor' && r.targetId === 'connection_probe::primary')!.id;
        });
        const alone = await idOfMonitorLink('');
        expect(await idOfMonitorLink('connection : IndependentOf connect other to primary;')).toBe(alone);
    });

    it('builds the same relationship as one that names its ends', async () => {
        const build = (connect: string) => withExample({ [FILE]: source(connect) }, async (_host, root) => {
            const config = { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } };
            const { model } = await loadProjectModel({ projectRoot: root, config: config as never, cache: false });
            const found = model.relationships.filter(r => r.file === FILE);
            return found.map(({ type, sourceId, sourceEnd, targetId, targetEnd }) => ({ type, sourceId, sourceEnd, targetId, targetEnd }));
        });
        const named = await build('channel ::> monitor to otherChannel ::> primary');
        const positional = await build('monitor to primary');
        expect(named).toHaveLength(1);
        expect(named[0]).toMatchObject({ sourceEnd: 'channel', targetEnd: 'otherChannel' });
        expect(positional).toEqual(named);
    });
});
