// ─── The model for an agent without MCP ──────────────────────────────────────
//
// A static viewer is the model shipped as a page. Beside it, `memo-architect build` writes the same
// model as text an AI agent reads directly: `llms.txt`, the index the llms.txt convention defines, and
// `model.md`, every element by kind with its documentation, attributes, relationships and findings.
// Both are written from the snapshot the viewer embeds, so the page and the text cannot disagree, and
// both say the SysML source is the record.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModelDTO } from '../model/semantic.js';
import type { CompletenessReport, ValidationResult } from '../validator/types.js';

export interface AgentExportInput {
    name: string;
    model: MemoModelDTO;
    validation: ValidationResult;
    completeness: CompletenessReport;
}

/** One line of text, so a value cannot break the markdown around it. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function label(element: MemoElement | undefined, id: string): string {
    if (!element) return `\`${id}\``;
    return `${oneLine(element.name)}${element.shortId ? ` (${element.shortId})` : ''}`;
}

function byKind(model: MemoModelDTO): [string, MemoElement[]][] {
    const groups = new Map<string, MemoElement[]>();
    for (const element of Object.values(model.elements)) {
        const list = groups.get(element.kind) ?? [];
        list.push(element);
        groups.set(element.kind, list);
    }
    for (const list of groups.values()) list.sort((a, b) => (a.shortId ?? a.id).localeCompare(b.shortId ?? b.id));
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

function kindLabel(model: MemoModelDTO, kind: string): string {
    return model.registries?.kinds.find(definition => definition.name === kind)?.label ?? kind;
}

export function agentModelMarkdown(input: AgentExportInput): string {
    const { model, validation, completeness } = input;
    const errors = validation.violations.filter(v => v.severity === 'error');
    const warnings = validation.violations.filter(v => v.severity === 'warning');
    const outgoing = new Map<string, typeof model.relationships>();
    const incoming = new Map<string, typeof model.relationships>();
    for (const rel of model.relationships) {
        outgoing.set(rel.sourceId, [...(outgoing.get(rel.sourceId) ?? []), rel]);
        incoming.set(rel.targetId, [...(incoming.get(rel.targetId) ?? []), rel]);
    }
    const findings = new Map<string, typeof validation.violations>();
    for (const violation of validation.violations) {
        findings.set(violation.elementId, [...(findings.get(violation.elementId) ?? []), violation]);
    }

    const lines: string[] = [
        `# ${input.name}`,
        '',
        'The MEMO model of a medical device, as text. The SysML v2 source is the record; this file is generated from it and is not edited.',
        '',
        '## Summary',
        '',
        `- Elements: ${Object.keys(model.elements).length}`,
        `- Relationships: ${model.relationships.length}`,
        `- Completeness: ${completeness.overall}%`,
        `- Validation: ${errors.length} errors, ${warnings.length} warnings`,
        '',
    ];

    if (errors.length + warnings.length > 0) {
        lines.push('## Findings', '');
        for (const violation of [...errors, ...warnings]) {
            lines.push(`- **${violation.severity}** ${violation.ruleId} on ${label(model.elements[violation.elementId], violation.elementId)}: ${oneLine(violation.description)}`);
        }
        lines.push('');
    }

    lines.push('## Elements by kind', '');
    for (const [kind, elements] of byKind(model)) {
        lines.push(`### ${kindLabel(model, kind)} (${elements.length})`, '');
        for (const element of elements) {
            lines.push(`#### ${label(element, element.id)}`, '');
            lines.push(`- Id: \`${element.id}\``);
            lines.push(`- Kind: ${element.kind}${element.layer ? `, layer ${element.layer}` : ''}`);
            if (element.file) lines.push(`- Source: \`${element.file}\``);
            const attributes = Object.entries(element.attributes ?? {}).filter(([, value]) => value !== undefined && value !== '');
            for (const [name, value] of attributes) lines.push(`- ${name}: ${oneLine(String(value))}`);
            for (const rel of outgoing.get(element.id) ?? []) lines.push(`- ${rel.type} → ${label(model.elements[rel.targetId], rel.targetId)}`);
            for (const rel of incoming.get(element.id) ?? []) lines.push(`- ← ${rel.type} from ${label(model.elements[rel.sourceId], rel.sourceId)}`);
            for (const violation of findings.get(element.id) ?? []) lines.push(`- Finding (${violation.severity}, ${violation.ruleId}): ${oneLine(violation.description)}`);
            if (element.doc) lines.push('', oneLine(element.doc));
            lines.push('');
        }
    }
    return `${lines.join('\n').trimEnd()}\n`;
}

export function agentIndex(input: AgentExportInput): string {
    const { model } = input;
    const kinds = byKind(model);
    return [
        `# ${input.name}`,
        '',
        `> The MEMO model of a medical device: ${Object.keys(model.elements).length} elements and ${model.relationships.length} relationships in SysML v2. The SysML source is the record; these files are generated from it.`,
        '',
        '## Model',
        '',
        '- [Model as text](model.md): every element by kind, with its documentation, attributes, relationships and validation findings',
        '- [Viewer](index.html): the same model in MEMO Architect, read-only',
        '',
        '## Kinds',
        '',
        ...kinds.map(([kind, elements]) => {
            const name = kindLabel(model, kind);
            return `- ${name === kind ? `\`${kind}\`` : `${name} (\`${kind}\`)`}: ${elements.length}`;
        }),
        '',
    ].join('\n');
}
