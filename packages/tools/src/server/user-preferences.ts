// ─── One person's preferences for one model ─────────────────────────────────
//
// What a person chose for themselves in Architect while working on this model —
// the role whose viewpoints they want to see, how the explorer splits its folders, the experimental features they switched on, the workspace (the system of systems, or one
// system) they are working in, what they marked as favorites, and what they opened last. It is not model content
// and not something the team shares, so it lives in one visible file at the
// model root, `memo.user.yaml`, which the model's `.gitignore` keeps out of git
// (added the first time it is written, as personal dashboards are).
//
// Settings that are the same for a person across every model (their compiler,
// their SysIDE Python) are not here: those are `~/.config/memo/settings.yaml`.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { FavoriteDTO, FavoriteType, UserPreferencesDTO } from '../protocol/messages.js';
import { ensureGitIgnored } from './project-gitignore.js';

/** The file, at the model root. */
export const USER_PREFERENCES_FILE = 'memo.user.yaml';

const HEADER = `# Your own MEMO Architect choices for this model. Not committed: the model's
# .gitignore lists this file. Delete it to go back to the defaults.
`;

/** What the file holds, or no choices at all when it is absent. */
export function loadUserPreferences(projectRoot: string): UserPreferencesDTO {
    const path = resolve(projectRoot, USER_PREFERENCES_FILE);
    if (!existsSync(path)) return {};
    const parsed = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown> | null;
    return clean({
        role: parsed?.role, workspace: parsed?.workspace, explorerSplit: parsed?.explorerSplit, features: parsed?.features,
        packageFolders: parsed?.packageFolders, favorites: parsed?.favorites, recentViews: parsed?.recentViews, recentElements: parsed?.recentElements,
    });
}

/** Keep the string choices that are set, trimmed; drop the rest. */
function clean(raw: Record<string, unknown>): UserPreferencesDTO {
    const out: UserPreferencesDTO = {};
    for (const key of ['role', 'workspace', 'explorerSplit'] as const) {
        const value = raw[key];
        if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    // Package folders are on unless the person turned them off, so only `false` is kept.
    if (raw.packageFolders === false) out.packageFolders = false;
    // The feature ids switched on: a list of non-empty strings, each once, in the order given.
    if (Array.isArray(raw.features)) {
        const features = [...new Set(raw.features.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim()))];
        if (features.length > 0) out.features = features;
    }
    const favorites = cleanFavorites(raw.favorites);
    if (favorites.length > 0) out.favorites = favorites;
    for (const key of ['recentViews', 'recentElements'] as const) {
        const recent = cleanRecent(raw[key]);
        if (recent.length > 0) out[key] = recent;
    }
    return out;
}

/** How many recently opened views, and elements, are kept. */
export const RECENT_LIMIT = 10;

const FAVORITE_TYPES: readonly FavoriteType[] = ['element', 'view', 'viewpoint', 'package', 'folder'];

/** Favorites of a known type with a reference, each once, in the order given. */
function cleanFavorites(raw: unknown): FavoriteDTO[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: FavoriteDTO[] = [];
    for (const entry of raw) {
        const value = entry as Partial<FavoriteDTO> | null;
        const ref = typeof value?.ref === 'string' ? value.ref.trim() : '';
        if (!value || !FAVORITE_TYPES.includes(value.type as FavoriteType) || !ref) continue;
        const packageName = typeof value.packageName === 'string' && value.packageName.trim() ? value.packageName.trim() : undefined;
        const key = `${value.type}|${ref}|${packageName ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: value.type as FavoriteType, ref, ...(packageName ? { packageName } : {}) });
    }
    return out;
}

/** Ids, each once, most recent first, at most RECENT_LIMIT. */
function cleanRecent(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim());
    return [...new Set(ids)].slice(0, RECENT_LIMIT);
}

/** Write the person's choices; an unset choice removes its key. */
export function saveUserPreferences(projectRoot: string, preferences: UserPreferencesDTO): UserPreferencesDTO {
    const next = clean({ ...preferences });
    ensureGitIgnored(projectRoot, USER_PREFERENCES_FILE, 'MEMO Architect: your own choices for this model');
    writeFileSync(resolve(projectRoot, USER_PREFERENCES_FILE), HEADER + stringifyYaml(next), 'utf8');
    return next;
}
