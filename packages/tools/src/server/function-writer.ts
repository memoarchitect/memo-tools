import { functionalScope } from '../model/functional-scope.js';
import { canonicalFunctionId, type FunctionalWriteContext } from '../model/functional-work.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';
import type { SourceOutline } from '../authoring/source-outline.js';
import { elementPath } from '../serializer/element-reference.js';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import type { MemoModelDTO } from '../model/semantic.js';
import { indexKinds, kindConformsTo } from '../model/relationship-legality.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { appendMembers } from './source-members.js';
import { functionalStructure } from '../model/functional-structure.js';
import { commitSource } from './persistor.js';

export type FunctionContext = FunctionalWriteContext;
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
    const operation = context.operation ?? (context.componentId ? 'component-function' : 'root');
    const systemFunction = context.systemFunctionId ? model.elements[canonicalFunctionId(model, context.systemFunctionId)] : undefined;
    if (context.systemFunctionId && (!systemFunction || systemFunction.isDefinition || !conforms(systemFunction.id, 'SystemFunction') || !functionalScope(model, system.id).members.has(systemFunction.id))) return fail('Choose a system function in this system.');
    const existingImplementation = context.componentFunctionId ? model.elements[context.componentFunctionId] : undefined;
    if (context.componentFunctionId && (!existingImplementation || existingImplementation.isDefinition || !conforms(existingImplementation.id, 'ComponentFunction') || !functionalScope(model, system.id).members.has(existingImplementation.id))) return fail('Choose a component function in this system.');
    const component = context.componentId ? model.elements[context.componentId] : undefined;
    if (context.componentId && (!component || component.isDefinition || !conforms(component.id, 'LogicalComponent') || !model.workspaceMembership.membership[component.id]?.includes(system.id))) return fail('Choose a component inside the selected system.');
    if ((component || operation === 'system-function') && !existingImplementation && !name.trim()) return fail('Name the component function.');
    if (operation === 'root' && root) return { success: true, elementId: root.id, filePath: root.file, sourceFiles: [] };
    const { candidates, adoptable } = functionalStructure(model, system.id);
    if (!root && adoptable) root = adoptable;
    const parent = operation === 'system-function' && root ? model.elements[canonicalFunctionId(model, context.parentFunctionId ?? root.id)] : root;
    if (operation === 'system-function' && (!root || !parent || parent.isDefinition || !conforms(parent.id, 'SystemFunction') || !functionalScope(model, system.id).members.has(parent.id))) return fail('Set up the parent function, then choose a function in this system.');
    const home = existingImplementation ?? (operation === 'system-function' ? parent! : root ?? system);
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
    const childParent = operation === 'system-function' ? parent! : root;
    const childName = unique(childParent?.id ?? `${home.package}::rootFunction`, name.trim() || 'componentFunction');
    const child = !existingImplementation && (component || operation === 'system-function') ? `action ${childName} : memo_architecture_functional_functions::${operation === 'system-function' ? 'SystemFunction' : 'ComponentFunction'} {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(name.trim())}; }\n}` : '';
    if (!root) {
        const rootName = unique(home.package, 'rootFunction'); rootId = `${home.package}::${rootName}`;
        // Perform references keep existing declarations and qualified identities intact.
        const performances = candidates.map((element, index) => `perform action responsibility${index + 1} : memo_architecture_functional_functions::SystemFunction :> ${elementPath(element.id, model)} { @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(element.name)}; } }`).join('\n');
        const body = `action ${rootName} : memo_architecture_functional_functions::SystemFunction {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(`${system.name} function`)}; }\n${[performances, child].filter(Boolean).map(text => text.split('\n').map(line => `    ${line}`).join('\n')).join('\n')}\n}`;
        newRootBody = body;
    }
    if (existingImplementation) childId = existingImplementation.id;
    else if (component || operation === 'system-function') childId = `${operation === 'system-function' ? parent!.id : rootId}::${childName}`;
    const additions = [!roots.length ? `#memo_architecture_functional_functions::FunctionalRoot dependency from ${system.id} to ${rootId};` : '',
        systemFunction && childId && !model.relationships.some(edge => edge.type === 'realizes' && edge.sourceId === childId && edge.targetId === systemFunction.id) ? `#ModelingMetadata::Refinement dependency from ${childId} to ${systemFunction.id};` : '',
    ].filter(Boolean).join('\n');
    const edits = new Map<string, { source: string; outline: SourceOutline; members: Map<string, string> }>();
    edits.set(home.file, { source, outline, members: new Map([[home.package, [newRootBody, additions].filter(Boolean).join('\n')]]) });
    if (child && (root || operation === 'system-function')) edits.get(home.file)!.members.set(operation === 'system-function' ? parent!.id : root!.id, child);
    const allocated = existingImplementation ? model.relationships.filter(edge => edge.type === 'allocatedTo' && edge.sourceId === existingImplementation.id) : [];
    if (component && allocated.some(edge => edge.targetId !== component.id)) return fail('This component function is already allocated elsewhere. Review its existing allocation first.');
    if (component && !allocated.some(edge => edge.targetId === component.id)) {
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
        const implementationPath = existingImplementation ? elementPath(existingImplementation.id, model) : `${elementPath(operation === 'system-function' ? parent!.id : rootId!, model)}.${childName}`;
        const allocation = `allocation allocate ${implementationPath} to ${target};`;
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
