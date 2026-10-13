// ─── The project commands, registered on whichever program offers them ───────
//
// MEMO Tools' own program (`memo`) compiles and validates. Everything else a
// person does with a project (creating one, authoring, packaging, exporting,
// the AI helpers, the regulatory workbench) is registered here and offered by
// memo-architect's program, so the two do not share a surface. The command
// implementations stay in this package: Architect's server and tests call the
// same functions.
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import { setCommandLineToolchain } from '../model/config-loader.js';
import { toolchainOverridesFromCliOptions } from '../toolchain/schema.js';
import { initCommand } from '../commands/init.js';
import { retiredCommand } from '../commands/retired.js';
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
import { importKpar, inspectKpar } from '../commands/package.js';
import { importOwlCommand } from '../commands/import-owl.js';
import { lockCommand } from '../commands/lock.js';
import { installCommand } from '../commands/install.js';
import { createPackageCommand } from '../commands/create-package.js';
import { askCommand } from '../commands/ask.js';
import { mcpCommand, mcpInitCommand } from '../commands/mcp.js';
import { generateCommand } from '../commands/generate.js';
import { dhfDraftCommand } from '../commands/dhf-draft.js';
import { dhfLintCommand } from '../commands/dhf-lint.js';
import { dhfInitCommand } from '../commands/dhf-init.js';
import { dhfPreviewCommand } from '../commands/dhf-preview.js';
import { pluginListCommand, pluginCreateCommand, pluginRunCommand } from '../commands/plugin.js';
import { reqNewCommand } from '../commands/req.js';
import { interfacesCommand, type InterfacesOptions } from '../commands/interfaces.js';
import {
    rulesTailoringCommand,
    rulesNewCommand,
    rulesTailorCommand,
} from '../commands/rules.js';
import {
    elementIdentitiesCommand,
    elementWriteCommand,
    type ElementIdentitiesOptions,
    type ElementWriteOptions,
} from '../commands/element.js';
import { convertCommand } from '../commands/convert.js';
import { applyToolchainCliOptions } from '../toolchain/schema.js';
import { defaultRegistry } from '../toolchain/default-registry.js';

export function registerProjectCommands(program: Command): void {
    const before = new Set(program.commands);
    const withToolchainOptions = (command: Command): Command =>
        applyToolchainCliOptions(command, defaultRegistry);

    // ─── memo-architect interfaces ─────────────────────────────────────────────

    withToolchainOptions(
        program
            .command('interfaces')
            .description('List every interface between two elements, of any kind or layer')
            .argument('<a>', 'First element (name or qualified id)')
            .argument('<b>', 'Second element (name or qualified id)')
            .option('--kind <kind>', 'Only interfaces of this ontology kind or a specialization of it, e.g. RosTopicInterface or SoftwareInterface')
            .option('--no-nested', 'Do not count ports of parts nested inside either element')
            .option('--format <format>', 'Output format: text, json', 'text'),
    ).action(async (a: string, b: string, opts: Record<string, unknown>) => {
        await interfacesCommand(a, b, opts as InterfacesOptions);
    });

    // ─── memo element ───────────────────────────────────────────────────────────
    //
    // The CLI surface for authoring write-back, so the operation Architect calls is
    // scriptable too (§1.2.2 rule 2). Same implementation, same lowering provider.

    const elementCmd = program
        .command('element')
        .description('Author model source through the toolchain');

    withToolchainOptions(
        elementCmd
            .command('identities')
            .description('Print the IR identity to quote when writing to each element')
            .argument('[dir]', 'Model directory', '.')
            .option('--id <id>', 'Restrict output to one element')
            .option('--format <format>', 'Output format: text, json', 'text'),
    ).action(async (dir: string, opts: Record<string, unknown>) => {
        await elementIdentitiesCommand(dir, opts as ElementIdentitiesOptions);
    });

    withToolchainOptions(
        elementCmd
            .command('write')
            .description('Write one element back to source and recompile')
            .argument('[dir]', 'Model directory', '.')
            .option('--id <id>', 'Element ID to create or update')
            .option('--name <name>', 'Display name')
            .option('--kind <kind>', 'Ontology kind')
            .option('--construct <construct>', 'SysML construct, e.g. part, action, requirement')
            .option('--layer <layer>', 'MEMO layer')
            .option('--doc <text>', 'Documentation body')
            .option('--attribute <key=value...>', 'Attribute assignment, repeatable')
            .option('--file <path>', 'Model-relative source file to write into')
            .option('--ir-identity <identity>', 'IR identity of the declaration being updated')
            .option('--renamed-from <id>', 'Previous element ID, when this write renames the declaration')
            .option('--by-id', 'Resolve the identity from --id instead of quoting one (cannot detect a stale view)')
            .option('--request <file>', 'JSON file holding the whole write request')
            .option('--format <format>', 'Output format: text, json', 'text'),
    ).action(async (dir: string, opts: Record<string, unknown>) => {
        await elementWriteCommand(dir, opts as ElementWriteOptions);
    });

    program
        .command('init')
        .description('Scaffold a new MEMO model')
        .argument('[name]', 'Model directory (omit or "." to initialize the current directory)')
        .option('--ontology <package>', 'Logical ontology package to use (defaults from the content manifest)')
        .option('--example <id>', 'Create from an example model (e.g. gpca)')
        .option('--list', 'List installed ontology packages and examples')
        .option('--no-install', 'Create the model without running npm install')
        .action(async (name: string | undefined, options: { ontology?: string; example?: string; list?: boolean; install?: boolean }) => {
            await initCommand(name, options);
        });

    program
        .command('convert')
        .description('Restructure a model into the native catalog layout (dry run unless --write)')
        .argument('[dir]', 'Model directory', '.')
        .option('--write', 'Apply the plan. Without it the command only reports what would change.')
        .option('--diff', 'Include per-file content hunks in the report')
        .option('--json', 'Emit the plan as JSON')
        .option('--normalize-names', 'Also rename in-place packages whose names do not mirror their location')
        .action(async (dir: string, options: { write?: boolean; diff?: boolean; json?: boolean; normalizeNames?: boolean }) => {
            await convertCommand(dir, options);
        });


    const exportCmd = program
        .command('export')
        .description('Export model to various formats');

    withToolchainOptions(
        exportCmd
            .command('json')
            .description('Export full model as JSON')
            .option('-o, --output <file>', 'Output file path', 'memo-model.json')
            .option('--no-pretty', 'Minified JSON output'),
    ).action(async (options: { output: string; pretty: boolean } & Record<string, unknown>) => {
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
        .command('install')
        .description('Install locked MEMO content, or add a package from git, npm, or a local path')
        .argument('[source]', 'Optional package source: git URL, npm package name, or local path')
        .option('--mode <mode>', 'Force install mode: git, npm, or local')
        .action(async (source: string | undefined, options: { mode?: string }) => {
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

    // ─── memo import ──────────────────────────────────────────────────────────

    const importCmd = program
        .command('import')
        .description('Import models from CSV, Sparx EA, Cameo, SysAnd, or OWL/JSON-LD, or a KPAR archive');

    importCmd
        .command('kpar')
        .description('Add a KPAR archive (as `memo pack` writes) to the project as a library, under .memo/libraries/kpar; --inspect only reads it')
        .argument('<archive>', 'KPAR archive path')
        .option('-C, --project <dir>', 'Model directory', '.')
        .option('--inspect', 'Print the archive\'s name, version, checksum and files, and import nothing')
        .action((archive: string, options: { project: string; inspect?: boolean }) => {
            console.log(JSON.stringify(options.inspect ? inspectKpar(archive) : importKpar(options.project, archive), null, 2));
        });

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

    // ─── memo mcp ────────────────────────────────────────────────────────────────

    // `init` is a positional argument rather than a subcommand: commander binds an
    // option declared on both a command and its subcommand to the parent, so
    // `memo mcp init --project X` would silently lose --project.
    program
        .command('mcp')
        .description('Serve the model to AI coding tools over the Model Context Protocol')
        .argument('[action]', 'Omit to serve; "init" to register the server with Cursor')
        .option('--project <dir>', 'Model directory (defaults to the current one)')
        .option('--write', 'Enable the model-editing tools (read-only by default)')
        .option('--no-rules', 'With "init", skip writing .cursor/rules/memo.mdc')
        .action(async (action: string | undefined, options: { project?: string; write?: boolean; rules?: boolean }) => {
            if (action === 'init') {
                await mcpInitCommand({
                    project: options.project,
                    write: options.write,
                    noRules: options.rules === false,
                });
                return;
            }
            if (action) {
                console.error(`Unknown action "${action}". Use \`memo mcp\` to serve, or \`memo mcp init\`.`);
                process.exit(1);
            }
            // Runs until the client closes stdin; stdout is reserved for JSON-RPC.
            await mcpCommand({ project: options.project, write: options.write, version: program.version() });
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
        .description('Scaffold DHF document set for your medical device model (interactive wizard)')
        .option('-d, --dir <path>', 'Model directory', '.')
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
        .command('lint')
        .description('Validate DHF templates against the ontology they query')
        .option('-f, --filter <prefix>', 'Only lint templates whose id starts with this prefix')
        .option('--structural-only', 'Skip ontology resolution; check frontmatter and query syntax only')
        .option('--json', 'Emit JSON for CI')
        .action(async (options: { filter?: string; structuralOnly?: boolean; json?: boolean }) => {
            await dhfLintCommand(options);
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

    // ─── memo rules ────────────────────────────────────────────────────────────

    const rulesCmd = program
        .command('rules')
        .description('Consistency rule management');

    rulesCmd
        .command('tailoring')
        .description('The record of every rule switched off, downgraded or replaced, with who decided and why')
        .argument('[dir]', 'Model directory', '.')
        .option('--format <format>', 'Output format: text, json, markdown', 'text')
        .action(async (dir: string, opts: { format?: string }) => {
            await rulesTailoringCommand(dir, { format: opts.format as 'text' | 'json' | 'markdown' });
        });

    rulesCmd
        .command('tailor')
        .description('Switch off or re-grade one rule, every rule of a standard, or every rule on a layer, as one recorded policy')
        .argument('[dir]', 'Model directory', '.')
        .option('--rule <rule>', 'One rule: its id or constraint def name')
        .option('--standard <standard>', 'Every rule that enforces a clause of this standard, e.g. "ISO 14971"')
        .option('--category <layer>', "Every rule whose subject kind is in this layer (the discipline), by its namespace, e.g. memo_assurance_safety_risk")
        .option('--disable', 'Switch the selected rules off (needs --rationale)')
        .option('--severity <severity>', 'Change the severity to error, warning or info')
        .option('--replace-with <rule>', 'Replace one rule with another constraint def (--rule only)')
        .option('--rationale <text>', 'Why: required to disable or replace')
        .option('--authority <text>', 'Who decided')
        .option('--approval <reference>', 'The approval reference')
        .option('--file <path>', 'Model-relative .sysml file with the model binding or methodology to write the policy into')
        .option('--dry-run', 'Show the rules the policy would reach and write nothing')
        .action(async (dir: string, opts: Record<string, unknown>) => {
            await rulesTailorCommand(dir, opts as import('../commands/rules.js').RulesTailorOptions);
        });

    // ─── memo-architect new ─────────────────────────────────────────────────────
    //
    // One verb to create a thing; the kind is the subcommand.

    const newCmd = program
        .command('new')
        .description('Create a package, requirement, rule, ontology kind or plugin');

    newCmd
        .command('package')
        .description('Scaffold a new MEMO package (ontology, profile, library or device)')
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

    newCmd
        .command('requirement')
        .description('Generate a requirement stub from an EARS pattern')
        .requiredOption('-p, --pattern <pattern>', 'EARS pattern: ubi, event, state, opt, unwanted')
        .option('-o, --output <file>', 'Write stub to file (stdout if omitted)')
        .option('--id <reqId>', 'Requirement ID', 'REQ-001')
        .option('--title <title>', 'Requirement title', 'New Requirement')
        .action(async (options: { pattern: 'ubi' | 'event' | 'state' | 'opt' | 'unwanted'; output?: string; id?: string; title?: string }) => {
            await reqNewCommand({ template: options.pattern, output: options.output, id: options.id, title: options.title });
        });

    newCmd
        .command('rule')
        .description("Write a rule of this model's own: checked, previewed against the model, then written")
        .argument('[dir]', 'Model directory', '.')
        .requiredOption('--id <id>', 'The rule id, e.g. ORG-001')
        .requiredOption('--type <name>', 'The constraint def name, e.g. EveryUserHasALabel')
        .requiredOption('--applies-to <kind>', 'The kind the rule is checked on, e.g. Hazard')
        .requiredOption('--predicate <expression>', 'The condition; true means the element is fine')
        .requiredOption('--rationale <text>', 'Why the rule exists')
        .requiredOption('--file <path>', 'Model-relative .sysml file to write it into')
        .option('--severity <severity>', 'error, warning or info (default: from --obligation, else warning)')
        .option('--obligation <obligation>', 'required, recommended or bestPractice')
        .option('--tailoring <class>', 'assurance or methodology (default methodology)')
        .option('--enforces <clause...>', 'A clause the rule enforces: its qualified name, or "<standard> §<number>"')
        .option('--dry-run', 'Show what the rule would flag and write nothing')
        .action(async (dir: string, opts: Record<string, unknown>) => {
            await rulesNewCommand(dir, opts as import('../commands/rules.js').RulesNewOptions);
        });

    newCmd
        .command('kind')
        .description('Write a new SysML kind definition file into the local ontology folder')
        .argument('<name>', 'Kind name (PascalCase)')
        .requiredOption('-l, --layer <layer>', 'Ontology layer path (e.g. requirements, architecture/risk)')
        .option('-o, --output <dir>', 'Override output directory (default: ontology/<layer>)')
        .action((name: string, options: { layer: string; output?: string }) => {
            ontologyAddKindCommand(name, options);
        });

    newCmd
        .command('plugin')
        .description('Scaffold a new plugin')
        .argument('<name>', 'Plugin name')
        .option('-t, --type <type>', 'Plugin type: export, analysis, validation, generator', 'export')
        .option('-d, --description <desc>', 'Plugin description')
        .option('-o, --output <dir>', 'Output directory')
        .action(async (name: string, options: { type?: string; description?: string; output?: string }) => {
            await pluginCreateCommand(name, options);
        });

    // The old names, for one release.
    retiredCommand(program, 'create-package', 'memo-architect new package');
    retiredCommand(program, 'req', 'memo-architect new requirement --pattern <pattern>');
    retiredCommand(ontologyCmd, 'add-kind', 'memo-architect new kind');
    retiredCommand(pluginCmd, 'create', 'memo-architect new plugin');
    retiredCommand(program, 'sysand', 'memo publish');

    retiredCommand(rulesCmd, 'new', 'memo-architect new rule');
    retiredCommand(rulesCmd, 'check', 'memo validate');
    retiredCommand(rulesCmd, 'list', 'memo validate --rules');
    retiredCommand(rulesCmd, 'explain', 'memo validate --explain-rule <id>');

    retiredCommand(rulesCmd, 'coverage', 'memo validate --standards');


    // Every command registered here takes the `--toolchain.*` flags, and the running
    // command's flags apply to whatever settings it loads (model/config-loader.ts).
    const allCommands = (command: Command): Command[] => [command, ...command.commands.flatMap(allCommands)];
    for (const added of program.commands.filter(command => !before.has(command))) {
        for (const command of allCommands(added)) {
            if (command.commands.length > 0) continue;
            if (!command.options.some(option => option.attributeName() === 'toolchain.compiler')) withToolchainOptions(command);
        }
    }
    program.hook('preAction', (_program, action) => {
        setCommandLineToolchain(toolchainOverridesFromCliOptions(action.opts(), defaultRegistry));
    });
}
