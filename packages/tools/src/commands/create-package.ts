// ─── memo create-package ─────────────────────────────────────────────────────
//
// Scaffolds a new MEMO package (ontology, profile, or library).
// Creates directory structure with memo.package.yaml, .project.json,
// SysML templates, and package.json.
//
// Usage:
//   memo create-package my-ontology --type ontology
//   memo create-package my-profile --type profile --extends @memo/ontology
//   memo create-package my-library --type library
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import type { ProjectType } from '@memo/tools';

interface CreatePackageOptions {
    type: ProjectType;
    extends?: string;
    description?: string;
    author?: string;
    license?: string;
    output?: string;
}

/** Default architecture layers for ontology packages */
const DEFAULT_LAYERS = [
    'purpose',
    'operational',
    'requirements',
    'functional',
    'logical',
    'physical',
    'software',
    'interfaces',
    'analysis',
    'verification',
    'relationships',
];

export async function createPackageCommand(
    name: string,
    options: CreatePackageOptions,
): Promise<void> {
    const type = options.type || 'ontology';
    const outputBase = options.output || process.cwd();
    const packageDir = resolve(outputBase, name);

    console.log(chalk.bold(`\n📦 MEMO Create Package\n`));

    // Validate name
    if (!/^[a-z0-9@/_-]+$/.test(name)) {
        console.error(chalk.red('❌ Package name must be lowercase alphanumeric with dashes/underscores.'));
        console.error(chalk.gray('   Example: @myorg/cardiac-ontology'));
        process.exit(1);
    }

    if (existsSync(packageDir)) {
        console.error(chalk.red(`❌ Directory already exists: ${packageDir}`));
        process.exit(1);
    }

    const extendsPackage = options.extends;
    if (type === 'profile' && !extendsPackage) {
        console.error(chalk.red('❌ Profile packages require an explicit --extends package.'));
        process.exit(1);
    }
    const description = options.description || `MEMO ${type} package`;
    const author = options.author || '';
    const license = options.license || 'Apache-2.0';

    console.log(chalk.gray(`  Name: ${name}`));
    console.log(chalk.gray(`  Type: ${type}`));
    if (extendsPackage) console.log(chalk.gray(`  Extends: ${extendsPackage}`));
    console.log(chalk.gray(`  Output: ${packageDir}`));
    console.log('');

    // Create directory structure
    mkdirSync(packageDir, { recursive: true });

    // 1. memo.package.yaml
    const packageYaml = buildPackageYaml(name, type, description, license, extendsPackage);
    writeFileSync(join(packageDir, 'memo.package.yaml'), packageYaml);

    // 2. .project.json (SysAnd manifest)
    const projectJson = buildProjectJson(name, type);
    writeFileSync(join(packageDir, '.project.json'), JSON.stringify(projectJson, null, 2) + '\n');

    // 3. package.json (npm manifest)
    const npmPackageJson = buildNpmPackageJson(name, description, license, author, extendsPackage);
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(npmPackageJson, null, 2) + '\n');

    // 4. Type-specific scaffolding
    if (type === 'ontology') {
        scaffoldOntology(packageDir, name);
    } else if (type === 'profile') {
        scaffoldProfile(packageDir, name, extendsPackage);
    } else if (type === 'library') {
        scaffoldLibrary(packageDir, name);
    } else {
        // device — minimal scaffolding
        scaffoldDevice(packageDir, name);
    }

    // 5. tsconfig.json
    writeFileSync(join(packageDir, 'tsconfig.json'), JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
            outDir: 'lib',
            rootDir: 'src',
        },
        include: ['src'],
    }, null, 2) + '\n');

    // 6. README.md
    const readme = `# ${name}\n\n${description}\n\n## Type\n\n${type}\n\n## Usage\n\n\`\`\`bash\nmemo install ${name}\n\`\`\`\n`;
    writeFileSync(join(packageDir, 'README.md'), readme);

    console.log(chalk.green(`✅ Package scaffolded at ${packageDir}`));
    console.log('');
    console.log(chalk.gray('  Files created:'));
    console.log(chalk.gray('    memo.package.yaml   — Package identity'));
    console.log(chalk.gray('    .project.json       — SysAnd manifest'));
    console.log(chalk.gray('    package.json        — npm manifest'));

    if (type === 'ontology') {
        console.log(chalk.gray('    sysml/              — SysML definitions (one dir per layer)'));
        console.log(chalk.gray('    memo.rendering.yaml — Layer colors'));
        console.log(chalk.gray('    src/index.ts        — TypeScript entrypoint'));
    } else if (type === 'profile') {
        console.log(chalk.gray('    memo.rules.yaml     — Closure rules'));
        console.log(chalk.gray('    memo.rendering.yaml — Layer colors'));
        console.log(chalk.gray('    templates/          — Project templates'));
    } else if (type === 'library') {
        console.log(chalk.gray('    sysml/              — Reusable model elements'));
    }

    console.log('');
    console.log(chalk.cyan('  Next steps:'));
    console.log(chalk.cyan(`    cd ${name}`));
    if (type === 'ontology') {
        console.log(chalk.cyan('    # Add kind definitions to sysml/<layer>/*.sysml'));
        console.log(chalk.cyan('    # Add relationship definitions to sysml/relationships/*.sysml'));
    } else if (type === 'profile') {
        console.log(chalk.cyan('    # Add closure rules to memo.rules.yaml'));
        console.log(chalk.cyan('    # Add viewpoints to memo.rules.yaml'));
    } else if (type === 'library') {
        console.log(chalk.cyan('    # Add reusable model elements to sysml/*.sysml'));
    }
    console.log('');
}

// ─── Scaffold helpers ─────────────────────────────────────────────────────

function scaffoldOntology(dir: string, name: string): void {
    // Create sysml layer directories with starter files
    const sysmlDir = join(dir, 'sysml');
    mkdirSync(sysmlDir, { recursive: true });

    // Index file
    const shortName = name.replace(/^@[^/]+\//, '').replace(/-/g, '_');
    const packageName = shortName.charAt(0).toUpperCase() + shortName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    let indexImports = '';
    for (const layer of DEFAULT_LAYERS) {
        const layerDir = join(sysmlDir, layer);
        mkdirSync(layerDir, { recursive: true });

        const layerFileName = `${layer}.sysml`;
        const layerPackageName = layer.charAt(0).toUpperCase() + layer.slice(1);
        const content = `package ${packageName}_${layerPackageName} {\n    // Add ${layer} kind definitions here\n    // Example: part def MyKind { }\n}\n`;
        writeFileSync(join(layerDir, layerFileName), content);

        indexImports += `    import ${packageName}_${layerPackageName}::*;\n`;
    }

    const indexContent = `package ${packageName} {\n${indexImports}}\n`;
    writeFileSync(join(sysmlDir, 'index.sysml'), indexContent);

    // memo.rendering.yaml with default layer colors
    const renderingYaml = `layers:
  - id: purpose
    label: "Purpose & Stakeholders"
    color: "#8B5CF6"
  - id: operational
    label: "Operational Analysis"
    color: "#EC4899"
  - id: requirements
    label: "Requirements"
    color: "#4A90D9"
  - id: functional
    label: "Functional Analysis"
    color: "#E67E22"
  - id: logical
    label: "Logical Architecture"
    color: "#7B68EE"
  - id: physical
    label: "Physical Architecture"
    color: "#95A5A6"
  - id: software
    label: "Software Architecture"
    color: "#F39C12"
  - id: interfaces
    label: "Interfaces & Ports"
    color: "#1ABC9C"
  - id: analysis
    label: "Analysis"
    color: "#6B7280"
  - id: verification
    label: "Verification"
    color: "#2ECC71"
`;
    writeFileSync(join(dir, 'memo.rendering.yaml'), renderingYaml);

    // src/index.ts
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'index.ts'), `// ${name} — ontology package entrypoint\nexport const PACKAGE_NAME = '${name}';\nexport const PACKAGE_TYPE = 'ontology';\n`);
}

function scaffoldProfile(dir: string, name: string, extendsPackage?: string): void {
    // Consistency rules as native SysML v2 `constraint def` bodies (KerML expressions).
    // The KerML evaluator (memo validate / memo rules check) runs these directly — no
    // proprietary rule format. Rule metadata travels as plain attribute members.
    const rulesSysml = `// Consistency rules for ${name} — native SysML v2 constraints.
// See @memo/medical-modeling-profile for examples.
package ${name.replace(/^@[^/]+\//, '').replace(/-/g, '_')}_Rules {
    // Example: every Requirement must trace to at least one stakeholder need.
    // constraint def requirementTraceRule {
    //     attribute id = "CR-001";
    //     attribute appliesTo = "Requirement";
    //     attribute severity = RuleSeverityKind::warning;
    //     attribute rationaleText = "Requirements shall be traceable to needs.";
    //     require constraint { traceTo->size() >= 1 }
    // }
}
`;
    const rulesDir = join(dir, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'rules.sysml'), rulesSysml);

    // memo.viewpoints.yaml with example viewpoint
    const viewpointsYaml = `# Viewpoints for ${name}
viewpoints: []
  # Example:
  # - id: risk-view
  #   label: "Risk Analysis"
  #   visibleKinds: [Hazard, HazardousSituation, Harm, RiskControl]
  #   visibleRelationships: [mitigates, leadsTo, causes]
  #   visibleLayers: [risk]
`;
    writeFileSync(join(dir, 'memo.viewpoints.yaml'), viewpointsYaml);

    // memo.rendering.yaml (empty — inherits from extended package)
    writeFileSync(join(dir, 'memo.rendering.yaml'), `# Layer rendering overrides for ${name}\n# Inherits from ${extendsPackage || 'base ontology'}\nlayers: []\n`);

    // templates directory
    const templateDir = join(dir, 'templates');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, 'starter.sysml'), `// Starter template for projects using ${name}\npackage StarterModel {\n    // Add starter elements here\n}\n`);

    // src/index.ts
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'index.ts'), `// ${name} — profile package entrypoint\nexport const PACKAGE_NAME = '${name}';\nexport const PACKAGE_TYPE = 'profile';\n`);
}

function scaffoldLibrary(dir: string, name: string): void {
    const sysmlDir = join(dir, 'sysml');
    mkdirSync(sysmlDir, { recursive: true });

    const shortName = name.replace(/^@[^/]+\//, '').replace(/-/g, '_');
    const packageName = shortName.charAt(0).toUpperCase() + shortName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    writeFileSync(join(sysmlDir, 'library.sysml'), `library package ${packageName}_Library {\n    // Add reusable model element instances here\n    // Example: part myComponent : LogicalComponent { }\n}\n`);

    // src/index.ts
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'index.ts'), `// ${name} — library package entrypoint\nexport const PACKAGE_NAME = '${name}';\nexport const PACKAGE_TYPE = 'library';\n`);
}

function scaffoldDevice(dir: string, name: string): void {
    const sysmlDir = join(dir, 'sysml');
    mkdirSync(sysmlDir, { recursive: true });

    const shortName = name.replace(/^@[^/]+\//, '').replace(/-/g, '_');
    const packageName = shortName.charAt(0).toUpperCase() + shortName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    writeFileSync(join(sysmlDir, 'model.sysml'), `package ${packageName} {\n    // Device model elements\n}\n`);
}

// ─── File generators ──────────────────────────────────────────────────────

function buildPackageYaml(
    name: string,
    type: ProjectType,
    description: string,
    license: string,
    extendsPackage?: string,
): string {
    let yaml = `name: "${name}"\n`;
    yaml += `version: "0.1.0"\n`;
    yaml += `type: ${type}\n`;
    if (extendsPackage) {
        yaml += `extends: "${extendsPackage}"\n`;
    }
    yaml += `description: "${description}"\n`;
    yaml += `license: "${license}"\n`;
    yaml += `tags: []\n`;
    return yaml;
}

function buildProjectJson(name: string, type: ProjectType): Record<string, unknown> {
    return {
        type: type === 'device' ? 'device-model' : `${type}-package`,
        name,
        version: '0.1.0',
        usage: type === 'ontology' ? ['kinds', 'relationships']
            : type === 'profile' ? ['rules', 'viewpoints']
            : type === 'library' ? ['elements']
            : ['model'],
    };
}

function buildNpmPackageJson(
    name: string,
    description: string,
    license: string,
    author: string,
    extendsPackage?: string,
): Record<string, unknown> {
    const pkg: Record<string, unknown> = {
        name,
        version: '0.1.0',
        description,
        type: 'module',
        license,
        main: 'src/index.ts',
        scripts: {
            build: 'tsc',
            clean: 'rm -rf lib/',
        },
    };
    if (author) pkg.author = author;
    if (extendsPackage) {
        pkg.dependencies = { [extendsPackage]: 'workspace:*' };
    }
    return pkg;
}
