// ─── The design history of one regulated device ──────────────────────────────
//
// A regulated device is one approval in one jurisdiction, and it covers system releases (plan O6). Its
// documents are built from what it covers, not from the working model:
//
//   for each release the device covers:
//     the model at that release's commit (or the SoS version assembled from its pins), pinned (T5);
//     minus the variants the release does not select, and what they own (the "100% view");
//     scoped to the one system the release is for, as validation scopes it (subjects only);
//     the standards its jurisdiction requires (`regimeOverride`), and the documents whose
//     `required_for` names that jurisdiction.
//
// So two devices that cover different releases of one system differ in the content (the variant each
// release builds), in the standards sections (what each jurisdiction requires) and in which documents
// exist at all. The device, its jurisdiction and its covers are read from the working model: a pinned
// model holds no records and no devices. The compiler and the ontology are today's, as for every pinned
// build (T5); the index says so.
//
// The system of systems' context is the index's: each covered release lists the release records that
// `contains` it (an SoS version, the validated configuration) and the releases pinned beside it. It is
// read from the working model's records, so it needs no build of the SoS. Not here: a renderer of its own,
// which the "one renderer" board row is about. The documents go through the existing markdown pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDhfConfigV2 } from './dhf-config-v2.js';
import { compileMarkdownDocument } from './document-compiler.js';
import { createQueryContext } from './query-engine.js';
import { listBuiltinTemplates } from './template-resolver.js';
import { buildStandardsReport } from '../commands/standards.js';
import type { MEMOConfig } from '../model/config.js';
import { narrowModel } from '../model/narrow-model.js';
import { buildForRecord } from '../model/pinned.js';
import type { MemoModel } from '../model/semantic.js';
import { excludedFor } from '../model/variability.js';
import { computeWorkspaceMembership, selectWorkspace, type WorkspaceScope } from '../model/workspace-membership.js';
import { computeCompleteness } from '../completeness/tracker.js';
import { validateModel } from '../validator/rule-engine.js';
import type { ProjectModel } from '../toolchain/project-model.js';

export interface DeviceDocument {
    id: string;
    title: string;
    /** The template's standard folder: `21cfr820`, `iso-14971`, `system`. */
    group: string;
    /** Project-relative to the output directory. */
    path: string;
    warnings: number;
}

export interface DeviceRelease {
    record: string;
    commit: string;
    /** The system the documents are scoped to, when the record's item is one. */
    workspace?: string;
    /** Variants this release does not build, left out of its documents. */
    excludedVariants: string[];
    documents: DeviceDocument[];
    /** The release records that contain this one (an SoS version, say) and the releases pinned beside it. */
    context: ReleaseContext[];
}

export interface ReleaseContext {
    record: string;
    /** The item the containing record is a release of. */
    item?: string;
    commit?: string;
    siblings: { record: string; item?: string; commit?: string }[];
}

export interface DeviceDhfResult {
    device: { id: string; name: string; jurisdiction: string; submissionId?: string };
    outputDir: string;
    index: string;
    releases: DeviceRelease[];
    /** How many of the documents are the risk management file (the ISO 14971 templates). */
    riskDocuments: number;
    notes: string[];
}

export interface DeviceDhfOptions {
    projectRoot: string;
    working: Pick<ProjectModel, 'model' | 'registries'>;
    /** The device's element id, or its name. */
    device: string;
    /** Absolute. */
    outputDir: string;
    config?: Partial<MEMOConfig>;
    /** Template ids to compile; by default every template whose `required_for` names the jurisdiction. */
    templates?: string[];
    /** A directory of the project's own templates, searched before the library's. */
    customTemplateDir?: string;
}

const RISK_GROUP = 'iso-14971';

/** What contains a release record: each container, with the other records it pins. */
export function releaseContext(model: MemoModel, recordId: string): ReleaseContext[] {
    const name = (id: string) => model.elements.get(id)?.shortName ?? id;
    const itemOf = (id: string) => {
        const target = model.relationships.find(r => r.type === 'releaseOf' && r.sourceId === id)?.targetId;
        return target ? name(target) : undefined;
    };
    return model.relationships
        .filter(r => r.type === 'contains' && r.targetId === recordId)
        .map(r => r.sourceId)
        .filter((id, index, all) => all.indexOf(id) === index)
        .map(container => ({
            record: name(container), item: itemOf(container), commit: attribute(model, container, 'modelCommit'),
            siblings: model.relationships
                .filter(r => r.type === 'contains' && r.sourceId === container && r.targetId !== recordId)
                .map(r => ({ record: name(r.targetId), item: itemOf(r.targetId), commit: attribute(model, r.targetId, 'modelCommit') })),
        }))
        .sort((a, b) => a.record.localeCompare(b.record));
}

const attribute = (model: MemoModel, id: string, key: string): string | undefined => model.elements.get(id)?.attributes?.[key] || undefined;

/** The device a name or id picks out of the working model. */
export function findDevice(model: MemoModel, requested: string): { id: string; name: string } | { error: string } {
    const matches = [...model.relationships.filter(r => r.type === 'covers').map(r => r.sourceId)]
        .filter((id, index, all) => all.indexOf(id) === index)
        .filter(id => id === requested || model.elements.get(id)?.shortName === requested || model.elements.get(id)?.attributes?.providedId === requested);
    const devices = [...model.elements.values()].filter(e => e.attributes?.jurisdiction !== undefined);
    const byName = devices.filter(e => e.id === requested || e.shortName === requested || e.attributes?.providedId === requested);
    const found = byName.length > 0 ? byName.map(e => e.id) : matches;
    if (found.length === 1) return { id: found[0], name: model.elements.get(found[0])!.shortName ?? found[0] };
    const names = devices.map(e => e.shortName ?? e.id).sort().join(', ') || 'none declared';
    return { error: found.length === 0 ? `"${requested}" is not a regulated device of this model (devices: ${names}).` : `"${requested}" names more than one device; use its element id.` };
}

export async function compileDeviceDhf(options: DeviceDhfOptions): Promise<DeviceDhfResult> {
    const { model } = options.working;
    const located = findDevice(model, options.device);
    if ('error' in located) throw new Error(located.error);
    const jurisdiction = (attribute(model, located.id, 'jurisdiction') ?? '').replace(/^RegulatoryRegimeKind::/, '');
    if (!jurisdiction) throw new Error(`${located.name} states no jurisdiction.`);
    const submissionId = attribute(model, located.id, 'submissionId');
    const covered = model.relationships.filter(r => r.type === 'covers' && r.sourceId === located.id).map(r => r.targetId);
    const notes: string[] = [];
    if (covered.length === 0) throw new Error(`${located.name} covers no release (#Covers): there is nothing to build its documents from.`);

    const templates = (options.templates ?? listBuiltinTemplates()
        .filter(t => (t.frontmatter.required_for ?? []).includes(jurisdiction))
        .map(t => t.id)).sort();
    if (templates.length === 0) notes.push(`No document template names ${jurisdiction} in its required_for, so no document is generated.`);
    if (!templates.some(id => id.startsWith(`${RISK_GROUP}/`))) notes.push(`No ISO 14971 template is required for ${jurisdiction}, so there is no risk management file for this device.`);

    const deviceDir = join(options.outputDir, located.name);
    mkdirSync(deviceDir, { recursive: true });
    const releases: DeviceRelease[] = [];
    let compiler: string | undefined;
    let compilerVersion: string | undefined;

    for (const recordId of covered) {
        const recordName = model.elements.get(recordId)?.shortName ?? recordId;
        const built = await buildForRecord(options.projectRoot, options.working, recordId, { config: options.config });
        compiler = built.build.compiler;
        compilerVersion = built.build.compilerVersion;
        const pinned = built.build.project;
        // The variants this release does not select leave the model before anything is judged. The features
        // are the working record's: the pinned model holds no record.
        const features = model.relationships.filter(r => r.type === 'selectsFeature' && r.sourceId === recordId).map(r => r.targetId);
        const excluded = excludedFor({ elements: pinned.model.elements, relationships: pinned.model.relationships }, features);
        const kept = excluded.size === 0 ? pinned.model : narrowModel(pinned.model, new Map([...pinned.model.elements].filter(([id]) => !excluded.has(id))));

        // The system the release is for: subjects only, as validation scopes it.
        let workspace: WorkspaceScope | undefined;
        const item = model.relationships.find(r => r.type === 'releaseOf' && r.sourceId === recordId)?.targetId;
        if (item && pinned.registries) {
            const selection = selectWorkspace(kept, computeWorkspaceMembership(kept, pinned.registries), item);
            if (selection.ok) workspace = selection.scope;
        }
        const validation = validateModel(kept, undefined, undefined, undefined, undefined, workspace, undefined, pinned.registries?.relationshipRegistry);
        const completeness = computeCompleteness(
            workspace ? narrowModel(kept, new Map([...kept.elements].filter(([id]) => workspace!.subjects.has(id)))) : kept, validation);
        const config = { modelName: options.working.model ? (options.config?.modelName ?? 'model') : 'model', ...options.config } as MEMOConfig;
        const standards = buildStandardsReport({
            model: kept, registries: pinned.registries, projectRoot: built.build.projectDir, regimeOverride: [jurisdiction],
        });
        const ctx = createQueryContext(kept, validation, completeness, config, standards, workspace);
        const dhfConfig = loadDhfConfigV2(built.build.projectDir) ?? ({} as never);

        const documents: DeviceDocument[] = [];
        const releaseDir = join(deviceDir, recordName);
        for (const templateId of templates) {
            const result = await compileMarkdownDocument({
                templateId, ctx, config: dhfConfig, customTemplateDir: options.customTemplateDir,
                extraMeta: {
                    product: model.elements.get(item ?? '')?.shortName ?? recordName,
                    version: attribute(model, recordId, 'revision'),
                    device: located.name, jurisdiction, submission: submissionId ?? '', release: recordName, commit: built.commit,
                },
            });
            const group = templateId.includes('/') ? templateId.slice(0, templateId.indexOf('/')) : 'documents';
            const id = templateId.slice(templateId.lastIndexOf('/') + 1);
            mkdirSync(join(releaseDir, group), { recursive: true });
            writeFileSync(join(releaseDir, group, `${id}.md`), result.markdown, 'utf8');
            documents.push({ id: templateId, title: result.title, group, path: `${recordName}/${group}/${id}.md`, warnings: result.warnings.length });
        }
        releases.push({
            record: recordName, commit: built.commit, workspace: workspace?.name,
            excludedVariants: [...excluded].map(id => pinned.model.elements.get(id)?.shortName ?? id).sort(), documents,
            context: releaseContext(model, recordId),
        });
    }

    const riskDocuments = releases.reduce((sum, r) => sum + r.documents.filter(d => d.group === RISK_GROUP).length, 0);
    const index = join(deviceDir, 'index.md');
    writeFileSync(index, indexText({ id: located.id, name: located.name, jurisdiction, submissionId }, releases, riskDocuments, notes, compiler, compilerVersion), 'utf8');
    return { device: { id: located.id, name: located.name, jurisdiction, submissionId }, outputDir: deviceDir, index, releases, riskDocuments, notes };
}

function indexText(device: DeviceDhfResult['device'], releases: DeviceRelease[], risk: number, notes: string[], compiler?: string, compilerVersion?: string): string {
    const lines = [
        `# Design history file: ${device.name}`, '',
        `- Jurisdiction: ${device.jurisdiction}`,
        ...(device.submissionId ? [`- Submission: ${device.submissionId}`] : []),
        `- Compiler: ${compiler ?? 'unknown'}${compilerVersion ? ` ${compilerVersion}` : ''}, and the ontology installed now (a pinned build uses today's, not the commit's)`,
        '', '## Covered releases', '',
    ];
    for (const release of releases) {
        lines.push(`### ${release.record} (${release.commit.slice(0, 7)})`, '');
        if (release.workspace) lines.push(`Scoped to ${release.workspace}.`);
        lines.push(release.excludedVariants.length > 0 ? `Built without: ${release.excludedVariants.join(', ')}.` : 'Every variant is built.', '');
        const short = (commit?: string) => commit ? ` (${commit.slice(0, 7)})` : '';
        for (const sos of release.context) {
            lines.push(`System of systems context: part of ${sos.record}${sos.item ? `, a release of ${sos.item}` : ''}${short(sos.commit)}, pinned with ${sos.siblings.length > 0
                ? sos.siblings.map(s => `${s.record}${s.item ? ` (${s.item})` : ''}${short(s.commit)}`).join(', ') : 'no other release'}.`, '');
        }
        if (release.context.length === 0) lines.push('System of systems context: no release record contains this one.', '');
        for (const doc of release.documents) lines.push(`- [${doc.title}](${doc.path})${doc.warnings > 0 ? ` (${doc.warnings} warnings)` : ''}`);
        lines.push('');
    }
    lines.push(`## Risk management file`, '', risk > 0 ? `${risk} risk management documents (ISO 14971) are among the above.` : 'No risk management documents: see the notes.', '');
    if (notes.length > 0) lines.push('## Notes', '', ...notes.map(n => `- ${n}`), '');
    return lines.join('\n');
}
