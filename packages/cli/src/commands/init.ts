import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import { findConfigFile, VENDOR_ONTOLOGY_PACKAGES_DIR } from '@memo/core';
import { createLockFile } from '../lock.js';
import { loadArchetypes, findArchetype, deviceClassArchetypes, profileArchetypes, type ArchetypeInfo } from './archetype-loader.js';
import { runWizard, regulatoryComment } from './init-wizard.js';

const DEFAULT_ONTOLOGY = '@memo/medical-modeling-profile';

// Public import surface of the ontology: memo::medical_device_library
// re-exports core, all architecture layers, viewpoints, and views.
const ONTOLOGY_ROOT_IMPORT = 'memo_medical_device_library';

export { type ArchetypeInfo } from './archetype-loader.js';

export interface AvailableOntology {
    name: string;
    version: string;
    type: string;
    description: string;
    extends?: string;
    path: string;
}

export function discoverOntologies(fromDir: string): AvailableOntology[] {
    const results: AvailableOntology[] = [];
    let dir = resolve(fromDir);

    while (true) {
        // Content packages now live in the memo-sysmlv2 submodule; the local
        // packages/ dir holds only the engine (core/cli/web). Scan both.
        for (const rel of [VENDOR_ONTOLOGY_PACKAGES_DIR, 'packages']) {
            const packagesDir = resolve(dir, rel);
            if (existsSync(packagesDir)) scanOntologyDir(packagesDir, results);
        }
        if (results.length > 0) break;

        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return results;
}

function scanOntologyDir(dir: string, results: AvailableOntology[]): void {
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const pkgYaml = resolve(dir, entry.name, 'memo.package.yaml');
            if (!existsSync(pkgYaml)) continue;

            try {
                const raw = readFileSync(pkgYaml, 'utf-8');
                const parsed = parseYaml(raw);
                const type = parsed?.type ?? '';
                if (type === 'ontology' || type === 'profile') {
                    const name = parsed.name ?? entry.name;
                    if (!results.find(r => r.name === name)) {
                        results.push({
                            name,
                            version: parsed.version ?? '0.0.0',
                            type,
                            description: parsed.description ?? '',
                            extends: parsed.extends,
                            path: pkgYaml,
                        });
                    }
                }
            } catch {
                // skip malformed
            }
        }
    } catch {
        // skip unreadable
    }
}

export function listOntologiesCommand(): void {
    const ontologies = discoverOntologies(process.cwd());

    if (ontologies.length === 0) {
        console.log(chalk.yellow('No ontology packages found in the workspace.'));
        return;
    }

    console.log(chalk.bold('\nAvailable ontology packages:\n'));
    for (const ont of ontologies) {
        const marker = ont.name === DEFAULT_ONTOLOGY ? chalk.green(' (default)') : '';
        console.log(`  ${chalk.cyan(ont.name)}${marker}`);
        console.log(`    ${chalk.gray(`v${ont.version} · ${ont.type}`)}`);
        if (ont.description) {
            console.log(`    ${chalk.gray(ont.description)}`);
        }
        if (ont.extends) {
            console.log(`    ${chalk.gray(`extends: ${ont.extends}`)}`);
        }
        console.log();
    }

    console.log(chalk.gray(`  Usage: memo init <name> --ontology <package-name>\n`));
}

export interface AvailableExample {
    id: string;
    name: string;
    description: string;
    path: string;
}

export function discoverExamples(fromDir: string): AvailableExample[] {
    const results: AvailableExample[] = [];
    let dir = resolve(fromDir);

    while (true) {
        const examplesDir = resolve(dir, 'examples');
        if (existsSync(examplesDir)) {
            try {
                const entries = readdirSync(examplesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const configPath = resolve(examplesDir, entry.name, 'memo.config.yaml');
                    if (!existsSync(configPath)) continue;
                    try {
                        const raw = readFileSync(configPath, 'utf-8');
                        const parsed = parseYaml(raw);
                        const firstLine = raw.split('\n')[0] ?? '';
                        const description = firstLine.startsWith('#') ? firstLine.replace(/^#\s*/, '') : '';
                        results.push({
                            id: entry.name,
                            name: parsed?.projectName ?? entry.name,
                            description,
                            path: resolve(examplesDir, entry.name),
                        });
                    } catch { /* skip malformed */ }
                }
            } catch { /* skip unreadable */ }
            if (results.length > 0) break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // Fallback: check the vendor submodule examples path relative to the CLI package
    if (results.length === 0) {
        const cliDir = dirname(fileURLToPath(import.meta.url));
        const submoduleExamples = resolve(cliDir, '../../../../memo/src/examples');
        if (existsSync(submoduleExamples)) {
            try {
                const entries = readdirSync(submoduleExamples, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const configPath = resolve(submoduleExamples, entry.name, 'memo.config.yaml');
                    if (!existsSync(configPath)) continue;
                    try {
                        const raw = readFileSync(configPath, 'utf-8');
                        const parsed = parseYaml(raw);
                        const firstLine = raw.split('\n')[0] ?? '';
                        const description = firstLine.startsWith('#') ? firstLine.replace(/^#\s*/, '') : '';
                        results.push({
                            id: entry.name,
                            name: parsed?.projectName ?? entry.name,
                            description,
                            path: resolve(submoduleExamples, entry.name),
                        });
                    } catch { /* skip malformed */ }
                }
            } catch { /* skip unreadable */ }
        }
    }

    return results;
}

export interface InitOptions {
    template: string;
    ontology: string;
    archetype?: string;
    listOntologies?: boolean;
    example?: string;
    fromExample?: string;
}

/** Match an example by exact id, then unique prefix, then unique substring (e.g. "gpca" → "gpca-pump"). */
function matchExample(examples: AvailableExample[], query: string): { example?: AvailableExample; candidates: AvailableExample[] } {
    const exact = examples.find(e => e.id === query);
    if (exact) return { example: exact, candidates: [exact] };

    let candidates = examples.filter(e => e.id.startsWith(query));
    if (candidates.length === 0) {
        candidates = examples.filter(e => e.id.includes(query));
    }
    return { example: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

export async function initCommand(
    name: string | undefined,
    options: InitOptions
): Promise<void> {
    const archetypes = await loadArchetypes(process.cwd());

    if (options.listOntologies) {
        listOntologiesCommand();

        const examples = discoverExamples(process.cwd());
        if (examples.length > 0) {
            console.log(chalk.bold('Available examples:\n'));
            for (const ex of examples) {
                console.log(`  ${chalk.cyan(ex.id)}`);
                if (ex.description) {
                    console.log(`    ${chalk.gray(ex.description)}`);
                }
            }
            console.log(chalk.gray(`\n  Usage: memo init <name> --example <id>\n`));
        }

        const profiles = profileArchetypes(archetypes);
        if (profiles.length > 0) {
            console.log(chalk.bold('Available profiles (from SysML archetypes):\n'));
            for (const p of profiles) {
                console.log(`  ${chalk.cyan(p.id)}`);
                console.log(`    ${chalk.gray(p.description)}`);
                console.log();
            }
        }

        const devices = deviceClassArchetypes(archetypes);
        console.log(chalk.bold('Available device archetypes:\n'));
        for (const a of devices) {
            console.log(`  ${chalk.cyan(a.id)}`);
            console.log(`    ${chalk.gray(a.description)}`);
        }
        console.log(chalk.gray(`\n  Usage: memo init <name> --archetype <id>\n`));
        return;
    }

    const exampleQuery = options.example ?? options.fromExample;
    if (exampleQuery) {
        const examples = discoverExamples(process.cwd());
        const { example, candidates } = matchExample(examples, exampleQuery);
        if (!example) {
            if (candidates.length > 1) {
                console.error(chalk.red(`❌ Example "${exampleQuery}" is ambiguous.`));
                console.log(chalk.gray('Matches: ' + candidates.map(e => e.id).join(', ')));
            } else {
                console.error(chalk.red(`❌ Unknown example "${exampleQuery}".`));
                if (examples.length > 0) {
                    console.log(chalk.gray('Available: ' + examples.map(e => e.id).join(', ')));
                }
            }
            process.exit(1);
        }

        const inPlace = !name || name === '.';
        const projectDir = inPlace ? process.cwd() : resolve(process.cwd(), name!);
        if (inPlace) {
            const visibleEntries = readdirSync(projectDir).filter(f => !f.startsWith('.'));
            if (visibleEntries.length > 0) {
                console.error(chalk.red('❌ Current directory is not empty.'));
                console.log(chalk.gray(`  Run in an empty directory, or pass a name: memo init <name> --example ${example.id}`));
                process.exit(1);
            }
        } else if (existsSync(projectDir)) {
            console.error(chalk.red(`❌ Directory "${name}" already exists.`));
            process.exit(1);
        }

        console.log(chalk.bold(`\n📦 Creating project from example: ${example.id}\n`));
        cpSync(example.path, projectDir, { recursive: true });
        console.log(chalk.green(inPlace
            ? `\n✅ Project created in current directory`
            : `\n✅ Project created at ./${name}`));
        console.log(chalk.gray(`\n  Next steps:`));
        if (!inPlace) console.log(chalk.gray(`    cd ${name}`));
        console.log(chalk.gray(`    memo dev\n`));
        return;
    }

    const inPlace = !name || name === '.';
    const projectDir = inPlace ? process.cwd() : resolve(process.cwd(), name!);
    const projectName = basename(projectDir);

    if (inPlace) {
        const existingConfig = findConfigFile(projectDir);
        if (existingConfig) {
            console.error(chalk.red(`❌ This directory is already a MEMO project (${basename(existingConfig)} exists).`));
            process.exit(1);
        }
    } else if (existsSync(projectDir)) {
        console.error(chalk.red(`❌ Directory "${name}" already exists.`));
        process.exit(1);
    }

    let selectedArchetype: ArchetypeInfo | undefined;
    let regulatoryClass: 'class-i' | 'class-ii' | 'class-iii-iib' = 'class-ii';

    if (options.archetype) {
        selectedArchetype = findArchetype(archetypes, options.archetype);
        if (!selectedArchetype) {
            console.error(chalk.red(`❌ Unknown archetype "${options.archetype}".`));
            console.log(chalk.gray('Available: ' + archetypes.map(a => a.id).join(', ')));
            process.exit(1);
        }
    } else if (options.ontology === DEFAULT_ONTOLOGY && process.stdin.isTTY) {
        try {
            const wizResult = await runWizard(deviceClassArchetypes(archetypes));
            selectedArchetype = findArchetype(archetypes, wizResult.archetypeId);
            regulatoryClass = wizResult.regulatoryClass;
        } catch {
            selectedArchetype = findArchetype(archetypes, 'blank');
        }
    }

    if (!selectedArchetype) {
        selectedArchetype = findArchetype(archetypes, 'blank');
    }

    const ontology = options.ontology;

    const available = discoverOntologies(process.cwd());
    const selectedOnt = available.find(o => o.name === ontology);
    if (available.length > 0 && !selectedOnt) {
        console.error(chalk.red(`❌ Ontology "${ontology}" not found.\n`));
        console.log(chalk.gray('Available ontologies:'));
        for (const o of available) {
            console.log(chalk.gray(`  - ${o.name} (${o.type})`));
        }
        console.log();
        process.exit(1);
    }

    console.log(chalk.bold(`\n📦 Creating MEMO project: ${projectName}\n`));
    if (selectedArchetype && selectedArchetype.id !== 'blank') {
        console.log(chalk.gray(`  Archetype: ${selectedArchetype.label}`));
        if (selectedArchetype.includedStandards.length > 0) {
            console.log(chalk.gray(`  Standards: ${selectedArchetype.includedStandards.join(', ')}`));
        }
    }
    if (ontology !== DEFAULT_ONTOLOGY) {
        console.log(chalk.gray(`  Ontology: ${ontology}`));
    }
    console.log();

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(resolve(projectDir, 'model'), { recursive: true });

    let packageContent = `# ${projectName} — MEMO device model
name: "${projectName}"
version: "0.1.0"
type: device
extends: "${ontology}"
description: "MEMO device model project"
`;

    if (selectedArchetype && selectedArchetype.id !== 'blank') {
        packageContent += `archetype: "${selectedArchetype.id}"\n`;
    }

    writeFileSync(resolve(projectDir, 'memo.package.yaml'), packageContent);
    console.log(chalk.gray(`  Created memo.package.yaml (extends ${ontology})`));

    const templatePath = resolveArchetypeTemplate(selectedArchetype, process.cwd());
    const modelFilePath = resolve(projectDir, 'model', `${projectName}.sysml`);

    if (templatePath) {
        const templateContent = readFileSync(templatePath, 'utf-8');
        const firstPackageNameMatch = templateContent.match(/^package\s+\w+/m);
        const firstPackageName = firstPackageNameMatch ? firstPackageNameMatch[0].split(/\s+/)[1] : null;
        let content = templateContent;
        if (firstPackageName) {
            content = content.replace(
                new RegExp(`^package ${firstPackageName}`, 'm'),
                `package ${toIdentifier(projectName)}`
            );
        }
        const header = `// ${projectName} — MEMO Device Model\n// Generated by \`memo init\`\n//\n${regulatoryComment(regulatoryClass, selectedArchetype?.label ?? '')}\n\n`;
        writeFileSync(modelFilePath, header + content);
        console.log(chalk.gray(`  Created model/${projectName}.sysml (from ${selectedArchetype?.id ?? 'blank'} archetype)`));

        const elementTypes = extractElementSummary(header + content);
        if (elementTypes.length > 0) {
            console.log(chalk.gray(`  Scaffolded: ${elementTypes.join(', ')}`));
        }
    } else {
        const sysmlContent = `// ${projectName} — SysML v2 Model
// Generated by \`memo init\`

package ${toIdentifier(projectName)} {
    import ${ONTOLOGY_ROOT_IMPORT}::*;

    part ${toIdentifier(projectName)}System : System {
        attribute redefines name = "${projectName}";
    }

    requirement mainRequirement : Requirement {
        attribute redefines title = "Main system requirement";
        doc /* TODO: define your first system requirement */
    }

    requirement exampleHazard : Hazard {
        attribute redefines title = "Example hazard";
        doc /* TODO: identify hazards per ISO 14971 */
    }
}
`;
        writeFileSync(modelFilePath, sysmlContent);
        console.log(chalk.gray(`  Created model/${projectName}.sysml`));
    }

    const configPath = findConfigFile(projectDir);
    if (configPath) {
        try {
            const { lock } = createLockFile(configPath);
            console.log(chalk.gray(`  Created memo.lock.yaml (locked to ${lock.ontology} v${lock.version})`));
        } catch (e) {
            console.log(chalk.yellow(`  ⚠ Could not create lock file: ${e instanceof Error ? e.message : e}`));
        }
    }

    console.log(chalk.green(inPlace
        ? `\n✅ Project created in current directory`
        : `\n✅ Project created at ./${projectName}`));
    console.log(chalk.gray(`\n  Next steps:`));
    if (!inPlace) console.log(chalk.gray(`    cd ${projectName}`));
    console.log(chalk.gray(`    memo dev\n`));
    console.log(chalk.gray(`  Then open http://localhost:3000 — the Dashboard shows your model status.\n`));
}

function resolveArchetypeTemplate(archetype: ArchetypeInfo | undefined, fromDir: string): string | null {
    if (!archetype || !archetype.templateDir) return null;

    let dir = resolve(fromDir);
    while (true) {
        const templateDir = resolve(dir, VENDOR_ONTOLOGY_PACKAGES_DIR, 'medical-modeling-profile', 'templates', archetype.templateDir);
        if (existsSync(templateDir)) {
            const starterPath = resolve(templateDir, 'starter.sysml');
            if (existsSync(starterPath)) return starterPath;
            const modelPath = resolve(templateDir, 'model.sysml');
            if (existsSync(modelPath)) return modelPath;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function extractElementSummary(content: string): string[] {
    const kinds = new Set<string>();
    const labels: Record<string, string> = {
        Requirement: 'requirements',
        HazardousSituation: 'hazardous situations', Harm: 'harms', RiskControl: 'risk controls',
        Actor: 'actors', Stakeholder: 'stakeholders', UseCase: 'use cases',
        System: 'system architecture', SoftwareComponent: 'software components', Test: 'tests',
    };
    for (const [pattern, label] of Object.entries(labels)) {
        const regex = new RegExp(`:\\s*${pattern}\\b`);
        if (regex.test(content)) kinds.add(label);
    }
    return [...kinds].slice(0, 6);
}

function toIdentifier(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
