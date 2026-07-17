// ─── memo import owl ─────────────────────────────────────────────────────────
//
// Import an OWL/Turtle or JSON-LD ontology into MEMO.
// Maps owl:Class → kinds, owl:ObjectProperty → relationships.
// Produces an ontology package with SysML files.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, basename, extname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import chalk from 'chalk';
import {
    importOwlTurtle,
    importJsonLd,
    owlResultToSysml,
    owlResultToPackage,
} from '@memoarchitect/tools';

/**
 * memo import owl <file> — Import an OWL/Turtle or JSON-LD file.
 *
 * Accepts:
 * - .ttl — OWL/Turtle format
 * - .owl — OWL/RDF (parsed as Turtle subset)
 * - .jsonld / .json — JSON-LD format
 *
 * Output modes:
 * - Default: single .sysml file with all definitions
 * - --package-dir: full ontology package directory with layer-organized SysML files
 */
export async function importOwlCommand(
    file: string,
    options: { output?: string; package?: string; packageDir?: string; dryRun?: boolean },
): Promise<void> {
    console.log(chalk.bold('\n\u{1F4E5} MEMO Import \u2190 OWL/JSON-LD\n'));

    const cwd = process.cwd();
    const filePath = resolve(cwd, file);
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${filePath}`));
        process.exit(1);
    }

    // Determine format
    const ext = extname(file).toLowerCase();
    let result;

    if (ext === '.jsonld' || ext === '.json') {
        result = importJsonLd(content);
    } else {
        // .ttl, .owl, or any other — treat as Turtle
        result = importOwlTurtle(content);
    }

    // Report
    if (result.ontologyIri) {
        console.log(chalk.cyan(`  Ontology: ${result.ontologyIri}`));
    }
    if (result.title) {
        console.log(chalk.cyan(`  Title:    ${result.title}`));
    }
    if (result.version) {
        console.log(chalk.cyan(`  Version:  ${result.version}`));
    }
    console.log(chalk.cyan(`  Classes:    ${result.stats.classes}`));
    console.log(chalk.cyan(`  Properties: ${result.stats.properties}`));

    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  \u26A0 ${warn}`));
    }
    for (const err of result.errors) {
        console.error(chalk.red(`  \u2716 ${err}`));
    }

    if (result.classes.length === 0 && result.properties.length === 0) {
        console.error(chalk.red('\nNo classes or properties found in the OWL file.'));
        process.exit(1);
    }

    const packageName = options.package || basename(file, extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');

    // Package directory mode
    if (options.packageDir) {
        const pkgFiles = owlResultToPackage(result, packageName);
        const outDir = resolve(cwd, options.packageDir);

        if (options.dryRun) {
            console.log(chalk.dim('\n── Generated package (dry run) ──'));
            for (const [path, content] of pkgFiles) {
                console.log(chalk.dim(`\n── ${path} ──`));
                console.log(content);
            }
            return;
        }

        for (const [path, fileContent] of pkgFiles) {
            const fullPath = resolve(outDir, path);
            mkdirSync(resolve(fullPath, '..'), { recursive: true });
            writeFileSync(fullPath, fileContent, 'utf-8');
        }
        console.log(chalk.green(`\n\u2705 Created ontology package with ${pkgFiles.size} files \u2192 ${options.packageDir}/\n`));
        for (const path of pkgFiles.keys()) {
            console.log(chalk.dim(`  ${path}`));
        }
        return;
    }

    // Single file mode
    const sysml = owlResultToSysml(result, packageName);

    if (options.dryRun) {
        console.log(chalk.dim('\n── Generated SysML (dry run) ──'));
        console.log(sysml);
        return;
    }

    const outputFile = options.output || `${packageName}.sysml`;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, sysml, 'utf-8');
    console.log(chalk.green(`\n\u2705 Imported ${result.classes.length} classes, ${result.properties.length} properties \u2192 ${outputFile}\n`));
}
