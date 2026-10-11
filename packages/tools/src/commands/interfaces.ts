// ─── memo-architect interfaces <a> <b> ──────────────────────────────────────
//
// Every interface between two elements, whatever their kind and layer. The
// work is in analysis/interfaces-between.ts; this resolves the two names the
// way `compile --inspect` does and prints the result.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { findProjectRoot, loadProjectSettings, modelToDTO } from '@memoarchitect/tools';
import { findSysmlFiles } from '../model/sysml-files.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { interfacesBetween } from '../analysis/interfaces-between.js';
import type { KindRegistry } from '../model/kind-registry.js';

export interface InterfacesOptions {
    kind?: string;
    nested?: boolean;
    format?: string;
    dir?: string;
}

/** `kind` conforms to `ancestor` when `ancestor` is on the kind's specialization chain. */
function conformsBy(registry: KindRegistry | undefined) {
    return (kind: string, ancestor: string): boolean => {
        const seen = new Set<string>();
        const visit = (name: string): boolean => {
            if (name === ancestor) return true;
            if (seen.has(name)) return false;
            seen.add(name);
            const entry = registry?.getKind(name);
            if (!entry) return false;
            return [entry.superType, ...(entry.additionalSuperTypes ?? [])]
                .filter((s): s is string => !!s)
                // `Interfaces::Interface` is written qualified; the kind is its last segment.
                .some(s => visit(s.split('::').pop() ?? s));
        };
        return visit(kind);
    };
}

export async function interfacesCommand(a: string, b: string, options: InterfacesOptions = {}): Promise<void> {
    const projectRoot = findProjectRoot(resolve(options.dir ?? process.cwd()));
    if (!projectRoot) {
        throw new Error('No MEMO project found. A project is located by the `entrypoint` in its `memo.package.yaml`.');
    }
    const config = withToolchainOverrides(loadProjectSettings(projectRoot), options as Record<string, unknown>, defaultRegistry);
    const { model, registries } = await loadProjectModel({ projectRoot, config, files: findSysmlFiles(projectRoot), cache: false });

    const ids = [a, b].map(name => {
        const ambiguous = model.elements.ambiguities.find(x => x.reference === name);
        if (ambiguous) throw new Error(`"${name}" names more than one element: ${ambiguous.candidates.join(', ')}. Name one of them.`);
        const element = model.elements.lookup(name);
        if (!element) throw new Error(`No model element named "${name}".`);
        return element.id;
    });

    const found = interfacesBetween(modelToDTO(model, {}), ids[0], ids[1], {
        kind: options.kind,
        kindConforms: conformsBy(registries?.kindRegistry),
        includeNested: options.nested !== false,
    });

    if (options.format === 'json') {
        console.log(JSON.stringify(found, null, 2));
        return;
    }
    if (found.length === 0) {
        console.log(`No interfaces between ${ids[0]} and ${ids[1]}${options.kind ? ` of kind ${options.kind}` : ''}.`);
        return;
    }
    for (const f of found) {
        // Always source -> target; `reversed` says it runs from the second argument to the first.
        console.log(`${f.name}  [${f.kind ?? 'untyped'}]  ${f.from.portId} -> ${f.to.portId}${f.reversed ? '   (from <b> to <a>)' : ''}`);
        for (const [key, value] of Object.entries(f.attributes)) console.log(`    ${key} = ${value}`);
    }
}
