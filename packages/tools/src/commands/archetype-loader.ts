import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { findMemoManifests, resolveManifestPath, type LoadedMemoManifest } from '@memoarchitect/tools';

export interface ArchetypeInfo {
    id: string;
    label: string;
    description: string;
    category: string;
    templateDir: string;
    includedLayers: string[];
    includedStandards: string[];
}

export async function loadArchetypes(fromDir: string, selected?: LoadedMemoManifest): Promise<ArchetypeInfo[]> {
    const loaded = selected ?? findMemoManifests(fromDir)[0];
    if (!loaded) return [];
    const path = resolveManifestPath(loaded, loaded.manifest.init.archetypes);
    const parsed = parseYaml(readFileSync(path, 'utf-8'));
    if (!Array.isArray(parsed?.archetypes)) throw new Error(`Invalid archetype catalog: ${path}`);
    return parsed.archetypes.map((entry: Partial<ArchetypeInfo>) => ({
        id: String(entry.id ?? ''),
        label: String(entry.label ?? entry.id ?? ''),
        description: String(entry.description ?? ''),
        category: String(entry.category ?? 'device-class'),
        templateDir: String(entry.templateDir ?? ''),
        includedLayers: Array.isArray(entry.includedLayers) ? entry.includedLayers.map(String) : [],
        includedStandards: Array.isArray(entry.includedStandards) ? entry.includedStandards.map(String) : [],
    })).filter((entry: ArchetypeInfo) => entry.id !== '');
}

export function findArchetype(archetypes: ArchetypeInfo[], id: string): ArchetypeInfo | undefined {
    return archetypes.find(archetype => archetype.id === id);
}

export function deviceClassArchetypes(archetypes: ArchetypeInfo[]): ArchetypeInfo[] {
    return archetypes.filter(archetype => archetype.category === 'device-class');
}

export function profileArchetypes(archetypes: ArchetypeInfo[]): ArchetypeInfo[] {
    return archetypes.filter(archetype => archetype.category === 'profile');
}
