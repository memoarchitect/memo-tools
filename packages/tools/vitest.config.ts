import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['lib/**', 'node_modules/**'],
        // A test that needs a model compiles it with the selected compiler.
        testTimeout: 60_000,
        // The examples and templates name no compiler; the suite says which one
        // it runs under, as a user's own settings would. Commands it spawns inherit it.
        // Nor does the suite read or write the developer's own settings file
        // (`memo init` puts a compiler there): it gets a directory of its own.
        env: {
            MEMO_TOOLCHAIN_COMPILER: process.env.MEMO_TEST_COMPILER ?? 'opensysml',
            MEMO_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'memo-test-config-')),
        },
    },
});
