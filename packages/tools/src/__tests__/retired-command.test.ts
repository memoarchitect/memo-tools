import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { retiredCommand } from '../commands/retired.js';

afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('a retired command', () => {
    function program(): Command {
        const root = new Command('memo').exitOverride();
        retiredCommand(root, 'examples', 'memo init --list');
        retiredCommand(root.command('rules'), 'check', 'memo validate');
        return root;
    }

    it('fails, naming the command that replaced it, whatever it is given', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await program().parseAsync(['rules', 'check', '.', '--format', 'json'], { from: 'user' });
        expect(process.exitCode).toBe(1);
        expect(error.mock.calls[0][0]).toContain('`memo rules check` was removed; use `memo validate`.');
    });

    it('is not listed in help', () => {
        expect(program().helpInformation()).not.toContain('examples');
    });
});
