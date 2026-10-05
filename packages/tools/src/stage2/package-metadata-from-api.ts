// ─── Ontology package metadata from a stage 1 handoff ───────────────────────
//
// What the ontology browser and the Model Explorer show of each library package:
// its layers, its kinds, its relationship types, and the explorer taxonomy and
// layer colours it declares. The definitions are read from the API JSON a stage 1
// compiler wrote (every library root a locator offers is compiled into it), so
// MEMO scans no source file and parses nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { basename, join, resolve, sep } from 'node:path';
import { readPackageManifest } from '../model/package-manifest.js';
import { discoverLibraryRoots } from '../model/native-project.js';
import type {
    ExplorerPlacement, LayerPalette, OntologyKindInfo, OntologyLayerInfo, OntologyPackageInfo,
    OntologyRelationshipInfo,
} from '../model/ontology-loader.js';
import { LAYER_COLORS } from '../model/ontology-loader.js';
import type { ApiElement, ApiModel } from './api-model.js';
import { apiDefinitionFacts } from './build-from-api.js';
import { apiRelationshipEntries } from './registries-from-api.js';
import { handoffFileOf } from './handoff-files.js';

/**
 * The definition metaclasses the catalogue lists, and the `<construct> def` each is
 * reported as. Rules (constraint definitions) are not catalogue kinds, and a
 * flow or allocation definition never was.
 */
const CATALOG_CONSTRUCTS: Record<string, string> = {
    PartDefinition: 'part def',
    RequirementDefinition: 'requirement def',
    VerificationCaseDefinition: 'verification def',
    StateDefinition: 'state def',
    UseCaseDefinition: 'use case def',
    ActionDefinition: 'action def',
    AttributeDefinition: 'attribute def',
    ItemDefinition: 'item def',
    PortDefinition: 'port def',
    InterfaceDefinition: 'interface def',
    EnumerationDefinition: 'enum def',
    ConnectionDefinition: 'connection def',
    MetadataDefinition: 'metadata def',
};

const within = (file: string, dir: string) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep);

interface Declared {
    name: string;
    construct: string;
    derivesFrom?: string;
    description?: string;
    isAbstract?: boolean;
    file: string;
}

/**
 * Describe every package a project could resolve, marking the ones it does.
 *
 * "Available" comes from locators; "selected" comes from the import closure
 * (`selectedRootDirs`) and nothing else.
 */
export function apiPackageMetadata(
    api: ApiModel,
    projectRoot: string,
    selectedRootDirs?: ReadonlySet<string>,
    filePackages?: ReadonlyMap<string, string>,
): OntologyPackageInfo[] {
    const fileOf = handoffFileOf(api, filePackages);
    const roots = discoverLibraryRoots(resolve(projectRoot));

    const definitions = declaredDefinitions(api, fileOf, 'library');
    const usages = [...api.ofType('PartUsage')].filter(u => api.source(u['@id'])?.role === 'library');

    const result: OntologyPackageInfo[] = [];
    for (const root of roots) {
        const { path, manifest } = readPackageManifest(root.dir);
        if (!path) continue;
        const sysmlDir = manifest.sysmlDir ? resolve(root.dir, manifest.sysmlDir) : join(root.dir, 'sysml');
        const mine = definitions.filter(d => within(d.file, sysmlDir));
        const rootUsages = usages.filter(u => within(fileOf(u), sysmlDir));
        const rendering = readRendering(api, rootUsages);
        const layers = applyExplorerClassification(buildLayers(mine, sysmlDir), rendering);
        const relationshipTypes = relationshipsOf(api, fileOf, sysmlDir);
        result.push({
            name: manifest.name ?? basename(root.dir),
            version: manifest.version ?? '0.0.0',
            type: rootUsages.some(u => typeNameOf(api, u) === 'MethodologyDefinition') ? 'methodology' : 'ontology',
            description: manifest.description ?? '',
            layers,
            kindCount: layers.reduce((sum, layer) => sum + layer.kindCount, 0),
            relationshipCount: relationshipTypes.length,
            relationshipTypes,
            selected: selectedRootDirs?.has(root.dir) ?? false,
            rootDir: root.dir,
            explorerPlacements: [...rendering.placements.values()],
            layerPalette: [...rendering.palette.values()],
        });
    }
    result.sort((a, b) => {
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return result;
}

/** The definitions a handoff declares, of the catalogue's metaclasses, in the documents of one role. */
function declaredDefinitions(
    api: ApiModel, fileOf: (element: ApiElement) => string, role: 'library' | 'project',
): Declared[] {
    const definitions: Declared[] = [];
    for (const [metaclass, construct] of Object.entries(CATALOG_CONSTRUCTS)) {
        for (const element of api.ofType(metaclass)) {
            if (api.source(element['@id'])?.role !== role) continue;
            const name = api.declaredName(element['@id']);
            if (!name) continue;
            const superType = api.superclassifiers(element['@id'])[0];
            definitions.push({
                name,
                construct,
                derivesFrom: superType ? api.name(superType['@id']) : undefined,
                description: apiDefinitionFacts(api, element).doc?.replace(/\s+/g, ' ').trim() || undefined,
                isAbstract: element.isAbstract === true && element.isVariation !== true ? true : undefined,
                file: fileOf(element),
            });
        }
    }
    return definitions;
}

/**
 * The layers of the definitions under one source directory: the first directory
 * under it is the layer id, whether the layout is flat or nested.
 */
export function apiLayers(
    api: ApiModel, sysmlDir: string, role: 'library' | 'project' = 'library',
    filePackages?: ReadonlyMap<string, string>,
): OntologyLayerInfo[] {
    const fileOf = handoffFileOf(api, filePackages);
    return buildLayers(declaredDefinitions(api, fileOf, role).filter(d => within(d.file, sysmlDir)), sysmlDir);
}

const typeNameOf = (api: ApiModel, usage: ApiElement): string | undefined => {
    const type = api.types(usage['@id'])[0];
    return type ? api.name(type['@id']) : undefined;
};

/**
 * The layers of one package: the first directory under its source directory is
 * the layer id, and the next one the namespace sub-group (`architecture/<risk>/`,
 * `compliance/<iso14971>/`).
 */
function buildLayers(definitions: readonly Declared[], sysmlDir: string): OntologyLayerInfo[] {
    const byLayer = new Map<string, OntologyKindInfo[]>();
    const derivedBy = new Map<string, string[]>();
    for (const definition of definitions) {
        const segments = definition.file.slice(sysmlDir.length).split(sep).filter(Boolean);
        // A file directly under the source directory belongs to no layer directory.
        if (segments.length < 2) continue;
        const layerId = segments[0];
        const group = segments.length > 2 ? segments[1] : undefined;
        // A compliance sub-group that names a regulatory standard also surfaces as `standard`.
        const standard = layerId === 'compliance' && group && /^(iso|iec|fda|en|astm|ul|nist|cfr|mdr)/i.test(group)
            ? group : undefined;
        const kinds = byLayer.get(layerId) ?? [];
        kinds.push({
            name: definition.name,
            label: definition.name.replace(/([A-Z])/g, ' $1').trim(),
            construct: definition.construct,
            layer: layerId,
            instanceCount: 0,
            viewpoints: [],
            description: definition.description,
            derivesFrom: definition.derivesFrom,
            group,
            standard,
            isAbstract: definition.isAbstract,
        });
        byLayer.set(layerId, kinds);
        if (definition.derivesFrom) {
            derivedBy.set(definition.derivesFrom, [...(derivedBy.get(definition.derivesFrom) ?? []), definition.name]);
        }
    }
    const layers: OntologyLayerInfo[] = [];
    for (const [id, kinds] of [...byLayer].sort((a, b) => a[0].localeCompare(b[0]))) {
        for (const kind of kinds) kind.derivedBy = derivedBy.get(kind.name);
        layers.push({
            id,
            label: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
            color: LAYER_COLORS[id] ?? '#6B7280',
            kindCount: kinds.length,
            kinds,
        });
    }
    return layers;
}

/** The `connection def`s of one package, with their first two typed ends. */
function relationshipsOf(
    api: ApiModel, fileOf: (element: ApiElement) => string, sysmlDir: string,
): OntologyRelationshipInfo[] {
    return apiRelationshipEntries(api, fileOf, namespace => within(fileOf(namespace), sysmlDir))
        .filter(entry => entry.sysmlConstruct === 'connection def')
        .map(entry => {
            const typed = (entry.ends ?? []).map(end => end.type).filter((t): t is string => Boolean(t));
            return { name: entry.sysmlName ?? entry.name, sourceKind: typed[0], targetKind: typed[1] };
        });
}

/** The `ExplorerClassification` and `LayerRendering` usages a package declares. */
function readRendering(api: ApiModel, usages: readonly ApiElement[]): {
    placements: Map<string, ExplorerPlacement>; palette: Map<string, LayerPalette>;
} {
    const placements = new Map<string, ExplorerPlacement>();
    const palette = new Map<string, LayerPalette>();
    for (const usage of usages) {
        const type = typeNameOf(api, usage);
        if (type !== 'ExplorerClassification' && type !== 'LayerRendering') continue;
        const a = apiDefinitionFacts(api, usage).attributes;
        if (type === 'ExplorerClassification') {
            if (a.sourceNamespace && a.explorerDomain && a.explorerGroup) {
                placements.set(a.sourceNamespace, {
                    sourceNamespace: a.sourceNamespace, explorerDomain: a.explorerDomain, explorerGroup: a.explorerGroup,
                });
            }
        } else if (a.layerId && a.layerLabel && a.layerColor) {
            palette.set(a.layerId, { layerId: a.layerId, layerLabel: a.layerLabel, layerColor: a.layerColor });
        }
    }
    return { placements, palette };
}

/** Apply the ontology-declared Explorer taxonomy to discovered kinds. */
function applyExplorerClassification(
    layers: OntologyLayerInfo[],
    { placements, palette }: { placements: Map<string, ExplorerPlacement>; palette: Map<string, LayerPalette> },
): OntologyLayerInfo[] {
    for (const layer of layers) {
        const authored = palette.get(layer.id);
        if (authored) {
            layer.label = authored.layerLabel;
            layer.color = authored.layerColor;
        }
    }
    if (placements.size === 0) return layers;

    const domains = new Map<string, OntologyLayerInfo>();
    for (const layer of layers) for (const kind of layer.kinds) {
        const source = kind.group ?? kind.layer;
        const placement = placements.get(source);
        if (!placement) continue;
        let domain = domains.get(placement.explorerDomain);
        if (!domain) {
            domain = {
                id: placement.explorerDomain,
                label: placement.explorerDomain.charAt(0).toUpperCase() + placement.explorerDomain.slice(1),
                color: '#6B7280',
                kindCount: 0,
                kinds: [],
            };
            domains.set(placement.explorerDomain, domain);
        }
        domain.kinds.push({ ...kind, layer: placement.explorerDomain, group: placement.explorerGroup });
    }
    if (domains.size === 0) return layers;
    for (const domain of domains.values()) domain.kindCount = domain.kinds.length;
    return [...domains.values()];
}
