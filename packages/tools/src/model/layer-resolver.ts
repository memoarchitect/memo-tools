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
    const assuranceMatch = normalized.match(/\/src\/assurance\/([^/]+)\//);
    if (assuranceMatch && !assuranceMatch[1].endsWith('.sysml')) {
        const assuranceLayers: Record<string, string> = {
            safety: 'risk',
            safety_analysis: 'risk',
            verification: 'verification',
            human_factors: 'human-factors',
            needs: 'needs',
        };
        return assuranceLayers[assuranceMatch[1]] ?? assuranceMatch[1];
    }
    const operationalMatch = normalized.match(/\/src\/(context|activities|clinical_procedures|interaction|scenarios|use_cases|workflows)\//);
    if (operationalMatch) {
        return operationalMatch[1] === 'context' ? 'context' : 'operational';
    }
    const groupMatch = normalized.match(/\/src\/(viewpoints|compliance|core|methodology|artifacts|rules)\//);
    if (groupMatch) return groupMatch[1];

    return 'unknown';
}

/**
 * Resolve the namespace path represented by an ontology source file.
 *
 * MEMO keeps namespace and folder paths aligned, so
 * `src/assurance/safety_risk/analysis/fmea.sysml` becomes
 * `["assurance", "safety_risk", "analysis"]`. Older ontology packages that
 * use `sysml/` receive the same treatment. The registry ships this path to
 * clients so they never need a second hardcoded kind taxonomy.
 */
export function resolveNamespaceFromPath(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, '/');
    const roots = ['/src/', '/sysml/'];
    let remainder: string | undefined;

    for (const root of roots) {
        const index = normalized.lastIndexOf(root);
        if (index !== -1) {
            remainder = normalized.substring(index + root.length);
            break;
        }
        const relativeRoot = root.substring(1);
        if (normalized.startsWith(relativeRoot)) {
            remainder = normalized.substring(relativeRoot.length);
            break;
        }
    }

    if (!remainder || !remainder.endsWith('.sysml')) return [];
    const segments = remainder.split('/').filter(Boolean);
    if (segments.length === 0) return [];
    if (segments[segments.length - 1].endsWith('.sysml')) segments.pop();
    return segments;
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
        // Vendored ontology convention: src/<layer>/<module>/<file>.sysml
        const m = normalized.match(/\/src\/compliance\/([^/]+)\/[^/]+\.sysml$/);
        return m ? m[1] : undefined;
    }

    const parts = afterSysml.split('/');
    if (parts[0] === 'compliance' && parts.length >= 3 && !parts[1].endsWith('.sysml')) {
        return parts[1];
    }
    return undefined;
}
