// ─── DHF Template Engine ─────────────────────────────────────────────────────
//
// Compiles DHF document templates into Document IR using model data.
// Templates are defined per document type with section generators.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';
import type { MEMOConfig } from '../model/config.js';
import type { DhfDocumentType } from './document-registry.js';
import type { DhfDocument, DhfDocumentSection, DhfBlock, DhfFrontmatter } from './document-ir.js';
import type { DhfConfig } from './dhf-config.js';
import { text, xref, heading, paragraph, table, list, badge, metric, metricGroup, progress, divider } from './document-ir.js';
import { createQueryContext, type QueryContext } from './query-engine.js';
import { DHF_DOCUMENT_TYPES as DHF_DOC_TYPES_REF } from './document-registry.js';

/** Input data for template compilation */
export interface TemplateInput {
    model: MemoModel;
    validation: ValidationResult;
    completeness: CompletenessReport;
    config: MEMOConfig;
    dhfConfig?: DhfConfig;
    documentType: DhfDocumentType;
}

/** Compile a DHF document from model data */
export function compileDocument(input: TemplateInput): DhfDocument {
    const { model, validation, completeness, config, dhfConfig, documentType } = input;
    const ctx = createQueryContext(model, validation, completeness, config);

    const sections = documentType.sections.map(sectionDef => {
        const generator = SECTION_GENERATORS[documentType.id]?.[sectionDef.id]
            || defaultSectionGenerator;
        return generator(sectionDef, documentType, ctx, dhfConfig);
    });

    const totalElements = sections.reduce((sum, s) => sum + (s.elementCount || 0), 0);
    const totalGaps = sections.reduce((sum, s) => sum + (s.gapCount || 0), 0);
    const hasContent = sections.some(s => s.blocks.length > 0);
    const allComplete = sections.every(s => s.status === 'complete' || !sectionIsRequired(documentType, s.id));

    const frontmatter: DhfFrontmatter = {
        documentId: documentType.id,
        title: documentType.title,
        version: dhfConfig?.version || '1.0',
        standards: documentType.standards,
        organization: dhfConfig?.organization,
        project: config.projectName || 'MEMO Project',
        phase: dhfConfig?.phase,
        authors: dhfConfig?.authors,
        approvers: dhfConfig?.approvers,
        generatedAt: new Date().toISOString(),
    };

    return {
        frontmatter,
        sections,
        status: !hasContent ? 'empty' : allComplete ? 'complete' : 'partial',
        totalElements,
        totalGaps,
    };
}

function sectionIsRequired(docType: DhfDocumentType, sectionId: string): boolean {
    return docType.sections.find(s => s.id === sectionId)?.required ?? false;
}

// ─── Section Generators ──────────────────────────────────────────────────────

type SectionGenerator = (
    sectionDef: { id: string; title: string; required: boolean },
    docType: DhfDocumentType,
    ctx: QueryContext,
    dhfConfig?: DhfConfig,
) => DhfDocumentSection;

function defaultSectionGenerator(
    sectionDef: { id: string; title: string; required: boolean },
    docType: DhfDocumentType,
    ctx: QueryContext,
): DhfDocumentSection {
    const elements = ctx.elementsByKinds(docType.relevantKinds);
    const blocks: DhfBlock[] = [];

    if (elements.length > 0) {
        blocks.push(heading(3, sectionDef.title, sectionDef.id));
        blocks.push(paragraph(text(`${elements.length} model elements relevant to this section.`)));

        const rows = elements.slice(0, 100).map(el => [
            [xref(el.id, el.name, el.kind)],
            [text(el.kind)],
            [text(el.layer)],
            [text(el.doc || '—')],
        ]);
        blocks.push(table(['Element', 'Kind', 'Layer', 'Description'], rows));
    }

    return {
        id: sectionDef.id,
        title: sectionDef.title,
        blocks,
        elementCount: elements.length,
        gapCount: 0,
        status: elements.length > 0 ? 'complete' : sectionDef.required ? 'empty' : 'complete',
    };
}

// ─── Risk Management Plan (rmp) ──────────────────────────────────────────────

function rmpScope(sectionDef: any, _docType: any, ctx: QueryContext, dhfConfig?: DhfConfig): DhfDocumentSection {
    const blocks: DhfBlock[] = [
        heading(3, 'Scope', 'scope'),
        paragraph(text(`This Risk Management Plan covers the risk management activities for `),
            text(ctx.projectName, { bold: true }),
            text(` in accordance with ISO 14971:2019.`)),
    ];
    if (dhfConfig?.organization) {
        blocks.push(paragraph(text(`Organization: ${dhfConfig.organization}`)));
    }
    return { id: 'scope', title: 'Scope', blocks, elementCount: 0, gapCount: 0, status: 'complete' };
}

function rmpRiskPolicy(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const hazards = ctx.elementsByKind('Hazard');
    const controls = ctx.elementsByKind('RiskControl');
    const blocks: DhfBlock[] = [
        heading(3, 'Risk Acceptability Policy', 'risk-policy'),
        metricGroup(
            metric('Hazards Identified', hazards.length),
            metric('Risk Controls', controls.length),
            metric('Unmitigated Hazards', ctx.unmitigatedCount()),
        ),
    ];

    if (ctx.unmitigatedCount() > 0) {
        blocks.push(paragraph(
            badge(`${ctx.unmitigatedCount()} unmitigated hazards`, 'error'),
        ));
    } else if (hazards.length > 0) {
        blocks.push(paragraph(badge('All hazards mitigated', 'success')));
    }

    return {
        id: 'risk-policy', title: 'Risk Acceptability Policy', blocks,
        elementCount: hazards.length + controls.length,
        gapCount: ctx.unmitigatedCount(),
        status: ctx.unmitigatedCount() === 0 && hazards.length > 0 ? 'complete' : hazards.length === 0 ? 'empty' : 'partial',
    };
}

function rmpVerification(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const controls = ctx.elementsByKind('RiskControl');
    const blocks: DhfBlock[] = [heading(3, 'Verification of Risk Control Measures', 'verification-activities')];

    if (controls.length > 0) {
        const rows = controls.map(c => {
            const verified = ctx.related(c.id, 'verifies', 'incoming');
            return [
                [xref(c.id, c.name, c.kind)],
                [text(c.doc || '—')],
                [verified.length > 0 ? badge('Verified', 'success') : badge('Unverified', 'warning')],
            ];
        });
        blocks.push(table(['Control', 'Description', 'Verification'], rows));
    }

    const unverified = controls.filter(c => ctx.related(c.id, 'verifies', 'incoming').length === 0);
    return {
        id: 'verification-activities', title: 'Verification of Risk Control Measures', blocks,
        elementCount: controls.length,
        gapCount: unverified.length,
        status: controls.length === 0 ? 'empty' : unverified.length === 0 ? 'complete' : 'partial',
    };
}

// ─── Hazard Analysis Report (har) ────────────────────────────────────────────

function harHazardId(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const hazards = ctx.elementsByKind('Hazard');
    const blocks: DhfBlock[] = [heading(3, 'Hazard Identification', 'hazard-identification')];

    if (hazards.length > 0) {
        const rows = hazards.map(h => {
            const mitigations = ctx.related(h.id, 'mitigates', 'incoming');
            return [
                [xref(h.id, h.name, h.kind)],
                [text(h.doc || '—')],
                [text(h.attributes['severity'] || '—')],
                [mitigations.length > 0
                    ? badge(`${mitigations.length} control(s)`, 'success')
                    : badge('Unmitigated', 'error')],
            ];
        });
        blocks.push(table(['Hazard', 'Description', 'Severity', 'Mitigation'], rows));
    } else {
        blocks.push(paragraph(text('No hazards identified in the model.', { italic: true })));
    }

    return {
        id: 'hazard-identification', title: 'Hazard Identification', blocks,
        elementCount: hazards.length,
        gapCount: ctx.unmitigatedCount(),
        status: hazards.length === 0 ? 'empty' : 'complete',
    };
}

function harRiskControls(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const controls = ctx.elementsByKind('RiskControl');
    const blocks: DhfBlock[] = [heading(3, 'Risk Control Measures', 'risk-controls')];

    if (controls.length > 0) {
        const rows = controls.map(c => {
            const mitigates = ctx.related(c.id, 'mitigates', 'outgoing');
            return [
                [xref(c.id, c.name, c.kind)],
                [text(c.doc || '—')],
                [text(mitigates.map(r => ctx.elementName(r.targetId)).join(', ') || '—')],
            ];
        });
        blocks.push(table(['Control', 'Description', 'Mitigates'], rows));
    }

    return {
        id: 'risk-controls', title: 'Risk Control Measures', blocks,
        elementCount: controls.length, gapCount: 0,
        status: controls.length > 0 ? 'complete' : 'empty',
    };
}

// ─── RTM ─────────────────────────────────────────────────────────────────────

function rtmRequirements(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const reqs = ctx.elementsByKinds(['Requirement', 'Requirement', 'DesignInput']);
    const blocks: DhfBlock[] = [heading(3, 'Requirements Inventory', 'requirements-list')];

    if (reqs.length > 0) {
        blocks.push(metricGroup(
            metric('Total Requirements', reqs.length),
            metric('System Requirements', ctx.elementsByKind('Requirement').length),
            metric('Software Requirements', ctx.elementsByKind('Requirement').length),
        ));
        const rows = reqs.map(r => [
            [xref(r.id, r.name, r.kind)],
            [text(r.kind)],
            [text(r.doc || '—')],
        ]);
        blocks.push(table(['Requirement', 'Type', 'Description'], rows));
    }

    return {
        id: 'requirements-list', title: 'Requirements Inventory', blocks,
        elementCount: reqs.length, gapCount: 0,
        status: reqs.length > 0 ? 'complete' : 'empty',
    };
}

function rtmCoverage(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const reqs = ctx.elementsByKinds(['Requirement', 'Requirement']);
    const blocks: DhfBlock[] = [heading(3, 'Coverage Summary', 'coverage-summary')];

    let traced = 0;
    let verified = 0;
    for (const r of reqs) {
        const traces = ctx.related(r.id, 'traceTo', 'outgoing')
            .concat(ctx.related(r.id, 'satisfies', 'incoming'));
        if (traces.length > 0) traced++;
        const verifications = ctx.related(r.id, 'verifies', 'incoming');
        if (verifications.length > 0) verified++;
    }

    const total = reqs.length || 1;
    blocks.push(metricGroup(
        metric('Trace Coverage', `${Math.round(traced / total * 100)}%`,
            { variant: traced === reqs.length ? 'success' : 'warning' }),
        metric('Verification Coverage', `${Math.round(verified / total * 100)}%`,
            { variant: verified === reqs.length ? 'success' : 'warning' }),
    ));
    blocks.push(progress('Trace Coverage', traced, reqs.length));
    blocks.push(progress('Verification Coverage', verified, reqs.length));

    const gaps = reqs.length - traced;
    return {
        id: 'coverage-summary', title: 'Coverage Summary', blocks,
        elementCount: reqs.length, gapCount: gaps,
        status: gaps === 0 && reqs.length > 0 ? 'complete' : reqs.length === 0 ? 'empty' : 'partial',
    };
}

function rtmGaps(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const reqs = ctx.elementsByKinds(['Requirement', 'Requirement']);
    const blocks: DhfBlock[] = [heading(3, 'Traceability Gaps', 'gaps')];

    const untraced = reqs.filter(r => {
        const traces = ctx.related(r.id, 'traceTo', 'outgoing')
            .concat(ctx.related(r.id, 'satisfies', 'incoming'));
        return traces.length === 0;
    });

    if (untraced.length > 0) {
        const rows = untraced.map(r => [
            [xref(r.id, r.name, r.kind)],
            [text(r.kind)],
            [badge('No trace', 'error')],
        ]);
        blocks.push(table(['Requirement', 'Type', 'Issue'], rows));
    } else if (reqs.length > 0) {
        blocks.push(paragraph(badge('All requirements traced', 'success')));
    }

    return {
        id: 'gaps', title: 'Traceability Gaps', blocks,
        elementCount: untraced.length, gapCount: untraced.length,
        status: untraced.length === 0 ? 'complete' : 'partial',
    };
}

// ─── SAD ─────────────────────────────────────────────────────────────────────

function sadOverview(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const blocks: DhfBlock[] = [
        heading(3, 'System Overview', 'system-overview'),
        paragraph(text(`${ctx.projectName} system architecture contains:`)),
        metricGroup(
            metric('Total Elements', ctx.totalElements()),
            metric('Relationships', ctx.totalRelationships()),
            metric('Architecture Layers', ctx.layerCount()),
            metric('Completeness', `${ctx.overallCompleteness()}%`),
        ),
    ];

    // Layer breakdown
    const layerData = ctx.layerSummary();
    if (layerData.length > 0) {
        const rows = layerData.map(l => [
            [text(l.label)],
            [text(String(l.count))],
            [text(`${l.completeness}%`)],
        ]);
        blocks.push(table(['Layer', 'Elements', 'Completeness'], rows));
    }

    return {
        id: 'system-overview', title: 'System Overview', blocks,
        elementCount: ctx.totalElements(), gapCount: 0, status: 'complete',
    };
}

// ─── SOUP ────────────────────────────────────────────────────────────────────

function soupInventory(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const soups = ctx.elementsByKind('SOUPComponent');
    const blocks: DhfBlock[] = [heading(3, 'SOUP Component Inventory', 'soup-inventory')];

    if (soups.length > 0) {
        const rows = soups.map(s => [
            [xref(s.id, s.name, s.kind)],
            [text(s.attributes['version'] || '—')],
            [text(s.attributes['manufacturer'] || '—')],
            [text(s.doc || '—')],
        ]);
        blocks.push(table(['Component', 'Version', 'Manufacturer', 'Purpose'], rows));
    } else {
        blocks.push(paragraph(text('No SOUP components identified.', { italic: true })));
    }

    return {
        id: 'soup-inventory', title: 'SOUP Component Inventory', blocks,
        elementCount: soups.length, gapCount: 0,
        status: soups.length > 0 ? 'complete' : 'empty',
    };
}

// ─── DHF Index ───────────────────────────────────────────────────────────────

function dhfIndexDocList(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    // Import statically at top — re-reference here for clarity
    const docTypes = DHF_DOC_TYPES_REF;
    const blocks: DhfBlock[] = [heading(3, 'Document Inventory', 'document-list')];

    const rows = docTypes.filter(d => d.id !== 'dhf-index').map(d => {
        const relevantElements = ctx.elementsByKinds(d.relevantKinds);
        return [
            [text(d.title, { bold: true })],
            [text(d.id, { code: true })],
            [text(d.standards.join(', '))],
            [relevantElements.length > 0 ? badge(`${relevantElements.length} elements`, 'info') : badge('No data', 'neutral')],
        ];
    });
    blocks.push(table(['Document', 'ID', 'Standards', 'Data Status'], rows));

    return {
        id: 'document-list', title: 'Document Inventory', blocks,
        elementCount: 0, gapCount: 0, status: 'complete',
    };
}

function dhfIndexStatus(sectionDef: any, _docType: any, ctx: QueryContext): DhfDocumentSection {
    const blocks: DhfBlock[] = [
        heading(3, 'Status Summary', 'status-summary'),
        metricGroup(
            metric('Total Elements', ctx.totalElements()),
            metric('Total Relationships', ctx.totalRelationships()),
            metric('Overall Completeness', `${ctx.overallCompleteness()}%`,
                { variant: ctx.overallCompleteness() >= 80 ? 'success' : ctx.overallCompleteness() >= 50 ? 'warning' : 'error' }),
            metric('Validation Errors', ctx.errorCount(), { variant: ctx.errorCount() === 0 ? 'success' : 'error' }),
            metric('Warnings', ctx.warningCount(), { variant: ctx.warningCount() === 0 ? 'success' : 'warning' }),
        ),
    ];

    return {
        id: 'status-summary', title: 'Status Summary', blocks,
        elementCount: 0, gapCount: ctx.errorCount(), status: ctx.errorCount() === 0 ? 'complete' : 'partial',
    };
}

// ─── Section Generator Registry ──────────────────────────────────────────────

const SECTION_GENERATORS: Record<string, Record<string, SectionGenerator>> = {
    rmp: {
        'scope': rmpScope,
        'risk-policy': rmpRiskPolicy,
        'verification-activities': rmpVerification,
    },
    har: {
        'hazard-identification': harHazardId,
        'risk-controls': harRiskControls,
    },
    rtm: {
        'requirements-list': rtmRequirements,
        'coverage-summary': rtmCoverage,
        'gaps': rtmGaps,
    },
    sad: {
        'system-overview': sadOverview,
    },
    soup: {
        'soup-inventory': soupInventory,
    },
    'dhf-index': {
        'document-list': dhfIndexDocList,
        'status-summary': dhfIndexStatus,
    },
};
