// ─── Parser Utilities ─────────────────────────────────────────────────────────
//
// Wraps Langium's parse helper for multi-file parsing.
// Used by the builder to parse .sysml files into AST documents.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { ParseError } from './semantic.js';

/** A parsed document with its source file path */
export interface ParsedDocument {
    /** Langium document with AST */
    document: LangiumDocument<Model>;
    /** Relative file path */
    filePath: string;
}

/** Result of parsing multiple files */
export interface ParseResult {
    /** Successfully parsed documents */
    documents: ParsedDocument[];
    /** Parse errors from all files */
    errors: ParseError[];
}

/**
 * Parse multiple SysML files and return their ASTs.
 * Each file is parsed independently (no cross-file resolution for MVP).
 */
export async function parseFiles(filePaths: string[], basePath: string = ''): Promise<ParseResult> {
    const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
    const parse = parseHelper<Model>(services);

    const documents: ParsedDocument[] = [];
    const errors: ParseError[] = [];

    for (const filePath of filePaths) {
        try {
            const source = readFileSync(filePath, 'utf-8');
            const doc = await parse(source);

            // Collect lexer + parser errors
            const lexerErrors = doc.parseResult.lexerErrors;
            const parserErrors = doc.parseResult.parserErrors;

            for (const err of lexerErrors) {
                errors.push({
                    file: relativePath(filePath, basePath),
                    message: err.message,
                    line: err.line,
                    column: err.column,
                });
            }

            for (const err of parserErrors) {
                const token = (err as any).token;
                errors.push({
                    file: relativePath(filePath, basePath),
                    message: err.message,
                    line: token?.startLine,
                    column: token?.startColumn,
                });
            }

            documents.push({
                document: doc,
                filePath: relativePath(filePath, basePath),
            });
        } catch (e) {
            errors.push({
                file: relativePath(filePath, basePath),
                message: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return { documents, errors };
}

/**
 * Coherent project document cache for the live runtime.
 *
 * The first build parses the complete project. Later builds parse only files
 * reported by the watcher, discard deleted files, and return the complete
 * cached document/error set to the semantic builder. This keeps snapshot
 * semantics identical to a cold build while removing unchanged parser work
 * from the project-save hot path.
 */
export class IncrementalProjectParser {
    private readonly documents = new Map<string, ParsedDocument>();
    private readonly errors = new Map<string, ParseError[]>();

    constructor(private readonly basePath: string) {}

    async parse(allFiles: string[], changedFiles?: readonly string[]): Promise<ParseResult> {
        const absoluteFiles = new Set(allFiles.map(file => resolve(file)));
        for (const cached of [...this.documents.keys()]) {
            if (!absoluteFiles.has(cached)) {
                this.documents.delete(cached);
                this.errors.delete(cached);
            }
        }

        const targets = changedFiles === undefined
            ? [...absoluteFiles]
            : [...new Set(changedFiles.map(file => resolve(this.basePath, file)))]
                .filter(file => absoluteFiles.has(file) && existsSync(file));

        for (const file of targets) {
            const result = await parseFiles([file], this.basePath);
            const document = result.documents[0];
            if (document) this.documents.set(file, document);
            else this.documents.delete(file);
            this.errors.set(file, result.errors);
        }

        // A file newly discovered outside the watcher batch still needs a
        // document; this covers atomic directory moves and watcher coalescing.
        const missing = [...absoluteFiles].filter(file => !this.documents.has(file));
        for (const file of missing) {
            const result = await parseFiles([file], this.basePath);
            const document = result.documents[0];
            if (document) this.documents.set(file, document);
            this.errors.set(file, result.errors);
        }

        return {
            documents: [...this.documents.values()].sort((a, b) => a.filePath.localeCompare(b.filePath)),
            errors: [...this.errors.values()].flat(),
        };
    }
}

/**
 * Parse a single SysML source string, keeping the CST so callers can edit the
 * original text by offset. Source-preserving editors use this to validate a
 * candidate edit before it replaces the file on disk.
 */
export async function parseText(source: string): Promise<{
    document: LangiumDocument<Model>;
    errors: ParseError[];
}> {
    const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
    const parse = parseHelper<Model>(services);
    const document = await parse(source);

    const errors: ParseError[] = [];
    for (const err of document.parseResult.lexerErrors) {
        errors.push({ file: '', message: err.message, line: err.line, column: err.column });
    }
    for (const err of document.parseResult.parserErrors) {
        const token = (err as any).token;
        errors.push({
            file: '',
            message: err.message,
            line: token?.startLine,
            column: token?.startColumn,
        });
    }
    return { document, errors };
}

/**
 * Parse one SysML file to an AST synchronously.
 *
 * `parseFiles`/`parseText` go through Langium's async document builder, which
 * several callers cannot use: the ontology-browser metadata path is synchronous
 * all the way up through `buildLayers` and `getPackageMetadata`. Langium's
 * parser itself is synchronous, so those callers can have a real AST without
 * the surrounding pipeline going async — which is what let the regex scanner
 * survive as long as it did.
 *
 * Returns undefined when the file cannot be read or produces no root node.
 * Parse errors are not surfaced: callers here are building a catalog view, and
 * a partially-parsed file should contribute what it has rather than vanish.
 */
export function parseFileToAstSync(filePath: string): Model | undefined {
    try {
        const source = readFileSync(filePath, 'utf-8');
        const services = getSyncServices();
        const result = services.parser.LangiumParser.parse<Model>(source);
        return result.value ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * Language services are expensive to construct and stateless for parsing, so
 * the synchronous path reuses one instance across every file it scans.
 */
let syncServices: ReturnType<typeof createMemoSysMLServices>['MemoSysML'] | undefined;
function getSyncServices() {
    syncServices ??= createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
    return syncServices;
}

function relativePath(filePath: string, basePath: string): string {
    if (basePath && filePath.startsWith(basePath)) {
        return filePath.slice(basePath.length).replace(/^\//, '');
    }
    return filePath;
}
