// ─── DHF Document Store ──────────────────────────────────────────────────────
//
// File-backed persistence for DHF workbench documents. Each document is one
// markdown file under <projectRoot>/dhf/documents/<id>.md whose YAML
// frontmatter carries the workbench metadata (id, title, group, template,
// authors, approvers, created). The frontmatter in the file and the one shown
// in the web editor are the same block — saving merges the workbench metadata
// into whatever frontmatter the user typed, so hand edits survive.
//
// Also lists repo markdown files usable as custom templates.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DhfDocDTO, DhfSettingsDTO, DhfRepoTemplateInfo } from '@memoarchitect/tools';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function docsDir(projectRoot: string): string {
    return resolve(projectRoot, 'dhf', 'documents');
}

function settingsPath(projectRoot: string): string {
    return resolve(projectRoot, '.memo', 'dhf-settings.json');
}

const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

function docPath(projectRoot: string, docId: string): string {
    return resolve(docsDir(projectRoot), `${safeId(docId)}.md`);
}

/** Split markdown into { frontmatter object, body }. Malformed YAML → empty meta. */
function splitFrontmatter(md: string): { meta: Record<string, unknown>; body: string } {
    const m = md.match(FRONTMATTER_RE);
    if (!m) return { meta: {}, body: md };
    let meta: Record<string, unknown> = {};
    try { meta = (parseYaml(m[1]) as Record<string, unknown>) ?? {}; } catch { /* keep raw body */ }
    return { meta, body: md.slice(m[0].length) };
}

/** "Name | Role" lines ↔ frontmatter string list */
const linesToList = (raw: string): string[] => raw.split('\n').map(l => l.trim()).filter(Boolean);
const listToLines = (v: unknown): string =>
    Array.isArray(v) ? v.map(String).join('\n') : typeof v === 'string' ? v : '';

// ─── Documents ────────────────────────────────────────────────────────────────

export function loadDhfDocs(projectRoot: string): DhfDocDTO[] {
    const dir = docsDir(projectRoot);
    if (!existsSync(dir)) return [];
    const docs: DhfDocDTO[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        try {
            const content = readFileSync(resolve(dir, entry.name), 'utf8');
            const { meta } = splitFrontmatter(content);
            const id = typeof meta.id === 'string' ? meta.id : entry.name.replace(/\.md$/, '');
            docs.push({
                id,
                title: typeof meta.title === 'string' ? meta.title : id,
                group: typeof meta.group === 'string' ? meta.group : '',
                templateId: typeof meta.template === 'string' ? meta.template : '',
                content,
                createdAt: typeof meta.created === 'number' ? meta.created : 0,
                authors: listToLines(meta.authors),
                approvers: listToLines(meta.approvers),
            });
        } catch { /* unreadable file is skipped */ }
    }
    return docs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function saveDhfDoc(projectRoot: string, doc: DhfDocDTO): void {
    const dir = docsDir(projectRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Merge workbench metadata into the frontmatter the user may have edited
    const { meta, body } = splitFrontmatter(doc.content);
    const merged: Record<string, unknown> = {
        ...meta,
        id: doc.id,
        title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : doc.title,
        group: doc.group,
        template: doc.templateId,
        created: doc.createdAt,
    };
    if (doc.authors.trim()) merged.authors = linesToList(doc.authors); else delete merged.authors;
    if (doc.approvers.trim()) merged.approvers = linesToList(doc.approvers); else delete merged.approvers;
    const fm = stringifyYaml(merged).trimEnd();
    writeFileSync(docPath(projectRoot, doc.id), `---\n${fm}\n---\n${body}`, 'utf8');
}

export function deleteDhfDoc(projectRoot: string, docId: string): boolean {
    const p = docPath(projectRoot, docId);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    return true;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function loadDhfSettings(projectRoot: string): DhfSettingsDTO | null {
    const p = settingsPath(projectRoot);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')) as DhfSettingsDTO; } catch { return null; }
}

export function saveDhfSettings(projectRoot: string, settings: DhfSettingsDTO): void {
    const dir = resolve(projectRoot, '.memo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath(projectRoot), JSON.stringify(settings, null, 2), 'utf8');
}

// ─── Repo templates ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.memo', 'memo_packages']);
// Existing workbench documents and export output are not templates
const SKIP_RELATIVE = new Set(['dhf/documents', 'dhf/exports']);

/** Markdown files in the project usable as custom document templates. */
export function listRepoTemplates(projectRoot: string): DhfRepoTemplateInfo[] {
    const root = realpathSync(resolve(projectRoot));
    const out: DhfRepoTemplateInfo[] = [];
    const walk = (dir: string, depth: number): void => {
        if (depth > 6 || out.length >= 200) return;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                const rel = relative(root, full).split('\\').join('/');
                if (!SKIP_DIRS.has(entry.name) && !SKIP_RELATIVE.has(rel)) walk(full, depth + 1);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                out.push({ path: relative(root, full), title: templateTitle(full) });
            }
        }
    };
    walk(root, 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

function templateTitle(fullPath: string): string {
    try {
        const md = readFileSync(fullPath, 'utf8');
        const { meta, body } = splitFrontmatter(md);
        if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
        const h = body.match(/^#\s+(.+)$/m);
        if (h) return h[1].trim();
    } catch { /* fall through to filename */ }
    return fullPath.split('/').pop()!.replace(/\.md$/, '');
}

/** Read one project-local markdown file, guarding against path escape. */
export function readRepoTemplate(projectRoot: string, requestedPath: string): string {
    const root = realpathSync(resolve(projectRoot));
    const requested = resolve(root, requestedPath);
    if (!existsSync(requested)) throw new Error('Template file does not exist.');
    const real = realpathSync(requested);
    const rel = relative(root, real);
    const outside = rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel);
    if (outside || extname(real).toLowerCase() !== '.md') {
        throw new Error('Template must be a project-local .md file.');
    }
    return readFileSync(real, 'utf8');
}
