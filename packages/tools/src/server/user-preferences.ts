// ─── One person's preferences for one model ─────────────────────────────────
//
// What a person chose for themselves in Architect while working on this model —
// the role whose viewpoints they want to see, and the workspace (the system of systems, or one
// system) they are working in. It is not model content
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
import type { UserPreferencesDTO } from '../protocol/messages.js';
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
    return clean({ role: parsed?.role, workspace: parsed?.workspace });
}

/** Keep the string choices that are set, trimmed; drop the rest. */
function clean(raw: Record<string, unknown>): UserPreferencesDTO {
    const out: UserPreferencesDTO = {};
    for (const key of ['role', 'workspace'] as const) {
        const value = raw[key];
        if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
}

/** Write the person's choices; an unset choice removes its key. */
export function saveUserPreferences(projectRoot: string, preferences: UserPreferencesDTO): UserPreferencesDTO {
    const next = clean({ ...preferences });
    ensureGitIgnored(projectRoot, USER_PREFERENCES_FILE, 'MEMO Architect: your own choices for this model');
    writeFileSync(resolve(projectRoot, USER_PREFERENCES_FILE), HEADER + stringifyYaml(next), 'utf8');
    return next;
}
