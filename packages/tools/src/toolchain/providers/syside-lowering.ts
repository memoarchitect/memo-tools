// ─── SysIDE as a stage 1 compiler ────────────────────────────────────────────
//
// The lowering half of `toolchain.compiler: syside`
// (plans/memo-compiler-stages-opensysml.md, milestone 3). SysIDE's Python API
// loads the project with the libraries its resolution selects and, only when the
// load is clean, hands over the OMG API JSON with an element index
// (`python/memo_stage1_syside.py`). Stage 2 builds the MEMO model from that
// handoff (`stage2/build-from-api.ts`); MEMO's own parser is not involved.
//
// The validator half is the existing `syside check` provider, unchanged, so the
// `validator-exceptions.json` register keeps its meaning. Two SysIDE runs per
// build is the known cost of that; one run serving both is the follow-up.
//
// The Python API is licensed: it needs the same Modeler licence `syside check`
// does, found the same way (AGENTS.md, "The SysIDE licence").
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MEMOConfig } from '../../model/config.js';
import { loadOntologyRegistries } from '../../model/ontology-loader.js';
import { modelToDTO } from '../../model/semantic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { SYSML_IR_VERSION } from '../../model/sysml-ir.js';
import { ApiModel, type Stage1Output } from '../../stage2/api-model.js';
import { buildMemoModelFromApi } from '../../stage2/build-from-api.js';
import { providerSettings } from '../effective.js';
import { SYSMLC_IR_VERSION } from '../protocol.js';
import type {
    Availability,
    CompileModelOptions,
    CompileModelResult,
    LoweringDescriptor,
    LoweringRunResult,
    ProviderContext,
    ToolchainSchemaLeaf,
} from '../registry.js';
import { SYSIDE_PROVIDER_ID, parseSysideDiagnostics } from './syside.js';

interface SysidePythonConfig {
    python?: string;
}

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${SYSIDE_PROVIDER_ID}.python`,
        type: 'string',
        description: 'Python interpreter with SysIDE\'s licensed API, for stage 1 export. Defaults to `python3`.',
    },
];

/** The stage 1 export script, shipped beside the compiled library. */
const EXPORT_SCRIPT = fileURLToPath(new URL('../../../python/memo_stage1_syside.py', import.meta.url));

function python(config: MEMOConfig): string {
    return providerSettings<SysidePythonConfig>(config, SYSIDE_PROVIDER_ID)?.python
        ?? process.env.MEMO_SYSIDE_PYTHON ?? 'python3';
}

export type SysideCompileResult = CompileModelResult;

/**
 * Stage 1 through SysIDE, then stage 2. A stage 1 that reports an error yields
 * no model: stage 2 never runs on a failed stage 1 (plan, Decisions).
 */
export async function compileWithSyside(options: CompileModelOptions): Promise<CompileModelResult> {
    const projectDir = resolve(options.projectDir);
    let { libraryDirs, projectFiles, registries } = options;
    if (!libraryDirs || !projectFiles || !registries) {
        const loaded = await loadOntologyRegistries(projectDir);
        registries ??= loaded.registries;
        const resolvedRoots = [...(loaded.resolution?.selectedRoots ?? []), ...(loaded.resolution?.unusedRoots ?? [])];
        libraryDirs ??= (loaded.resolution?.selectedRoots ?? []).map(root => root.sysmlDir);
        projectFiles ??= new Set(findSysmlFiles(projectDir)
            .filter(file => !resolvedRoots.some(root => resolve(file).startsWith(root.sysmlDir)))
            .map(file => relative(projectDir, file)));
    }

    const work = mkdtempSync(join(tmpdir(), 'memo-stage1-'));
    const out = join(work, 'stage1.json');
    try {
        const args = [EXPORT_SCRIPT, ...libraryDirs.flatMap(dir => ['--library', dir]), '--out', out, projectDir];
        const run = spawnSync(python(options.config), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (run.error || !existsSync(out)) {
            throw new Error(`SysIDE stage 1 could not run with "${python(options.config)}": `
                + `${run.error?.message ?? run.stderr.trim().split('\n').slice(-3).join(' ')}. `
                + `Set toolchain.${SYSIDE_PROVIDER_ID}.python to a Python with SysIDE's API.`);
        }
        const handoff = JSON.parse(readFileSync(out, 'utf8')) as Stage1Output & { diagnostics?: { text: string }[] };
        const diagnostics = parseSysideDiagnostics(
            (handoff.diagnostics ?? []).map(d => d.text).join('\n'), handoff.providerVersion);
        if (!handoff.clean) return { accepted: false, diagnostics, providerVersion: handoff.providerVersion };
        const model = buildMemoModelFromApi(new ApiModel(handoff), options.config, registries, projectFiles);
        return { accepted: true, diagnostics, providerVersion: handoff.providerVersion, model };
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

export const sysideLoweringDescriptor: LoweringDescriptor = {
    id: SYSIDE_PROVIDER_ID,
    role: 'lowering',
    capabilities: ['lower'],
    settingsSchema: SETTINGS_SCHEMA,
    compileModel: compileWithSyside,
    probe(context: ProviderContext): Availability {
        const interpreter = python(context.config);
        const check = spawnSync(interpreter, ['-c', 'import syside; print(syside.__version__)'], { encoding: 'utf8' });
        return check.status === 0
            ? { available: true, transport: 'process', executable: interpreter, version: check.stdout.trim() }
            : { available: false, transport: 'process', detail: `"${interpreter}" cannot import syside.` };
    },
    create(context: ProviderContext) {
        return {
            id: SYSIDE_PROVIDER_ID,
            role: 'lowering' as const,
            transport: 'process' as const,
            invocation: () => ({ command: python(context.config), args: [EXPORT_SCRIPT], provider: SYSIDE_PROVIDER_ID }),
            async run(): Promise<LoweringRunResult> {
                const result = await compileWithSyside({
                    config: context.config, projectDir: context.projectDir, registries: context.registries,
                    libraryDirs: context.includeDirs,
                });
                const model = result.model
                    ? modelToDTO(result.model)
                    : { elements: {}, relationships: [], errors: [], packages: [] } as unknown as ReturnType<typeof modelToDTO>;
                return {
                    provider: SYSIDE_PROVIDER_ID,
                    providerVersion: result.providerVersion,
                    transport: 'process',
                    accepted: result.accepted,
                    diagnostics: result.diagnostics,
                    ir: {
                        irVersion: SYSMLC_IR_VERSION,
                        model,
                        parseErrors: [],
                        accepted: result.accepted,
                        // Stage 2 has no syntax tree to record; the standard JSON is the record.
                        sysml: { irVersion: SYSML_IR_VERSION, elements: [], diagnostics: [] },
                    },
                };
            },
        };
    },
};
