// ─── Anatomy generation ──────────────────────────────────────────────────────
//
// A project's human anatomy is generated, not hand-written and not imported
// whole: it declares `AnatomySelector`s (the anatomy extension's type) naming FMA
// classes and a part depth, and this writes ONE package from the union of them.
//
// What it reads is the anatomy extension's FMA index (memo's
// scripts/build_fma_index.py builds it from FMA's OWL release). The index already
// carries every OWL decision — each class's SysML name, parent, home file and own
// relations; each relation's feature and whether it is composition — so nothing
// here knows OWL, FMA's relations, or any class by name.
//
// A selection is:
//   deep     the seeds, and their parts to `partDepth` levels — declared with
//            every relation FMA states for them;
//   shallow  every class a deep class names, and every ancestor of any declared
//            class — declared without relations of their own, so the selection
//            stays small; what FMA says about a deep class is never lost.
//
// Output is one small package per home file under a facade: the facade publicly
// imports them and each privately imports the facade, so a stomach in one file
// names an artery in another and a model imports one name. A class's home is
// fixed in the index from the whole of FMA, so it is in the same file in every
// project.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { SYSML_RESERVED_KEYWORDS } from '../stage2/sysml-names.js';
import type { ApiModel } from '../stage2/api-model.js';

/** One relation FMA states: the abstract feature it subsets, and how a feature for it is named. */
export interface FmaRelation {
    feature: string;
    composite: boolean;
    prefix: string;
    suffix: string;
}

/** [name, parent id, home file, definition, own relations as [relation, target id]] */
export type FmaClass = [string, string | null, string, string | null, [string, string][]];

export interface FmaIndex {
    source: { title: string; version: string; publisher: string; iri: string; licence: string; modification: string };
    root: string;
    relations: Record<string, FmaRelation>;
    classes: Record<string, FmaClass>;
}

/** One `AnatomySelector` a project declares. */
export interface AnatomySelection {
    /** Qualified name of the declaring usage. */
    name: string;
    seeds: string[];
    partDepth: number;
}

export interface SelectedAnatomy {
    deep: Set<string>;
    emitted: Set<string>;
    /** Seeds the index does not know, by selector. */
    unknown: { selector: string; id: string }[];
}

/** The type a project declares its selections with. Its package's root holds the index. */
export const ANATOMY_SELECTOR = 'AnatomySelector';
/** Where the index sits in the package that declares {@link ANATOMY_SELECTOR}. */
export const FMA_INDEX_PATH = 'data/fma-index.json.gz';

export function readFmaIndex(path: string): FmaIndex {
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as FmaIndex;
}

/**
 * The selections a project declares: every part usage in a project file that is
 * an {@link ANATOMY_SELECTOR}, by typing or by subsetting one that is (a preset).
 * A value the usage does not bind is read from what it subsets.
 */
export function readAnatomySelectors(api: ApiModel, isProjectFile: (file: string) => boolean): AnatomySelection[] {
    const isSelector = (id: string, seen = new Set<string>()): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        if (api.types(id).some(t => api.name(t['@id']) === ANATOMY_SELECTOR)) return true;
        return api.subsetted(id).some(s => isSelector(s['@id'], seen));
    };
    const bound = (id: string, feature: string): ReturnType<ApiModel['value']> => {
        for (const member of api.ownedMembers(id)) {
            if (api.name(member['@id']) !== feature) continue;
            const value = api.value(member['@id']);
            if (value) return value;
        }
        for (const general of api.subsetted(id)) {
            const value = bound(general['@id'], feature);
            if (value) return value;
        }
        return undefined;
    };
    const selections: AnatomySelection[] = [];
    for (const usage of api.ofType('PartUsage')) {
        const id = usage['@id'];
        const file = api.absoluteFile(id);
        if (!file || !isProjectFile(file) || !isSelector(id)) continue;
        const seeds = bound(id, 'fmaSeeds');
        const depth = bound(id, 'partDepth');
        const items = seeds?.kind === 'sequence' ? seeds.items : seeds ? [seeds] : [];
        selections.push({
            name: api.qualifiedName(id) ?? api.name(id) ?? id,
            seeds: items.flatMap(item => item.kind === 'string' ? [item.value] : []),
            partDepth: depth?.kind === 'number' ? depth.value : 2,
        });
    }
    return selections.sort((a, b) => a.name.localeCompare(b.name));
}

/** The union of the selections: which classes are declared, and which with their relations. */
export function selectAnatomy(index: FmaIndex, selections: readonly AnatomySelection[]): SelectedAnatomy {
    const { classes, relations } = index;
    const deep = new Set<string>();
    const unknown: { selector: string; id: string }[] = [];
    for (const selection of selections) {
        // Breadth first, so a class reached at two depths is expanded from the shallower one.
        let frontier = selection.seeds.filter(id => {
            if (classes[id]) return true;
            unknown.push({ selector: selection.name, id });
            return false;
        });
        for (let depth = 0; frontier.length; depth++) {
            const next: string[] = [];
            for (const id of frontier) {
                deep.add(id);
                if (depth >= selection.partDepth) continue;
                for (const [relation, target] of classes[id][4]) {
                    if (relations[relation]?.composite && !deep.has(target)) next.push(target);
                }
            }
            frontier = [...new Set(next)];
        }
    }
    const emitted = new Set<string>();
    const declare = (id: string): void => {
        for (let at: string | null = id; at && !emitted.has(at); at = classes[at]?.[1] ?? null) emitted.add(at);
    };
    for (const id of deep) {
        declare(id);
        for (const [, target] of classes[id][4]) declare(target);
    }
    declare(index.root);
    return { deep, emitted, unknown };
}

interface Feature { name: string; kind: 'part' | 'ref'; redefines: boolean; target: string; relation: string }

/** A deep class's own features, named and resolved against what its declared ancestors already give it. */
function resolveFeatures(index: FmaIndex, selected: SelectedAnatomy): Map<string, Feature[]> {
    const { classes, relations } = index;
    const owned = new Map<string, Feature[]>();
    const visible = new Map<string, Map<string, Feature>>();
    const camel = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
    const resolve = (id: string): Map<string, Feature> => {
        const cached = visible.get(id);
        if (cached) return cached;
        const parent = classes[id][1];
        const inherited = new Map(parent && id !== index.root ? resolve(parent) : []);
        const mine: Feature[] = [];
        if (selected.deep.has(id)) {
            const own = classes[id][4].filter(([relation]) => relations[relation]);
            const baseName = ([relation, target]: [string, string]): string => {
                const r = relations[relation];
                const name = r.composite ? camel(classes[target][0]) : r.prefix + classes[target][0];
                return SYSML_RESERVED_KEYWORDS.has(name) ? `${name}_` : name;
            };
            const counts = new Map<string, number>();
            for (const rel of own) counts.set(baseName(rel), (counts.get(baseName(rel)) ?? 0) + 1);
            const taken = new Set<string>();
            for (const rel of own) {
                const [relation, target] = rel;
                const kind = relations[relation].composite ? 'part' : 'ref';
                let name = baseName(rel);
                if ((counts.get(name) ?? 0) > 1) name = `${name}As${relations[relation].suffix}`;
                const prior = inherited.get(name);
                if (prior && prior.relation === relation && prior.target === target && prior.kind === kind) continue;
                let redefines = false;
                if (prior) {
                    if (prior.kind === kind) redefines = true;
                    else name = `${name}As${relations[relation].suffix}`;
                }
                if (taken.has(name)) continue;
                taken.add(name);
                mine.push({ name, kind, redefines, target, relation });
            }
        }
        owned.set(id, mine);
        for (const feature of mine) inherited.set(feature.name, feature);
        visible.set(id, inherited);
        return inherited;
    };
    for (const id of selected.emitted) resolve(id);
    return owned;
}

const docText = (text: string): string => text.replaceAll('*/', '* /').replace(/\s+/g, ' ').trim();

/**
 * The project's anatomy as SysML files, keyed by file name: the facade
 * `<packageName>.sysml` and one `<packageName>_<home>.sysml` per home file.
 */
export function renderAnatomy(
    index: FmaIndex,
    selected: SelectedAnatomy,
    packageName: string,
    selections: readonly AnatomySelection[],
): Map<string, string> {
    const { classes, relations, source } = index;
    const features = resolveFeatures(index, selected);
    const header = [
        `// GENERATED by \`memo anatomy generate\` from the ${source.title} ${source.version},`,
        `// ${source.publisher}, ${source.iri}, ${source.licence}.`,
        `// ${source.modification} Do not edit: change the project's AnatomySelectors and regenerate.`,
    ];
    const byHome = new Map<string, string[]>();
    for (const id of selected.emitted) {
        const home = classes[id][2];
        byHome.set(home, [...(byHome.get(home) ?? []), id]);
    }
    const homes = [...byHome.keys()].sort();
    const files = new Map<string, string>();
    for (const home of homes) {
        const lines = [...header, `package ${packageName}_${home} {`, `    private import ${packageName}::*;`];
        if (byHome.get(home)!.includes(index.root)) lines.push('    private import memo_extension_anatomy_vocabulary::*;');
        const ids = byHome.get(home)!.sort((a, b) => classes[a][0].localeCompare(classes[b][0]));
        for (const id of ids) {
            const [name, parent, , definition] = classes[id];
            const general = id === index.root ? 'AnatomyEntity' : classes[parent!][0];
            const body: string[] = [];
            if (definition) body.push(`        doc /* ${docText(definition)} */`);
            for (const f of features.get(id) ?? []) {
                const keyword = f.kind === 'part' ? 'part' : 'ref part';
                const head = f.redefines ? `${keyword} :>> ${f.name}` : `${keyword} ${f.name}`;
                body.push(`        ${head} : ${classes[f.target][0]}[1..*] :> ${relations[f.relation].feature};`);
            }
            const declaration = `    part def <${id}> ${name} :> ${general}`;
            if (body.length) lines.push('', `${declaration} {`, ...body, '    }');
            else lines.push(`${declaration};`);
        }
        lines.push('}', '');
        files.set(`${packageName}_${home}.sysml`, lines.join('\n'));
    }
    const facade = [
        ...header,
        '//',
        '// Selected by:',
        ...selections.map(s => `//   ${s.name}: ${s.seeds.join(', ')} (part depth ${s.partDepth})`),
        `package ${packageName} {`,
        ...homes.map(home => `    public import ${packageName}_${home}::*;`),
        '}',
        '',
    ];
    files.set(`${packageName}.sysml`, facade.join('\n'));
    return files;
}

/** The facade a project imports before its anatomy has been generated, so the project compiles. */
export function emptyAnatomyFacade(packageName: string): string {
    return [
        '// GENERATED by `memo anatomy generate`: empty until the project\'s AnatomySelectors are generated.',
        `package ${packageName} {`,
        '}',
        '',
    ].join('\n');
}
