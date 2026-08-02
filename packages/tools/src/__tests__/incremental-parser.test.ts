import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IncrementalProjectParser } from '../model/parser-utils.js';

const ROOT = resolve(__dirname, '__tmp_incremental_parser__');

afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe('IncrementalProjectParser', () => {
    it('keeps unchanged documents, reparses changed files, and drops deleted files', async () => {
        mkdirSync(ROOT, { recursive: true });
        const a = join(ROOT, 'a.sysml');
        const b = join(ROOT, 'b.sysml');
        writeFileSync(a, 'package A { part first : Thing; }\n');
        writeFileSync(b, 'package B { part stable : Thing; }\n');

        const parser = new IncrementalProjectParser(ROOT);
        const initial = await parser.parse([a, b]);
        const stableDocument = initial.documents.find(document => document.filePath === 'b.sysml')!.document;

        writeFileSync(a, 'package A { part changed : Thing; }\n');
        const updated = await parser.parse([a, b], ['a.sysml']);
        expect(updated.documents.find(document => document.filePath === 'b.sysml')!.document)
            .toBe(stableDocument);
        expect(updated.documents.find(document => document.filePath === 'a.sysml')!.document)
            .not.toBe(initial.documents.find(document => document.filePath === 'a.sysml')!.document);

        rmSync(b);
        const deleted = await parser.parse([a], ['b.sysml']);
        expect(deleted.documents.map(document => document.filePath)).toEqual(['a.sysml']);
    });
});
