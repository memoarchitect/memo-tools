// ─── memo inspect ────────────────────────────────────────────────────────────
// Authoritative ownership inspection for a model element or relationship.

import { resolve } from 'node:path';
import {
    buildMemoModel, findConfigFile, loadOntologyRegistries, parseFiles,
    type BuilderRegistries,
} from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { findSysmlFiles } from '../model/sysml-files.js';

export async function inspectCommand(
    id: string,
    options: { provenance?: boolean; dir?: string } = {},
): Promise<void> {
    const cwd = resolve(options.dir ?? process.cwd());
    const configPath = findConfigFile(cwd);
    if (!configPath) throw new Error('No memo config found. Run `memo init` first.');
    const config = loadAndResolveConfig(configPath);
    const loaded = await loadOntologyRegistries(configPath);
    const registries: BuilderRegistries = {
        ...loaded.registries,
        provenance: loaded.provenance,
    };
    const { documents, errors } = await parseFiles(findSysmlFiles(cwd), `${cwd}/`);
    const model = buildMemoModel(documents, config, errors, registries);
    const subject = model.elements.get(id) ?? model.relationships.find(r => r.id === id);
    if (!subject) throw new Error(`No model element or relationship named "${id}".`);

    if (options.provenance) {
        console.log(JSON.stringify({ id, provenance: subject.provenance }, null, 2));
        return;
    }
    console.log(JSON.stringify(subject, null, 2));
}
