// ─── DHF Snapshot & Redline ──────────────────────────────────────────────────
//
// Snapshot captures a point-in-time summary of a DHF document.
// Redline compares two snapshots and produces a diff Document IR with
// added/removed markup for change tracking.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DhfDocument, DhfDocumentSection, DhfBlock, DhfInline, DhfRow, DhfCell } from './document-ir.js';
import { text, heading, paragraph, table, badge, metricGroup, metric, divider } from './document-ir.js';

/** A snapshot of a DHF document at a point in time */
export interface DhfSnapshot {
    /** Snapshot ID (timestamp-based) */
    id: string;
    /** Document type ID */
    documentId: string;
    /** Creation timestamp */
    timestamp: string;
    /** Label/description for this snapshot */
    label?: string;
    /** Section summaries */
    sections: Array<{
        id: string;
        title: string;
        status: string;
        elementCount: number;
        gapCount: number;
        /** Hash of section content for change detection */
        contentHash: string;
    }>;
    /** Overall stats */
    totalElements: number;
    totalGaps: number;
    status: string;
}

/** Create a snapshot from a compiled DHF document */
export function createSnapshot(doc: DhfDocument, label?: string): DhfSnapshot {
    return {
        id: `snap-${Date.now()}`,
        documentId: doc.frontmatter.documentId,
        timestamp: new Date().toISOString(),
        label,
        sections: doc.sections.map(s => ({
            id: s.id,
            title: s.title,
            status: s.status || 'empty',
            elementCount: s.elementCount || 0,
            gapCount: s.gapCount || 0,
            contentHash: hashSection(s),
        })),
        totalElements: doc.totalElements,
        totalGaps: doc.totalGaps,
        status: doc.status,
    };
}

/** Simple content hash for change detection */
function hashSection(section: DhfDocumentSection): string {
    const content = JSON.stringify({
        blocks: section.blocks.length,
        elementCount: section.elementCount,
        gapCount: section.gapCount,
        status: section.status,
    });
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const chr = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash.toString(36);
}

/** Save a snapshot to the .memo/dhf-snapshots/ directory */
export function saveSnapshot(projectDir: string, snapshot: DhfSnapshot): string {
    const dir = resolve(projectDir, '.memo', 'dhf-snapshots');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `${snapshot.documentId}-${snapshot.id}.json`;
    const filepath = join(dir, filename);
    writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
    return filepath;
}

/** Load all snapshots for a document type */
export function loadSnapshots(projectDir: string, documentId: string): DhfSnapshot[] {
    const dir = resolve(projectDir, '.memo', 'dhf-snapshots');
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir).filter(f => f.startsWith(`${documentId}-snap-`) && f.endsWith('.json'));
    return files.map(f => {
        const raw = readFileSync(join(dir, f), 'utf-8');
        return JSON.parse(raw) as DhfSnapshot;
    }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Load the latest snapshot for a document type */
export function loadLatestSnapshot(projectDir: string, documentId: string): DhfSnapshot | undefined {
    const snapshots = loadSnapshots(projectDir, documentId);
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;
}

/** Diff result between two snapshots */
export interface DhfDiffResult {
    /** Baseline snapshot */
    baseline: DhfSnapshot;
    /** Current snapshot */
    current: DhfSnapshot;
    /** Sections that changed */
    changedSections: Array<{
        id: string;
        title: string;
        changeType: 'added' | 'removed' | 'modified' | 'unchanged';
        baselineStatus?: string;
        currentStatus?: string;
        elementDelta: number;
        gapDelta: number;
    }>;
    /** Summary metrics */
    elementDelta: number;
    gapDelta: number;
    statusChange: string;
}

/** Compare two snapshots */
export function diffSnapshots(baseline: DhfSnapshot, current: DhfSnapshot): DhfDiffResult {
    const baselineSections = new Map(baseline.sections.map(s => [s.id, s]));
    const currentSections = new Map(current.sections.map(s => [s.id, s]));

    const allSectionIds = new Set([
        ...baseline.sections.map(s => s.id),
        ...current.sections.map(s => s.id),
    ]);

    const changedSections: DhfDiffResult['changedSections'] = [];
    for (const id of allSectionIds) {
        const base = baselineSections.get(id);
        const curr = currentSections.get(id);

        if (!base && curr) {
            changedSections.push({
                id, title: curr.title, changeType: 'added',
                currentStatus: curr.status,
                elementDelta: curr.elementCount, gapDelta: curr.gapCount,
            });
        } else if (base && !curr) {
            changedSections.push({
                id, title: base.title, changeType: 'removed',
                baselineStatus: base.status,
                elementDelta: -base.elementCount, gapDelta: -base.gapCount,
            });
        } else if (base && curr) {
            const changed = base.contentHash !== curr.contentHash;
            changedSections.push({
                id, title: curr.title,
                changeType: changed ? 'modified' : 'unchanged',
                baselineStatus: base.status,
                currentStatus: curr.status,
                elementDelta: curr.elementCount - base.elementCount,
                gapDelta: curr.gapCount - base.gapCount,
            });
        }
    }

    const statusChange = baseline.status === current.status
        ? 'unchanged'
        : `${baseline.status} → ${current.status}`;

    return {
        baseline,
        current,
        changedSections,
        elementDelta: current.totalElements - baseline.totalElements,
        gapDelta: current.totalGaps - baseline.totalGaps,
        statusChange,
    };
}

/** Generate a redline Document IR from a diff */
export function generateRedlineDocument(diff: DhfDiffResult): DhfDocument {
    const sections: DhfDocumentSection[] = [];

    // Summary section
    const summaryBlocks: DhfBlock[] = [
        heading(3, 'Change Summary'),
        metricGroup(
            metric('Element Delta', diff.elementDelta >= 0 ? `+${diff.elementDelta}` : String(diff.elementDelta),
                { variant: diff.elementDelta >= 0 ? 'success' : 'warning' }),
            metric('Gap Delta', diff.gapDelta <= 0 ? String(diff.gapDelta) : `+${diff.gapDelta}`,
                { variant: diff.gapDelta <= 0 ? 'success' : 'error' }),
            metric('Status', diff.statusChange),
        ),
        paragraph(
            text(`Baseline: ${diff.baseline.label || diff.baseline.id} (${new Date(diff.baseline.timestamp).toLocaleDateString()})`),
        ),
        paragraph(
            text(`Current: ${diff.current.label || diff.current.id} (${new Date(diff.current.timestamp).toLocaleDateString()})`),
        ),
    ];

    sections.push({
        id: 'change-summary',
        title: 'Change Summary',
        blocks: summaryBlocks,
        elementCount: 0,
        gapCount: 0,
        status: 'complete',
    });

    // Section-level changes
    const changeBlocks: DhfBlock[] = [heading(3, 'Section Changes')];
    const changedOnly = diff.changedSections.filter(s => s.changeType !== 'unchanged');

    if (changedOnly.length > 0) {
        const rows = changedOnly.map(s => {
            const changeLabel = s.changeType === 'added' ? 'Added' : s.changeType === 'removed' ? 'Removed' : 'Modified';
            const variant = s.changeType === 'added' ? 'success' : s.changeType === 'removed' ? 'error' : 'warning';
            return [
                [text(s.title)],
                [badge(changeLabel, variant)],
                [text(s.baselineStatus || '—')],
                [text(s.currentStatus || '—')],
                [text(s.elementDelta >= 0 ? `+${s.elementDelta}` : String(s.elementDelta))],
                [text(s.gapDelta >= 0 ? `+${s.gapDelta}` : String(s.gapDelta))],
            ];
        });
        changeBlocks.push(table(
            ['Section', 'Change', 'Baseline Status', 'Current Status', 'Element Δ', 'Gap Δ'],
            rows,
        ));
    } else {
        changeBlocks.push(paragraph(text('No section-level changes detected.', { italic: true })));
    }

    sections.push({
        id: 'section-changes',
        title: 'Section Changes',
        blocks: changeBlocks,
        elementCount: 0,
        gapCount: 0,
        status: changedOnly.length > 0 ? 'partial' : 'complete',
    });

    return {
        frontmatter: {
            documentId: `${diff.current.documentId}-redline`,
            title: `Redline: ${diff.current.documentId}`,
            generatedAt: new Date().toISOString(),
            custom: {
                baselineId: diff.baseline.id,
                currentId: diff.current.id,
            },
        },
        sections,
        status: changedOnly.length > 0 ? 'partial' : 'complete',
        totalElements: 0,
        totalGaps: 0,
    };
}
