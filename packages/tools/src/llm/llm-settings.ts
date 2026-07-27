// ─── LLM Settings Resolution ─────────────────────────────────────────────────
//
// Resolves LLM provider settings from four sources, highest precedence first:
//
//   1. The real process environment            (ANTHROPIC_API_KEY, …)
//   2. A project `.env` file                   (<projectRoot>/.env)
//   3. Project settings                        (<projectRoot>/.memo/llm.json)
//   4. User credentials                        (~/.memo/credentials.json)
//
// Only the last source is written by MEMO itself, and it lives outside the
// project so a key entered in the workbench can never be committed. Project
// settings hold provider/model/baseUrl and are safe to version — the loader
// ignores an `apiKey` there rather than encouraging a key into the repo.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

/** Which provider a set of settings selects. */
export type LLMProviderName = 'anthropic' | 'openai';

/** Non-secret settings, safe to keep in the project. */
export interface LlmProjectSettings {
    provider?: LLMProviderName;
    model?: string;
    baseUrl?: string;
}

/** Per-provider secrets, stored outside the project. */
export interface LlmCredentials {
    anthropic?: { apiKey?: string };
    openai?: { apiKey?: string };
}

/** Where a resolved value came from — surfaced in the UI so the key's origin is never a mystery. */
export type LlmSettingsOrigin = 'env' | 'env-file' | 'project-settings' | 'user-credentials' | 'default';

/** Default model per provider. Both are the current flagship at time of writing. */
export const DEFAULT_MODELS: Record<LLMProviderName, string> = {
    anthropic: 'claude-opus-5',
    openai: 'gpt-4o',
};

const PROJECT_SETTINGS_RELATIVE = ['.memo', 'llm.json'] as const;
const CREDENTIALS_RELATIVE = ['.memo', 'credentials.json'] as const;

// ─── .env parsing ────────────────────────────────────────────────────────────

/**
 * Parse a `.env` file body into key/value pairs.
 *
 * Deliberately small: `KEY=value` per line, `#` comments, optional `export`
 * prefix, and single- or double-quoted values (escapes are only expanded
 * inside double quotes, matching the common dotenv behaviour). Anything more
 * elaborate belongs in a real shell, not a settings file.
 */
export function parseEnvFile(contents: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
        const eq = withoutExport.indexOf('=');
        if (eq <= 0) continue;

        const key = withoutExport.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = withoutExport.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
            value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
            value = value.slice(1, -1);
        } else {
            // Unquoted values run to an unescaped `#`, so `KEY=value # note` works.
            const hash = value.indexOf(' #');
            if (hash >= 0) value = value.slice(0, hash).trimEnd();
        }
        out[key] = value;
    }
    return out;
}

/** Read `<projectRoot>/.env`, or an empty map when there is none. */
export function loadEnvFile(projectRoot: string): Record<string, string> {
    const path = resolve(projectRoot, '.env');
    if (!existsSync(path)) return {};
    try {
        return parseEnvFile(readFileSync(path, 'utf8'));
    } catch {
        return {};
    }
}

// ─── Project settings (no secrets) ───────────────────────────────────────────

export function projectSettingsPath(projectRoot: string): string {
    return resolve(projectRoot, ...PROJECT_SETTINGS_RELATIVE);
}

export function loadLlmProjectSettings(projectRoot: string): LlmProjectSettings {
    const path = projectSettingsPath(projectRoot);
    if (!existsSync(path)) return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as LlmProjectSettings & { apiKey?: string };
        // A key here would be one `git add` away from being published. Drop it.
        const { provider, model, baseUrl } = parsed;
        return {
            provider: provider === 'anthropic' || provider === 'openai' ? provider : undefined,
            model: typeof model === 'string' && model ? model : undefined,
            baseUrl: typeof baseUrl === 'string' && baseUrl ? baseUrl : undefined,
        };
    } catch {
        return {};
    }
}

export function saveLlmProjectSettings(projectRoot: string, settings: LlmProjectSettings): void {
    const path = projectSettingsPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    const clean: LlmProjectSettings = {};
    if (settings.provider) clean.provider = settings.provider;
    if (settings.model) clean.model = settings.model;
    if (settings.baseUrl) clean.baseUrl = settings.baseUrl;
    writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

// ─── User credentials (secrets, outside the project) ─────────────────────────

/**
 * Where user credentials live.
 *
 * `MEMO_CREDENTIALS_PATH` overrides the default so CI, containers, and tests
 * can point somewhere other than the real home directory — without it, a key a
 * developer saved through the workbench would leak into their test runs.
 */
export function credentialsPath(): string {
    const override = process.env.MEMO_CREDENTIALS_PATH;
    if (override) return resolve(override);
    return resolve(homedir(), ...CREDENTIALS_RELATIVE);
}

export function loadLlmCredentials(): LlmCredentials {
    const path = credentialsPath();
    if (!existsSync(path)) return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as LlmCredentials;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Store an API key for one provider, merging with any key already held for the
 * other. Written 0600 — this file is the one place MEMO persists a secret.
 */
export function saveLlmCredential(provider: LLMProviderName, apiKey: string): void {
    const path = credentialsPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existing = loadLlmCredentials();
    const next: LlmCredentials = { ...existing, [provider]: { apiKey } };
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    } catch {
        // Best effort — a filesystem without POSIX modes is not a reason to fail the save.
    }
}

/** Forget the stored key for one provider. */
export function clearLlmCredential(provider: LLMProviderName): void {
    const path = credentialsPath();
    if (!existsSync(path)) return;
    const existing = loadLlmCredentials();
    delete existing[provider];
    writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

// ─── Combined resolution ─────────────────────────────────────────────────────

/** A resolved setting plus where it was found. */
export interface ResolvedLlmSettings {
    provider?: LLMProviderName;
    apiKey?: string;
    model: string;
    baseUrl?: string;
    /** Where the API key came from. `undefined` when there is no key. */
    keyOrigin?: LlmSettingsOrigin;
    /** True when a key is available from any source. */
    configured: boolean;
}

interface Layers {
    env: NodeJS.ProcessEnv;
    envFile: Record<string, string>;
    project: LlmProjectSettings;
    credentials: LlmCredentials;
}

function readLayers(projectRoot?: string): Layers {
    return {
        env: process.env,
        envFile: projectRoot ? loadEnvFile(projectRoot) : {},
        project: projectRoot ? loadLlmProjectSettings(projectRoot) : {},
        credentials: loadLlmCredentials(),
    };
}

/** First non-empty value for `name` across the two environment layers. */
function fromEnvLayers(layers: Layers, name: string): { value: string; origin: LlmSettingsOrigin } | undefined {
    const direct = layers.env[name];
    if (direct) return { value: direct, origin: 'env' };
    const fromFile = layers.envFile[name];
    if (fromFile) return { value: fromFile, origin: 'env-file' };
    return undefined;
}

function resolveKey(layers: Layers, provider: LLMProviderName): { value: string; origin: LlmSettingsOrigin } | undefined {
    const envName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const fromEnv = fromEnvLayers(layers, envName);
    if (fromEnv) return fromEnv;
    const stored = layers.credentials[provider]?.apiKey;
    if (stored) return { value: stored, origin: 'user-credentials' };
    return undefined;
}

/**
 * Resolve provider settings across every layer.
 *
 * The chosen provider is whichever the project explicitly selects, or — absent
 * that — whichever has a usable key, Anthropic first.
 */
export function resolveLlmSettings(projectRoot?: string): ResolvedLlmSettings {
    const layers = readLayers(projectRoot);

    const preferred = layers.project.provider;
    const order: LLMProviderName[] = preferred
        ? [preferred, preferred === 'anthropic' ? 'openai' : 'anthropic']
        : ['anthropic', 'openai'];

    for (const provider of order) {
        const key = resolveKey(layers, provider);
        if (!key) continue;
        return {
            provider,
            apiKey: key.value,
            model: resolveModel(layers, provider),
            baseUrl: resolveBaseUrl(layers, provider),
            keyOrigin: key.origin,
            configured: true,
        };
    }

    // No key anywhere. Still report the provider/model the project asks for so
    // the settings screen can show what would be used once a key is supplied.
    const provider = preferred;
    return {
        provider,
        apiKey: undefined,
        model: provider ? resolveModel(layers, provider) : DEFAULT_MODELS.anthropic,
        baseUrl: provider ? resolveBaseUrl(layers, provider) : undefined,
        keyOrigin: undefined,
        configured: false,
    };
}

function resolveModel(layers: Layers, provider: LLMProviderName): string {
    return fromEnvLayers(layers, 'MEMO_LLM_MODEL')?.value
        ?? layers.project.model
        ?? DEFAULT_MODELS[provider];
}

function resolveBaseUrl(layers: Layers, provider: LLMProviderName): string | undefined {
    const envName = provider === 'anthropic' ? 'ANTHROPIC_BASE_URL' : 'OPENAI_BASE_URL';
    return fromEnvLayers(layers, envName)?.value ?? layers.project.baseUrl;
}

/**
 * Settings safe to send to a browser client: everything except the key itself.
 * The workbench needs to know a key exists and where it came from — never its value.
 */
export interface LlmSettingsStatus {
    configured: boolean;
    provider?: LLMProviderName;
    model: string;
    baseUrl?: string;
    keyOrigin?: LlmSettingsOrigin;
    /** True when the key came from a file MEMO can overwrite. */
    keyEditable: boolean;
}

export function llmSettingsStatus(projectRoot?: string): LlmSettingsStatus {
    const resolved = resolveLlmSettings(projectRoot);
    return {
        configured: resolved.configured,
        provider: resolved.provider,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        keyOrigin: resolved.keyOrigin,
        // An env-supplied key wins over the credentials file, so offering to
        // overwrite it in the UI would be a lie — saving would change nothing.
        keyEditable: !resolved.configured || resolved.keyOrigin === 'user-credentials',
    };
}
