import { layoutBlindRevision } from '../model/view-layout-block.js';
import type { SourceOutline } from '../authoring/source-outline.js';
import { elementPath } from '../serializer/element-reference.js';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import type { MemoModelDTO } from '../model/semantic.js';
import { indexKinds, kindConformsTo } from '../model/relationship-legality.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { insertIntoContainer } from './package-source.js';
import { functionalStructure } from '../model/functional-structure.js';
import { commitSource } from './persistor.js';

export interface FunctionContext { workspace: string; componentId?: string; componentSourceHash?: string }
/** Create/associate the distinguished system function, optionally adding an allocated child, in one checked edit. */
export async function createFunction(
    projectRoot: string, model: MemoModelDTO, context: FunctionContext, name: string,
    outlines: OutlineSource, expectedFile: string,
): Promise<{ success: boolean; elementId?: string; filePath: string; sourceFiles?: string[]; error?: string }> {
    try { return await createFunctionSource(projectRoot, model, context, name, outlines, expectedFile); }
    catch (error) { return { success: false, filePath: expectedFile, error: error instanceof Error ? error.message : String(error) }; }
}

async function createFunctionSource(
    projectRoot: string, model: MemoModelDTO, context: FunctionContext, name: string,
    outlines: OutlineSource, expectedFile: string,
): Promise<{ success: boolean; elementId?: string; filePath: string; sourceFiles?: string[]; error?: string }> {
    const fail = (error: string) => ({ success: false, filePath: expectedFile, error });
    const system = model.elements[context.workspace];
    const registry = indexKinds(model.registries?.kinds ?? []);
    const conforms = (id: string, kind: string) => !!model.elements[id] && kindConformsTo(model.elements[id].kind, kind, registry);
    if (!system || !model.workspaceMembership?.workspaces.some(workspace => workspace.root === system.id)) return fail('Choose a current system or system of systems.');
    const roots = model.relationships.filter(edge => edge.type === 'functionalRoot' && edge.sourceId === system.id);
    if (roots.length > 1) return fail('This system has more than one functional root; resolve the duplicate associations first.');
    let root = roots[0] ? model.elements[roots[0].targetId] : undefined;
    if (root && (root.isDefinition === true || !conforms(root.id, 'SystemFunction'))) return fail('The functional root must be a system function.');
    const component = context.componentId ? model.elements[context.componentId] : undefined;
    if (context.componentId && (!component || component.isDefinition || !conforms(component.id, 'LogicalComponent') || !model.workspaceMembership.membership[component.id]?.includes(system.id))) return fail('Choose a component inside the selected system.');
    if (component && !name.trim()) return fail('Name the component function.');
    if (!component && root) return { success: true, elementId: root.id, filePath: root.file, sourceFiles: [] };
    const { candidates, adoptable } = functionalStructure(model, system.id);
    if (!root && adoptable) root = adoptable;
    const home = root ?? system;
    if (home.file !== expectedFile) return fail('The functional root changed; reload before creating the function.');
    if (home.provenance && !home.provenance.declaration.writable) return fail('The functional root source is read-only.');
    const absolute = resolve(projectRoot, home.file);
    const rel = relative(realpathSync(projectRoot), realpathSync(absolute));
    if (rel === '..' || rel.startsWith(`..${sep}`)) return fail('Function source is outside the project.');
    if (!home.package) return fail('The function needs a named source package.');
    const source = readFileSync(absolute, 'utf8');
    const outline = await outlines.outline(home.file, source);
    const unique = (parent: string, requested: string) => {
        const stem = requested.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([^a-zA-Z_])/, '_$1') || 'function';
        let candidate = stem;
        for (let suffix = 2; model.elements[`${parent}::${candidate}`]; suffix++) candidate = `${stem}${suffix}`;
        return candidate;
    };
    let newRootBody: string | undefined;
    let rootId = root?.id;
    let childId: string | undefined;
    const childName = unique(rootId ?? `${home.package}::rootFunction`, name.trim() || 'componentFunction');
    const child = component ? `action ${childName} : memo_architecture_functional_functions::ComponentFunction {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(name.trim())}; }\n}` : '';
    if (!root) {
        const rootName = unique(home.package, 'rootFunction'); rootId = `${home.package}::${rootName}`;
        // Perform references keep existing declarations and qualified identities intact.
        const performances = candidates.map((element, index) => `perform action responsibility${index + 1} : memo_architecture_functional_functions::SystemFunction :> ${elementPath(element.id, model)} { @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(element.name)}; } }`).join('\n');
        const body = `action ${rootName} : memo_architecture_functional_functions::SystemFunction {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(`${system.name} function`)}; }\n${[performances, child].filter(Boolean).map(text => text.split('\n').map(line => `    ${line}`).join('\n')).join('\n')}\n}`;
        newRootBody = body;
    }
    if (component) childId = `${rootId}::${childName}`;
    const additions = !roots.length ? `#memo_architecture_functional_functions::FunctionalRoot dependency from ${system.id} to ${rootId};` : '';
    const edits = new Map<string, { source: string; outline: SourceOutline; members: Map<string, string> }>();
    edits.set(home.file, { source, outline, members: new Map([[home.package, [newRootBody, additions].filter(Boolean).join('\n')]]) });
    if (root && component) edits.get(home.file)!.members.set(root.id, child);
    if (component) {
        let featuring;
        let owner = component.owner ?? component.parentAction;
        const seen = new Set<string>();
        while (owner && !seen.has(owner)) {
            seen.add(owner); const element = model.elements[owner]; if (!element) break;
            if (element.isDefinition) { featuring = element; break; }
            owner = element.owner ?? element.parentAction;
        }
        const targetFile = featuring?.file ?? home.file;
        const container = featuring?.id ?? home.package;
        if (featuring?.provenance && !featuring.provenance.declaration.writable) return fail('The component definition is read-only.');
        if (targetFile === home.file && context.componentSourceHash && layoutBlindRevision(source) !== context.componentSourceHash) return fail('The component source changed; reload before creating its function.');
        if (!edits.has(targetFile)) {
            const targetAbsolute = realpathSync(resolve(projectRoot, targetFile));
            const targetRelative = relative(realpathSync(projectRoot), targetAbsolute);
            if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) return fail('Component source is outside the project.');
            const targetSource = readFileSync(targetAbsolute, 'utf8');
            if (!context.componentSourceHash || layoutBlindRevision(targetSource) !== context.componentSourceHash) return fail('The component source changed; reload before creating its function.');
            edits.set(targetFile, { source: targetSource, outline: await outlines.outline(targetFile, targetSource), members: new Map() });
        }
        const targetPath = elementPath(component.id, model);
        const target = featuring ? targetPath.slice(`${featuring.id}::`.length) : targetPath;
        const allocation = `allocation allocate ${elementPath(rootId!, model)}.${childName} to ${target};`;
        const file = edits.get(targetFile)!;
        file.members.set(container, [file.members.get(container), allocation].filter(Boolean).join('\n'));
    }
    const proposed = new Map<string, string>();
    for (const [file, edit] of edits) {
        const updated = appendMembers(edit.source, edit.outline, edit.members);
        if (updated === undefined) return fail(`A source container could not be located in ${file}.`);
        proposed.set(file, updated);
    }
    const others = new Map([...proposed].filter(([file]) => file !== home.file).map(([file, text]) => [resolve(projectRoot, file), text]));
    const committed = await commitSource(absolute, home.file, proposed.get(home.file)!, outlines, others, projectRoot, new Map([...edits].map(([file, edit]) => [resolve(projectRoot, file), edit.source])));
    return committed.success ? { success: true, elementId: childId ?? rootId, filePath: home.file, sourceFiles: [...proposed.keys()] }
        : fail(committed.error ?? 'The compiler refused the function.');
}

/** Compute independent container insertions against one outline, then apply their ranges from the end. */
function appendMembers(source: string, outline: SourceOutline, members: ReadonlyMap<string, string>): string | undefined {
    const edits: { start: number; end: number; text: string }[] = [];
    for (const [container, text] of members) {
        if (!text) continue;
        const proposed = insertIntoContainer(source, outline, container, text); if (proposed === undefined) return undefined;
        let start = 0; while (start < source.length && source[start] === proposed[start]) start++;
        let end = source.length, nextEnd = proposed.length;
        while (end > start && nextEnd > start && source[end - 1] === proposed[nextEnd - 1]) { end--; nextEnd--; }
        edits.push({ start, end, text: proposed.slice(start, nextEnd) });
    }
    return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}
