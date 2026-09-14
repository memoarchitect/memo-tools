// ─── Dashboard Store ─────────────────────────────────────────────────────────
//
// File-backed persistence for custom dashboards. A dashboard is one markdown
// file and nothing else — no index, no settings entry — so a dashboard exists
// because its file exists, and a `git pull` or a hand edit is a complete way
// to add one.
//
//   shared   <projectRoot>/dashboards/<id>.md        committed with the project
//   user     <projectRoot>/dashboards/user/<id>.md   one person's, never committed
//
// The user folder is visible on purpose — a hidden directory is somewhere people
// lose work. It is kept out of git by a `dashboards/user/` line in the project's
// own `.gitignore`, which the store adds the first time it writes a user
// dashboard, and `dashboards/README.md` says what the two folders are for.
//
// Dashboards are presentation, not model: they sit outside the SysML include
// roots and outside viewpoint packages, and only reference views by id.
//
// Design: plans/memo-custom-dashboards.md.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { DashboardDTO, DashboardScope } from '@memoarchitect/tools';

export const DASHBOARD_SCOPES: readonly DashboardScope[] = ['shared', 'user'];

/** The ignore rule for user dashboards, as written into `.gitignore`. */
export const USER_DASHBOARDS_IGNORE = 'dashboards/user/';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Files in a dashboard folder that document it rather than being a dashboard. */
const NOT_DASHBOARDS = new Set(['readme.md']);

const README = `# Dashboards

Markdown pages with live diagrams, opened in MEMO Architect under **Dashboards**.

| Folder | Who sees it | In git? |
| --- | --- | --- |
| \`dashboards/\` | everyone on the project | committed |
| \`dashboards/user/\` | only you, on this machine | ignored — listed in \`.gitignore\` |

Each \`.md\` file is one dashboard; its file name is its id. Every viewpoint
also has a generated dashboard until a file named
\`viewpoint-<viewpoint id>.md\` replaces it.

Embed a live, read-only diagram with a directive on its own line:

    {{diagram:<view id or name>}}
    {{diagram:<view id or name> height=640}}

A file in \`dashboards/user/\` with the same name as one in \`dashboards/\`
replaces it for you only. **Share** in the app moves a user dashboard up into
\`dashboards/\`.
`;

/** Directory holding one scope's dashboard files. */
export function dashboardDir(projectRoot: string, scope: DashboardScope): string {
    return scope === 'shared'
        ? resolve(projectRoot, 'dashboards')
        : resolve(projectRoot, 'dashboards', 'user');
}

function assertScope(scope: unknown): asserts scope is DashboardScope {
    if (scope !== 'shared' && scope !== 'user') {
        throw new Error(`Unknown dashboard scope "${String(scope)}" — expected "shared" or "user".`);
    }
}

/**
 * Refuse, rather than rewrite, an id that is not a plain filename stem.
 *
 * Silently sanitizing would let two different ids land on one file, and a
 * dashboard saved under an id the user did not type is one they cannot find.
 */
function assertId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !ID_RE.test(id) || NOT_DASHBOARDS.has(`${id.toLowerCase()}.md`)) {
        throw new Error(`Invalid dashboard id "${String(id)}" — use letters, digits, ".", "_" or "-", starting with a letter or digit.`);
    }
}

function filePath(projectRoot: string, scope: DashboardScope, id: string): string {
    return resolve(dashboardDir(projectRoot, scope), `${id}.md`);
}

/**
 * Make sure the project's `.gitignore` keeps user dashboards out of git.
 *
 * Appends one line, never rewrites the file. Already covered is judged by an
 * exact line match on the common spellings; anything cleverer is the user's
 * own rule to keep.
 */
export function ensureUserDashboardsIgnored(projectRoot: string): void {
    const path = resolve(projectRoot, '.gitignore');
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const spellings = new Set([USER_DASHBOARDS_IGNORE, 'dashboards/user', '/dashboards/user/', '/dashboards/user']);
    if (existing.split(/\r?\n/).some(line => spellings.has(line.trim()))) return;
    const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${existing}${lead}\n# MEMO Architect: personal dashboards\n${USER_DASHBOARDS_IGNORE}\n`, 'utf8');
}

function ensureDir(projectRoot: string, scope: DashboardScope): string {
    const shared = dashboardDir(projectRoot, 'shared');
    if (!existsSync(shared)) mkdirSync(shared, { recursive: true });
    const readme = resolve(shared, 'README.md');
    if (!existsSync(readme)) writeFileSync(readme, README, 'utf8');
    const dir = dashboardDir(projectRoot, scope);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (scope === 'user') ensureUserDashboardsIgnored(projectRoot);
    return dir;
}

/** Frontmatter `title`, else the first `#` heading, else the id. */
export function dashboardTitle(content: string, id: string): string {
    const m = content.match(FRONTMATTER_RE);
    if (m) {
        try {
            const meta = parseYaml(m[1]) as Record<string, unknown> | null;
            if (meta && typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
        } catch { /* malformed frontmatter falls through to the heading */ }
    }
    const body = m ? content.slice(m[0].length) : content;
    const heading = body.match(/^#\s+(.+)$/m);
    return heading ? heading[1].trim() : id;
}

/** Every dashboard in both scopes, shared first, each sorted by title. */
export function loadDashboards(projectRoot: string): DashboardDTO[] {
    const out: DashboardDTO[] = [];
    for (const scope of DASHBOARD_SCOPES) {
        const dir = dashboardDir(projectRoot, scope);
        if (!existsSync(dir)) continue;
        const inScope: DashboardDTO[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            if (NOT_DASHBOARDS.has(entry.name.toLowerCase())) continue;
            const id = entry.name.slice(0, -3);
            if (!ID_RE.test(id)) continue;
            const full = resolve(dir, entry.name);
            try {
                const content = readFileSync(full, 'utf8');
                inScope.push({
                    id,
                    scope,
                    title: dashboardTitle(content, id),
                    content,
                    path: relative(projectRoot, full),
                    updatedAt: statSync(full).mtimeMs,
                });
            } catch { /* an unreadable file is skipped, not fatal */ }
        }
        inScope.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
        out.push(...inScope);
    }
    return out;
}

export function saveDashboard(projectRoot: string, scope: DashboardScope, id: string, content: string): string {
    assertScope(scope);
    assertId(id);
    if (typeof content !== 'string') throw new Error('Dashboard content must be a string.');
    ensureDir(projectRoot, scope);
    const path = filePath(projectRoot, scope, id);
    writeFileSync(path, content, 'utf8');
    return relative(projectRoot, path);
}

export function deleteDashboard(projectRoot: string, scope: DashboardScope, id: string): boolean {
    assertScope(scope);
    assertId(id);
    const path = filePath(projectRoot, scope, id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
}

/**
 * Move a dashboard between scopes.
 *
 * Refuses to overwrite: sharing a user page onto a shared one of the same id
 * would destroy the team's copy, and that must be a deliberate delete first.
 */
export function moveDashboard(projectRoot: string, id: string, from: DashboardScope, to: DashboardScope): string {
    assertScope(from);
    assertScope(to);
    assertId(id);
    if (from === to) return relative(projectRoot, filePath(projectRoot, from, id));
    const source = filePath(projectRoot, from, id);
    if (!existsSync(source)) throw new Error(`No ${from} dashboard "${id}".`);
    const target = filePath(projectRoot, to, id);
    if (existsSync(target)) throw new Error(`A ${to} dashboard "${id}" already exists — delete or rename it first.`);
    ensureDir(projectRoot, to);
    renameSync(source, target);
    return relative(projectRoot, target);
}
