// ─── Repo Layout Paths ─────────────────────────────────────────────────────────
//
// Legacy nested-checkout paths.
// Runtime resolution uses the installed @memoarchitect/ontology dependency.
// These constants remain temporarily for compatibility with older source
// checkouts and will not be used in the sibling-submodule meta workspace.
// ───────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

const contentRootScope = new AsyncLocalStorage<string>();

/**
 * Run `run` with `root` as the ontology package that content (DHF templates, standards packs) is read
 * from, in place of the one this installation selects. A pinned build uses it so a release's documents
 * come from the ontology its commit locked. Callers cache by `contentRootKey()`, not globally.
 */
export function withContentPackageRoot<T>(root: string | undefined, run: () => T): T {
    return root ? contentRootScope.run(root, run) : run();
}

/** The scoped ontology root, or '' when this installation's own is in force: the key content caches use. */
export function contentRootKey(): string {
    return contentRootScope.getStore() ?? '';
}

/** Resolve the ontology package selected by this tools installation, or by an enclosing `withContentPackageRoot`. */
export function resolveContentPackageRoot(): string {
    const scoped = contentRootScope.getStore();
    if (scoped) return scoped;
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
 * Relative path (from a legacy tools checkout) to the DHF templates shipped with
 * the ontology. They are artifact templates — document payloads governed by the
 * artifacts taxonomy — and live in the ontology repo, not the engine.
 *
 * They used to sit under `src/compliance/`, a namespace the V-model taxonomy
 * removed. That directory was also absent from the package's `files` list, so
 * the templates shipped to nobody: DHF template resolution worked in a linked
 * workspace and failed for every installed user. `src/artifacts/` is published,
 * which fixes both the name and the packaging.
 */
export const VENDOR_DHF_TEMPLATES_DIR = `${VENDOR_ONTOLOGY_DIR}/src/artifacts/templates/dhf`;
