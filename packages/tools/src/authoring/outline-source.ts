// ─── Outlines of a project, from whichever compiler is selected ─────────────
//
// A write resolves its identity against the outline of the file as it is on
// disk now (plans/memo-write-back-from-handoff.md). Under MEMO's compiler that
// is a parse of the text. Under a compiler that builds the model from its
// handoff it is the last handoff, when the file is unchanged since that
// compile, and otherwise a fresh compile: an outline read from a handoff of
// other bytes would put every range in the wrong place.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { MEMOConfig } from '../model/config.js';
import type { IrIdentityIndex } from '../model/ir-identity.js';
import { parseText } from '../model/parser-utils.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import type { ApiModel } from '../stage2/api-model.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { selectedCompilerBuildsModel } from '../toolchain/operations.js';
import { outlineIdentities, outlineIdentityTable } from './outline-identity.js';
import { outlineFromHandoff, outlineFromParse, type SourceOutline } from './source-outline.js';

/** The outline of one project file, given its current text. */
export interface OutlineSource {
    /**
     * `file` is project-relative. Rejects with a message when the text is not
     * one the selected compiler accepts: there is no outline to edit then.
     */
    outline(file: string, text: string): Promise<SourceOutline>;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Outlines from MEMO's parse of the current text. */
export const parseOutlineSource: OutlineSource = {
    async outline(file, text) {
        const { document, errors } = await parseText(text);
        if (errors.length > 0) throw new Error(`${file} does not parse (${errors[0].message})`);
        return outlineFromParse(document.parseResult.value as never, file, text);
    },
};

/**
 * Outlines from a handoff, recompiling when a file changed since it was
 * compiled. `texts` are the files' contents as that compile read them.
 */
export function handoffOutlineSource(options: {
    projectRoot: string;
    config: MEMOConfig;
    api: ApiModel;
    texts: ReadonlyMap<string, string>;
}): OutlineSource {
    let { api } = options;
    let hashes = new Map([...options.texts].map(([file, text]) => [file, sha(text)]));
    return {
        async outline(file, text) {
            if (hashes.get(file) !== sha(text)) {
                const project = await loadProjectModel({ projectRoot: options.projectRoot, config: options.config });
                if (!project.api) throw new Error(`${project.compiler} built no handoff to outline ${file} from`);
                api = project.api;
                hashes = new Map([...projectTexts(options.projectRoot, project)].map(([f, t]) => [f, sha(t)]));
                if (hashes.get(file) !== sha(text)) {
                    throw new Error(`${file} changed while it was being compiled; repeat the edit`);
                }
            }
            return outlineFromHandoff(api, resolve(options.projectRoot, file), file, text);
        },
    };
}

/**
 * The outline source of the selected compiler, for a caller holding no loaded
 * project: a compiler that builds the model loads it on first use, reusing
 * `.memo/stage1/` when nothing changed.
 */
export function selectedOutlineSource(projectRoot: string, config: MEMOConfig): OutlineSource {
    if (!selectedCompilerBuildsModel(config)) return parseOutlineSource;
    let loaded: Promise<OutlineSource> | undefined;
    return {
        async outline(file, text) {
            loaded ??= loadProjectModel({ projectRoot, config })
                .then(project => outlineSourceFor(projectRoot, config, project));
            return (await loaded).outline(file, text);
        },
    };
}

/** The outline source for a loaded project: its compiler's. */
export function outlineSourceFor(projectRoot: string, config: MEMOConfig, project: ProjectModel): OutlineSource {
    return project.api
        ? handoffOutlineSource({ projectRoot, config, api: project.api, texts: projectTexts(projectRoot, project) })
        : parseOutlineSource;
}

/** The project's own files and their text, by project-relative path. */
function projectTexts(projectRoot: string, project: ProjectModel): Map<string, string> {
    const texts = new Map<string, string>();
    if (project.api) {
        for (const file of projectFilesOf(project.api)) {
            if (existsSync(file)) texts.set(relative(projectRoot, file), readFileSync(file, 'utf8'));
        }
    } else {
        for (const document of project.documents) {
            texts.set(relativeTo(projectRoot, document.filePath), document.document.textDocument.getText());
        }
    }
    return texts;
}

/** The absolute files of a handoff's project documents. */
function projectFilesOf(api: ApiModel): string[] {
    const files = new Set<string>();
    for (const namespace of api.ofType('Namespace')) {
        if (api.owner(namespace['@id']) || api.source(namespace['@id'])?.role !== 'project') continue;
        const file = api.absoluteFile(namespace['@id']);
        if (file) files.add(file);
    }
    return [...files];
}

const relativeTo = (projectRoot: string, file: string) =>
    (isAbsolute(file) ? relative(projectRoot, file) : file).replaceAll('\\', '/');

/** The outlines of every project file of a loaded project. */
export function projectOutlines(projectRoot: string, project: ProjectModel): SourceOutline[] {
    return project.api ? outlinesFromHandoff(projectRoot, project.api) : outlinesFromDocuments(projectRoot, project.documents);
}

/** The outlines of a handoff's project files, read against the files on disk. */
export function outlinesFromHandoff(projectRoot: string, api: ApiModel): SourceOutline[] {
    return projectFilesOf(api).filter(file => existsSync(file)).map(file => {
        const name = relativeTo(projectRoot, file);
        return outlineFromHandoff(api, file, name, readFileSync(file, 'utf8'));
    });
}

/** The outlines of documents MEMO parsed. */
export function outlinesFromDocuments(projectRoot: string, documents: readonly ParsedDocument[]): SourceOutline[] {
    return documents.map(document => outlineFromParse(
        document.document.parseResult.value as never,
        relativeTo(projectRoot, document.filePath),
        document.document.textDocument.getText(),
    ));
}

/**
 * The identity index a write resolves against: every declaration with an
 * identity, and each element's.
 */
export function outlineIdentityIndex(
    outlines: readonly SourceOutline[],
    elements: Iterable<{ id: string; file?: string }>,
    projectRoot: string,
): IrIdentityIndex {
    const byMemoElement = outlineIdentityTable(outlines, elements, projectRoot);
    const elementOf = new Map(Object.entries(byMemoElement).map(([element, identity]) => [identity, element]));
    const byIdentity = new Map<string, { identity: { id: string; metaclass: string }; memoElementId?: string }>();
    for (const [identity, { node }] of outlineIdentities(outlines)) {
        byIdentity.set(identity, { identity: { id: identity, metaclass: node.metaclass }, memoElementId: elementOf.get(identity) });
    }
    return { byMemoElement, byIdentity };
}
