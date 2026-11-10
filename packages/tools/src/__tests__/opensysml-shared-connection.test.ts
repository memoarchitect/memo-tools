import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const close = vi.fn(async () => undefined);
let convert: () => Promise<string>;

vi.mock('../toolchain/providers/opensysml.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../toolchain/providers/opensysml.js')>()),
    connectOpenSysML: vi.fn(async () => ({ info: { version: 'test' }, rpc: { convert: () => convert() }, close })),
}));

const { sharedOpenSysMLConnection, closeSharedOpenSysMLConnection } = await import('../toolchain/providers/opensysml-check.js');
const config = {} as never;

describe('the session\'s shared OpenSysML service', () => {
    beforeEach(() => { vi.useFakeTimers(); close.mockClear(); });
    afterEach(() => { closeSharedOpenSysMLConnection(); vi.useRealTimers(); });

    it('stays open while a call outlasts the idle window, then closes once idle', async () => {
        convert = () => new Promise(resolve => setTimeout(() => resolve('done'), 90_000));
        const connection = await sharedOpenSysMLConnection(config);
        const pending = (connection.rpc as unknown as { convert: () => Promise<string> }).convert();

        await vi.advanceTimersByTimeAsync(75_000); // past IDLE_MS, call still running
        expect(close).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(15_000);
        await expect(pending).resolves.toBe('done');
        expect(close).not.toHaveBeenCalled(); // the idle clock restarts when the call ends

        await vi.advanceTimersByTimeAsync(61_000);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes a service that was never called after the idle window', async () => {
        await sharedOpenSysMLConnection(config);
        await vi.advanceTimersByTimeAsync(61_000);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
