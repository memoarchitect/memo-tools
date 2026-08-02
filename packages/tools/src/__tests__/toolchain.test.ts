import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MEMOConfig } from '../model/config.js';
import {
    MissingToolError,
    ProviderRegistry,
    UnknownProviderError,
    type ProviderContext,
    type ProviderRunResult,
    type ValidatorDescriptor,
} from '../toolchain/registry.js';
import { createDefaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { runPackager, runValidator } from '../toolchain/operations.js';
import { buildSysideInvocation } from '../toolchain/providers/syside.js';
import { buildSysandInvocation } from '../toolchain/providers/sysand.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function config(toolchain?: MEMOConfig['toolchain']): MEMOConfig {
    return { projectName: 'test', toolchain };
}

function context(toolchain: MEMOConfig['toolchain'], extra: Partial<ProviderContext> = {}): ProviderContext {
    return { config: config(toolchain), projectDir: '/project', ...extra };
}

describe('role resolution', () => {
    it('defaults every role to the provider that claims the default, not to a literal', () => {
        const registry = createDefaultRegistry();
        const effective = resolveToolchain(config(), registry);
        // The point is not which ID this is — it is that core code never wrote
        // one. Whatever descriptor claims `isDefault` fills the role.
        expect(effective.validator).toBe(registry.defaultId('validator'));
        expect(effective.lowering).toBe(registry.defaultId('lowering'));
        expect(effective.packager).toBe(registry.defaultId('package'));
        expect(effective.selections.every(s => s.source === 'default')).toBe(true);
    });

    it('treats the deprecated compiler key as an alias for validator and lowering', () => {
        const registry = createDefaultRegistry();
        const effective = resolveToolchain(config({ compiler: 'internal' }), registry);
        expect(effective.validator).toBe('internal');
        expect(effective.lowering).toBe('internal');
        // It never meant packaging, so packaging keeps its default.
        expect(effective.packager).toBe(registry.defaultId('package'));
        expect(effective.deprecations[0]).toContain('deprecated');
    });

    it('leaves a role at its default when the aliased provider cannot fill it', () => {
        // `syside` has no IR export, so it is registered for `validator` only.
        // `compiler: syside` must therefore keep resolving — it is the exact
        // configuration the alias exists to preserve — and lowering stays with
        // MEMO's own parser, which is what the pre-split code did.
        const registry = createDefaultRegistry();
        const effective = resolveToolchain(config({ compiler: 'syside' }), registry);
        expect(effective.validator).toBe('syside');
        expect(effective.lowering).toBe(registry.defaultId('lowering'));
        expect(effective.deprecations.join(' ')).toContain('not registered for the lowering role');
    });

    it('lets an explicit role key win over the deprecated alias', () => {
        const registry = createDefaultRegistry();
        const effective = resolveToolchain(
            config({ compiler: 'syside', lowering: 'internal' }), registry);
        expect(effective.validator).toBe('syside');
        expect(effective.lowering).toBe('internal');
        expect(effective.selections.find(s => s.role === 'lowering')?.source).toBe('settings');
        expect(effective.selections.find(s => s.role === 'validator')?.source).toBe('deprecated-alias');
    });

    it('reports the live roster when a provider is not registered for a role', () => {
        const registry = createDefaultRegistry();
        // `sysand` is a real provider — for packaging. Asking it to validate is
        // an unknown-provider error naming what *is* registered, not a
        // hardcoded "choose internal or syside" message.
        expect(() => resolveToolchain(config({ validator: 'sysand' }), registry))
            .toThrow(UnknownProviderError);
        expect(() => resolveToolchain(config({ packager: 'syside' }), registry))
            .toThrow(/Registered package providers: /);
    });
});

describe('provider invocations', () => {
    it('builds a configured syside invocation', () => {
        expect(buildSysideInvocation(context({
            validator: 'syside',
            syside: {
                executable: './bin/syside',
                configFile: './config/syside.toml',
                warningsAsErrors: true,
            },
        }))).toEqual({
            command: '/project/bin/syside',
            args: [
                'check', '--colour', 'no', '--diagnose', 'all',
                '--config', '/project/config/syside.toml',
                '--warnings-as-errors', '/project',
            ],
            provider: 'syside',
        });
    });

    it('passes configured diagnostic scope and deduplicated includes to syside', () => {
        expect(buildSysideInvocation(context(
            { validator: 'syside', syside: { diagnose: 'none' } },
            { includeDirs: ['/content/src', '/content/src'] },
        ))).toMatchObject({
            args: [
                'check', '--colour', 'no', '--diagnose', 'none',
                '--warnings-as-errors', '--include', '/content/src', '/project',
            ],
        });
    });

    it('allows strict warning handling to be disabled explicitly', () => {
        expect(buildSysideInvocation(context({
            validator: 'syside',
            syside: { warningsAsErrors: false },
        }))).toMatchObject({
            args: ['check', '--colour', 'no', '--diagnose', 'all', '/project'],
        });
    });

    it('builds a configured sysand invocation', () => {
        expect(buildSysandInvocation(context(
            { packager: 'sysand', sysand: { executable: 'sysand-custom', configFile: 'sysand.toml' } },
            { outputPath: '/project/model.kpar' },
        ))).toEqual({
            command: 'sysand-custom',
            args: ['--config-file', '/project/sysand.toml', 'build', '/project/model.kpar'],
            provider: 'sysand',
        });
    });
});

describe('running providers', () => {
    it.skipIf(process.platform === 'win32')('executes a configured external packager', async () => {
        const project = mkdtempSync(join(tmpdir(), 'memo-toolchain-'));
        tempDirs.push(project);
        const packager = join(project, 'packager');
        const output = join(project, 'model.kpar');
        writeFileSync(packager, '#!/bin/sh\ntouch "$4"\n');
        chmodSync(packager, 0o755);

        const result = await runPackager({
            config: config({ packager: 'sysand', sysand: { executable: packager, configFile: 'sysand.toml' } }),
            projectDir: project,
            outputPath: output,
        });
        expect(result.provider).toBe('sysand');
        expect(result.accepted).toBe(true);
        expect(existsSync(output)).toBe(true);
    });

    it('fails with a missing-tool error and never downgrades to another provider', async () => {
        const project = mkdtempSync(join(tmpdir(), 'memo-toolchain-'));
        tempDirs.push(project);
        const settings = config({
            validator: 'syside',
            syside: { executable: join(project, 'definitely-not-here') },
        });
        // The contract that matters is the *absence* of a fallback: a selected
        // tool that is not there must never quietly become a different one.
        const result = await runValidator({ config: settings, projectDir: project }).catch(e => e);
        expect(result).toBeInstanceOf(MissingToolError);
        expect((result as Error).message).toMatch(/does not silently fall back/);
    });
});

// The §1.2 claim, made falsifiable: adding a provider is one new file plus one
// registration line. This test *is* the new file; the registration line is the
// `.register(...)` below. If either the registry, the CLI schema, or role
// resolution had to learn about this provider, this test could not pass.
const STUB_ID = 'stub-validator';

const stubValidatorDescriptor: ValidatorDescriptor = {
    id: STUB_ID,
    role: 'validator',
    capabilities: ['parse-only'],
    settingsSchema: [
        { path: `${STUB_ID}.executable`, type: 'string', description: 'Stub executable.' },
    ],
    probe: () => ({ available: true, transport: 'in-process', version: '0.0.0-stub' }),
    create: (ctx: ProviderContext) => ({
        id: STUB_ID,
        role: 'validator' as const,
        transport: 'in-process' as const,
        invocation: () => undefined,
        async run(): Promise<ProviderRunResult> {
            return {
                provider: STUB_ID,
                providerVersion: '0.0.0-stub',
                transport: 'in-process',
                accepted: true,
                diagnostics: [],
            };
        },
    }),
};

describe('modularity — a new provider costs one file and one registration', () => {
    function registryWithStub(): ProviderRegistry {
        return createDefaultRegistry().register(stubValidatorDescriptor);
    }

    it('is selectable by ID with no change to role resolution', () => {
        const effective = resolveToolchain(config({ validator: STUB_ID }), registryWithStub());
        expect(effective.validator).toBe(STUB_ID);
    });

    it('appears in the probe roster and in the generated CLI schema', () => {
        const registry = registryWithStub();
        expect(registry.ids('validator')).toContain(STUB_ID);
        const paths = registry.schema().map(leaf => leaf.path);
        // Its own settings leaf, contributed by the descriptor.
        expect(paths).toContain(`${STUB_ID}.executable`);
        // And it is offered as a value of the role-selection leaf, because that
        // leaf's values are read from the registry rather than written down.
        expect(registry.schema().find(l => l.path === 'validator')?.values).toContain(STUB_ID);
    });

    it('runs through the same operation every other provider runs through', async () => {
        const project = mkdtempSync(join(tmpdir(), 'memo-toolchain-'));
        tempDirs.push(project);
        const result = await runValidator({
            config: config({ validator: STUB_ID }),
            projectDir: project,
            registry: registryWithStub(),
        });
        expect(result.provider).toBe(STUB_ID);
        expect(result.accepted).toBe(true);
    });

    it('does not leak into the shipped registry', () => {
        expect(createDefaultRegistry().ids('validator')).not.toContain(STUB_ID);
    });
});

describe('registry invariants', () => {
    it('refuses two defaults for one role', () => {
        const registry = new ProviderRegistry().register({ ...stubValidatorDescriptor, isDefault: true });
        expect(() => registry.register({
            ...stubValidatorDescriptor, id: 'other-stub', isDefault: true,
        })).toThrow(/already has a default provider/);
    });

    it('refuses a duplicate registration for one role', () => {
        const registry = new ProviderRegistry().register(stubValidatorDescriptor);
        expect(() => registry.register(stubValidatorDescriptor)).toThrow(/already registered/);
    });
});
