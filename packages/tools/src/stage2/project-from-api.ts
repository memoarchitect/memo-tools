// ─── Project resolution from a stage 1 handoff ──────────────────────────────
//
// `resolveNativeProject` reads three things from MEMO's parse: each package's
// files and imports (the import closure walks them from the entrypoint), and
// the `ProjectMethodBinding` and `MethodologyDefinition` usages that select a
// methodology. These readers take the same facts from the API JSON a stage 1
// compiler wrote over every library root a locator offers, so the closure,
// the selected roots and the binding come from the compiled model; the rest
// of resolution (finding the sources, closing over them) is shared.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    LibraryRoot,
    NativeMethodBinding,
    NativeMethodology,
    NativeProjectResolution,
    NativeRulePolicy,
    PackageIndexEntry,
    ScopeMode,
} from '../model/native-project.js';
import { relative, resolve, sep } from 'node:path';
import type { SourceGraphPackage } from '../model/source-graph.js';
import { discoverProjectSources, finishResolution } from '../model/native-project.js';
import type { ApiElement, ApiModel, ApiValue } from './api-model.js';

/** Resolve a project from a handoff compiled over every library root it offers. */
export function resolveNativeProjectFromApi(projectRoot: string, api: ApiModel): NativeProjectResolution {
    const sources = discoverProjectSources(projectRoot);
    const fileOf = (element: ApiElement) => api.absoluteFile(element['@id']) ?? '';
    const { bindings, methodologies } = apiNativeUsages(api, fileOf);
    return finishResolution(sources, apiPackageIndex(api, sources.fileToRoot, fileOf), bindings, methodologies);
}

/** The top-level packages of every document, with the file each is declared in. */
function documentPackages(api: ApiModel): ApiElement[] {
    const packages: ApiElement[] = [];
    for (const namespace of api.ofType('Namespace')) {
        if (api.owner(namespace['@id'])) continue;
        for (const member of api.ownedMembers(namespace['@id'])) {
            if (isPackage(member)) packages.push(member);
        }
    }
    return packages;
}

const isPackage = (element: ApiElement) => element['@type'] === 'Package' || element['@type'] === 'LibraryPackage';

const refs = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : [])
    .map(v => (v as { '@id'?: unknown })?.['@id'])
    .filter((id): id is string => typeof id === 'string');

/**
 * The package index `indexPackages` builds from MEMO's parse: every package,
 * nested ones too, keyed by the name it declares, with the files declaring it
 * and the packages it imports from.
 */
export function apiPackageIndex(
    api: ApiModel,
    fileToRoot: Map<string, LibraryRoot | undefined>,
    fileOf: (element: ApiElement) => string,
): Map<string, PackageIndexEntry> {
    const index = new Map<string, PackageIndexEntry>();
    const walk = (pkg: ApiElement, file: string) => {
        const name = api.declaredName(pkg['@id']);
        if (!name) return;
        let entry = index.get(name);
        if (!entry) {
            entry = { qualifiedName: name, files: new Set(), imports: new Set(), root: fileToRoot.get(file) };
            index.set(name, entry);
        }
        entry.files.add(file);
        if (!entry.root) entry.root = fileToRoot.get(file);
        for (const relationship of api.ownedRelationships(pkg['@id'])) {
            const imported = importedPackage(api, relationship);
            if (imported) entry.imports.add(imported);
        }
        for (const member of api.ownedMembers(pkg['@id'])) {
            if (isPackage(member)) walk(member, file);
        }
    };
    for (const pkg of documentPackages(api)) walk(pkg, fileOf(pkg));
    return index;
}

/**
 * The package an import reads from: the namespace of `import P::*` (or
 * `P::**`), the owner of `import P::X`.
 */
function importedPackage(api: ApiModel, relationship: ApiElement): string | undefined {
    if (relationship['@type'] === 'NamespaceImport') {
        const namespace = refs(relationship.importedNamespace)[0];
        return namespace ? api.qualifiedName(namespace) : undefined;
    }
    if (relationship['@type'] === 'MembershipImport') {
        const membership = refs(relationship.importedMembership)[0];
        const member = membership ? refs(api.element(membership)?.memberElement)[0] : undefined;
        const qualified = member ? api.qualifiedName(member) : undefined;
        if (!qualified) return undefined;
        const segments = qualified.split('::');
        return segments.length > 1 ? segments.slice(0, -1).join('::') : qualified;
    }
    return undefined;
}

/** The binding and methodology usages, as `readNativeUsages` reads them from MEMO's parse. */
export function apiNativeUsages(api: ApiModel, fileOf: (element: ApiElement) => string): {
    bindings: NativeMethodBinding[]; methodologies: NativeMethodology[];
} {
    const bindings: NativeMethodBinding[] = [];
    const methodologies: NativeMethodology[] = [];
    const reader = new UsageReader(api);
    const visit = (node: ApiElement, pkg: string | undefined, file: string) => {
        if (isPackage(node)) {
            const name = api.declaredName(node['@id']) ?? pkg;
            for (const member of api.ownedMembers(node['@id'])) visit(member, name, file);
            return;
        }
        if (node['@type'] !== 'PartUsage') return;
        const type = reader.typeName(node);
        if (type === 'ProjectMethodBinding') {
            bindings.push({
                usageName: api.name(node['@id']) ?? '',
                bindingId: reader.attr(node, 'id'),
                projectName: reader.attr(node, 'projectName'),
                selectedMethodologyName: reader.refType(node, 'selectedMethodology'),
                scopeMode: asScopeMode(reader.attr(node, 'scopeMode')),
                includedModules: reader.attrList(node, 'includedModule'),
                rulePolicies: reader.policies(node, file),
                sourceFile: file,
                packageQualifiedName: pkg,
            });
        } else if (type === 'MethodologyDefinition') {
            methodologies.push({
                usageName: api.name(node['@id']) ?? '',
                methodologyId: reader.attr(node, 'id'),
                displayName: reader.attr(node, 'name'),
                version: reader.attr(node, 'version'),
                baseMethodologyName: reader.refType(node, 'baseMethodology'),
                scopeMode: asScopeMode(reader.attr(node, 'scopeMode')),
                includedLayers: reader.attrList(node, 'includedLayer'),
                includedModules: reader.attrList(node, 'includedModule'),
                includedStandards: reader.attrList(node, 'includedStandard'),
                includedArtifactKinds: reader.attrList(node, 'includedArtifactKind'),
                includedViewpoints: reader.attrList(node, 'includedViewpoint'),
                rulePolicies: reader.policies(node, file),
                sourceFile: file,
                packageQualifiedName: pkg,
            });
        }
        for (const member of api.ownedMembers(node['@id'])) visit(member, pkg, file);
    };
    for (const pkg of documentPackages(api)) visit(pkg, undefined, fileOf(pkg));
    return { bindings, methodologies };
}

function asScopeMode(raw: string | undefined): ScopeMode | undefined {
    return raw === 'allAvailable' || raw === 'explicit' ? raw : undefined;
}

const lastSegment = (name: string) => name.slice(name.lastIndexOf('::') + 2);

/** The attribute, list and reference readers `readNativeUsages` uses, over the handoff. */
class UsageReader {
    constructor(private readonly api: ApiModel) {}

    typeName(usage: ApiElement): string | undefined {
        const type = this.api.types(usage['@id'])[0];
        return type ? this.api.name(type['@id']) : undefined;
    }

    private members(owner: ApiElement, metaclass: string, name: string): ApiElement[] {
        return this.api.ownedMembers(owner['@id'])
            .filter(m => m['@type'] === metaclass && this.api.name(m['@id']) === name);
    }

    /** One value as a string: a literal as written, an enumeration literal by its member name. */
    private text(value: ApiValue | undefined): string | undefined {
        switch (value?.kind) {
            case 'string': return value.value;
            case 'number': return String(value.value);
            case 'boolean': return String(value.value);
            case 'reference': return lastSegment(value.qualifiedName);
            default: return undefined;
        }
    }

    attr(owner: ApiElement, name: string): string | undefined {
        for (const member of this.members(owner, 'AttributeUsage', name)) {
            const value = this.text(this.api.value(member['@id']));
            if (value !== undefined) return value;
        }
        return undefined;
    }

    /** A list-valued attribute: a sequence literal, or repeated single assignments. */
    attrList(owner: ApiElement, name: string): string[] {
        const out: string[] = [];
        for (const member of this.members(owner, 'AttributeUsage', name)) {
            const value = this.api.value(member['@id']);
            const items = value?.kind === 'sequence' ? value.items : value ? [value] : [];
            for (const item of items) {
                const text = item.kind === 'reference' ? item.qualifiedName : this.text(item);
                if (text !== undefined) out.push(text);
            }
        }
        return out;
    }

    /** The qualified name a `ref :>> <name> = <element>;` member is valued with. */
    refQualified(owner: ApiElement, name: string): string | undefined {
        for (const member of this.members(owner, 'ReferenceUsage', name)) {
            const value = this.api.value(member['@id']);
            if (value?.kind === 'reference') return value.qualifiedName;
            if (value?.kind === 'chain' && value.steps.length > 0) return value.steps[value.steps.length - 1];
        }
        return undefined;
    }

    /** The type a `ref :>> <name> : <Type>;` member narrows to, else its value. */
    refType(owner: ApiElement, name: string): string | undefined {
        for (const member of this.members(owner, 'ReferenceUsage', name)) {
            const type = this.typeName(member);
            if (type) return type;
            const value = this.text(this.api.value(member['@id']));
            if (value !== undefined) return value;
        }
        return undefined;
    }

    /** The `RulePolicy` parts a binding or methodology states. */
    policies(owner: ApiElement, file: string): NativeRulePolicy[] {
        return this.api.ownedMembers(owner['@id'])
            .filter(m => m['@type'] === 'PartUsage' && this.typeName(m) === 'RulePolicy')
            .map(policy => {
                const disposition = this.attr(policy, 'disposition');
                const severity = this.attr(policy, 'severityOverride');
                return {
                    usageName: this.api.name(policy['@id']) ?? '',
                    targetRuleType: this.refType(policy, 'targetRule'),
                    targetStandard: this.refQualified(policy, 'targetStandard'),
                    targetCategory: this.attr(policy, 'targetCategory'),
                    replacementRuleType: this.refType(policy, 'replacementRule'),
                    disposition: disposition === 'enabled' || disposition === 'disabled' || disposition === 'replaced'
                        ? disposition : undefined,
                    severityOverride: severity === 'error' || severity === 'warning' || severity === 'info'
                        ? severity : undefined,
                    rationaleText: this.attr(policy, 'rationaleText'),
                    authority: this.attr(policy, 'authority'),
                    approvalReference: this.attr(policy, 'approvalReference'),
                    approvedBy: this.attr(policy, 'approvedBy'),
                    approvedOn: this.attr(policy, 'approvedOn'),
                    sourceFile: file,
                };
            });
    }
}

/**
 * Whether resolution loads a file's content into the ontology: a file of a
 * package in the import closure, or one under a selected library root — the
 * filter `loadOntologyRegistries` applies to MEMO's parse.
 */
export function resolutionLoads(resolution: NativeProjectResolution): (file: string) => boolean {
    const closureFiles = new Set<string>();
    for (const pkg of resolution.closure.values()) for (const file of pkg.files) closureFiles.add(file);
    const selected = resolution.selectedRoots.map(root => root.sysmlDir);
    return file => closureFiles.has(file) || selected.some(dir => file.startsWith(dir + sep));
}

/** Whether a file is the project's own: under no library root, selected or unused. */
export function isProjectSource(resolution: NativeProjectResolution): (file: string) => boolean {
    const roots = [...resolution.selectedRoots, ...resolution.unusedRoots].map(root => root.sysmlDir);
    return file => !roots.some(dir => file.startsWith(dir));
}

/**
 * The project's packages for the view source graph: each with the files
 * declaring it and what it imports, the files named relative to the project,
 * as the graph built from MEMO's parse of the project names them. Library
 * packages are left out: a project rebuild never re-reads a library file.
 */
export function apiProjectSourcePackages(api: ApiModel, projectRoot: string): {
    packages: SourceGraphPackage[]; files: string[];
} {
    const projectDir = resolve(projectRoot);
    const fileOf = (element: ApiElement) => resolve(api.absoluteFile(element['@id']) ?? '');
    const inProject = (file: string) => file.startsWith(projectDir + sep);
    const packages: SourceGraphPackage[] = [];
    for (const entry of apiPackageIndex(api, new Map(), fileOf).values()) {
        const files = [...entry.files].filter(inProject).map(file => relative(projectDir, file));
        if (files.length > 0) packages.push({ qualifiedName: entry.qualifiedName, files, imports: entry.imports });
    }
    // Every project document, a file declaring no package included: its root namespace.
    const files = [...new Set([...api.ofType('Namespace')]
        .filter(namespace => !api.owner(namespace['@id']) && api.source(namespace['@id'])?.role === 'project')
        .map(namespace => fileOf(namespace))
        .filter(inProject)
        .map(file => relative(projectDir, file)))];
    return { packages, files };
}

/** The project's enumeration definitions with their literals, by name. */
export function apiEnumerations(api: ApiModel): { name: string; literals: string[] }[] {
    const found = new Map<string, { name: string; literals: string[] }>();
    for (const definition of api.ofType('EnumerationDefinition')) {
        if (api.source(definition['@id'])?.role !== 'project') continue;
        const name = api.declaredName(definition['@id']);
        if (!name) continue;
        const literals = api.ownedMembers(definition['@id'])
            .filter(member => member['@type'] === 'EnumerationUsage')
            .map(member => api.declaredName(member['@id']))
            .filter((literal): literal is string => Boolean(literal));
        found.set(name, { name, literals });
    }
    return [...found.values()];
}
