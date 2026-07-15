// ─── Sysand Publish Dry-Run ─────────────────────────────────────────────────
//
// Simulates `sysand publish --dry-run` for MEMO's three publishable packages:
//   - @memo/sysml-base       (L0: ontology/core)
//   - @memo/ontology          (L1: ontology/architecture + compliance + manifest + viewpoints + views + root)
//   - @memo/methodology-default (L2: ontology/methodology)
//
// For each package the script:
//   P1: Validates .project.json metadata per FB2 (creates if missing)
//   P2: Collects SysML files and checks they are readable
//   P3: Computes the publishable .kpar artifact name
//   P4: Reports summary
//
// Exit code 0 = all pass; 1 = at least one failure.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ONTOLOGY_DIR = join(REPO_ROOT, 'memo', 'src');

const COLORS = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const PACKAGES = [
    {
        name: '@memo/sysml-base',
        version: '0.1.0',
        level: 'L0',
        description: 'MEMO SysML v2 base helpers — common types, enumerations, dimensions, methodology scope definitions.',
        dirs: ['core'],
        usage: ['kinds', 'enumerations', 'dimensions'],
        dependencies: [],
        license: 'Apache-2.0',
    },
    {
        name: '@memo/ontology',
        version: '0.1.0',
        level: 'L1',
        description: 'MEMO medical device ontology — architecture layers, compliance, risk, viewpoints, and relationships.',
        dirs: ['architecture', 'compliance', 'viewpoints'],
        rootFiles: ['medical_device_library.sysml'],
        usage: ['kinds', 'relationships', 'viewpoints'],
        dependencies: ['urn:kpar:memo-sysml-base'],
        license: 'Apache-2.0',
    },
    {
        name: '@memo/methodology-default',
        version: '0.1.0',
        level: 'L2',
        description: 'MEMO default methodology — comprehensive layer/standard/artifact/viewpoint selection with workflow and gates.',
        dirs: ['methodology'],
        usage: ['methodology', 'rules', 'gates', 'workflow'],
        dependencies: ['urn:kpar:memo-sysml-base', 'urn:kpar:memo-ontology'],
        license: 'Apache-2.0',
    },
];

const FB2_REQUIRED_FIELDS = ['name', 'version', 'license', 'usage'];

function collectSysmlFiles(dir) {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectSysmlFiles(p));
        else if (entry.name.endsWith('.sysml')) out.push(p);
    }
    return out;
}

function computeContentHash(files) {
    const hash = createHash('sha256');
    for (const f of files.sort()) {
        hash.update(readFileSync(f));
    }
    return hash.digest('hex').slice(0, 12);
}

function validateProjectJson(pkg) {
    const errors = [];
    const projectJsonPath = join(ONTOLOGY_DIR, pkg.dirs[0], '.project.json');

    if (existsSync(projectJsonPath)) {
        try {
            const data = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
            for (const field of FB2_REQUIRED_FIELDS) {
                if (!data[field]) {
                    errors.push(`FB2: .project.json missing required field "${field}"`);
                }
            }
        } catch (e) {
            errors.push(`FB2: .project.json parse error: ${e.message}`);
        }
    }
    // No .project.json is OK for dry-run — we generate the expected metadata
    return errors;
}

function buildExpectedProjectJson(pkg) {
    return {
        type: 'ontology-package',
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        description: pkg.description,
        usage: pkg.usage,
        dependencies: pkg.dependencies.map(d => ({ resource: d })),
    };
}

function sanitizeName(name) {
    return name.replace(/^@/, '').replace(/\//g, '-');
}

function dryRunPackage(pkg) {
    const result = {
        name: pkg.name,
        level: pkg.level,
        sysmlFiles: [],
        errors: [],
        warnings: [],
        kparName: null,
        projectJson: null,
        totalBytes: 0,
    };

    // Collect SysML files
    for (const dir of pkg.dirs) {
        const dirPath = join(ONTOLOGY_DIR, dir);
        if (!existsSync(dirPath)) {
            result.errors.push(`Source directory not found: ontology/${dir}/`);
            continue;
        }
        result.sysmlFiles.push(...collectSysmlFiles(dirPath));
    }

    // Root-level files
    if (pkg.rootFiles) {
        for (const f of pkg.rootFiles) {
            const fp = join(ONTOLOGY_DIR, f);
            if (existsSync(fp)) {
                result.sysmlFiles.push(fp);
            } else {
                result.warnings.push(`Root file not found: ontology/${f}`);
            }
        }
    }

    if (result.sysmlFiles.length === 0) {
        result.errors.push('No .sysml files found — nothing to publish');
        return result;
    }

    // Validate readability
    for (const f of result.sysmlFiles) {
        try {
            const content = readFileSync(f, 'utf-8');
            result.totalBytes += Buffer.byteLength(content, 'utf-8');
            if (content.trim().length === 0) {
                result.warnings.push(`Empty file: ${relative(ONTOLOGY_DIR, f)}`);
            }
        } catch (e) {
            result.errors.push(`Cannot read ${relative(ONTOLOGY_DIR, f)}: ${e.message}`);
        }
    }

    // Validate existing .project.json (per FB2)
    const fb2Errors = validateProjectJson(pkg);
    result.errors.push(...fb2Errors);

    // Build expected metadata
    result.projectJson = buildExpectedProjectJson(pkg);

    // Compute artifact name
    const contentHash = computeContentHash(result.sysmlFiles);
    const safeName = sanitizeName(pkg.name);
    result.kparName = `${safeName}-${pkg.version}.kpar`;
    result.contentHash = contentHash;

    return result;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log(COLORS.bold('\n📦 sysand publish --dry-run\n'));

let hasErrors = false;
const results = [];

for (const pkg of PACKAGES) {
    const result = dryRunPackage(pkg);
    results.push(result);

    const status = result.errors.length > 0 ? COLORS.red('FAIL') : COLORS.green('PASS');
    console.log(`${status}  ${COLORS.cyan(result.name)} ${COLORS.gray(`(${result.level})`)}`);
    console.log(COLORS.gray(`       ${result.sysmlFiles.length} files, ${formatBytes(result.totalBytes)}`));

    if (result.kparName) {
        console.log(COLORS.gray(`       artifact: ${result.kparName}`));
        console.log(COLORS.gray(`       content hash: ${result.contentHash}`));
    }

    if (result.projectJson) {
        console.log(COLORS.gray(`       .project.json:`));
        console.log(COLORS.gray(`         name: ${result.projectJson.name}`));
        console.log(COLORS.gray(`         version: ${result.projectJson.version}`));
        console.log(COLORS.gray(`         usage: [${result.projectJson.usage.join(', ')}]`));
        if (result.projectJson.dependencies.length > 0) {
            console.log(COLORS.gray(`         dependencies: [${result.projectJson.dependencies.map(d => d.resource).join(', ')}]`));
        }
    }

    for (const w of result.warnings) {
        console.log(COLORS.yellow(`       ⚠ ${w}`));
    }
    for (const e of result.errors) {
        console.log(COLORS.red(`       ✖ ${e}`));
        hasErrors = true;
    }

    console.log('');
}

// Summary
console.log(COLORS.bold('── Summary ──'));
const passed = results.filter(r => r.errors.length === 0).length;
const total = results.length;
const totalFiles = results.reduce((sum, r) => sum + r.sysmlFiles.length, 0);
const totalBytes = results.reduce((sum, r) => sum + r.totalBytes, 0);

console.log(`${passed}/${total} packages ready to publish`);
console.log(`${totalFiles} SysML files, ${formatBytes(totalBytes)} total`);

if (hasErrors) {
    console.log(COLORS.red('\n✖ Dry-run failed — fix errors above before publishing.\n'));
    process.exit(1);
} else {
    console.log(COLORS.green('\n✔ All packages pass dry-run. Ready for `sysand publish`.\n'));
    console.log(COLORS.gray('Publishable artifacts:'));
    for (const r of results) {
        console.log(COLORS.gray(`  ${r.kparName}  (${r.contentHash})`));
    }
    console.log('');
}
