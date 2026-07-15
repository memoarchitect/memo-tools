// ─── DHF Config V2 ────────────────────────────────────────────────────────────
//
// New memo.dhf.yaml schema for the markdown-first DHF workbench.
// Supersedes dhf-config.ts (v1) which is kept for backward compatibility.
//
// Schema:
//   project:        company, product, logo, authors, risk_policy
//   standards:      list of applicable regulatory standards
//   manifest:       document groups with @group references and per-doc settings
//   rendering:      per-kind display profiles (columns, badge colors)
//   export:         format, numbering, glossary, header/footer
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'yaml';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export interface DhfProjectConfig {
    company?: string;
    product?: string;
    device_type?: string;
    /** Path to logo file (relative to project root) */
    logo?: string;
    authors?: Array<{ name: string; role: string; email?: string }>;
    approvers?: Array<{ name: string; role: string; date?: string }>;
    version?: string;
    phase?: 'concept' | 'design' | 'verification' | 'production' | string;
    /** Policy reference for risk acceptability (ISO 14971) */
    risk_policy?: {
        max_unmitigated?: number;
        severity_levels?: string[];
        probability_levels?: string[];
        acceptable_threshold?: number;
    };
}

export interface DhfDocumentEntry {
    /** Template path relative to templates root, or built-in template ID */
    template: string;
    /** Human-readable title override (falls back to template frontmatter) */
    title?: string;
    /** Whether to include in default exports */
    enabled?: boolean;
    /** Output filename (without extension) */
    filename?: string;
}

export interface DhfDocumentGroup {
    /** Group display name */
    title: string;
    /** Document entries in this group */
    documents: Array<string | { id: string } & DhfDocumentEntry>;
}

export interface DhfManifest {
    /** Named document groups */
    groups: Record<string, DhfDocumentGroup>;
    /** Default group(s) to include in `memo dhf export` */
    default_groups?: string[];
}

export interface DhfKindProfile {
    /** Columns to show in tables */
    columns?: string[];
    /** Badge label field */
    badge?: string;
    /** Color for kind badges */
    color?: string;
}

export interface DhfRenderingConfig {
    /** Per-kind display profiles */
    kinds?: Record<string, DhfKindProfile>;
    /** Max rows per table before truncation */
    table_limit?: number;
}

export interface DhfExportConfig {
    /** Default export format */
    format?: 'html' | 'md' | 'docx' | 'pdf';
    /** Section numbering (1.1.1 style) */
    numbering?: boolean;
    /** Include auto-generated glossary */
    glossary?: boolean;
    /** Header template (markdown, may use {{project.*}} directives) */
    header?: string;
    /** Footer template */
    footer?: string;
    /** Output directory */
    output_dir?: string;
}

export interface DhfConfigV2 {
    /** Config format version — "2" triggers new markdown-first pipeline */
    version?: '1' | '2';
    project?: DhfProjectConfig;
    standards?: string[];
    manifest?: DhfManifest;
    rendering?: DhfRenderingConfig;
    export?: DhfExportConfig;
    /** Path to directory containing custom templates */
    template_dir?: string;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export function loadDhfConfigV2(projectDir: string): DhfConfigV2 | undefined {
    const candidates = [
        resolve(projectDir, 'memo.dhf.yaml'),
        resolve(projectDir, 'memo.dhf.yml'),
    ];

    for (const path of candidates) {
        if (existsSync(path)) {
            try {
                const raw = readFileSync(path, 'utf-8');
                const parsed = yaml.parse(raw) as DhfConfigV2;
                return parsed || {};
            } catch {
                return undefined;
            }
        }
    }

    return undefined;
}

/** Check if config is V2 (markdown-first) */
export function isDhfConfigV2(cfg: unknown): cfg is DhfConfigV2 {
    if (!cfg || typeof cfg !== 'object') return false;
    const c = cfg as Record<string, unknown>;
    return c['version'] === '2' || c['manifest'] !== undefined || c['project'] !== undefined;
}

/** Extract flat project metadata for use in directives */
export function extractProjectMeta(cfg: DhfConfigV2): Record<string, unknown> {
    const p = cfg.project ?? {};
    return {
        company: p.company ?? '',
        product: p.product ?? '',
        device_type: p.device_type ?? '',
        version: p.version ?? cfg.export?.format ?? '',
        phase: p.phase ?? '',
        logo: p.logo ?? '',
        authors: (p.authors ?? []).map(a => a.name).join(', '),
        risk_policy: p.risk_policy ?? {},
    };
}

/** Get all enabled document entries from a manifest */
export function resolveManifestDocuments(
    cfg: DhfConfigV2,
    groupFilter?: string,
): Array<{ id: string; template: string; group: string; title?: string }> {
    if (!cfg.manifest?.groups) return [];

    const result: Array<{ id: string; template: string; group: string; title?: string }> = [];
    const defaultGroups = cfg.manifest.default_groups;

    for (const [groupId, group] of Object.entries(cfg.manifest.groups)) {
        if (groupFilter && groupId !== groupFilter) continue;
        if (!groupFilter && defaultGroups && !defaultGroups.includes(groupId)) continue;

        for (const entry of group.documents) {
            if (typeof entry === 'string') {
                result.push({ id: entry, template: entry, group: groupId });
            } else {
                const { id, template, enabled = true, title } = entry as { id: string } & DhfDocumentEntry;
                if (enabled !== false) {
                    result.push({ id, template, group: groupId, title });
                }
            }
        }
    }

    return result;
}
