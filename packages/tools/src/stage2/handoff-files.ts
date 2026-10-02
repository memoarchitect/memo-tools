// ─── Absolute files for a stage 1 handoff ───────────────────────────────────
//
// The handoff names each element's file relative to its root (portable, and
// the same for every compiler). Readers that key on files — rule activation,
// a kind's layer and standard, which come from its path — need the absolute
// file project resolution read. These map one back to the other.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiElement, ApiModel } from './api-model.js';

/**
 * The absolute file a handoff-relative one is: the one known file it ends
 * with, or among several the one whose package declares the element. The
 * relative path when nothing known matches.
 */
export function absoluteHandoffFile(
    file: string,
    qualifiedName: string | undefined,
    filePackages?: ReadonlyMap<string, string>,
): string {
    if (!file || !filePackages) return file;
    const candidates = [...filePackages.keys()].filter(path => path === file || path.endsWith(`/${file}`));
    if (candidates.length <= 1) return candidates[0] ?? file;
    const declaring = candidates.filter(path => {
        const pkg = filePackages.get(path);
        return pkg !== undefined && qualifiedName !== undefined && qualifiedName.startsWith(`${pkg}::`);
    });
    return declaring.length === 1 ? declaring[0] : file;
}

/**
 * The absolute file each element of a handoff is declared in: from the root
 * the handoff names, else matched against the files resolution read.
 */
export function handoffFileOf(api: ApiModel, filePackages?: ReadonlyMap<string, string>): (element: ApiElement) => string {
    return element => api.absoluteFile(element['@id']) ?? absoluteHandoffFile(
        api.source(element['@id'])?.file ?? '', api.qualifiedName(element['@id']), filePackages);
}
