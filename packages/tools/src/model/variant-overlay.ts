// ─── Variants as an overlay on one flow ──────────────────────────────────────
//
// A base workflow's steps are refined, one for one, by each variant's own
// workflow (`#refinement dependency`, which the builder emits as `realizes`).
// Where the variants perform the same steps, drawing a workflow per variant
// repeats the flow and hides what differs. This reads the refinements back as an
// overlay instead: for each base step, what every variant does with it.
//
// A refining step belongs to a variant through the workflow that owns it: the workflow
// `realizesUseCase`, and that use case's `hasSubject` is the variant part. It
// does not go through the variant's own `perform` list, which is allowed to name
// fewer steps than its workflow owns.
//
// Browser-safe: reads the DTO and the ontology's relationship names, nothing else.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO } from './semantic.js';
import { relationshipsOfType } from './relation-selection.js';

/** One variant's version of a base step. */
export interface VariantStepRow {
    variantId: string;
    /** The refining step in the variant's workflow. */
    stepId: string;
    /** `expectedDuration` as the model writes it, e.g. `30 [minute]`. */
    duration?: string;
}

/** A variant that refines at least one step of the base. */
export interface OverlayVariant {
    id: string;
    label: string;
    /** `capacityCostRate` as the model writes it, e.g. `650 [euro/hour]`. */
    rate?: string;
}

export interface VariantOverlay {
    variants: OverlayVariant[];
    /** Base step id → one row per variant that refines it, in `variants` order. */
    rows: Map<string, VariantStepRow[]>;
}

/** The variant part a refining step stands for, or undefined when no workflow above it has one. */
function variantOf(stepId: string, parentOf: Map<string, string>, subjectOf: Map<string, string>, useCaseOf: Map<string, string>): string | undefined {
    for (let id: string | undefined = stepId, hops = 0; id && hops < 16; id = parentOf.get(id), hops++) {
        const useCase = useCaseOf.get(id);
        if (useCase) return subjectOf.get(useCase);
    }
    return undefined;
}

/**
 * The per-step overlay for the base steps in `baseStepIds`.
 *
 * Empty when none of them is refined by a variant's workflow, so a flow with no
 * variants draws exactly as it did.
 */
export function variantOverlay(model: MemoModelDTO, baseStepIds: Iterable<string>): VariantOverlay {
    const base = new Set(baseStepIds);
    const useCaseOf = new Map(relationshipsOfType(model, 'realizesUseCase').map(r => [r.sourceId, r.targetId] as const));
    const parentOf = new Map(relationshipsOfType(model, 'composes').map(r => [r.targetId, r.sourceId] as const));
    const subjectOf = new Map(relationshipsOfType(model, 'hasSubject').map(r => [r.sourceId, r.targetId] as const));

    const rows = new Map<string, VariantStepRow[]>();
    const seen = new Map<string, OverlayVariant>();
    for (const r of relationshipsOfType(model, 'realizes')) {
        if (!base.has(r.targetId)) continue;
        const variantId = variantOf(r.sourceId, parentOf, subjectOf, useCaseOf);
        const variant = variantId ? model.elements[variantId] : undefined;
        if (!variantId || !variant) continue;
        if (!seen.has(variantId)) {
            seen.set(variantId, {
                id: variantId,
                label: variant.attributes.label ?? variant.name,
                rate: variant.attributes.capacityCostRate,
            });
        }
        const list = rows.get(r.targetId) ?? [];
        list.push({ variantId, stepId: r.sourceId, duration: model.elements[r.sourceId]?.attributes.expectedDuration });
        rows.set(r.targetId, list);
    }
    return { variants: [...seen.values()], rows };
}
