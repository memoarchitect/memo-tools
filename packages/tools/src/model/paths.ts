// ─── Repo Layout Paths ─────────────────────────────────────────────────────────
//
// Legacy nested-checkout paths.
// Runtime resolution uses the installed @memoarchitect/ontology dependency.
// These constants remain temporarily for compatibility with older source
// checkouts and will not be used in the sibling-submodule meta workspace.
// ───────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

/** Resolve the ontology package selected by this tools installation. */
export function resolveContentPackageRoot(): string {
    try {
        return dirname(require.resolve('@memoarchitect/ontology/package.json'));
    } catch (error) {
        throw new Error(
            'Could not resolve @memoarchitect/ontology. Install the dependency before using MEMO content.',
            { cause: error },
        );
    }
}

/** Relative path (from a legacy tools checkout) to the ontology repository. */
export const VENDOR_ONTOLOGY_DIR = 'memo';

/**
 * Relative path (from a legacy tools checkout) to the ontology `src/` root.
 * All SysML v2 ontology/methodology/example content lives under `src/`, organized
 * to mirror the `memo::` namespace hierarchy (e.g. `src/architecture/context/`).
 * Package manifests point `sysmlDir` here; the loader walks it for catalog layers.
 */
export const VENDOR_ONTOLOGY_SRC_DIR = `${VENDOR_ONTOLOGY_DIR}/src`;

/**
 * Relative path (from a legacy tools checkout) to the DHF templates shipped with the
 * ontology. Templates are compliance-layer content and live in the ontology
 * repo, not the engine.
 */
export const VENDOR_DHF_TEMPLATES_DIR = `${VENDOR_ONTOLOGY_DIR}/src/compliance/dhf-templates`;
