// ─── The sources a model imports from ────────────────────────────────────────
//
// Read from the model alone, so the Architect can list them without asking the
// server: each source's package carries `@ImportSource` (system, format, file,
// time of the last import), and its records carry `externalReference`. Pure and
// free of Node, because the browser entry exports it.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoPackageDTO } from '../model/semantic.js';

export interface ImportSourceInfo {
    system: string;
    format: string;
    /** The export last imported, as given. */
    file?: string;
    /** ISO-8601 time of the last import. */
    importedAt: string;
    /** The package the import owns, and the file it is written to. */
    packageName: string;
    sourceFile: string;
    /** Records the source holds now, and how many of them have left its export. */
    records: number;
    withdrawn: number;
}

export interface ImportSourceModel {
    packages?: readonly MemoPackageDTO[];
    elements: ReadonlyMap<string, MemoElement> | Readonly<Record<string, MemoElement>>;
}

export function listImportSources(model: ImportSourceModel): ImportSourceInfo[] {
    const elements = model.elements instanceof Map ? [...model.elements.values()] : Object.values(model.elements);
    const counts = new Map<string, { records: number; withdrawn: number }>();
    for (const element of elements) {
        const system = element.attributes['externalReference.sourceSystem'];
        if (system === undefined) continue;
        const count = counts.get(system) ?? { records: 0, withdrawn: 0 };
        count.records += 1;
        if (element.attributes['sourceWithdrawn'] === 'true') count.withdrawn += 1;
        counts.set(system, count);
    }
    const sources: ImportSourceInfo[] = [];
    for (const pkg of model.packages ?? []) {
        const system = pkg.attributes?.['sourceSystem'];
        const importedAt = pkg.attributes?.['importedAt'];
        if (system === undefined || importedAt === undefined) continue;
        const count = counts.get(system) ?? { records: 0, withdrawn: 0 };
        sources.push({
            system, importedAt, format: pkg.attributes?.['importFormat'] ?? '',
            ...(pkg.attributes?.['importFile'] ? { file: pkg.attributes['importFile'] } : {}),
            packageName: pkg.qualifiedName, sourceFile: pkg.file, ...count,
        });
    }
    return sources.sort((a, b) => a.system.localeCompare(b.system));
}
