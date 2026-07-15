import type { OntologyKindInfo } from './ontology-loader.js';

/** Typed scope extracted from a MethodologyScope part instance. */
export interface MethodologyScopeInfo {
    id: string;
    scopeName: string;
    includedArchLayers: string[];
    includedStandards: string[];
    includedArtifactKinds: string[];
    includedViewpointTypes: string[];
    excludedKinds: string[];
}

/** A minimal part-instance shape, matching MethodologyPart without importing it. */
interface ScopePartLike {
    attributes: Record<string, unknown>;
    multiAttributes: Record<string, unknown[]>;
}

/** Extract typed scope info from a MethodologyScope part instance. */
export function extractScopeInfo(part: ScopePartLike): MethodologyScopeInfo {
    const strList = (key: string): string[] =>
        ((part.multiAttributes[key] as string[] | undefined) ?? [])
            .filter((v): v is string => typeof v === 'string' && v !== '');
    return {
        id: String(part.attributes.id ?? ''),
        scopeName: String(part.attributes.scopeName ?? ''),
        includedArchLayers: strList('includedArchLayer'),
        includedStandards: strList('includedStandard'),
        includedArtifactKinds: strList('includedArtifactKind'),
        includedViewpointTypes: strList('includedViewpointType'),
        excludedKinds: strList('excludedKind'),
    };
}

export type DimensionKey = 'archLayer' | 'standard' | 'artifactKind' | 'viewpointType';

const SCOPE_FIELD: Record<DimensionKey, keyof MethodologyScopeInfo> = {
    archLayer: 'includedArchLayers',
    standard: 'includedStandards',
    artifactKind: 'includedArtifactKinds',
    viewpointType: 'includedViewpointTypes',
};

function kindMatchesDimension(kind: OntologyKindInfo, dimension: DimensionKey): string | undefined {
    switch (dimension) {
        case 'archLayer': return kind.layer;
        case 'standard': return kind.standard;
        case 'artifactKind': return kind.name;
        case 'viewpointType': return kind.viewpoints?.[0];
    }
}

/**
 * Filter ontology kinds by a methodology scope dimension.
 *
 * Returns the subset of `kinds` whose dimension value appears in the scope's
 * included set. If the scope is null or the included set for the dimension is
 * empty, all kinds pass through (methodology does not restrict).
 */
export function filterKindsByDimension(
    kinds: OntologyKindInfo[],
    dimension: DimensionKey,
    scope: MethodologyScopeInfo | null,
): OntologyKindInfo[] {
    if (!scope) return kinds;

    const field = SCOPE_FIELD[dimension];
    const included = scope[field] as string[];

    if (included.length === 0) return kinds;

    const includedSet = new Set(included);

    return kinds.filter(kind => {
        const value = kindMatchesDimension(kind, dimension);
        return value !== undefined && includedSet.has(value);
    });
}

/**
 * Check whether a single kind is excluded by methodology scope.
 */
export function isKindExcluded(
    kind: OntologyKindInfo,
    scope: MethodologyScopeInfo | null,
): boolean {
    if (!scope || scope.excludedKinds.length === 0) return false;
    return scope.excludedKinds.includes(kind.name);
}
