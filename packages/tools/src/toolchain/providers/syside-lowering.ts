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
// `validator-exceptions.json` register keeps its meaning. `memo validate` runs
// SysIDE once: stage 1's diagnostics are the validator's verdict whenever
// `compileServesValidator` says so.
//
// The Python API is licensed: it needs the same Modeler licence `syside check`
// does, found the same way (AGENTS.md, "The SysIDE licence").
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MEMOConfig } from '../../model/config.js';
import { loadOntologyRegistries } from '../../model/ontology-loader.js';
import { modelToDTO } from '../../model/semantic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { SYSML_IR_VERSION } from '../../model/sysml-ir.js';
import { stage2FromHandoff } from '../../stage2/stage2-from-handoff.js';
import { ApiModel, type Stage1Output } from '../../stage2/api-model.js';
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
    let { libraryDirs, projectFiles, registries, filePackages } = options;
    // Resolving from the handoff needs only the sources; otherwise MEMO's
    // resolution supplies what was not given.
    if (!libraryDirs || !projectFiles || (!options.resolveProject && (!registries || !filePackages))) {
        const loaded = await loadOntologyRegistries(projectDir);
        registries ??= loaded.registries;
        filePackages ??= loaded.resolution?.filePackages;
        const resolvedRoots = [...(loaded.resolution?.selectedRoots ?? []), ...(loaded.resolution?.unusedRoots ?? [])];
        libraryDirs ??= (loaded.resolution?.selectedRoots ?? []).map(root => root.sysmlDir);
        projectFiles ??= new Set(findSysmlFiles(projectDir)
            .filter(file => !resolvedRoots.some(root => resolve(file).startsWith(root.sysmlDir)))
            .map(file => relative(projectDir, file)));
    }

    const interpreter = python(options.config);
    const key = sysideInputKey(interpreter, projectDir, libraryDirs);
    const cached = options.cacheDir ? join(options.cacheDir, `${SYSIDE_PROVIDER_ID}.json`) : undefined;
    const keyFile = cached ? `${cached}.key` : undefined;
    let handoffPath: string;
    let reused = false;
    let work: string | undefined;
    if (cached && keyFile && !options.force && existsSync(cached) && existsSync(keyFile)
        && readFileSync(keyFile, 'utf8') === key) {
        handoffPath = cached;
        reused = true;
    } else {
        work = mkdtempSync(join(tmpdir(), 'memo-stage1-'));
        handoffPath = join(work, 'stage1.json');
        const args = [EXPORT_SCRIPT, ...libraryDirs.flatMap(dir => ['--library', dir]), '--out', handoffPath, projectDir];
        const run = spawnSync(interpreter, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (run.error || !existsSync(handoffPath)) {
            rmSync(work, { recursive: true, force: true });
            throw new Error(`SysIDE stage 1 could not run with "${interpreter}": `
                + `${run.error?.message ?? run.stderr.trim().split('\n').slice(-3).join(' ')}. `
                + `Set toolchain.${SYSIDE_PROVIDER_ID}.python to a Python with SysIDE's API.`);
        }
        if (cached && keyFile && options.cacheDir) {
            mkdirSync(options.cacheDir, { recursive: true });
            // Tool output, never authored content: the directory ignores
            // itself, so no project has to know to add it to its .gitignore.
            const ignore = join(options.cacheDir, '.gitignore');
            if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
            writeFileSync(cached, readFileSync(handoffPath));
            writeFileSync(keyFile, key);
        }
    }
    try {
        const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as Stage1Output & { diagnostics?: { text: string }[] };
        const diagnostics = parseSysideDiagnostics(
            (handoff.diagnostics ?? []).map(d => d.text).join('\n'), handoff.providerVersion);
        if (!handoff.clean) return { accepted: false, diagnostics, providerVersion: handoff.providerVersion, cached: reused };
        const api = new ApiModel(handoff);
        // The ontology is the handoff's, not MEMO's parse of it.
        const stage2 = stage2FromHandoff(api, {
            config: options.config, projectDir, projectFiles, resolveProject: options.resolveProject, registries, filePackages,
        });
        return { accepted: true, diagnostics, providerVersion: handoff.providerVersion, ...stage2, api, cached: reused };
    } finally {
        if (work) rmSync(work, { recursive: true, force: true });
    }
}

/**
 * Everything a SysIDE stage 1 result depends on: the interpreter, the export
 * script, and the content of every SysML file it loads. A result is reused only
 * while this is unchanged; a SysIDE upgrade in the same interpreter is not seen,
 * which is what `memo compile --force` is for.
 */
export function sysideInputKey(interpreter: string, projectDir: string, libraryDirs: readonly string[]): string {
    const hash = createHash('sha256');
    hash.update(`${SYSIDE_PROVIDER_ID}\0${interpreter}\0`);
    hash.update(readFileSync(EXPORT_SCRIPT));
    const files = [...findSysmlFiles(projectDir), ...libraryDirs.flatMap(sysmlFilesUnder)]
        .map(file => resolve(file));
    for (const file of [...new Set(files)].sort()) {
        hash.update(`\0${file}\0`);
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}

function sysmlFilesUnder(dir: string): string[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return ['node_modules', '.venv', 'site-packages', '.git'].includes(entry.name) ? [] : sysmlFilesUnder(path);
        return entry.name.endsWith('.sysml') ? [path] : [];
    });
}

export const sysideLoweringDescriptor: LoweringDescriptor = {
    id: SYSIDE_PROVIDER_ID,
    role: 'lowering',
    capabilities: ['lower'],
    settingsSchema: SETTINGS_SCHEMA,
    compileModel: compileWithSyside,
    // The Python load reports what `syside check --diagnose all` does, in the
    // same text (`full_message`), so it is the validator's verdict too, unless
    // a setting only the CLI reads is in effect: a syside.toml or a narrower
    // diagnose scope.
    compileServesValidator(config: MEMOConfig): boolean {
        const cli = providerSettings<{ configFile?: string; diagnose?: string }>(config, SYSIDE_PROVIDER_ID) ?? {};
        return !cli.configFile && (cli.diagnose ?? 'all') === 'all';
    },
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
