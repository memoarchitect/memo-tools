// ─── Layer Resolver ──────────────────────────────────────────────────────────
//
// Derives architecture layer from a SysML file's directory path.
// Convention: sysml/<layer>/<file>.sysml → layer name.
// The "relationships" directory maps to "crosscutting".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the architecture layer from a SysML file path.
 *
 * Uses the Apollo-11 convention: the immediate subdirectory under `sysml/`
 * determines the layer. The `relationships/` directory is special-cased
 * to "crosscutting" since relationships span layers.
 *
 * @example
 * resolveLayerFromPath("sysml/risk/risk-management.sysml")     → "risk"
 * resolveLayerFromPath("sysml/operational/operational.sysml")   → "operational"
 * resolveLayerFromPath("sysml/relationships/relationships.sysml") → "crosscutting"
 * resolveLayerFromPath("sysml/operational/purpose/business.sysml") → "operational"
 */
export function resolveLayerFromPath(filePath: string): string {
    // Normalize to forward slashes
    const normalized = filePath.replace(/\\/g, '/');

    // Handle both "sysml/..." (relative) and ".../sysml/..." (absolute)
    let afterSysml: string | undefined;
    const slashSysmlIndex = normalized.indexOf('/sysml/');
    if (slashSysmlIndex !== -1) {
        afterSysml = normalized.substring(slashSysmlIndex + 7);
    } else if (normalized.startsWith('sysml/')) {
        afterSysml = normalized.substring(6);
    }

    if (afterSysml !== undefined) {
        const layerDir = afterSysml.split('/')[0];
        if (!layerDir || layerDir.endsWith('.sysml')) {
            // File is directly under sysml/ (e.g. index.sysml) — no layer
            return 'unknown';
        }
        return layerDir === 'relationships' ? 'crosscutting' : layerDir;
    }

    // Vendored ontology convention: content mirrors the memo:: namespace under
    // a src/ root (e.g. memo/src/architecture/risk/memo_risk.sysml).
    // For architecture/<layer>/ the layer is the subdirectory; other top-level
    // groups (viewpoints, compliance, core, ...) are themselves the layer.
    const archMatch = normalized.match(/\/src\/architecture\/([^/]+)\//);
    if (archMatch && !archMatch[1].endsWith('.sysml')) return archMatch[1];
    const groupMatch = normalized.match(/\/src\/(viewpoints|compliance|core|methodology|artifacts|rules)\//);
    if (groupMatch) return groupMatch[1];

    return 'unknown';
}

/**
 * For files under a compliance layer, extract the standard subdirectory.
 *
 * Convention: sysml/compliance/<standard>/<file>.sysml → standard name.
 *
 * @example
 * resolveStandardFromPath("sysml/compliance/iso-14971/rmf.sysml") → "iso-14971"
 * resolveStandardFromPath("sysml/safety/hazard.sysml")            → undefined
 */
export function resolveStandardFromPath(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/');

    let afterSysml: string;
    const slashSysmlIndex = normalized.indexOf('/sysml/');
    if (slashSysmlIndex !== -1) {
        afterSysml = normalized.substring(slashSysmlIndex + 7);
    } else if (normalized.startsWith('sysml/')) {
        afterSysml = normalized.substring(6);
    } else {
        // Vendored ontology convention: src/compliance/<standard>/<file>.sysml
        const m = normalized.match(/\/src\/compliance\/([^/]+)\/[^/]+\.sysml$/);
        return m ? m[1] : undefined;
    }

    const parts = afterSysml.split('/');
    if (parts[0] === 'compliance' && parts.length >= 3 && !parts[1].endsWith('.sysml')) {
        return parts[1];
    }
    return undefined;
}
