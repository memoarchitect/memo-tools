import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { buildMemoModel } from '../model/builder.js';
import { loadProjectSettings } from '../model/config-loader.js';
import { checkSelectorVocabulary } from '../model/selector-vocabulary.js';

// `memo validate` checks a PROJECT's selectors, and deliberately builds only
// project source: a library that will not parse is a different report. That
// leaves the ontology's own selectors — the viewpoint views, the methodology
// profiles' element and relation rules — checked by nobody, and they are
// written by the same hands and go wrong the same way. Found one on the first
// run: `RULE-002` required relation "verify", the keyword, where the model
// keys the relation `verifiedBy`, so the rule named nothing.
//
// This is that check, run over the resolved ontology itself.

const GPCA_PROJECT = resolve(__dirname, '../../../../../memo/examples/gpca-pump');

describe('the ontology\'s own selectors name declared vocabulary', () => {
    it('no view, rule or legend names a kind, relation or attribute that is not there', async () => {
        if (!existsSync(GPCA_PROJECT)) {
            // The sibling ontology checkout is not present in every consumer
            // install; skipping is correct there, failing would be noise.
            return;
        }
        const root = findProjectRoot(GPCA_PROJECT);
        expect(root, 'the gpca-pump example should resolve as a project').toBeTruthy();
        const loaded = await loadOntologyRegistries(root!);
        // `parsedDocuments` is the LIBRARY side of the resolution — the
        // ontology and extension packages themselves, which is exactly what
        // `memo validate` subtracts before it builds the project's model.
        expect(loaded.parsedDocuments.length).toBeGreaterThan(0);
        const model = buildMemoModel(
            loaded.parsedDocuments, loadProjectSettings(root!), [],
            { ...loaded.registries, provenance: loaded.provenance });

        const diagnostics = checkSelectorVocabulary(model, loaded.registries);

        const detail = diagnostics.map(d => `\n  ${d.file}\n    ${d.message}`).join('');
        expect(diagnostics, `Selectors naming undeclared vocabulary:${detail}\n`).toEqual([]);
    });
});
