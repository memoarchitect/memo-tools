// ─── Parser Utilities ─────────────────────────────────────────────────────────
//
// Wraps Langium's parse helper for multi-file parsing.
// Used by the builder to parse .sysml files into AST documents.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
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

function relativePath(filePath: string, basePath: string): string {
    if (basePath && filePath.startsWith(basePath)) {
        return filePath.slice(basePath.length).replace(/^\//, '');
    }
    return filePath;
}
