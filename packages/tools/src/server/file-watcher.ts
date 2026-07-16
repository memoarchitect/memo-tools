// ─── File Watcher ────────────────────────────────────────────────────────────
//
// Two-scope watchers: project files (hot reload) and ontology files (restart).
// ─────────────────────────────────────────────────────────────────────────────

import chokidar from 'chokidar';
import { extname, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

export interface FileWatcher {
    close(): void;
}

const IGNORED_DIR_NAMES = new Set(['node_modules', '.memo', 'dist', 'lib']);

function isInIgnoredDir(filePath: string): boolean {
    return resolve(filePath).split(sep).some(part => IGNORED_DIR_NAMES.has(part));
}

function makeDebounced(onChange: () => void | Promise<void>, debounceMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            onChange();
        }, debounceMs);
    };
}

/**
 * Watch project source files — triggers hot rebuild.
 * Covers model SysML and per-project YAML config files only.
 */
export function createProjectWatcher(
    projectDir: string,
    onChange: () => void | Promise<void>,
    debounceMs: number = 300,
    usePolling: boolean = false,
): FileWatcher {
    const fire = makeDebounced(onChange, debounceMs);

    const root = resolve(projectDir);
    const modelRoot = resolve(root, 'model');
    const configFiles = [
        resolve(root, 'memo.rendering.yaml'),
        resolve(root, 'memo.rules.yaml'),
        resolve(root, 'memo.viewpoints.yaml'),
    ];
    // Chokidar 4 removed glob support. Watch concrete roots/files and filter
    // events instead of passing model/**/*.sysml (which silently watches none).
    const watcher = chokidar.watch(root, {
        ignored: (filePath, stats) => {
            const absolute = resolve(filePath);
            if (absolute === root) return false;
            if (isInIgnoredDir(absolute)) return true;
            if (configFiles.includes(absolute)) return false;

            const relToModel = relative(modelRoot, absolute);
            const inModel = relToModel !== '..' && !relToModel.startsWith(`..${sep}`);
            if (!inModel) return true;
            return stats?.isFile() === true && extname(absolute).toLowerCase() !== '.sysml';
        },
        persistent: true,
        ignoreInitial: true,
        usePolling,
    });

    watcher.on('all', (_event, filePath) => {
        const absolute = resolve(filePath);
        const inModel = relative(modelRoot, absolute) !== '..'
            && !relative(modelRoot, absolute).startsWith(`..${sep}`);
        if ((inModel && extname(absolute).toLowerCase() === '.sysml') || configFiles.includes(absolute)) {
            fire();
        }
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
    const fire = makeDebounced(onChange, debounceMs);

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
        if (extname(filePath).toLowerCase() === '.sysml' || watchedConfigNames.has(name)) fire();
    });

    return {
        close() { watcher.close(); },
    };
}
