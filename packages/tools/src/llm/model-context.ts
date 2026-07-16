// ─── Model Context Serializer ────────────────────────────────────────────────
//
// Serializes MemoModel into a compact text summary suitable for LLM context.
// Provides model overview, element listing, relationships, and validation gaps.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';
import type { MEMOConfig } from '../model/config.js';
import type { QueryContext } from '../dhf/query-engine.js';

/** Options for context serialization */
export interface ContextOptions {
    /** Include element details (default: true) */
    includeElements?: boolean;
    /** Include relationships (default: true) */
    includeRelationships?: boolean;
    /** Include validation gaps (default: true) */
    includeGaps?: boolean;
    /** Maximum elements to include (default: 500) */
    maxElements?: number;
    /** Filter to specific kinds */
    filterKinds?: string[];
    /** Filter to specific layers */
    filterLayers?: string[];
}

/**
 * Serialize model into a compact text context for LLM consumption.
 * Designed to fit within typical context windows while providing
 * enough information for meaningful Q&A.
 */
export function serializeModelContext(
    ctx: QueryContext,
    options: ContextOptions = {},
): string {
    const {
        includeElements = true,
        includeRelationships = true,
        includeGaps = true,
        maxElements = 500,
        filterKinds,
        filterLayers,
    } = options;

    const parts: string[] = [];

    // ─── Project overview ───────────────────────────────────────────────
    parts.push(`# Model: ${ctx.projectName}`);
    parts.push(`Elements: ${ctx.totalElements()} | Relationships: ${ctx.totalRelationships()} | Completeness: ${ctx.overallCompleteness()}%`);
    parts.push('');

    // ─── Layer summary ──────────────────────────────────────────────────
    const layers = ctx.layerSummary();
    if (layers.length > 0) {
        parts.push('## Layers');
        for (const l of layers) {
            parts.push(`- ${l.label} (${l.id}): ${l.count} elements, ${l.completeness}% complete`);
        }
        parts.push('');
    }

    // ─── Elements ───────────────────────────────────────────────────────
    if (includeElements) {
        let elements = ctx.allElements();
        if (filterKinds?.length) {
            elements = ctx.elementsByKinds(filterKinds);
        }
        if (filterLayers?.length) {
            elements = elements.filter(e => filterLayers.includes(e.layer));
        }

        // Truncate if too many
        const truncated = elements.length > maxElements;
        const shown = truncated ? elements.slice(0, maxElements) : elements;

        parts.push('## Elements');
        // Group by kind for readability
        const byKind = new Map<string, MemoElement[]>();
        for (const el of shown) {
            if (!byKind.has(el.kind)) byKind.set(el.kind, []);
            byKind.get(el.kind)!.push(el);
        }
        for (const [kind, els] of byKind) {
            parts.push(`### ${kind} (${els.length})`);
            for (const el of els) {
                let line = `- ${el.name} [${el.id}] (layer: ${el.layer})`;
                if (el.doc) line += ` — ${el.doc}`;
                const attrs = Object.entries(el.attributes);
                if (attrs.length > 0) {
                    line += ` {${attrs.map(([k, v]) => `${k}=${v}`).join(', ')}}`;
                }
                parts.push(line);
            }
        }
        if (truncated) {
            parts.push(`... (${elements.length - maxElements} more elements truncated)`);
        }
        parts.push('');
    }

    // ─── Relationships ──────────────────────────────────────────────────
    if (includeRelationships) {
        const rels = ctx.allRelationships();
        parts.push('## Relationships');
        // Group by type
        const byType = new Map<string, typeof rels>();
        for (const r of rels) {
            if (!byType.has(r.type)) byType.set(r.type, []);
            byType.get(r.type)!.push(r);
        }
        for (const [type, rs] of byType) {
            parts.push(`### ${type} (${rs.length})`);
            const shown = rs.slice(0, 50); // cap per type
            for (const r of shown) {
                parts.push(`- ${ctx.elementName(r.sourceId)} → ${ctx.elementName(r.targetId)}`);
            }
            if (rs.length > 50) {
                parts.push(`... (${rs.length - 50} more)`);
            }
        }
        parts.push('');
    }

    // ─── Validation gaps ────────────────────────────────────────────────
    if (includeGaps) {
        const errors = ctx.violationsBySeverity('error');
        const warnings = ctx.violationsBySeverity('warning');

        if (errors.length > 0 || warnings.length > 0) {
            parts.push('## Validation Gaps');
            parts.push(`Errors: ${errors.length} | Warnings: ${warnings.length}`);
            parts.push(`Unmitigated hazards: ${ctx.unmitigatedCount()}`);
            parts.push(`Untraced requirements: ${ctx.untracedRequirements().length}`);
            parts.push('');

            if (errors.length > 0) {
                parts.push('### Errors');
                for (const v of errors.slice(0, 30)) {
                    parts.push(`- [${v.ruleId}] ${v.elementName} (${v.elementKind}): ${v.description}`);
                }
                if (errors.length > 30) parts.push(`... (${errors.length - 30} more)`);
            }
            if (warnings.length > 0) {
                parts.push('### Warnings');
                for (const v of warnings.slice(0, 20)) {
                    parts.push(`- [${v.ruleId}] ${v.elementName} (${v.elementKind}): ${v.description}`);
                }
                if (warnings.length > 20) parts.push(`... (${warnings.length - 20} more)`);
            }
            parts.push('');
        }
    }

    return parts.join('\n');
}

/**
 * Serialize ontology context (available kinds, relationships) for SysML generation.
 */
export function serializeOntologyContext(config: MEMOConfig): string {
    const parts: string[] = [];

    parts.push('# Ontology Context');
    parts.push('');

    // Available kinds grouped by layer
    if (config.kinds) {
        parts.push('## Available Kinds');
        const byLayer = new Map<string, string[]>();
        for (const [name, def] of Object.entries(config.kinds)) {
            const layer = def.layer || 'unknown';
            if (!byLayer.has(layer)) byLayer.set(layer, []);
            byLayer.get(layer)!.push(`${name} (${def.sysmlConstruct})`);
        }
        for (const [layer, kinds] of byLayer) {
            parts.push(`### ${layer}`);
            for (const k of kinds) {
                parts.push(`- ${k}`);
            }
        }
        parts.push('');
    }

    // Available relationship types
    if (config.relationshipTypes?.length) {
        parts.push('## Available Relationship Types');
        for (const rt of config.relationshipTypes) {
            parts.push(`- ${rt.name} (${rt.label}) — layer: ${rt.layer}`);
        }
        parts.push('');
    }

    // Architecture layers
    if (config.architectureLayers?.length) {
        parts.push('## Architecture Layers');
        for (const l of config.architectureLayers) {
            parts.push(`- ${l.id}: ${l.label}`);
        }
        parts.push('');
    }

    return parts.join('\n');
}
