// Every leaf under `toolchain.*` must be reachable from the command line, and
// reach the right settings path when it is. The test is generated from the same
// schema the options are generated from, so a provider that adds a setting adds
// its own parity case — there is no list here to forget to update.

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../toolchain/default-registry.js';
import {
    ToolchainOptionError,
    applyToolchainCliOptions,
    toolchainOptionName,
    toolchainOverridesFromCliOptions,
    withToolchainOverrides,
} from '../toolchain/schema.js';

const registry = createDefaultRegistry();
const schema = registry.schema();

/** A sample value a leaf will accept, so each case exercises real parsing. */
function sampleValue(leaf: (typeof schema)[number]): string {
    if (leaf.type === 'boolean') return 'false';
    if (leaf.type === 'enum') return leaf.values![0];
    return '/somewhere/on/disk';
}

function parse(argv: string[]): Record<string, unknown> {
    const command = new Command().exitOverride();
    applyToolchainCliOptions(command, registry);
    command.parse(['node', 'memo', ...argv]);
    return command.opts();
}

describe('generated --toolchain.* options', () => {
    it('covers every schema leaf and nothing else', () => {
        const command = new Command();
        applyToolchainCliOptions(command, registry);
        const optionNames = command.options.map(option => option.name());
        expect([...optionNames].sort())
            .toEqual([...schema.map(toolchainOptionName)].sort());
    });

    it('has a leaf for every registered role and for the deprecated alias', () => {
        const paths = schema.map(leaf => leaf.path);
        expect(paths).toContain('validator');
        expect(paths).toContain('lowering');
        expect(paths).toContain('packager');
        expect(paths).toContain('compiler');
    });

    it('offers the live roster as the accepted values of each role leaf', () => {
        expect(schema.find(l => l.path === 'validator')?.values)
            .toEqual(registry.ids('validator'));
        expect(schema.find(l => l.path === 'packager')?.values)
            .toEqual(registry.ids('package'));
    });

    // One generated case per leaf.
    for (const leaf of schema) {
        const flag = `--${toolchainOptionName(leaf)}`;
        const value = sampleValue(leaf);

        it(`${flag} parses and lands at toolchain.${leaf.path}`, () => {
            const options = parse([flag, value]);
            expect(options[toolchainOptionName(leaf)]).toBe(value);

            const overrides = toolchainOverridesFromCliOptions(options, registry);
            const expected = leaf.type === 'boolean' ? value === 'true' : value;
            expect(readPath(overrides, leaf.path)).toBe(expected);

            // And it survives the merge onto loaded settings.
            const merged = withToolchainOverrides(
                { projectName: 'test' }, options, registry);
            expect(readPath(merged.toolchain ?? {}, leaf.path)).toBe(expected);
        });
    }
});

describe('option value checking', () => {
    it('rejects an unregistered provider at parse time, listing the registered ones', () => {
        // Commander owns the message and the exit code; the roster in it comes
        // from the registry, so it can never drift from what is registered.
        expect(() => parse(['--toolchain.validator', 'nope']))
            .toThrow(new RegExp(registry.ids('validator').join(', ')));
    });

    it('rejects a non-boolean for a boolean leaf at parse time', () => {
        const leaf = schema.find(l => l.type === 'boolean')!;
        expect(() => parse([`--${toolchainOptionName(leaf)}`, 'yes'])).toThrow(/true, false/);
    });

    it('rejects a non-boolean for a boolean leaf', () => {
        const leaf = schema.find(l => l.type === 'boolean')!;
        expect(() => toolchainOverridesFromCliOptions(
            { [toolchainOptionName(leaf)]: 'yes' }, registry))
            .toThrow(ToolchainOptionError);
    });

    it('rejects an unregistered provider and names the ones that are', () => {
        expect(() => toolchainOverridesFromCliOptions({ 'toolchain.validator': 'nope' }, registry))
            .toThrow(new RegExp(registry.ids('validator').join(', ')));
    });
});

describe('merging with settings', () => {
    it('overrides one leaf without discarding its siblings', () => {
        const merged = withToolchainOverrides(
            { projectName: 'test', toolchain: { syside: { executable: '/bin/syside', diagnose: 'none' } } },
            { 'toolchain.syside.diagnose': 'all' },
            registry,
        );
        expect(merged.toolchain?.syside).toEqual({ executable: '/bin/syside', diagnose: 'all' });
    });

    it('leaves settings untouched when no flag was given', () => {
        const settings = { projectName: 'test', toolchain: { validator: 'syside' } };
        expect(withToolchainOverrides(settings, {}, registry)).toBe(settings);
    });
});

function readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>(
        (cursor, segment) => (cursor as Record<string, unknown> | undefined)?.[segment], source);
}
