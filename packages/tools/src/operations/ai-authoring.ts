// ─── AI authoring operation ─────────────────────────────────────────────────
// The server and CLI-facing surfaces delegate here. Validation improves a draft;
// it never decides whether source may be saved (§1.1).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMemoManifests } from '../model/manifest.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { EMPTY_ONTOLOGY_VIEW, ontologyViewFrom } from '../model/kind-registry.js';
import { loadProjectConfig } from '../toolchain/lowering.js';
import { mergeDiagnostics, probeToolchain, runLowering, runValidator } from '../toolchain/operations.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import { validateModel } from '../validator/rule-engine.js';
import { dtoToModel } from '../model/semantic.js';
import { createProvider, generateSysml, repairSysml, resolveLLMConfig, type GenerateResult, type LLMProvider } from '../llm/index.js';
import { SYSML_MEMO_GUIDANCE_VERSION } from '../llm/sysml-guidance.js';

export const MAX_SYSML_GENERATION_ATTEMPTS = 3;

export interface AiChangeRecord {
    guidanceVersion: string;
    compiler: { id: string; version?: string };
    libraries: Record<string, string>;
}

export interface ValidatedGenerateResult extends GenerateResult {
    initialSysml: string;
    attempts: number;
    diagnostics: Diagnostic[];
    changeRecord: AiChangeRecord;
}

export async function validateGeneratedSysml(projectRoot: string, sysml: string): Promise<Diagnostic[]> {
    const config = loadProjectConfig(projectRoot);
    const scratch = await mkdtemp(join(tmpdir(), 'memo-ai-sysml-'));
    const candidatePath = join(scratch, 'generated.sysml');
    await writeFile(candidatePath, sysml, 'utf8');
    try {
        const options = { config, projectDir: projectRoot, files: [candidatePath] };
        const validator = await runValidator(options);
        const lowering = await runLowering(options);
        const diagnostics = mergeDiagnostics(validator.diagnostics, lowering.diagnostics);
        if (lowering.accepted) {
            const model = dtoToModel(lowering.ir.model);
            diagnostics.push(...validateModel(model).violations.map(violation => ({
                domain: 'memo-methodology' as const,
                provider: 'memo', severity: violation.severity === 'error' ? 'warning' as const : violation.severity,
                code: violation.ruleId,
                message: violation.description,
                file: violation.provenance?.declaration.sourceUri,
            })));
        }
        return diagnostics;
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}

export async function generateValidatedSysml(options: {
    projectRoot: string;
    description: string;
    provider?: LLMProvider;
}): Promise<ValidatedGenerateResult> {
    const config = loadProjectConfig(options.projectRoot);
    const provider = options.provider ?? (() => {
        const llm = resolveLLMConfig(options.projectRoot);
        if (!llm) throw new Error('No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
        return createProvider(llm);
    })();
    let ontology = EMPTY_ONTOLOGY_VIEW;
    try {
        const loaded = await loadOntologyRegistries(options.projectRoot);
        ontology = ontologyViewFrom(loaded.registries.kindRegistry, loaded.registries.relationshipRegistry);
    } catch {
        // Generation remains available without installed MEMO content. The
        // diagnostics will make any resulting methodology gap visible.
    }
    let candidate = await generateSysml(options.description, ontology, provider);
    const initialSysml = candidate.sysml;
    let diagnostics = await validateGeneratedSysml(options.projectRoot, candidate.sysml);
    let attempts = 1;
    while (diagnostics.length > 0 && attempts < MAX_SYSML_GENERATION_ATTEMPTS) {
        candidate = await repairSysml(options.description, candidate.sysml, diagnostics, ontology, provider);
        diagnostics = await validateGeneratedSysml(options.projectRoot, candidate.sysml);
        attempts += 1;
    }
    const probe = probeToolchain({ config, projectDir: options.projectRoot });
    const selected = probe.roles.find(role => role.role === 'validator')!;
    const libraries = Object.assign({}, ...findMemoManifests(options.projectRoot).map(found => found.manifest.packages));
    return { ...candidate, initialSysml, attempts, diagnostics, changeRecord: {
        guidanceVersion: SYSML_MEMO_GUIDANCE_VERSION,
        compiler: { id: selected.provider, version: selected.availability.version }, libraries,
    } };
}
