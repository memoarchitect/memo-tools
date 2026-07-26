// ─── File Watcher ────────────────────────────────────────────────────────────
//
// Two-scope watchers: project files (hot reload) and ontology files (restart).
// ─────────────────────────────────────────────────────────────────────────────

import chokidar from 'chokidar';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

export interface FileWatcher {
    close(): void;
}

/** Options for the project watcher's scope. */
export interface ProjectWatcherOptions {
    debounceMs?: number;
    usePolling?: boolean;
    /**
     * Absolute roots of installed ontology packages. SysML inside them is
     * watched by the ontology watcher, which requires a restart rather than a
     * hot rebuild — so the project watcher must not claim them too.
     */
    ontologyRoots?: string[];
}

const IGNORED_DIR_NAMES = new Set(['node_modules', '.memo', 'dist', 'lib']);

function isInIgnoredDir(filePath: string): boolean {
    return resolve(filePath).split(sep).some(part => IGNORED_DIR_NAMES.has(part));
}

/** True when `filePath` is inside `dir` (or is `dir` itself). */
function isWithin(dir: string, filePath: string): boolean {
    const rel = relative(dir, filePath);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Debounce a burst of file events into one call, keeping the set of paths seen
 * during the burst. A single save can emit several events, and a branch switch
 * emits hundreds — the caller wants one rebuild and the full list.
 */
function makeDebounced(
    onChange: (changedFiles: string[]) => void | Promise<void>,
    debounceMs: number,
) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = new Set<string>();
    return (filePath: string) => {
        pending.add(filePath);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const files = [...pending].sort();
            pending = new Set();
            onChange(files);
        }, debounceMs);
    };
}

/**
 * Watch project source files — triggers hot rebuild.
 *
 * The scope deliberately matches what the build ingests: every project-local
 * `.sysml` file, wherever it sits, plus the per-project YAML config files. A
 * narrower scope (model/ only) leaves views and catalogs outside that directory
 * silently stale, which is exactly the class of bug this watcher exists to
 * prevent.
 *
 * The callback receives the project-relative paths that changed, so callers can
 * tell clients what moved rather than only that something did.
 */
export function createProjectWatcher(
    projectDir: string,
    onChange: (changedFiles: string[]) => void | Promise<void>,
    debounceMs: number = 300,
    usePolling: boolean = false,
    options: ProjectWatcherOptions = {},
): FileWatcher {
    const fire = makeDebounced(onChange, options.debounceMs ?? debounceMs);

    const root = resolve(projectDir);
    const configFiles = [
        resolve(root, 'memo.rendering.yaml'),
        resolve(root, 'memo.rules.yaml'),
        resolve(root, 'memo.viewpoints.yaml'),
    ];
    const ontologyRoots = (options.ontologyRoots ?? []).map(dir => resolve(dir));

    /** Whether a change to this path should rebuild the project model. */
    const isProjectSource = (absolute: string): boolean => {
        if (configFiles.includes(absolute)) return true;
        if (extname(absolute).toLowerCase() !== '.sysml') return false;
        if (isInIgnoredDir(absolute)) return false;
        if (!isWithin(root, absolute)) return false;
        return !ontologyRoots.some(ontologyRoot => isWithin(ontologyRoot, absolute));
    };

    // Chokidar 4 removed glob support. Watch the project root and filter events
    // instead of passing model/**/*.sysml (which silently watches none).
    const watcher = chokidar.watch(root, {
        ignored: (filePath, stats) => {
            const absolute = resolve(filePath);
            if (absolute === root) return false;
            if (isInIgnoredDir(absolute)) return true;
            // Directories must stay watchable — the files under them are what
            // gets filtered, and a directory has no extension to judge by.
            if (stats && !stats.isFile()) {
                return ontologyRoots.some(ontologyRoot => isWithin(ontologyRoot, absolute));
            }
            if (!stats) return false;
            return !isProjectSource(absolute);
        },
        persistent: true,
        ignoreInitial: true,
        usePolling: options.usePolling ?? usePolling,
    });

    watcher.on('all', (_event, filePath) => {
        const absolute = resolve(filePath);
        if (isProjectSource(absolute)) fire(relative(root, absolute));
    });

    return {
        close() { watcher.close(); },
    };
}

/**
 * Watch ontology package files — triggers restart-required notification.
 * Covers: ontology sysml/, memo.package.yaml, memo.rendering.yaml in each root,
 * plus the project-level memo.config.yaml and model/ontology-selection.sysml.
 */
export function createOntologyWatcher(
    projectDir: string,
    ontologyRoots: string[],
    onChange: (changedFile: string) => void | Promise<void>,
    debounceMs: number = 300
): FileWatcher {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingFile = '';

    const fire = (filePath: string) => {
        if (!pendingFile) pendingFile = filePath;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const f = pendingFile;
            pendingFile = '';
            onChange(f);
        }, debounceMs);
    };

    const paths: string[] = [
        // Chokidar 4 watches concrete paths, not glob patterns.
        ...ontologyRoots.flatMap(root => [
            resolve(root, 'sysml'),
            resolve(root, 'memo.package.yaml'),
            resolve(root, 'memo.rendering.yaml'),
        ]),
        // Project-level ontology selection
        resolve(projectDir, 'memo.config.yaml'),
        resolve(projectDir, 'memo.config.yml'),
        resolve(projectDir, 'memo.package.yaml'),
        resolve(projectDir, 'model', 'ontology-selection.sysml'),
    ];

    const watcher = chokidar.watch(paths.filter(existsSync), {
        ignored: filePath => isInIgnoredDir(filePath),
        persistent: true,
        ignoreInitial: true,
    });

    watcher.on('all', (_event, filePath) => fire(filePath));

    return {
        close() {
            if (timer) clearTimeout(timer);
            watcher.close();
        },
    };
}

/**
 * @deprecated Use createProjectWatcher + createOntologyWatcher instead.
 * Kept for backward compatibility.
 */
export function createFileWatcher(
    projectDir: string,
    onChange: () => void | Promise<void>,
    debounceMs: number = 300
): FileWatcher {
    const fire = makeDebounced(() => onChange(), debounceMs);

    const watchedConfigNames = new Set([
        'memo.config.yaml', 'memo.config.yml', 'memo.package.yaml',
        'memo.rendering.yaml', 'memo.rules.yaml', 'memo.viewpoints.yaml',
    ]);
    const watcher = chokidar.watch(resolve(projectDir), {
        ignored: filePath => isInIgnoredDir(filePath),
        persistent: true,
        ignoreInitial: true,
    });

    watcher.on('all', (_event, filePath) => {
        const name = filePath.split(sep).at(-1) ?? '';
        if (extname(filePath).toLowerCase() === '.sysml' || watchedConfigNames.has(name)) fire(filePath);
    });

    return {
        close() { watcher.close(); },
    };
}
