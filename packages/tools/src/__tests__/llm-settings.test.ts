// ─── LLM Settings Resolution Tests ───────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    parseEnvFile,
    loadEnvFile,
    loadLlmProjectSettings,
    saveLlmProjectSettings,
    saveLlmCredential,
    clearLlmCredential,
    loadLlmCredentials,
    resolveLlmSettings,
    llmSettingsStatus,
    DEFAULT_MODELS,
} from '../llm/llm-settings.js';

let projectRoot: string;
let credentials: string;
const originalEnv = { ...process.env };

beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'memo-llm-settings-'));
    credentials = resolve(projectRoot, 'credentials.json');
    process.env.MEMO_CREDENTIALS_PATH = credentials;
    // The developer's own environment must not decide these outcomes.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMO_LLM_MODEL;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(projectRoot, { recursive: true, force: true });
});

// ─── .env parsing ────────────────────────────────────────────────────────────

describe('parseEnvFile', () => {
    it('reads simple assignments', () => {
        expect(parseEnvFile('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('ignores comments and blank lines', () => {
        expect(parseEnvFile('# a comment\n\nFOO=bar\n')).toEqual({ FOO: 'bar' });
    });

    it('strips an export prefix', () => {
        expect(parseEnvFile('export ANTHROPIC_API_KEY=sk-ant-1')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-1' });
    });

    it('unquotes double-quoted values and expands escapes', () => {
        expect(parseEnvFile('A="one\\ntwo"')).toEqual({ A: 'one\ntwo' });
    });

    it('unquotes single-quoted values literally', () => {
        expect(parseEnvFile("A='one\\ntwo'")).toEqual({ A: 'one\\ntwo' });
    });

    it('drops trailing comments on unquoted values', () => {
        expect(parseEnvFile('A=value # trailing note')).toEqual({ A: 'value' });
    });

    it('keeps a # that is part of an unquoted value', () => {
        expect(parseEnvFile('A=sk-abc#def')).toEqual({ A: 'sk-abc#def' });
    });

    it('keeps = characters inside a value', () => {
        expect(parseEnvFile('A=a=b=c')).toEqual({ A: 'a=b=c' });
    });

    it('skips malformed lines rather than throwing', () => {
        expect(parseEnvFile('novalue\n=noname\n9BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' });
    });
});

describe('loadEnvFile', () => {
    it('returns an empty map when there is no .env', () => {
        expect(loadEnvFile(projectRoot)).toEqual({});
    });

    it('reads the project .env', () => {
        writeFileSync(resolve(projectRoot, '.env'), 'ANTHROPIC_API_KEY=sk-from-file\n');
        expect(loadEnvFile(projectRoot)).toEqual({ ANTHROPIC_API_KEY: 'sk-from-file' });
    });
});

// ─── Project settings ────────────────────────────────────────────────────────

describe('project settings', () => {
    it('round-trips provider, model and baseUrl', () => {
        saveLlmProjectSettings(projectRoot, { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'http://localhost:1234/v1' });
        expect(loadLlmProjectSettings(projectRoot)).toEqual({
            provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'http://localhost:1234/v1',
        });
    });

    it('never surfaces an apiKey written into project settings by hand', () => {
        mkdirSync(resolve(projectRoot, '.memo'), { recursive: true });
        writeFileSync(
            resolve(projectRoot, '.memo', 'llm.json'),
            JSON.stringify({ provider: 'anthropic', apiKey: 'sk-should-be-ignored' }),
        );
        const loaded = loadLlmProjectSettings(projectRoot) as Record<string, unknown>;
        expect(loaded.apiKey).toBeUndefined();
        expect(loaded.provider).toBe('anthropic');
    });

    it('tolerates a corrupt settings file', () => {
        mkdirSync(resolve(projectRoot, '.memo'), { recursive: true });
        writeFileSync(resolve(projectRoot, '.memo', 'llm.json'), '{ not json');
        expect(loadLlmProjectSettings(projectRoot)).toEqual({});
    });
});

// ─── Credentials ─────────────────────────────────────────────────────────────

describe('credentials', () => {
    it('stores a key per provider without disturbing the other', () => {
        saveLlmCredential('anthropic', 'sk-ant-1');
        saveLlmCredential('openai', 'sk-oai-1');
        expect(loadLlmCredentials()).toEqual({
            anthropic: { apiKey: 'sk-ant-1' },
            openai: { apiKey: 'sk-oai-1' },
        });
    });

    it('clears only the named provider', () => {
        saveLlmCredential('anthropic', 'sk-ant-1');
        saveLlmCredential('openai', 'sk-oai-1');
        clearLlmCredential('anthropic');
        expect(loadLlmCredentials()).toEqual({ openai: { apiKey: 'sk-oai-1' } });
    });

    it('writes the file owner-readable only', () => {
        saveLlmCredential('anthropic', 'sk-ant-1');
        // 0o777 masks off the file-type bits; 0o600 is rw for the owner alone.
        expect(statSync(credentials).mode & 0o077).toBe(0);
    });
});

// ─── Precedence ──────────────────────────────────────────────────────────────

describe('resolveLlmSettings precedence', () => {
    it('reports nothing configured when no source has a key', () => {
        const resolved = resolveLlmSettings(projectRoot);
        expect(resolved.configured).toBe(false);
        expect(resolved.apiKey).toBeUndefined();
    });

    it('uses a stored credential when nothing else supplies a key', () => {
        saveLlmCredential('anthropic', 'sk-stored');
        const resolved = resolveLlmSettings(projectRoot);
        expect(resolved.apiKey).toBe('sk-stored');
        expect(resolved.keyOrigin).toBe('user-credentials');
    });

    it('prefers a project .env over a stored credential', () => {
        saveLlmCredential('anthropic', 'sk-stored');
        writeFileSync(resolve(projectRoot, '.env'), 'ANTHROPIC_API_KEY=sk-envfile\n');
        const resolved = resolveLlmSettings(projectRoot);
        expect(resolved.apiKey).toBe('sk-envfile');
        expect(resolved.keyOrigin).toBe('env-file');
    });

    it('prefers the real environment over a project .env', () => {
        saveLlmCredential('anthropic', 'sk-stored');
        writeFileSync(resolve(projectRoot, '.env'), 'ANTHROPIC_API_KEY=sk-envfile\n');
        process.env.ANTHROPIC_API_KEY = 'sk-realenv';
        const resolved = resolveLlmSettings(projectRoot);
        expect(resolved.apiKey).toBe('sk-realenv');
        expect(resolved.keyOrigin).toBe('env');
    });

    it('honours the provider the project selects even when the other has a key', () => {
        saveLlmCredential('anthropic', 'sk-ant');
        saveLlmCredential('openai', 'sk-oai');
        saveLlmProjectSettings(projectRoot, { provider: 'openai' });
        expect(resolveLlmSettings(projectRoot).provider).toBe('openai');
    });

    it('falls back to the other provider when the selected one has no key', () => {
        saveLlmCredential('openai', 'sk-oai');
        saveLlmProjectSettings(projectRoot, { provider: 'anthropic' });
        const resolved = resolveLlmSettings(projectRoot);
        expect(resolved.provider).toBe('openai');
        expect(resolved.apiKey).toBe('sk-oai');
    });

    it('defaults the model per provider', () => {
        saveLlmCredential('anthropic', 'sk-ant');
        expect(resolveLlmSettings(projectRoot).model).toBe(DEFAULT_MODELS.anthropic);
    });

    it('lets project settings override the default model', () => {
        saveLlmCredential('anthropic', 'sk-ant');
        saveLlmProjectSettings(projectRoot, { model: 'claude-sonnet-5' });
        expect(resolveLlmSettings(projectRoot).model).toBe('claude-sonnet-5');
    });

    it('lets MEMO_LLM_MODEL override project settings', () => {
        saveLlmCredential('anthropic', 'sk-ant');
        saveLlmProjectSettings(projectRoot, { model: 'claude-sonnet-5' });
        process.env.MEMO_LLM_MODEL = 'claude-opus-5';
        expect(resolveLlmSettings(projectRoot).model).toBe('claude-opus-5');
    });
});

// ─── Client-facing status ────────────────────────────────────────────────────

describe('llmSettingsStatus', () => {
    it('never includes the API key', () => {
        saveLlmCredential('anthropic', 'sk-secret');
        const status = llmSettingsStatus(projectRoot);
        expect(status.configured).toBe(true);
        expect(JSON.stringify(status)).not.toContain('sk-secret');
    });

    it('marks a stored key as editable', () => {
        saveLlmCredential('anthropic', 'sk-stored');
        expect(llmSettingsStatus(projectRoot).keyEditable).toBe(true);
    });

    it('marks an environment-supplied key as not editable', () => {
        // Saving from the UI would be a no-op, since env wins — say so instead.
        process.env.ANTHROPIC_API_KEY = 'sk-realenv';
        expect(llmSettingsStatus(projectRoot).keyEditable).toBe(false);
    });

    it('allows entering a key when nothing is configured', () => {
        expect(llmSettingsStatus(projectRoot).keyEditable).toBe(true);
    });
});
