// ─── DHF Init Command ─────────────────────────────────────────────────────────
//
// Interactive wizard: asks about device type, markets, classification, SW safety
// class, then scaffolds a dhf/ directory with the appropriate template subset
// and a starter memo.dhf.yaml (v2).
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import * as yaml from 'yaml';

// ─── Template selection logic ─────────────────────────────────────────────────

interface DeviceProfile {
    deviceType: string;
    markets: string[];
    swSafetyClass: 'A' | 'B' | 'C';
    patientContact: boolean;
    sterile: boolean;
    electrical: boolean;
    cybersecurity: boolean;
}

function selectTemplates(profile: DeviceProfile): Array<{ group: string; templates: string[] }> {
    const groups: Array<{ group: string; templates: string[] }> = [];

    // Risk Management — always
    const riskTemplates = ['iso-14971/rmp', 'iso-14971/har', 'iso-14971/fmea', 'iso-14971/rmr', 'iso-14971/risk-benefit'];
    if (profile.electrical) riskTemplates.push('iso-14971/fta');
    groups.push({ group: 'risk_management', templates: riskTemplates });

    // Software — Class B or C always; Class A minimal
    if (profile.swSafetyClass !== 'A') {
        const swTemplates = [
            'iec-62304/sdp',
            'iec-62304/srs',
            'iec-62304/sad',
            'iec-62304/soup',
            'iec-62304/integration-test',
            'iec-62304/system-test',
            'iec-62304/sw-traceability',
            'iec-62304/sbom',
        ];
        if (profile.swSafetyClass === 'C') {
            swTemplates.push('iec-62304/detailed-design', 'iec-62304/change-control');
        }
        groups.push({ group: 'software', templates: swTemplates });
    }

    // Usability
    if (profile.patientContact) {
        groups.push({
            group: 'usability',
            templates: [
                'iec-62366/ue-plan',
                'iec-62366/use-spec',
                'iec-62366/urra',
                'iec-62366/ui-spec',
                'iec-62366/task-analysis',
                'iec-62366/formative-eval',
                'iec-62366/summative-eval',
            ],
        });
    }

    // Design controls — FDA/21 CFR 820
    if (profile.markets.includes('US')) {
        groups.push({
            group: 'design_controls',
            templates: [
                '21cfr820/user-needs',
                '21cfr820/design-input',
                '21cfr820/design-output',
                '21cfr820/design-review',
                '21cfr820/vv-plan',
                '21cfr820/vv-report',
                '21cfr820/transfer-plan',
                '21cfr820/design-verification',
                '21cfr820/design-validation',
                '21cfr820/change-record',
            ],
        });

        if (profile.cybersecurity) {
            groups.push({
                group: 'cybersecurity',
                templates: [
                    'fda-cybersecurity/threat-model',
                    'fda-cybersecurity/security-arch',
                    'fda-cybersecurity/vuln-assessment',
                    'fda-cybersecurity/postmarket-surveillance',
                    'fda-cybersecurity/incident-response',
                    'iec-62304/sbom',
                ],
            });
        }
    }

    // DHF index — always
    groups.push({ group: 'general', templates: ['21cfr820/dhf-index'] });

    return groups;
}

// ─── Scaffold dhf/ directory ──────────────────────────────────────────────────

function scaffoldDhfDirectory(
    projectDir: string,
    profile: DeviceProfile,
    templateGroups: Array<{ group: string; templates: string[] }>,
): void {
    const dhfDir = resolve(projectDir, 'dhf');

    for (const { group, templates } of templateGroups) {
        const groupDir = join(dhfDir, group.replace(/_/g, '-'));
        if (!existsSync(groupDir)) mkdirSync(groupDir, { recursive: true });

        for (const templateId of templates) {
            const filename = templateId.split('/').pop()! + '.md';
            const outputPath = join(groupDir, filename);

            if (!existsSync(outputPath)) {
                // Write a stub file referencing the built-in template
                writeFileSync(outputPath, [
                    '---',
                    `# This file is a DHF document for ${profile.deviceType}`,
                    `# Built-in template: ${templateId}`,
                    `# Edit this file to customize, or leave as-is to use the built-in template`,
                    '---',
                    '',
                    `{{include:${templateId}}}`,
                    '',
                ].join('\n'), 'utf-8');
            }
        }
    }
}

// ─── Generate memo.dhf.yaml ───────────────────────────────────────────────────

function generateDhfConfig(
    projectDir: string,
    companyName: string,
    productName: string,
    profile: DeviceProfile,
    templateGroups: Array<{ group: string; templates: string[] }>,
): void {
    const configPath = resolve(projectDir, 'memo.dhf.yaml');
    if (existsSync(configPath)) {
        console.log(chalk.yellow('  memo.dhf.yaml already exists — skipping'));
        return;
    }

    // Build manifest
    const groups: Record<string, unknown> = {};
    for (const { group, templates } of templateGroups) {
        groups[group] = {
            title: groupTitle(group),
            documents: templates.map(t => ({
                id: t.split('/').pop(),
                template: t,
                enabled: true,
            })),
        };
    }

    const config = {
        version: '2',
        project: {
            company: companyName,
            product: productName,
            device_type: profile.deviceType,
            version: '1.0.0',
            phase: 'design',
            authors: [{ name: '', role: 'Lead Engineer' }],
            approvers: [
                { name: '', role: 'Quality Assurance' },
                { name: '', role: 'Regulatory Affairs' },
            ],
        },
        standards: buildStandardsList(profile),
        manifest: {
            groups,
            default_groups: templateGroups.map(g => g.group),
        },
        rendering: {
            table_limit: 100,
        },
        export: {
            format: 'md',
            numbering: true,
            glossary: false,
            output_dir: 'dhf-output',
        },
    };

    writeFileSync(configPath, yaml.stringify(config), 'utf-8');
}

function groupTitle(group: string): string {
    return group
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function buildStandardsList(profile: DeviceProfile): string[] {
    const standards = ['ISO 14971:2019', 'ISO 13485:2016'];
    if (profile.swSafetyClass !== 'A') {
        standards.push('IEC 62304:2006+AMD1:2015');
    }
    if (profile.patientContact) {
        standards.push('IEC 62366-1:2015+AMD1:2020');
    }
    if (profile.markets.includes('US')) {
        standards.push('21 CFR Part 820');
    }
    if (profile.cybersecurity) {
        standards.push('IEC 81001-5-1:2021', 'FDA Cybersecurity Guidance 2023');
    }
    if (profile.electrical) {
        standards.push('IEC 60601-1');
    }
    return standards;
}

// ─── Interactive wizard ───────────────────────────────────────────────────────

export async function dhfInitCommand(options: { projectDir?: string }): Promise<void> {
    const projectDir = resolve(options.projectDir ?? process.cwd());
    console.log(chalk.bold('\nMEMO DHF Init Wizard\n'));
    console.log(chalk.gray('Scaffolds a DHF document set for your medical device project.\n'));

    const rl = readline.createInterface({ input, output });

    try {
        // Company / product
        const companyName = await rl.question(chalk.cyan('Company name: '));
        const productName = await rl.question(chalk.cyan('Product/device name: '));
        const deviceType = await rl.question(chalk.cyan('Device type (e.g., infusion pump, monitor, catheter): '));

        // Markets
        console.log('');
        console.log(chalk.gray('Target markets (select all that apply):'));
        const usAnswer = await rl.question(chalk.cyan('  Include FDA/21 CFR 820 (US market)? [Y/n]: '));
        const euAnswer = await rl.question(chalk.cyan('  Include EU MDR/IEC standards (EU market)? [Y/n]: '));

        const markets: string[] = [];
        if (usAnswer.toLowerCase() !== 'n') markets.push('US');
        if (euAnswer.toLowerCase() !== 'n') markets.push('EU');
        if (markets.length === 0) markets.push('US', 'EU');

        // Software safety class
        console.log('');
        console.log(chalk.gray('Software safety classification (IEC 62304):'));
        console.log(chalk.gray('  A = no injury possible, B = non-serious injury, C = death or serious injury'));
        const swClassAnswer = await rl.question(chalk.cyan('  Software safety class [A/B/C] (default: B): '));
        const swSafetyClass = (['A', 'B', 'C'].includes(swClassAnswer.toUpperCase())
            ? swClassAnswer.toUpperCase()
            : 'B') as 'A' | 'B' | 'C';

        // Other attributes
        console.log('');
        const patientContactAnswer = await rl.question(chalk.cyan('Patient-contacting device? [Y/n]: '));
        const sterileAnswer = await rl.question(chalk.cyan('Sterile device? [y/N]: '));
        const electricalAnswer = await rl.question(chalk.cyan('Active/electrical device? [Y/n]: '));
        const cyberAnswer = await rl.question(chalk.cyan('Network-connected/cybersecurity concerns? [y/N]: '));

        const profile: DeviceProfile = {
            deviceType,
            markets,
            swSafetyClass,
            patientContact: patientContactAnswer.toLowerCase() !== 'n',
            sterile: sterileAnswer.toLowerCase() === 'y',
            electrical: electricalAnswer.toLowerCase() !== 'n',
            cybersecurity: cyberAnswer.toLowerCase() === 'y',
        };

        console.log('');
        console.log(chalk.bold('Selected document set:\n'));

        const templateGroups = selectTemplates(profile);
        let totalDocs = 0;
        for (const { group, templates } of templateGroups) {
            console.log(chalk.cyan(`  ${groupTitle(group)}`));
            for (const t of templates) {
                console.log(chalk.gray(`    • ${t.split('/').pop()}`));
                totalDocs++;
            }
        }

        console.log('');
        console.log(chalk.gray(`Total: ${totalDocs} documents`));
        console.log('');

        const confirm = await rl.question(chalk.cyan('Scaffold DHF directory? [Y/n]: '));
        if (confirm.toLowerCase() === 'n') {
            console.log(chalk.yellow('\nAborted.\n'));
            return;
        }

        // Scaffold
        scaffoldDhfDirectory(projectDir, profile, templateGroups);
        generateDhfConfig(projectDir, companyName, productName, profile, templateGroups);

        console.log(chalk.green('\nDHF scaffolded successfully!\n'));
        console.log(chalk.gray('Files created:'));
        console.log(chalk.gray('  dhf/           — Document templates organized by group'));
        console.log(chalk.gray('  memo.dhf.yaml  — DHF configuration (V2)'));
        console.log('');
        console.log(chalk.gray('Next steps:'));
        console.log(chalk.gray('  memo dhf status          — Check document readiness'));
        console.log(chalk.gray('  memo dhf export          — Export all documents'));
        console.log(chalk.gray('  memo dhf preview         — Live preview server'));
        console.log('');

    } finally {
        rl.close();
    }
}
