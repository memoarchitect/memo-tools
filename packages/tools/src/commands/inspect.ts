// ─── memo inspect ────────────────────────────────────────────────────────────
//
// Authoritative ownership inspection for a model element, relationship, or
// definition.
//
// Section 19 requires that every definition, element, relationship, rule, view,
// and violation can be traced to a source file, package, version, and origin.
// Architect shows that in its Origin panel; this is the same contract on the
// command line, so the guarantee is not Architect-only (section 18.1
// deliverable 6).
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import {
    buildMemoModel, findConfigFile, findProjectRoot, loadOntologyRegistries, parseFiles,
    type BuilderRegistries,
} from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { findSysmlFiles } from '../model/sysml-files.js';

export async function inspectCommand(
    id: string,
    options: { provenance?: boolean; dir?: string } = {},
): Promise<void> {
    const cwd = resolve(options.dir ?? process.cwd());

    // The loader resolves a PROJECT ROOT, not a settings file. Passing the
    // config path resolved nothing — no documents, no provenance table — so
    // `--provenance` printed a bare id and the ownership guarantee silently did
    // not hold on the CLI. The root is what `memo validate` passes.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        throw new Error(
            'No MEMO project found. A project declares its identity in '
            + 'model/catalog/project.sysml; run `memo init` to scaffold one.',
        );
    }
    const configPath = findConfigFile(projectRoot);
    if (!configPath) throw new Error('No memo package descriptor found beside the project.');

    const config = loadAndResolveConfig(configPath);
    const loaded = await loadOntologyRegistries(projectRoot);
    const registries: BuilderRegistries = {
        ...loaded.registries,
        provenance: loaded.provenance,
    };
    const { documents, errors } = await parseFiles(findSysmlFiles(projectRoot), `${projectRoot}/`);
    const model = buildMemoModel(documents, config, errors, registries);

    const subject = model.elements.get(id) ?? model.relationships.find(r => r.id === id);
    if (subject) {
        console.log(JSON.stringify(
            options.provenance ? { id, provenance: subject.provenance } : subject, null, 2));
        return;
    }

    // A definition is not an element, but section 19 names definitions
    // explicitly. Reporting only elements meant `memo inspect ProjectAction`
    // claimed the project's own `action def` did not exist.
    const kind = loaded.registries.kindRegistry?.getKind(id);
    if (kind) {
        const provenance = kind.sourceFile ? loaded.provenance?.lookup(kind.sourceFile) : undefined;
        console.log(JSON.stringify(options.provenance
            ? { id, definition: true, qualifiedName: kind.qualifiedName, provenance }
            : { ...kind, provenance }, null, 2));
        return;
    }

    throw new Error(`No model element, relationship, or definition named "${id}".`);
}
