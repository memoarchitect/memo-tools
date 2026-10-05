import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { relative } from 'node:path';
import { findSysmlFiles } from '../model/sysml-files.js';
import { checkSelectorVocabulary } from '../model/selector-vocabulary.js';
import { compileModelWithSelected } from '../toolchain/operations.js';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

// `memo validate` checks a PROJECT's selectors, and deliberately builds only
// project source: a library that will not parse is a different report. That
// leaves the ontology's own selectors — the viewpoint views, the methodology
// profiles' element and relation rules — checked by nobody, and they are
// written by the same hands and go wrong the same way. Found one on the first
// run: `RULE-002` required relation "verify", the keyword, where the model
// keys the relation `verifiedBy`, so the rule named nothing.
//
// This is that check, run over the resolved ontology itself.

const MEMO_ROOT = resolve(__dirname, '../../../../../memo');

describe.runIf(compilerConfigured && examplesPresent)('the ontology\'s own selectors name declared vocabulary', () => {
    it('no view, rule or legend names a kind, relation or attribute that is not there', async () => {
        // The ontology and its extensions, compiled as if they were a project's
        // own source: the library side of a resolution is what `memo validate`
        // subtracts before it builds the project's model, so this builds it.
        const example = await compiledExample('gpca-pump');
        const files = [...findSysmlFiles(resolve(MEMO_ROOT, 'src')), ...findSysmlFiles(resolve(MEMO_ROOT, 'extensions'))];
        expect(files.length).toBeGreaterThan(0);
        const compiled = await compileModelWithSelected({
            config: { projectName: 'ontology', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never,
            projectDir: MEMO_ROOT,
            libraryDirs: [],
            projectFiles: new Set(files.map(file => relative(MEMO_ROOT, file))),
            registries: example.registries,
            provenance: false,
        });
        expect(compiled.accepted, JSON.stringify(compiled.diagnostics.slice(0, 3))).toBe(true);

        const diagnostics = checkSelectorVocabulary(compiled.model!, example.registries ?? {});

        const detail = diagnostics.map(d => `\n  ${d.file}\n    ${d.message}`).join('');
        expect(diagnostics, `Selectors naming undeclared vocabulary:${detail}\n`).toEqual([]);
    }, 300_000);
});
