// ─── A library's stage 1 export, shipped with the library ────────────────────
//
// A package that is reused unchanged (MEMO's ontology, with the extensions and
// methodologies its manifest offers) is exported by the selected compiler once,
// by whoever releases it, and the export travels in the package:
// `<package>/stage1/<compiler>-<key>.json.gz` (plans/memo-incremental-stage1.md,
// step 4). A project compiling for the first time on a machine reads it instead
// of exporting the library itself.
//
// The file is a library handoff exactly as the provider keeps it in
// `.memo/stage1/`, with one change: the absolute directories it names are
// placeholders, so it can be read from wherever the package is installed.
//
// **The key is the whole library set.** It hashes, in the order the roots were
// given, every root's relative file names and bytes, with the compiler, its
// version and the format of what the provider writes. A project whose roots are
// the package's own finds the file; one that adds a root, or reads an edited
// file, does not, and exports the library itself, as it always has. Reusing
// the part of a set that matches is not done (an extension's export depends on
// the packages it imports, which this key does not follow).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/** The directory of a package that carries shipped exports. */
export const SHIPPED_DIR = 'stage1';

/** Bumped when what a provider writes into a library handoff changes. */
const SHIPPED_FORMAT = 'memo-stage1-library/1';

/** One library root with the files the compiler reads from it. */
export interface LibraryRootFiles {
    dir: string;
    files: readonly string[];
}

/** The key of a library set for a compiler at a version. */
export function shippedLibraryKey(compiler: string, version: string, roots: readonly LibraryRootFiles[]): string {
    const hash = createHash('sha256');
    hash.update(`${SHIPPED_FORMAT}\0${compiler}\0${version}\0`);
    for (const { dir, files } of roots) {
        const root = resolve(dir);
        const rootHash = createHash('sha256');
        for (const file of [...new Set(files.map(f => resolve(f)))].sort()) {
            rootHash.update(`\0${file.slice(root.length)}\0`);
            rootHash.update(readFileSync(file));
        }
        hash.update(`${rootHash.digest('hex')}\0`);
    }
    return hash.digest('hex');
}

export function shippedFileName(compiler: string, key: string, extension = 'json.gz'): string {
    return `${compiler}-${key.slice(0, 24)}.${extension}`;
}

/**
 * The shipped file for a key, looked for in the `stage1/` directory of every
 * directory above each root: the package that carries the library is an
 * ancestor of its roots, whether it is a checkout or installed.
 */
export function findShipped(
    compiler: string, key: string, libraryDirs: readonly string[], extension = 'json.gz',
): string | undefined {
    const name = shippedFileName(compiler, key, extension);
    const seen = new Set<string>();
    for (const dir of libraryDirs) {
        for (let current = resolve(dir); !seen.has(current); current = dirname(current)) {
            seen.add(current);
            const candidate = join(current, SHIPPED_DIR, name);
            if (existsSync(candidate)) return candidate;
            if (current === parse(current).root) break;
        }
    }
    return undefined;
}

const PLACEHOLDER = '@root';
// The only fields of a library handoff that hold a path: the root a file is
// relative to, and (OpenSysML) the document an element came from.
const PATH_FIELDS = /"(root|sysx:sourceDocument)"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g;
const PLACEHOLDER_VALUE = /"@root\/(\d+)((?:\/(?:[^"\\]|\\.)*)?)"/g;

/** A handoff's text with each library root's directory replaced by its place in `libraryDirs`. */
export function toPortable(text: string, libraryDirs: readonly string[]): string {
    const dirs = libraryDirs.map(dir => resolve(dir));
    return text.replace(PATH_FIELDS, (whole, field: string, colon: string, raw: string) => {
        const value = JSON.parse(`"${raw}"`) as string;
        const index = dirs.findIndex(dir => value === dir || value.startsWith(dir + sep));
        if (index < 0) {
            throw new Error(`a library handoff names "${value}" in "${field}", which is under none of its library roots; it cannot be shipped`);
        }
        const rest = value.slice(dirs[index].length).split(sep).filter(Boolean).join('/');
        return `"${field}"${colon}${JSON.stringify(`${PLACEHOLDER}/${index}${rest ? `/${rest}` : ''}`)}`;
    });
}

/** The inverse of `toPortable`, for the directories this machine has. */
export function fromPortable(text: string, libraryDirs: readonly string[]): string {
    const dirs = libraryDirs.map(dir => resolve(dir));
    return text.replace(PLACEHOLDER_VALUE, (_whole, index: string, rest: string) => {
        const dir = dirs[Number(index)];
        if (dir === undefined) throw new Error(`a shipped library names root ${index}, but only ${dirs.length} were given`);
        const tail = rest ? (JSON.parse(`"${rest}"`) as string).split('/').filter(Boolean).join(sep) : '';
        return JSON.stringify(tail ? `${dir}${sep}${tail}` : dir);
    });
}

/** Write a library handoff's text as a shipped file, atomically. */
export function writeShipped(
    outDir: string, compiler: string, key: string, text: string, libraryDirs: readonly string[], extension = 'json.gz',
): string {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, shippedFileName(compiler, key, extension));
    const partial = `${path}.${process.pid}.partial`;
    writeFileSync(partial, gzipSync(toPortable(text, libraryDirs)));
    renameSync(partial, path);
    return path;
}

/** A shipped file's text, for the directories this machine has. */
export function readShipped(path: string, libraryDirs: readonly string[]): string {
    return fromPortable(gunzipSync(readFileSync(path)).toString('utf8'), libraryDirs);
}

/** A shipped ids file (a list of ids, no paths), as stored. */
export function writeShippedIds(outDir: string, compiler: string, key: string, text: string): string {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, shippedFileName(compiler, key, 'ids.gz'));
    writeFileSync(path, gzipSync(text));
    return path;
}

export function readShippedIds(path: string): string {
    return gunzipSync(readFileSync(path)).toString('utf8');
}
