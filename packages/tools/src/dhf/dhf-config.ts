// ─── DHF Configuration ───────────────────────────────────────────────────────
//
// Reads memo.dhf.yaml for per-project DHF customization: org info, phase,
// per-doc enable/disable, custom sections, approvers, template overrides.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import * as yaml from 'yaml';

/** Per-document configuration override */
export interface DhfDocOverride {
    /** Enable/disable this document */
    enabled?: boolean;
    /** Custom section overrides */
    customSections?: Array<{ id: string; title: string; content?: string }>;
}

/** DHF configuration from memo.dhf.yaml */
export interface DhfConfig {
    /** Organization name */
    organization?: string;
    /** Document version */
    version?: string;
    /** Development phase (e.g., "Design", "Verification", "Production") */
    phase?: string;
    /** Applicable standards */
    standards?: string[];
    /** Author names */
    authors?: string[];
    /** Approvers with roles */
    approvers?: Array<{ name: string; role: string; date?: string }>;
    /** Per-document overrides keyed by document ID */
    documents?: Record<string, DhfDocOverride>;
    /** Custom template directory (overrides built-in templates) */
    templateDir?: string;
    /** Risk matrix configuration */
    riskMatrix?: {
        severityLevels?: string[];
        probabilityLevels?: string[];
        acceptabilityThreshold?: number;
    };
    /** Default export format */
    defaultFormat?: 'html' | 'md' | 'docx';
}

/** Load DHF config from a project directory */
export function loadDhfConfig(projectDir: string): DhfConfig | undefined {
    const candidates = [
        resolve(projectDir, 'memo.dhf.yaml'),
        resolve(projectDir, 'memo.dhf.yml'),
    ];

    for (const path of candidates) {
        if (existsSync(path)) {
            try {
                const raw = readFileSync(path, 'utf-8');
                const parsed = yaml.parse(raw) as DhfConfig;
                return parsed || {};
            } catch {
                return undefined;
            }
        }
    }

    return undefined;
}

/** Check if a document type is enabled given DHF config */
export function isDocumentEnabled(docId: string, dhfConfig?: DhfConfig): boolean {
    if (!dhfConfig?.documents) return true;
    const override = dhfConfig.documents[docId];
    if (!override) return true;
    return override.enabled !== false;
}

/** Get custom sections for a document type */
export function getCustomSections(docId: string, dhfConfig?: DhfConfig): Array<{ id: string; title: string; content?: string }> {
    if (!dhfConfig?.documents) return [];
    return dhfConfig.documents[docId]?.customSections || [];
}
