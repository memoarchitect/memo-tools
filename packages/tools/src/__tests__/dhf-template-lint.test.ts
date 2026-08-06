// DHF templates are prose with fenced query blocks, and nothing ever checked
// those blocks. A `kind:` that names no definition, a `layer ==` comparing
// against a layer id the ontology never had, a `columns:` listing attributes
// no kind declares — each renders as a plausible, empty, or dash-filled table
// in a regulated document, and none of them failed a build. These tests pin
// the rules that turn each into an error.

import { describe, it, expect } from 'vitest';
import { lintTemplateContent, type LintFinding } from '../dhf/template-lint.js';
import { KindRegistry } from '../model/kind-registry.js';

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

const ONTOLOGY = { kindRegistry: stubRegistry(), knownLayers: new Set(['safety_risk', 'implementation', 'core']) };

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
