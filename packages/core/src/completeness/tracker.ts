// ─── Completeness Tracker ─────────────────────────────────────────────────────
//
// Computes per-layer and overall completeness percentages based on
// validation results and the model's element distribution.
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig } from '../model/config.js';
import type { MemoModel } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport, LayerCompleteness, ElementStatus } from '../validator/types.js';

/**
 * Compute completeness from model + validation results.
 *
 * An element is "complete" if it has no error-severity violations.
 * Warnings and info violations do not affect completeness.
 */
export function computeCompleteness(
    model: MemoModel,
    validation: ValidationResult,
    config: MEMOConfig
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

    for (const layer of config.architectureLayers || []) {
        const layerElements = model.elementsByLayer.get(layer.id) || [];
        const total = layerElements.length;
        const complete = layerElements.filter(e => !elementsWithErrors.has(e.id)).length;

        totalElements += total;
        completeElements += complete;

        layers.push({
            layerId: layer.id,
            layerLabel: layer.label,
            layerColor: layer.color,
            totalElements: total,
            completeElements: complete,
            percentage: total > 0 ? Math.round((complete / total) * 100) : 100,
        });
    }

    // Include model layers not declared in config (e.g. layers derived from
    // the ontology directory structure when the project configures none)
    const configuredLayers = new Set((config.architectureLayers || []).map(l => l.id));
    for (const [layerId, layerElements] of model.elementsByLayer.entries()) {
        if (configuredLayers.has(layerId) || layerId === 'unknown' || layerElements.length === 0) continue;
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
