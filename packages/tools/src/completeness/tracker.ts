// ─── Completeness Tracker ─────────────────────────────────────────────────────
//
// Computes per-layer and overall completeness percentages based on
// validation results and the model's element distribution.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport, LayerCompleteness, ElementStatus } from '../validator/types.js';

/**
 * Compute completeness from model + validation results.
 *
 * An element is "complete" if it has no error-severity violations.
 * Warnings and info violations do not affect completeness.
 */
/**
 * Compute completeness over the model as given.
 *
 * Scope is applied by the caller, by narrowing the model before it gets here.
 * That keeps one filter rather than two: a methodology's inclusion lists name
 * packages, and a layer id is a display grouping in a different namespace, so a
 * scope check inside this function would have been comparing the wrong two
 * things.
 */
export function computeCompleteness(
    model: MemoModel,
    validation: ValidationResult,
): CompletenessReport {
    // Build sets of element IDs by violation severity
    const elementsWithErrors = new Set<string>();
    const elementsWithWarnings = new Set<string>();
    for (const v of validation.violations) {
        if (v.severity === 'error') {
            elementsWithErrors.add(v.elementId);
        } else if (v.severity === 'warning') {
            elementsWithWarnings.add(v.elementId);
        }
    }

    // Build per-element status map
    const elementStatus: Record<string, ElementStatus> = {};
    for (const el of model.elements.values()) {
        if (elementsWithErrors.has(el.id)) {
            elementStatus[el.id] = 'error';
        } else if (elementsWithWarnings.has(el.id)) {
            elementStatus[el.id] = 'warning';
        } else {
            elementStatus[el.id] = 'complete';
        }
    }

    const layers: LayerCompleteness[] = [];
    let totalElements = 0;
    let completeElements = 0;

    // Layers come from the model, not from a configured list. A settings file
    // used to declare `architectureLayers:`, so a layer the ontology defined
    // but the file omitted was silently excluded from the percentage — and the
    // report looked complete because the incomplete part was invisible.
    for (const [layerId, layerElements] of [...model.elementsByLayer.entries()].sort()) {
        if (layerId === 'unknown' || layerElements.length === 0) continue;
        const total = layerElements.length;
        const complete = layerElements.filter(e => !elementsWithErrors.has(e.id)).length;
        totalElements += total;
        completeElements += complete;
        layers.push({
            layerId,
            layerLabel: layerId.charAt(0).toUpperCase() + layerId.slice(1).replace(/_/g, ' '),
            layerColor: '#7A9BAA',
            totalElements: total,
            completeElements: complete,
            percentage: total > 0 ? Math.round((complete / total) * 100) : 100,
        });
    }

    // Include elements in unknown layers
    const unknownElements = model.elementsByLayer.get('unknown') || [];
    totalElements += unknownElements.length;
    completeElements += unknownElements.filter(e => !elementsWithErrors.has(e.id)).length;

    return {
        layers,
        overall: totalElements > 0 ? Math.round((completeElements / totalElements) * 100) : 100,
        totalElements,
        completeElements,
        elementStatus,
    };
}
