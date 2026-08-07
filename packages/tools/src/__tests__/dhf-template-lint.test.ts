// DHF templates are prose with fenced query blocks, and nothing ever checked
// those blocks. A `kind:` that names no definition, a `layer ==` comparing
// against a layer id the ontology never had, a `columns:` listing attributes
// no kind declares — each renders as a plausible, empty, or dash-filled table
// in a regulated document, and none of them failed a build. These tests pin
// the rules that turn each into an error.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintTemplateContent, type LintFinding } from '../dhf/template-lint.js';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const GOOD_FRONTMATTER = [
    '---',
    'id: fmea',
    'title: Failure Mode and Effects Analysis',
    'standard: IEC 60812:2018',
    'clauses: ["5", "6"]',
    'required_for: ["CE"]',
    '---',
    '',
].join('\n');

function template(...blocks: string[]): string {
    return GOOD_FRONTMATTER + blocks.join('\n\n');
}

function query(...lines: string[]): string {
    return ['```memo-query', ...lines, '```'].join('\n');
}

function lint(raw: string, options = {}): LintFinding[] {
    return lintTemplateContent('iso-14971/fmea', '/tmp/fmea.md', raw, options);
}

function rules(findings: LintFinding[]): string[] {
    return findings.map(f => f.rule);
}

/** A registry with one concrete kind, one abstract kind, and a supertype chain. */
function stubRegistry(): KindRegistry {
    const registry = new KindRegistry();
    (registry as unknown as { entries: () => unknown[] }).entries = () => ([
        { name: 'FailureMode', label: 'Failure Mode', layer: 'safety_risk', sysmlConstruct: 'item', isAbstract: false },
        { name: 'MemoPart', label: 'Memo Part', layer: 'core', sysmlConstruct: 'part', isAbstract: true },
        { name: 'SoftwareItem', label: 'Software Item', layer: 'implementation', sysmlConstruct: 'part', isAbstract: true },
    ]);
    return registry;
}

/** A registry with one concrete relation carrying an attribute, and one abstract. */
function stubRelationshipRegistry(): RelationshipRegistry {
    const registry = new RelationshipRegistry();
    registry.register({
        sysmlName: 'MemoRelationship', name: 'memoRelationship', label: 'Memo Relationship',
        layer: 'core', isAbstract: true, ends: [], attributes: ['linkStatus'],
    });
    registry.register({
        sysmlName: 'TracesToDocument', name: 'tracesToDocument', label: 'Traces To Document',
        layer: 'artifacts', superType: 'MemoRelationship', ends: [], attributes: ['sectionReference'],
    });
    return registry;
}

const ONTOLOGY = {
    kindRegistry: stubRegistry(),
    relationshipRegistry: stubRelationshipRegistry(),
    knownLayers: new Set(['safety_risk', 'implementation', 'core']),
};

// ─── Frontmatter ─────────────────────────────────────────────────────────────

describe('frontmatter rules', () => {
    it('requires the fields a standards matrix consumes', () => {
        const raw = ['---', 'id: fmea', 'title: FMEA', '---', ''].join('\n');
        const findings = lint(raw);
        const missing = findings.filter(f => f.rule === 'frontmatter-required').map(f => f.message);
        expect(missing).toHaveLength(3);
        expect(missing.join(' ')).toMatch(/standard/);
        expect(missing.join(' ')).toMatch(/clauses/);
        expect(missing.join(' ')).toMatch(/required_for/);
    });

    it('treats an empty clauses list as missing', () => {
        const raw = GOOD_FRONTMATTER.replace('clauses: ["5", "6"]', 'clauses: []');
        expect(rules(lint(raw))).toContain('frontmatter-required');
    });

    it('rejects a slash-joined pair of standards', () => {
        const raw = GOOD_FRONTMATTER.replace('standard: IEC 60812:2018', 'standard: IEC 60601 / IEC 62304');
        expect(rules(lint(raw))).toContain('frontmatter-one-standard');
    });

    it('accepts complete frontmatter with no query blocks', () => {
        expect(lint(GOOD_FRONTMATTER)).toEqual([]);
    });

    it('does not demand frontmatter of shared snippets', () => {
        const findings = lintTemplateContent('shared/snippets/approval-block', '/tmp/x.md', '## Approval\n');
        expect(findings).toEqual([]);
    });

    // Snippets list under their own directory name, so the id is
    // `snippets/approval-block`, not `shared/snippets/approval-block`. Matching
    // only the `shared/` prefix reported all four shipped snippets as missing
    // every required key.
    it('does not demand frontmatter of a snippet listed under snippets/', () => {
        const findings = lintTemplateContent('snippets/approval-block', '/tmp/x.md', '## Approval\n');
        expect(findings).toEqual([]);
    });

    // "ISO/IEC/IEEE 42010:2022" is one standard from a joint committee, not
    // three. The separator that means "two designations" is the space.
    it('accepts a single designation containing slashes', () => {
        const raw = GOOD_FRONTMATTER.replace('standard: IEC 60812:2018', 'standard: ISO/IEC/IEEE 42010:2022');
        expect(rules(lint(raw))).not.toContain('frontmatter-one-standard');
    });
});

// ─── Enum values ─────────────────────────────────────────────────────────────

describe('unknown-enum-value', () => {
    // Comparing an enum attribute against a value the enum does not declare
    // matches nothing and renders the `empty:` message — a section that
    // silently vanishes from a regulated document. This needs a real source
    // file, because both the attribute's type and the enum's members are read
    // from the ontology rather than from a table in the lint.
    let dir: string;
    let enumRegistry: { kindRegistry: KindRegistry };

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'memo-lint-enum-'));
        const file = join(dir, 'reqs.sysml');
        writeFileSync(file, [
            'package memo_assurance_requirements {',
            '    enum def RequirementKind { enum system; enum software; enum hardware; }',
            '    requirement def Requirement specializes VerifiableElement {',
            '        attribute requirementKind : RequirementKind;',
            '        attribute statement : String;',
            '    }',
            '}',
            '',
        ].join('\n'));

        const registry = new KindRegistry();
        (registry as unknown as { entries: () => unknown[] }).entries = () => ([
            { name: 'Requirement', label: 'Requirement', layer: 'requirements', sysmlConstruct: 'requirement def', isAbstract: false, sourceFile: file },
            { name: 'RequirementKind', label: 'RequirementKind', layer: 'requirements', sysmlConstruct: 'enum def', sourceFile: file },
        ]);
        enumRegistry = { kindRegistry: registry };
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('rejects a value the enum does not declare', () => {
        const raw = template(query('kind: Requirement', 'where: requirementKind == "sofware"'));
        const findings = lint(raw, enumRegistry);
        expect(rules(findings)).toContain('unknown-enum-value');
        expect(findings.find(f => f.rule === 'unknown-enum-value')!.message)
            .toMatch(/hardware, software, system/);
    });

    // The model stores the qualified reference, so that is the spelling.
    it('accepts a fully qualified member', () => {
        const raw = template(query('kind: Requirement', 'where: requirementKind == "RequirementKind::software"'));
        expect(lint(raw, enumRegistry)).toEqual([]);
    });

    // One value, one spelling. The bare name is a real member, so it is not a
    // typo — it is the wrong spelling, and it selects nothing at runtime.
    it('rejects a real member written without its enum, and names the fix', () => {
        const raw = template(query('kind: Requirement', 'where: requirementKind == "software"'));
        const findings = lint(raw, enumRegistry);
        expect(rules(findings)).toContain('unqualified-enum-value');
        expect(rules(findings)).not.toContain('unknown-enum-value');
        expect(findings[0].message).toMatch(/write `requirementKind == "RequirementKind::software"`/);
    });

    it('rejects the bare form on != as well', () => {
        const raw = template(query('kind: Requirement', 'where: requirementKind != "hardware"'));
        expect(rules(lint(raw, enumRegistry))).toContain('unqualified-enum-value');
    });

    // `contains` is a substring test by construction, so the qualification rule
    // does not apply to it — only the "is this a member at all" check does.
    it('checks contains against the member list without demanding qualification', () => {
        const good = template(query('kind: Requirement', 'where: requirementKind contains "soft"'));
        expect(lint(good, enumRegistry)).toEqual([]);
        const bad = template(query('kind: Requirement', 'where: requirementKind contains "firmware"'));
        expect(rules(lint(bad, enumRegistry))).toContain('unknown-enum-value');
    });

    it('says nothing about a non-enum attribute', () => {
        const raw = template(query('kind: Requirement', 'where: statement == "anything at all"'));
        expect(rules(lint(raw, enumRegistry))).not.toContain('unknown-enum-value');
    });
});

// ─── Parked queries ──────────────────────────────────────────────────────────

describe('commented-out blocks', () => {
    // A template may park a query the engine cannot run yet behind an HTML
    // comment and a visible TODO. That block renders nothing, so linting it
    // would make "park it" impossible and force the alternative: a table that
    // renders empty and reads like a clean audit.
    const parked = template([
        '<!-- _[TODO: requires `select: relationships`]_',
        '```memo-query',
        'kind: ConformsTo',
        'where: target.clauseNumber starts with "5"',
        'columns: source as Element, target.clauseNumber as Clause',
        '```',
        '-->',
        '',
        '_[TODO: requires `select: relationships`]_',
    ].join('\n'));

    it('reports nothing for a query parked inside an HTML comment', () => {
        expect(lint(parked, ONTOLOGY)).toEqual([]);
    });

    it('still reports live blocks beside a parked one', () => {
        const raw = parked + '\n\n' + query('kind: NotAKind');
        const findings = lint(raw, ONTOLOGY);
        expect(rules(findings)).toEqual(['unknown-kind']);
        // Block numbering counts live blocks only, so the number in the message
        // matches what a reader counts in the rendered document.
        expect(findings[0].block).toBe(1);
    });
});

// ─── Traversal ───────────────────────────────────────────────────────────────

describe('columns under traverse', () => {
    // With `traverse:`, `kind:` names the SEEDS; the rows are whatever the
    // relationship lands on. Checking columns against the seeds rejects every
    // correct traversal query — and most compliance queries reach the
    // hardware/software boundary by relationship, not by kind.
    it('does not check columns against the seed kind when traversing', () => {
        const raw = template(query(
            'kind: FailureMode',
            'traverse: outgoing hasFailureMode',
            'columns: name, effect, severityRating',
        ));
        expect(rules(lint(raw, ONTOLOGY))).not.toContain('unknown-column');
    });

    it('still checks columns when there is no traverse', () => {
        const raw = template(query('kind: FailureMode', 'columns: name, notAnAttribute'));
        expect(rules(lint(raw, ONTOLOGY))).toContain('unknown-column');
    });
});

// ─── Text matching ───────────────────────────────────────────────────────────

describe('no-text-matching', () => {
    it('rejects selecting compliance content by name substring', () => {
        const raw = template(query('kind: FailureMode', 'where: name contains "emc"'));
        const findings = lint(raw, ONTOLOGY);
        expect(rules(findings)).toContain('no-text-matching');
        expect(findings.find(f => f.rule === 'no-text-matching')!.message).toMatch(/traversing a relationship/);
    });

    it('rejects selecting by doc substring too', () => {
        const raw = template(query('kind: FailureMode', 'where: doc contains "shall"'));
        expect(rules(lint(raw, ONTOLOGY))).toContain('no-text-matching');
    });

    it('allows contains on a non-text field', () => {
        const raw = template(query('kind: FailureMode', 'where: failureModeKind contains "drift"'));
        expect(rules(lint(raw, ONTOLOGY))).not.toContain('no-text-matching');
    });
});

// ─── Ontology resolution ─────────────────────────────────────────────────────

describe('ontology-aware rules', () => {
    it('rejects a kind that is not in the ontology', () => {
        const raw = template(query('kind: Activity'));
        const findings = lint(raw, ONTOLOGY);
        expect(rules(findings)).toContain('unknown-kind');
        expect(findings[0].message).toMatch(/Activity/);
    });

    it('warns that an abstract kind can only ever return nothing', () => {
        const raw = template(query('kind: SoftwareItem'));
        const findings = lint(raw, ONTOLOGY);
        const warning = findings.find(f => f.rule === 'abstract-kind');
        expect(warning?.severity).toBe('warning');
    });

    it('rejects a layer id the ontology does not have', () => {
        const raw = template(query('kind: FailureMode', 'where: layer == "hardware"'));
        const findings = lint(raw, ONTOLOGY);
        const finding = findings.find(f => f.rule === 'unknown-layer');
        expect(finding).toBeDefined();
        expect(finding!.message).toMatch(/safety_risk/);
    });

    it('accepts a layer id the ontology does have', () => {
        const raw = template(query('kind: FailureMode', 'where: layer == "safety_risk"'));
        expect(rules(lint(raw, ONTOLOGY))).not.toContain('unknown-layer');
    });

    it('skips ontology rules entirely in structural mode', () => {
        const raw = template(query('kind: Activity', 'where: layer == "hardware"'));
        const found = rules(lint(raw));
        expect(found).not.toContain('unknown-kind');
        expect(found).not.toContain('unknown-layer');
    });
});

// ─── Query executability (delegated to validateQuerySpec) ────────────────────

describe('query executability', () => {
    it('rejects a compound where, which used to return every element', () => {
        const raw = template(query('kind: FailureMode', 'where: layer == "safety_risk" and name contains "x"'));
        expect(rules(lint(raw))).toContain('query-unexecutable');
    });

    it('rejects a sort direction, which was silently ignored', () => {
        const raw = template(query('kind: FailureMode', 'sort: severity desc'));
        expect(rules(lint(raw))).toContain('query-unexecutable');
    });

    it('reports the query block number so the finding is locatable', () => {
        const raw = template(
            query('kind: FailureMode'),
            query('kind: FailureMode', 'sort: severity desc'),
        );
        const finding = lint(raw).find(f => f.rule === 'query-unexecutable');
        expect(finding?.block).toBe(2);
    });

    it('flags a memo-query block that is not valid YAML', () => {
        const raw = template(query(':::not: [valid'));
        expect(rules(lint(raw))).toContain('query-invalid-yaml');
    });
});

// ─── select: relationships ───────────────────────────────────────────────────
//
// A relationship query's `kind:` names a connection def, not an element
// definition, so the element-shaped rules would report every correct one. What
// stays checkable is the type itself and the flat columns; a dotted path is a
// fact about the project's links, not about the template, so it is left alone.

describe('relationship query rules', () => {
    it('accepts a relationship query with dotted endpoint columns', () => {
        const raw = template(query(
            'select: relationships',
            'kind: tracesToDocument',
            'where: source.package == "memo_artifacts_standards_iec_62304"',
            'columns: source.clauseNumber, target, sectionReference',
            'sort: source.clauseNumber',
        ));
        expect(rules(lint(raw, ONTOLOGY))).toEqual([]);
    });

    it('rejects a type no connection def declares', () => {
        const raw = template(query('select: relationships', 'kind: conformsToClause'));
        expect(rules(lint(raw, ONTOLOGY))).toContain('unknown-relationship-type');
    });

    it('warns on an abstract relationship type, which nothing instantiates', () => {
        const raw = template(query('select: relationships', 'kind: memoRelationship'));
        expect(rules(lint(raw, ONTOLOGY))).toContain('abstract-relationship-type');
    });

    it('reports the PascalCase spelling, which selects nothing at runtime', () => {
        const raw = template(query('select: relationships', 'kind: TracesToDocument'));
        const findings = lint(raw, ONTOLOGY);
        expect(rules(findings)).toEqual(['query-unexecutable']);
        expect(findings[0].message).toMatch(/use `tracesToDocument`/);
    });

    // `doc` is an element field. On a link it renders "—" in every row, and the
    // fix is to say which end you meant.
    it('rejects an element field written flat on a relationship row', () => {
        const raw = template(query('select: relationships', 'kind: tracesToDocument', 'columns: source, target, doc'));
        const findings = lint(raw, ONTOLOGY);
        expect(rules(findings)).toContain('unknown-column');
        expect(findings[0].message).toMatch(/write `source\.doc` or `target\.doc`/);
    });

    it('accepts an attribute the connection def declares', () => {
        const raw = template(query('select: relationships', 'kind: tracesToDocument', 'columns: source, sectionReference'));
        expect(rules(lint(raw, ONTOLOGY))).toEqual([]);
    });

    it('still bans text matching one level out, on an endpoint field', () => {
        const raw = template(query('select: relationships', 'kind: tracesToDocument', 'where: target.name contains "emc"'));
        expect(rules(lint(raw, ONTOLOGY))).toContain('no-text-matching');
    });
});
