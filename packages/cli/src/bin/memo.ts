#!/usr/bin/env node
// ─── MEMO CLI Entry Point ────────────────────────────────────────────────────
//
// Commands:
//   memo dev            — Start development server with live reload
//   memo validate       — Validate model against closure rules
//   memo init           — Scaffold a new project
//   memo build          — Build static HTML site with embedded model
//   memo export json    — Export model as JSON
//   memo export dot     — Export model as Graphviz DOT
//   memo ontology show  — Show resolved ontology summary
//   memo ontology export— Export ontology as OWL/RDF or a SysAnd project
//   memo check          — Check model compatibility (--sysml-compat)
//   memo round-trip     — Predict round-trip conformance with external tools
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import { validateCommand } from '../commands/validate.js';
import { devCommand } from '../commands/dev.js';
import { initCommand } from '../commands/init.js';
import { buildCommand } from '../commands/build.js';
import { exportJsonCommand, exportDotCommand } from '../commands/export.js';
import {
    exportDhfCommand,
    dhfStatusCommand,
    dhfSnapshotCommand,
    dhfDiffCommand,
    dhfRedlineCommand,
    dhfReviewPacketCommand,
} from '../commands/dhf.js';
import {
    ontologyShowCommand,
    ontologyExportOwlCommand,
    ontologyExportSysandCommand,
    ontologyAddKindCommand,
} from '../commands/ontology.js';
import { importCsvCommand, importRelCsvCommand, importTemplateCommand, importDiffCommand } from '../commands/import.js';
import { importEaCommand, importCameoCommand } from '../commands/import-ea.js';
import { importSysandCommand } from '../commands/import-sysand.js';
import { importOwlCommand } from '../commands/import-owl.js';
import { sysandPublishCommand } from '../commands/sysand-publish.js';
import { lockCommand } from '../commands/lock.js';
import { installCommand } from '../commands/install.js';
import { createPackageCommand } from '../commands/create-package.js';
import { askCommand } from '../commands/ask.js';
import { generateCommand } from '../commands/generate.js';
import { dhfDraftCommand } from '../commands/dhf-draft.js';
import { dhfInitCommand } from '../commands/dhf-init.js';
import { dhfPreviewCommand } from '../commands/dhf-preview.js';
import { pluginListCommand, pluginCreateCommand, pluginRunCommand } from '../commands/plugin.js';
import { reqNewCommand } from '../commands/req.js';
import { checkCommand } from '../commands/check.js';
import { roundTripCommand } from '../commands/roundtrip.js';
import { rulesListCommand, rulesCheckCommand, rulesExplainCommand, rulesCoverageCommand } from '../commands/rules.js';

const program = new Command();

program
    .name('memo')
    .description('MEMO — Model-Based Systems Engineering for Medical Devices')
    .version('0.4.3');

program
    .command('validate')
    .description('Validate the model against closure rules and show completeness')
    .argument('[dir]', 'Project directory', '.')
    .option('--format <format>', 'Output format: text, junit, json', 'text')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .action(async (dir: string, opts: { format?: string; output?: string }) => {
        await validateCommand(dir, { format: opts.format as any, output: opts.output });
    });

program
    .command('dev')
    .description('Start development server with live model reload')
    .option('-p, --port <port>', 'Server port', '3000')
    .option('--no-open', 'Do not open browser')
    .action(async (options: { port: string; open: boolean }) => {
        await devCommand({
            port: parseInt(options.port, 10),
            open: options.open,
        });
    });

program
    .command('init')
    .description('Scaffold a new MEMO project')
    .argument('[name]', 'Project name')
    .option('-t, --template <template>', 'Template to use', 'medical')
    .option('--ontology <package>', 'Ontology package to use', '@memo/medical-modeling-profile')
    .option('--archetype <id>', 'Device archetype (samd, connected, monitoring, infusion_pump, blank)')
    .option('--from-example <id>', 'Copy from an example project (e.g. gpca-pump)')
    .option('--list-ontologies', 'List available ontology packages and archetypes')
    .action(async (name: string | undefined, options: { template: string; ontology: string; archetype?: string; fromExample?: string; listOntologies?: boolean }) => {
        await initCommand(name, options);
    });

program
    .command('build')
    .description('Build a self-contained static HTML site with the model diagram')
    .option('-o, --output <dir>', 'Output directory', 'dist')
    .option('--single-file', 'Inline all assets into a single index.html')
    .option('--kpar', 'Also produce a .kpar archive (Knowledge Package Archive)')
    .action(async (options: { output: string; singleFile?: boolean; kpar?: boolean }) => {
        await buildCommand(options);
    });

const exportCmd = program
    .command('export')
    .description('Export model to various formats');

exportCmd
    .command('json')
    .description('Export full model as JSON')
    .option('-o, --output <file>', 'Output file path', 'memo-model.json')
    .option('--no-pretty', 'Minified JSON output')
    .action(async (options: { output: string; pretty: boolean }) => {
        await exportJsonCommand(options);
    });

exportCmd
    .command('dhf')
    .description('Export DHF documents (HTML, Markdown, DOCX)')
    .option('-o, --output <dir>', 'Output directory', 'dhf-output')
    .option('-t, --target <id>', 'Target document ID (e.g., rmp, har, fmea)')
    .option('-f, --format <fmt>', 'Output format: html, md, docx', 'html')
    .option('-g, --group <group>', 'Document group: risk, design, verification, compliance, all')
    .action(async (options: { output: string; target?: string; format?: string; group?: string }) => {
        await exportDhfCommand(options);
    });

exportCmd
    .command('dot')
    .description('Export model as Graphviz DOT format')
    .option('-o, --output <file>', 'Output file path', 'memo-model.dot')
    .option('--viewpoint <id>', 'Filter by viewpoint ID')
    .action(async (options: { output: string; viewpoint?: string }) => {
        await exportDotCommand(options);
    });

program
    .command('create-package')
    .description('Scaffold a new MEMO package (ontology, profile, or library)')
    .argument('<name>', 'Package name (e.g., @myorg/cardiac-ontology)')
    .option('-t, --type <type>', 'Package type: ontology, profile, library, device', 'ontology')
    .option('-e, --extends <package>', 'Package to extend (auto-set for profiles)')
    .option('-d, --description <desc>', 'Package description')
    .option('--author <author>', 'Package author')
    .option('--license <license>', 'License', 'Apache-2.0')
    .option('-o, --output <dir>', 'Output base directory', '.')
    .action(async (name: string, options: any) => {
        await createPackageCommand(name, options);
    });

program
    .command('install')
    .description('Install an ontology package (git URL, npm package, or local path)')
    .argument('<source>', 'Package source: git URL, npm package name, or local path')
    .option('--mode <mode>', 'Force install mode: git, npm, or local')
    .action(async (source: string, options: { mode?: string }) => {
        await installCommand(source, options as any);
    });

program
    .command('lock')
    .description('Regenerate memo.lock.yaml from the current ontology')
    .action(async () => {
        await lockCommand();
    });

// ─── memo ontology ──────────────────────────────────────────────────────────

const ontologyCmd = program
    .command('ontology')
    .description('Ontology management commands');

ontologyCmd
    .command('show')
    .description('Show resolved ontology summary (kinds, relationships, rules)')
    .action(async () => {
        await ontologyShowCommand();
    });

const ontologyExportCmd = ontologyCmd
    .command('export')
    .description('Export ontology to standard formats');

ontologyExportCmd
    .command('owl')
    .description('Export ontology as OWL/RDF (Turtle)')
    .option('-o, --output <file>', 'Output file path')
    .option('--namespace <uri>', 'Ontology namespace URI', 'https://sysand.dev/ontology/memo#')
    .action(async (options: { output?: string; namespace?: string }) => {
        await ontologyExportOwlCommand({ ...options, format: 'turtle' });
    });

ontologyExportCmd
    .command('xml')
    .description('Export ontology as OWL/RDF (XML)')
    .option('-o, --output <file>', 'Output file path')
    .option('--namespace <uri>', 'Ontology namespace URI', 'https://sysand.dev/ontology/memo#')
    .action(async (options: { output?: string; namespace?: string }) => {
        await ontologyExportOwlCommand({ ...options, format: 'xml' });
    });

ontologyExportCmd
    .command('sysand')
    .description('Export ontology dependency stack as a SysAnd project')
    .option('-o, --output <dir>', 'Output directory path')
    .action(async (options: { output?: string }) => {
        await ontologyExportSysandCommand(options);
    });

ontologyCmd
    .command('add-kind <name>')
    .description('Write a new SysML kind definition file into the local ontology folder')
    .requiredOption('-l, --layer <layer>', 'Ontology layer path (e.g. requirements, architecture/risk)')
    .option('-o, --output <dir>', 'Override output directory (default: ontology/<layer>)')
    .action((name: string, options: { layer: string; output?: string }) => {
        ontologyAddKindCommand(name, options);
    });

// ─── memo import ──────────────────────────────────────────────────────────

const importCmd = program
    .command('import')
    .description('Import models from CSV, Sparx EA, Cameo, SysAnd, or OWL/JSON-LD');

importCmd
    .command('csv')
    .description('Import elements from a CSV file (generates .sysml)')
    .argument('<file>', 'CSV file path')
    .option('-o, --output <file>', 'Output .sysml file path')
    .option('--package <name>', 'SysML package name')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (file: string, options: { output?: string; package?: string; dryRun?: boolean }) => {
        await importCsvCommand(file, options);
    });

importCmd
    .command('csv-rel')
    .description('Import relationships from a CSV file (generates .sysml)')
    .argument('<file>', 'CSV file path')
    .option('-o, --output <file>', 'Output .sysml file path')
    .option('--package <name>', 'SysML package name')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (file: string, options: { output?: string; package?: string; dryRun?: boolean }) => {
        await importRelCsvCommand(file, options);
    });

importCmd
    .command('template')
    .description('Generate a template CSV based on the ontology (elements or relationships)')
    .argument('<type>', 'Template type: "elements" or "relationships"')
    .option('-o, --output <file>', 'Output CSV file path')
    .action(async (type: string, options: { output?: string }) => {
        await importTemplateCommand(type, options);
    });

importCmd
    .command('diff')
    .description('Preview what a CSV import would change without modifying the model')
    .argument('<file>', 'CSV file path')
    .option('--detect-removals', 'Also report elements in the model missing from the CSV')
    .action(async (file: string, options: { detectRemovals?: boolean }) => {
        await importDiffCommand(file, options);
    });

importCmd
    .command('ea')
    .description('Import from Sparx EA JSON export (.json)')
    .argument('<file>', 'EA JSON export file')
    .option('-o, --output <file>', 'Output .sysml file path')
    .option('--package <name>', 'SysML package name')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (file: string, options: { output?: string; package?: string; dryRun?: boolean }) => {
        await importEaCommand(file, options);
    });

importCmd
    .command('cameo')
    .description('Import from MagicDraw/Cameo XMI or JSON (.xml/.json)')
    .argument('<file>', 'Cameo XMI/XML or JSON file')
    .option('-o, --output <file>', 'Output .sysml file path')
    .option('--package <name>', 'SysML package name')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (file: string, options: { output?: string; package?: string; dryRun?: boolean }) => {
        await importCameoCommand(file, options);
    });

importCmd
    .command('sysand')
    .description('Import a SysAnd project directory (.project.json + SysML files)')
    .argument('<dir>', 'SysAnd project directory')
    .option('--verify', 'Verify round-trip against current ontology')
    .action(async (dir: string, options: { verify?: boolean }) => {
        await importSysandCommand(dir, options);
    });

importCmd
    .command('owl')
    .description('Import an OWL/Turtle or JSON-LD ontology')
    .argument('<file>', 'OWL/Turtle (.ttl/.owl) or JSON-LD (.jsonld/.json) file')
    .option('-o, --output <file>', 'Output .sysml file path')
    .option('--package <name>', 'SysML package name')
    .option('--package-dir <dir>', 'Create full ontology package directory')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (file: string, options: { output?: string; package?: string; packageDir?: string; dryRun?: boolean }) => {
        await importOwlCommand(file, options);
    });

// ─── memo ask ────────────────────────────────────────────────────────────────

program
    .command('ask')
    .description('Ask a question about the model using LLM')
    .argument('<question>', 'Natural language question about the model')
    .option('--layer <layer>', 'Filter context to a specific layer')
    .option('--kind <kind>', 'Filter context to a specific kind')
    .action(async (question: string, options: { layer?: string; kind?: string }) => {
        await askCommand(question, options);
    });

// ─── memo generate ───────────────────────────────────────────────────────────

program
    .command('generate')
    .description('Generate SysML from a natural language description using LLM')
    .argument('<description>', 'Natural language description of what to generate')
    .option('-o, --output <file>', 'Output .sysml file path (preview if omitted)')
    .option('--dry-run', 'Preview generated SysML without writing')
    .action(async (description: string, options: { output?: string; dryRun?: boolean }) => {
        await generateCommand(description, options);
    });

// ─── memo req ────────────────────────────────────────────────────────────────

const reqCmd = program
    .command('req')
    .description('Requirement authoring helpers');

reqCmd
    .command('new')
    .description('Generate a requirement stub from an EARS template')
    .requiredOption('-t, --template <template>', 'Template: ubi, event, state, opt, unwanted')
    .option('-o, --output <file>', 'Write stub to file (stdout if omitted)')
    .option('--id <reqId>', 'Requirement ID', 'REQ-001')
    .option('--title <title>', 'Requirement title', 'New Requirement')
    .action(async (options: { template: 'ubi' | 'event' | 'state' | 'opt' | 'unwanted'; output?: string; id?: string; title?: string }) => {
        await reqNewCommand({
            template: options.template,
            output: options.output,
            id: options.id,
            title: options.title,
        });
    });

// ─── memo plugin ─────────────────────────────────────────────────────────────

const pluginCmd = program
    .command('plugin')
    .description('Plugin management commands');

pluginCmd
    .command('list')
    .description('List configured plugins')
    .action(async () => {
        await pluginListCommand();
    });

pluginCmd
    .command('create')
    .description('Scaffold a new plugin')
    .argument('<name>', 'Plugin name')
    .option('-t, --type <type>', 'Plugin type: export, analysis, validation, generator', 'export')
    .option('-d, --description <desc>', 'Plugin description')
    .option('-o, --output <dir>', 'Output directory')
    .action(async (name: string, options: { type?: string; description?: string; output?: string }) => {
        await pluginCreateCommand(name, options);
    });

pluginCmd
    .command('run')
    .description('Run a generator or analysis plugin')
    .argument('<id>', 'Plugin ID')
    .option('--json', 'Output results as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
        await pluginRunCommand(id, options);
    });

// ─── memo dhf ────────────────────────────────────────────────────────────────

const dhfCmd = program
    .command('dhf')
    .description('Design History File workbench');

dhfCmd
    .command('init')
    .description('Scaffold DHF document set for your medical device project (interactive wizard)')
    .option('-d, --dir <path>', 'Project directory', '.')
    .action(async (options: { dir?: string }) => {
        await dhfInitCommand({ projectDir: options.dir });
    });

dhfCmd
    .command('preview')
    .description('Start local DHF preview server with live reload')
    .option('-p, --port <port>', 'Server port', '3001')
    .action(async (options: { port: string }) => {
        await dhfPreviewCommand({ port: parseInt(options.port, 10) });
    });

dhfCmd
    .command('status')
    .description('Show DHF document readiness status')
    .option('-v, --verbose', 'Show section-level detail')
    .option('-t, --target <id>', 'Target document ID')
    .action(async (options: { verbose?: boolean; target?: string }) => {
        await dhfStatusCommand(options);
    });

dhfCmd
    .command('snapshot')
    .description('Create a snapshot of current DHF document state')
    .option('-t, --target <id>', 'Target document ID (default: all)')
    .option('-l, --label <label>', 'Snapshot label')
    .action(async (options: { target?: string; label?: string }) => {
        await dhfSnapshotCommand(options);
    });

dhfCmd
    .command('diff')
    .description('Compare current state against latest snapshot')
    .requiredOption('-t, --target <id>', 'Target document ID')
    .action(async (options: { target: string }) => {
        await dhfDiffCommand(options);
    });

dhfCmd
    .command('redline')
    .description('Generate redline document showing changes from last snapshot')
    .requiredOption('-t, --target <id>', 'Target document ID')
    .option('-f, --format <fmt>', 'Output format: html, md, docx', 'html')
    .option('-o, --output <file>', 'Output file path')
    .action(async (options: { target: string; format?: string; output?: string }) => {
        await dhfRedlineCommand(options);
    });

dhfCmd
    .command('draft')
    .description('Use LLM to draft content for gap sections in a DHF document')
    .requiredOption('-t, --target <id>', 'Target document ID (e.g., rmp, har, fmea)')
    .option('-s, --section <id>', 'Draft only a specific section')
    .option('-f, --format <fmt>', 'Output format: html, md, docx', 'html')
    .option('-o, --output <dir>', 'Output directory', 'dhf-drafts')
    .action(async (options: { target: string; section?: string; format?: string; output?: string }) => {
        await dhfDraftCommand(options);
    });

dhfCmd
    .command('review-packet')
    .description('Generate a complete review packet of all DHF documents')
    .option('-f, --format <fmt>', 'Output format: html, md, docx', 'html')
    .option('-o, --output <dir>', 'Output directory')
    .action(async (options: { format?: string; output?: string }) => {
        await dhfReviewPacketCommand(options);
    });

// ─── memo sysand ────────────────────────────────────────────────────────────

const sysandCmd = program
    .command('sysand')
    .description('SysAnd tool interop commands');

sysandCmd
    .command('publish')
    .description('Validate and package ontology for SysAnd registry publication')
    .option('--dry-run', 'Validate without writing artifacts (default)')
    .option('-p, --package <name>', 'Publish a specific package from the config chain')
    .action(async (options: { dryRun?: boolean; package?: string }) => {
        await sysandPublishCommand({ ...options, dryRun: options.dryRun ?? true });
    });

// ─── memo check ─────────────────────────────────────────────────────────────

program
    .command('check')
    .description('Check model compatibility with SysML v2 tools')
    .argument('[dir]', 'Project directory', '.')
    .option('--sysml-compat', 'Run SysML v2 standard compatibility check')
    .option('--format <format>', 'Output format: text, json', 'text')
    .option('-o, --output <file>', 'Write report to file instead of stdout')
    .action(async (dir: string, opts: { sysmlCompat?: boolean; format?: string; output?: string }) => {
        await checkCommand(dir, { sysmlCompat: opts.sysmlCompat, format: opts.format as any, output: opts.output });
    });

// ─── memo round-trip ────────────────────────────────────────────────────────

program
    .command('round-trip')
    .description('Predict round-trip conformance with external SysML tools')
    .argument('[dir]', 'Project directory', '.')
    .option('--tool <tool>', 'Target tool: syson, syside, cameo', 'syson')
    .option('--format <format>', 'Output format: text, json', 'text')
    .option('-o, --output <file>', 'Write report to file instead of stdout')
    .action(async (dir: string, opts: { tool?: string; format?: string; output?: string }) => {
        await roundTripCommand(dir, { tool: opts.tool, format: opts.format as any, output: opts.output });
    });

// ─── memo rules ────────────────────────────────────────────────────────────

const rulesCmd = program
    .command('rules')
    .description('Consistency rule management');

rulesCmd
    .command('list')
    .description('List all consistency rules')
    .argument('[dir]', 'Project directory', '.')
    .option('--format <format>', 'Output format: text, json', 'text')
    .option('--category <category>', 'Filter by category: closure, coverage, lifecycle, crossLayer, quantitative')
    .action(async (dir: string, opts: { format?: string; category?: string }) => {
        await rulesListCommand(dir, { format: opts.format as any, category: opts.category });
    });

rulesCmd
    .command('check')
    .description('Evaluate rules against the current model')
    .argument('[dir]', 'Project directory', '.')
    .option('--format <format>', 'Output format: text, json', 'text')
    .action(async (dir: string, opts: { format?: string }) => {
        await rulesCheckCommand(dir, { format: opts.format as any });
    });

rulesCmd
    .command('explain')
    .description('Show detailed info for a specific rule')
    .argument('<ruleId>', 'Rule ID (e.g., CR-MED-001)')
    .argument('[dir]', 'Project directory', '.')
    .option('--format <format>', 'Output format: text, json', 'text')
    .action(async (ruleId: string, dir: string, opts: { format?: string }) => {
        await rulesExplainCommand(ruleId, dir, { format: opts.format as any });
    });

rulesCmd
    .command('coverage')
    .description('Show coverage rules grouped by regulatory standard')
    .argument('[dir]', 'Project directory', '.')
    .option('--format <format>', 'Output format: text, json', 'text')
    .action(async (dir: string, opts: { format?: string }) => {
        await rulesCoverageCommand(dir, { format: opts.format as any });
    });

program.parse();
