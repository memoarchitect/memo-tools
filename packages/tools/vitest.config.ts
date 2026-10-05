import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['lib/**', 'node_modules/**'],
        // A test that needs a model compiles it with the selected compiler.
        testTimeout: 60_000,
        // The examples and templates name no compiler; the suite says which one
        // it runs under, as a user's own settings would. Commands it spawns inherit it.
        env: { MEMO_TOOLCHAIN_COMPILER: process.env.MEMO_TEST_COMPILER ?? 'opensysml' },
    },
});
