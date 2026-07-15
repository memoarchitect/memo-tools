// ─── Repo Layout Paths ─────────────────────────────────────────────────────────
//
// Single source of truth for the ontology submodule location.
// The MEMO ontology content (base/ontology/methodology, pure SysML v2) is pulled
// in as a first-party git submodule mounted at `memo/`. If the checkout location
// ever changes, update VENDOR_ONTOLOGY_DIR here and the `path` in `.gitmodules`
// (plus the non-TS references in pnpm-workspace.yaml, tools/, and scripts/).
// ───────────────────────────────────────────────────────────────────────────────

/** Relative path (from repo root) to the ontology submodule. */
export const VENDOR_ONTOLOGY_DIR = 'memo';

/** Relative path (from repo root) to the submodule's `packages/` directory. */
export const VENDOR_ONTOLOGY_PACKAGES_DIR = `${VENDOR_ONTOLOGY_DIR}/packages`;

/**
 * Relative path (from repo root) to the submodule's `src/` content root.
 * All SysML v2 ontology/methodology/example content lives under `src/`, organized
 * to mirror the `memo::` namespace hierarchy (e.g. `src/architecture/context/`).
 * Package manifests point `sysmlDir` here; the loader walks it for catalog layers.
 */
export const VENDOR_ONTOLOGY_SRC_DIR = `${VENDOR_ONTOLOGY_DIR}/src`;

/**
 * Relative path (from repo root) to the DHF document templates shipped with the
 * ontology. Templates are compliance-layer content and live in the ontology
 * repo, not the engine.
 */
export const VENDOR_DHF_TEMPLATES_DIR = `${VENDOR_ONTOLOGY_DIR}/src/compliance/dhf-templates`;
