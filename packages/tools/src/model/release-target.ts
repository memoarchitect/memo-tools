// ─── Where a release record is written ───────────────────────────────────────
//
// A record cannot hold the hash of the commit that adds it, so it is always written after the commit it
// pins. A system folder is checked out at that commit when the SoS version is assembled (plan section 9,
// decision 1), where the record does not exist yet: a record never goes under `<include>/systems/`.
// Pure and browser-safe, so the page names the same file the server writes.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_FOLDER = /(^|\/)systems\/[^/]+\//;

/** Whether a project-relative path is inside a system folder. */
export function isInSystemFolder(file: string): boolean {
    return SYSTEM_FOLDER.test(file.replaceAll('\\', '/'));
}

/**
 * The file a new record is appended to: the one that already holds the most records outside
 * `systems/`; failing that, `sos/releases.sysml` beside the systems folder of the item's file, or the
 * item's own folder when it is not under one.
 */
export function defaultReleaseFile(input: { recordFiles: readonly string[]; itemFile?: string }): string {
    const counts = new Map<string, number>();
    for (const file of input.recordFiles) if (!isInSystemFolder(file)) counts.set(file, (counts.get(file) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) return best[0];
    const item = input.itemFile?.replaceAll('\\', '/');
    if (!item) return 'model/sos/releases.sysml';
    const match = /^(.*?\/?)systems\/[^/]+\//.exec(item);
    if (match) return `${match[1]}sos/releases.sysml`;
    const slash = item.lastIndexOf('/');
    return `${slash < 0 ? '' : item.slice(0, slash + 1)}releases.sysml`;
}
