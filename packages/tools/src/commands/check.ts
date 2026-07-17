import { resolve } from 'node:path';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries } from '@memoarchitect/tools';
import type { BuilderRegistries, MemoModel, MemoElement, ParseError } from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

const STANDARD_CONSTRUCTS = new Set([
    'part', 'requirement', 'action', 'item', 'port',
    'interface', 'connection', 'attribute', 'constraint',
    'enum', 'viewpoint', 'view',
]);

const STANDARD_KEYWORDS = new Set([
    'package', 'import', 'part', 'def', 'requirement', 'action', 'item',
    'port', 'interface', 'connection', 'attribute', 'constraint', 'enum',
    'viewpoint', 'view', 'flow', 'allocate', 'connect', 'first', 'then',
    'in', 'out', 'inout', 'end', 'ref', 'doc', 'library',
]);

interface CompatFinding {
    severity: 'error' | 'warning' | 'info';
    code: string;
    file?: string;
    element?: string;
    message: string;
}

interface CompatReport {
    tool: string;
    timestamp: string;
    projectName: string;
    findings: CompatFinding[];
    summary: {
        elements: number;
        relationships: number;
        parseErrors: number;
        errors: number;
        warnings: number;
        infos: number;
        compatible: boolean;
    };
}

function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.memo') {
                files.push(...findSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
    } catch {
        // skip
    }
    return files;
}

function checkExplicitMultiplicity(sysmlFiles: string[]): CompatFinding[] {
    const findings: CompatFinding[] = [];
    const attrRegex = /attribute\s+(\w+)\s*:\s*(\w+)\s*(?:\[([^\]]*)\])?\s*[;{=]/g;
    for (const file of sysmlFiles) {
        let content: string;
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const m of line.matchAll(attrRegex)) {
                if (!m[3]) {
                    findings.push({
                        severity: 'warning',
                        code: 'FB7_MISSING_MULTIPLICITY',
                        file,
                        element: m[1],
                        message: `Attribute "${m[1]}" (line ${i + 1}) missing explicit multiplicity — add [1], [0..1], or [1..*]`,
                    });
                }
            }
        }
    }
    return findings;
}

function checkSysmlCompat(model: MemoModel, parseErrors: ParseError[]): CompatFinding[] {
    const findings: CompatFinding[] = [];

    for (const err of parseErrors) {
        findings.push({
            severity: 'error',
            code: 'PARSE_ERROR',
            file: err.file,
            message: `Parse error at line ${err.line ?? '?'}: ${err.message}`,
        });
    }

    for (const [id, el] of model.elements) {
        if (!STANDARD_CONSTRUCTS.has(el.construct)) {
            findings.push({
                severity: 'warning',
                code: 'NON_STANDARD_CONSTRUCT',
                file: el.file,
                element: id,
                message: `Element "${el.name}" uses non-standard construct "${el.construct}"`,
            });
        }

        if (el.construct === 'part' && el.kind === 'InterfaceElement') {
            findings.push({
                severity: 'info',
                code: 'LEGACY_INTERFACE_PATTERN',
                file: el.file,
                element: id,
                message: `"${el.name}" uses part-based interface pattern; consider migrating to interface def + port def`,
            });
        }

        if (el.construct === 'port' && !el.portSpec?.direction) {
            findings.push({
                severity: 'warning',
                code: 'UNDIRECTED_PORT',
                file: el.file,
                element: id,
                message: `Port "${el.name}" has no direction (in/out/inout); SysON may require explicit direction`,
            });
        }
    }

    for (const rel of model.relationships) {
        if (rel.type === 'flow' && !rel.flowItem) {
            findings.push({
                severity: 'warning',
                code: 'UNTYPED_FLOW',
                file: rel.file,
                message: `Flow from "${rel.sourceId}" to "${rel.targetId}" has no item type`,
            });
        }
    }

    return findings;
}

export async function checkCommand(
    projectDir?: string,
    options?: { sysmlCompat?: boolean; format?: 'text' | 'json'; output?: string }
): Promise<void> {
    const format = options?.format || 'text';
    const cwd = resolve(projectDir || process.cwd());

    if (!options?.sysmlCompat) {
        console.log(chalk.yellow('Usage: memo check --sysml-compat [dir]'));
        console.log(chalk.gray('  Checks model for SysML v2 standard compatibility.'));
        return;
    }

    const isJson = format === 'json';
    const log = isJson ? () => {} : console.log.bind(console);

    log(chalk.bold('\n🔍 MEMO SysML Compatibility Check\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    log(chalk.gray(`Project: ${config.projectName}`));

    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = loadResult.registries;
        }
    } catch {
        // proceed without ontology registries
    }

    const sysmlFiles = findSysmlFiles(cwd);
    if (sysmlFiles.length === 0) {
        console.error(chalk.yellow('⚠️  No .sysml files found.'));
        return;
    }
    log(chalk.gray(`Files: ${sysmlFiles.length} .sysml files\n`));

    const { documents, errors: parseErrors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    const findings = [
        ...checkSysmlCompat(model, parseErrors),
        ...checkExplicitMultiplicity(sysmlFiles),
    ];

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');
    const infos = findings.filter(f => f.severity === 'info');

    const report: CompatReport = {
        tool: 'memo-sysml-compat',
        timestamp: new Date().toISOString(),
        projectName: config.projectName || 'unknown',
        findings,
        summary: {
            elements: model.elements.size,
            relationships: model.relationships.length,
            parseErrors: parseErrors.length,
            errors: errors.length,
            warnings: warnings.length,
            infos: infos.length,
            compatible: errors.length === 0,
        },
    };

    if (format === 'json') {
        const jsonStr = JSON.stringify(report, null, 2);
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), jsonStr);
            console.log(chalk.green(`Report written to ${options.output}`));
        } else {
            process.stdout.write(jsonStr + '\n');
        }
        if (!report.summary.compatible) process.exitCode = 1;
        return;
    }

    if (errors.length > 0) {
        console.log(chalk.red.bold(`Errors (${errors.length}):`));
        for (const f of errors) {
            console.log(chalk.red(`  ✖ [${f.code}] ${f.file || ''}: ${f.message}`));
        }
        console.log();
    }

    if (warnings.length > 0) {
        console.log(chalk.yellow.bold(`Warnings (${warnings.length}):`));
        for (const f of warnings) {
            console.log(chalk.yellow(`  ⚠ [${f.code}] ${f.element || f.file || ''}: ${f.message}`));
        }
        console.log();
    }

    if (infos.length > 0) {
        console.log(chalk.blue.bold(`Info (${infos.length}):`));
        for (const f of infos) {
            console.log(chalk.blue(`  ℹ [${f.code}] ${f.element || f.file || ''}: ${f.message}`));
        }
        console.log();
    }

    const status = report.summary.compatible
        ? chalk.green.bold('✔ Compatible')
        : chalk.red.bold('✖ Not compatible');
    console.log(`${status} — ${model.elements.size} elements, ${findings.length} findings (${errors.length} errors, ${warnings.length} warnings)\n`);

    if (!report.summary.compatible) process.exitCode = 1;
}
