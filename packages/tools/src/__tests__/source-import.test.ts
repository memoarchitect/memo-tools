import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRevision, deriveElementName } from '../serializer/csv-io.js';
import { parseReqIf } from '../import/reqif.js';
import { parseTraceMatrix } from '../import/source-import.js';
import { computeSuspectLinks } from '../analysis/suspect-links.js';
import { planSourceImport, readSource, renderSourceImport, type SourceImportContext } from '../import/source-import.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// T6, end to end through the real parse -> plan -> render -> write path. The records are
// requirements exported from a requirements tool; MEMO-authored links are written against them.
const V1 = `sourceId,revision,name,kind,statement
REQ-1,B,Single mode,Requirement,The system shall be in one mode.
REQ-2,A,Alarm latency,Requirement,The alarm shall sound within two seconds.
REQ-3,A,Battery,Requirement,The device shall run for eight hours.
`;
// REQ-1 moves to revision C with new text, REQ-2 is gone, REQ-3 is untouched.
const V2 = `sourceId,revision,name,kind,statement
REQ-1,C,Single mode,Requirement,The system shall be in exactly one mode.
REQ-3,A,Battery,Requirement,The device shall run for eight hours.
`;

const AUTHORED = `package authored {
    private import ScalarValues::*;
    private import memo_assurance_requirements::*;
    private import memo_core_semantics::*;
    private import memo_core_relationships::*;
    private import imports_reqtool::*;
    part def Widget;
    part widget : Widget;
    requirement reqOwn : Requirement;
    satisfy req1 by widget {
        @TraceBaseline { :>> sourceRevision = "B"; }
    }
    connection derives : DerivesFrom connect sourceDriver ::> reqOwn to targetRequirement ::> req1 {
        @TraceBaseline { :>> sourceRevision = "B"; }
    }
    satisfy req2 by widget {
        @TraceBaseline { :>> sourceRevision = "A"; }
    }
}`;

const NOW = new Date('2026-10-13T09:00:00Z');
const config = { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;

async function importInto(root: string, text: string, format: 'csv' | 'trace-matrix' = 'csv') {
    const project = await loadProjectModel({ projectRoot: root, config, cache: false });
    const context = project.registries as unknown as SourceImportContext;
    const records = readSource({ system: 'reqtool', format, text, defaultKind: 'Requirement' }, context);
    expect(records.errors).toEqual([]);
    const plan = planSourceImport(project.model, 'reqtool', records);
    const rendered = renderSourceImport(project.model, plan, context, { format, now: NOW });
    return { project, plan, rendered };
}

const stateOf = async (root: string) => {
    const { model } = await loadProjectModel({ projectRoot: root, config, cache: false });
    return {
        withdrawn: [...model.elements.values()].filter(e => e.attributes['sourceWithdrawn'] === 'true').map(e => e.id).sort(),
        records: [...model.elements.keys()].filter(id => id.startsWith('imports_reqtool::')).sort(),
        traces: model.relationships.filter(r => r.file.endsWith('imports/reqtool.sysml')).map(r => `${r.type}:${r.sourceId}>${r.targetId}`).sort(),
    };
};

const write = (root: string, file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text, 'utf8');
};

describe.runIf(compilerConfigured && examplesPresent)('import from a source system', () => {
    it('writes records that compile, and a re-import marks their links', async () => {
        await withExample({}, async (_host, root) => {
            // 1. Import v1; the records compile and carry their source record.
            const first = await importInto(root, V1);
            expect(first.plan.diff.added.map(e => e.source?.identifier)).toEqual(['REQ-1', 'REQ-2', 'REQ-3']);
            expect(first.rendered.dropped).toEqual([]);
            write(root, first.rendered.file, first.rendered.text);
            write(root, 'model/catalog/authored.sysml', AUTHORED);

            const afterFirst = await loadProjectModel({ projectRoot: root, config, cache: false });
            const req1 = afterFirst.model.elements.get('imports_reqtool::req1');
            expect(req1?.attributes).toMatchObject({
                'externalReference.sourceSystem': 'reqtool',
                'externalReference.identifier': 'REQ-1',
                'externalReference.revision': 'B',
                sourceMastered: 'true',
            });
            expect(computeSuspectLinks(afterFirst.model)).toEqual([]);

            // 2. Re-import v2: the diff names what changed and the links each entry touches.
            const second = await importInto(root, V2);
            const { diff } = second.plan;
            expect(diff.added).toEqual([]);
            expect(diff.unchanged).toEqual(['imports_reqtool::req3']);
            expect(diff.modified.map(m => [m.current.id, m.revisionMoved, m.links?.filter(l => l.baselined).length])).toEqual([
                ['imports_reqtool::req1', true, 2],
            ]);
            expect(diff.withdrawn.map(w => [w.id, w.links.length])).toEqual([['imports_reqtool::req2', 1]]);
            // Nothing the import does not own is reported missing.
            expect(diff.removed).toEqual(['imports_reqtool::req2']);

            // 3. Write it and recompile: two links suspect on the moved record, one on the withdrawn.
            write(root, second.rendered.file, second.rendered.text);
            const afterSecond = await loadProjectModel({ projectRoot: root, config, cache: false });
            expect(computeSuspectLinks(afterSecond.model).map(s => `${s.elementId}:${s.relationshipType}:${s.reason}`).sort()).toEqual([
                'imports_reqtool::req1:derivesFrom:revision-moved',
                'imports_reqtool::req1:satisfiedBy:revision-moved',
                'imports_reqtool::req2:satisfiedBy:source-withdrawn',
            ]);
            // The record kept its identity. A number is keyed by the qualified id (`identityKey`), and
            // the import reuses the name of a record it already holds, so the id is the same one.
            const kept = afterSecond.model.elements.get('imports_reqtool::req1');
            expect(kept?.id).toBe(req1?.id);
            expect(kept?.attributes['externalReference.revision']).toBe('C');
            expect(afterSecond.model.elements.get('imports_reqtool::req2')?.attributes['sourceWithdrawn']).toBe('true');
        });
    }, 240000);
});

// A ReqIF export from a requirements tool: two records, one trace between them, XHTML text with
// entities and markup, and a tool attribute the Requirement kind does not declare.
const REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <THE-HEADER><REQ-IF-HEADER IDENTIFIER="h1"><SOURCE-TOOL-ID>reqtool</SOURCE-TOOL-ID></REQ-IF-HEADER></THE-HEADER>
  <CORE-CONTENT><REQ-IF-CONTENT>
    <SPEC-TYPES>
      <SPEC-OBJECT-TYPE IDENTIFIER="t-req" LONG-NAME="Requirement"><SPEC-ATTRIBUTES>
        <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="ad-name" LONG-NAME="ReqIF.Name"/>
        <ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="ad-text" LONG-NAME="ReqIF.Text"/>
        <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="ad-method" LONG-NAME="Verification Method"/>
      </SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>
      <SPEC-RELATION-TYPE IDENTIFIER="rt-derive" LONG-NAME="DerivesFrom"/>
    </SPEC-TYPES>
    <SPEC-OBJECTS>
      <SPEC-OBJECT IDENTIFIER="REQ-10" LAST-CHANGE="2026-09-01T10:00:00Z">
        <TYPE><SPEC-OBJECT-TYPE-REF>t-req</SPEC-OBJECT-TYPE-REF></TYPE>
        <VALUES>
          <ATTRIBUTE-VALUE-STRING THE-VALUE="Boot time"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
          <ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>ad-text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION>
            <THE-VALUE><xhtml:div>The device shall boot in &lt; 5&#160;s &amp; <xhtml:b>report</xhtml:b> ready.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
          <ATTRIBUTE-VALUE-STRING THE-VALUE="Test"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-method</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
        </VALUES>
      </SPEC-OBJECT>
      <SPEC-OBJECT IDENTIFIER="REQ-11" LAST-CHANGE="2026-09-02T10:00:00Z">
        <TYPE><SPEC-OBJECT-TYPE-REF>t-req</SPEC-OBJECT-TYPE-REF></TYPE>
        <VALUES>
          <ATTRIBUTE-VALUE-STRING THE-VALUE="Boot time, cold"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
        </VALUES>
      </SPEC-OBJECT>
    </SPEC-OBJECTS>
    <SPEC-RELATIONS>
      <SPEC-RELATION IDENTIFIER="rel-1">
        <TYPE><SPEC-RELATION-TYPE-REF>rt-derive</SPEC-RELATION-TYPE-REF></TYPE>
        <SOURCE><SPEC-OBJECT-REF>REQ-11</SPEC-OBJECT-REF></SOURCE>
        <TARGET><SPEC-OBJECT-REF>REQ-10</SPEC-OBJECT-REF></TARGET>
      </SPEC-RELATION>
    </SPEC-RELATIONS>
  </REQ-IF-CONTENT></CORE-CONTENT>
</REQ-IF>`;

describe.runIf(compilerConfigured && examplesPresent)('a source that is imported more than once', () => {
    it('keeps a withdrawn record withdrawn, and its traces, through later imports', async () => {
        await withExample({}, async (_host, root) => {
            write(root, (await importInto(root, V1)).rendered.file, (await importInto(root, V1)).rendered.text);

            // A trace matrix links records and withdraws nothing: it states no population.
            const matrix = await importInto(root, 'from,to,type\nREQ-1,REQ-3,derivesFrom\n', 'trace-matrix');
            expect(matrix.plan.diff.withdrawn).toEqual([]);
            write(root, matrix.rendered.file, matrix.rendered.text);
            expect(await stateOf(root)).toEqual({
                withdrawn: [],
                records: ['imports_reqtool::req1', 'imports_reqtool::req2', 'imports_reqtool::req3'],
                traces: ['derivesFrom:imports_reqtool::req1>imports_reqtool::req3'],
            });

            // An export of elements alone leaves the traces of the last import in place.
            const dropped = await importInto(root, V2);
            write(root, dropped.rendered.file, dropped.rendered.text);
            expect(await stateOf(root)).toMatchObject({
                withdrawn: ['imports_reqtool::req2'],
                traces: ['derivesFrom:imports_reqtool::req1>imports_reqtool::req3'],
            });

            // Importing the same export again changes nothing and does not lose the withdrawn record.
            const again = await importInto(root, V2);
            expect(again.plan.diff.withdrawn).toEqual([]);
            expect(again.plan.diff.added).toEqual([]);
            write(root, again.rendered.file, again.rendered.text);
            expect((await stateOf(root)).withdrawn).toEqual(['imports_reqtool::req2']);

            // The record comes back: no longer withdrawn.
            const back = await importInto(root, V1);
            expect(back.plan.diff.modified.map(m => m.current.id)).toContain('imports_reqtool::req2');
            write(root, back.rendered.file, back.rendered.text);
            expect((await stateOf(root)).withdrawn).toEqual([]);
        });
    }, 240000);
});

describe('reading a source export', () => {
    it('derives a lowerCamelCase name from a source id, never a reserved word', () => {
        expect(deriveElementName('REQ-CS-01')).toBe('reqCs01');
        expect(deriveElementName('4471')).toBe('item4471');
        expect(deriveElementName('Part')).toBe('part'.concat('Record'));
        expect(deriveElementName('a b_c')).toBe('aBC');
    });

    it('gives a record without a revision the same one while its content is the same', () => {
        const record = { name: 'a', kind: 'Requirement', doc: '', attributes: { statement: 'x', status: 'draft' } };
        expect(contentRevision(record)).toBe(contentRevision({ ...record, attributes: { status: 'draft', statement: 'x' } }));
        expect(contentRevision(record)).not.toBe(contentRevision({ ...record, attributes: { statement: 'y' } }));
    });

    it('reads ReqIF records, their text and their traces', () => {
        const result = parseReqIf(REQIF, {
            system: 'reqtool', defaultKind: 'Requirement', constructOf: () => 'requirement',
            kinds: new Set(['Requirement']),
            declaresAttribute: (_kind, attribute) => attribute === 'statement',
            relationTypes: new Set(['derivesFrom']),
        });
        expect(result.errors).toEqual([]);
        expect(result.items.map(e => [e.id, e.name, e.kind, e.source?.identifier, e.source?.revision])).toEqual([
            ['req10', 'Boot time', 'Requirement', 'REQ-10', '2026-09-01T10:00:00Z'],
            ['req11', 'Boot time, cold', 'Requirement', 'REQ-11', '2026-09-02T10:00:00Z'],
        ]);
        // XHTML is plain text, entities decoded, markup dropped; the text is the kind's `statement`.
        expect(result.items[0].attributes['statement']).toBe('The device shall boot in < 5 s & report ready.');
        expect(result.items[0].attributes['verificationMethod']).toBe('Test');
        expect(result.links).toEqual([{ fromId: 'REQ-11', toId: 'REQ-10', type: 'derivesFrom' }]);
    });

    it('rejects a document that is not ReqIF', () => {
        expect(parseReqIf('<html/>', { system: 's', defaultKind: 'K', constructOf: () => 'part' }).errors).toHaveLength(1);
    });

    it('reads a trace matrix by source id', () => {
        const result = parseTraceMatrix('from,to,type\nA-1,B-1,derivesFrom\nA-2,B-1,nonsense\n,B-2,derivesFrom\n', ['derivesFrom']);
        expect(result.links).toEqual([{ fromId: 'A-1', toId: 'B-1', type: 'derivesFrom' }]);
        expect(result.errors).toEqual([
            "Row 3: unknown relationship type 'nonsense'", "Row 4: missing 'from' or 'to'",
        ]);
    });
});

describe.runIf(compilerConfigured && examplesPresent)('a ReqIF import', () => {
    it('writes records and their trace, and says what the kind did not declare', async () => {
        await withExample({}, async (_host, root) => {
            const project = await loadProjectModel({ projectRoot: root, config, cache: false });
            const context = project.registries as unknown as SourceImportContext;
            const records = readSource({ system: 'reqtool', format: 'reqif', text: REQIF, defaultKind: 'Requirement' }, context);
            expect(records.errors).toEqual([]);
            const plan = planSourceImport(project.model, 'reqtool', records);
            const rendered = renderSourceImport(project.model, plan, context, { format: 'reqif', now: NOW });
            expect(rendered.dropped).toEqual(['Requirement.verificationMethod']);
            write(root, rendered.file, rendered.text);

            const after = await loadProjectModel({ projectRoot: root, config, cache: false });
            const element = after.model.elements.get('imports_reqtool::req10');
            expect(element?.attributes['statement']).toBe('The device shall boot in < 5 s & report ready.');
            expect(element?.attributes['externalReference.revision']).toBe('2026-09-01T10:00:00Z');
            // The trace is source-mastered: it carries no baseline, and so is never suspect.
            const trace = after.model.relationships.find(r => r.type === 'derivesFrom' && r.targetId === 'imports_reqtool::req10');
            expect(trace?.sourceId).toBe('imports_reqtool::req11');
            expect(trace?.attributes?.['sourceRevision']).toBeUndefined();
        });
    }, 240000);
});
