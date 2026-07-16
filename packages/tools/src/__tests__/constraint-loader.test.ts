import { describe, it, expect } from 'vitest';
import { type LangiumDocument, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { collectNativeConstraints } from '../validator/constraint-loader.js';
import { evaluateConstraintNode } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── EE-3: ontology constraint def loader ─────────────────────────────────────
// collectNativeConstraints discovers native `constraint def` bodies (the EE-3
// replacement for the proprietary ConsistencyRule predicate-attribute parts) and
// compiles each into an evaluator AST with its rule metadata.

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

async function parseDoc(src: string): Promise<ParsedDocument> {
    const doc: LangiumDocument<Model> = await parse(src);
    const errors = doc.parseResult.lexerErrors.concat(doc.parseResult.parserErrors as any[]);
    if (errors.length > 0) {
        throw new Error(`Parse errors:\n${errors.map((e: any) => e.message).join('\n')}`);
    }
    return { document: doc, filePath: 'test.sysml' } as ParsedDocument;
}

async function load(src: string) {
    return collectNativeConstraints([await parseDoc(src)]);
}

// ─── Test model builder (mirrors constraint-eval.test.ts) ─────────────────────

let _id = 0;
function elem(kind: string, name: string, attributes: Record<string, string> = {}): MemoElement {
    return { id: `${kind}-${++_id}`, name, kind, layer: 'test', attributes } as MemoElement;
}
interface RelSpec { type: string; from: string; to: string; }
function buildModel(elements: MemoElement[], rels: RelSpec[] = []): MemoModel {
    const byId = new Map(elements.map((e) => [e.id, e]));
    const byKind = new Map<string, MemoElement[]>();
    for (const e of elements) {
        const list = byKind.get(e.kind) ?? [];
        list.push(e);
        byKind.set(e.kind, list);
    }
    const relationships: MemoRelationship[] = rels.map((r, i) => ({
        id: `rel-${i}`, type: r.type, sourceId: r.from, targetId: r.to,
    } as MemoRelationship));
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    for (const r of relationships) {
        if (!outgoing.has(r.sourceId)) outgoing.set(r.sourceId, []);
        outgoing.get(r.sourceId)!.push(r);
        if (!incoming.has(r.targetId)) incoming.set(r.targetId, []);
        incoming.get(r.targetId)!.push(r);
        if (!relationshipsByType.has(r.type)) relationshipsByType.set(r.type, []);
        relationshipsByType.get(r.type)!.push(r);
    }
    return { elements: byId, elementsByKind: byKind, relationships, relationshipsByType, outgoing, incoming } as MemoModel;
}

describe('collectNativeConstraints', () => {
    it('extracts metadata and compiles the require constraint body', async () => {
        const constraints = await load(`
            package P {
                constraint def hazardMitigationRule {
                    attribute id = "CR-MED-001";
                    attribute appliesTo = "Hazard";
                    attribute severity = RuleSeverityKind::error;
                    attribute rationaleText = "Every hazard must be mitigated.";
                    require constraint { mitigates->size() >= 1 }
                }
            }
        `);
        expect(constraints).toHaveLength(1);
        const c = constraints[0];
        expect(c.id).toBe('CR-MED-001');
        expect(c.appliesToKind).toBe('Hazard');
        expect(c.severity).toBe('error');
        expect(c.description).toBe('Every hazard must be mitigated.');
        expect(c.ast).toEqual({
            kind: 'cmp', op: '>=',
            left: { kind: 'method', target: { kind: 'feature', root: 'current', segments: ['mitigates'] }, name: 'size' },
            right: { kind: 'int', value: 1 },
        });
    });

    it('reads the severity enum, defaulting to warning when absent', async () => {
        const [a] = await load(`package P { constraint def R {
            attribute id = "A"; attribute appliesTo = "X";
            require constraint { foo->notEmpty() } } }`);
        expect(a.severity).toBe('warning');
    });

    it('skips defs with no require/assert body (metadata-only coverage/lifecycle rules)', async () => {
        const constraints = await load(`
            package P {
                constraint def coverageOnly {
                    attribute id = "COV-1";
                    attribute appliesTo = "Hazard";
                    attribute standard = "ISO 14971";
                }
            }
        `);
        expect(constraints).toHaveLength(0);
    });

    it('skips defs without an id attribute', async () => {
        const constraints = await load(`package P { constraint def Anon {
            require constraint { foo->notEmpty() } } }`);
        expect(constraints).toHaveLength(0);
    });

    it('de-duplicates by rule id across document sets', async () => {
        // The same ontology file can appear in more than one document set (ontology
        // load + project parse); a rule id is unique so it must not double-count.
        const doc = await parseDoc(`
            package P {
                constraint def hazardMitigationRule {
                    attribute id = "CR-MED-001";
                    attribute appliesTo = "Hazard";
                    require constraint { mitigates->size() >= 1 }
                }
            }
        `);
        const constraints = collectNativeConstraints([doc, doc]);
        expect(constraints).toHaveLength(1);
        expect(constraints[0].id).toBe('CR-MED-001');
    });
});

describe('native constraint evaluation (EE-3 rule semantics)', () => {
    it('requireRelationship: flags subjects missing the navigation', async () => {
        const h1 = elem('Hazard', 'H1');                 // unmitigated → violation
        const h2 = elem('Hazard', 'H2');                 // mitigated → ok
        const rc = elem('RiskControl', 'RC1');
        const m = buildModel([h1, h2, rc], [{ type: 'mitigates', from: h2.id, to: rc.id }]);

        const [native] = await load(`package P { constraint def hazardMitigationRule {
            attribute id = "CR-MED-001"; attribute appliesTo = "Hazard";
            attribute severity = RuleSeverityKind::error;
            attribute rationaleText = "hazard needs mitigation";
            require constraint { mitigates->size() >= 1 } } }`);
        const nativeViolations = evaluateConstraintNode(native, native.ast, m);

        expect(nativeViolations).toHaveLength(1);
        expect(nativeViolations[0].elementName).toBe('H1');
        expect(nativeViolations[0].severity).toBe('error');
    });

    it('requireAttribute: native attributes.X != "" flags empty attributes', async () => {
        const ok = elem('SoftwareComponent', 'SC1', { safetyClass: 'C' });
        const bad = elem('SoftwareComponent', 'SC2', {});
        const m = buildModel([ok, bad]);

        const [native] = await load(`package P { constraint def swSafety {
            attribute id = "CR-MED-020"; attribute appliesTo = "SoftwareComponent";
            attribute severity = RuleSeverityKind::error;
            require constraint { attributes.safetyClass != "" } } }`);
        const nativeViolations = evaluateConstraintNode(native, native.ast, m);

        expect(nativeViolations).toHaveLength(1);
        expect(nativeViolations[0].elementName).toBe('SC2');
    });
});
