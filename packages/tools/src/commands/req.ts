import { writeFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

type ReqTemplate = 'ubi' | 'event' | 'state' | 'opt' | 'unwanted';

const TEMPLATE_TEXT: Record<ReqTemplate, { enumValue: string; text: string }> = {
    ubi: {
        enumValue: 'Ubiquitous',
        text: 'The <subject> shall <capability>.',
    },
    event: {
        enumValue: 'EventDriven',
        text: 'When <trigger>, the <subject> shall <response>.',
    },
    state: {
        enumValue: 'StateDriven',
        text: 'While <state>, the <subject> shall <response>.',
    },
    opt: {
        enumValue: 'Optional',
        text: 'Where <feature> is enabled, the <subject> shall <response>.',
    },
    unwanted: {
        enumValue: 'Unwanted',
        text: 'If <fault-condition>, the <subject> shall <mitigation>.',
    },
};

export interface NewReqOptions {
    template: ReqTemplate;
    output?: string;
    id?: string;
    title?: string;
}

export async function reqNewCommand(options: NewReqOptions): Promise<void> {
    const tpl = TEMPLATE_TEXT[options.template];
    if (!tpl) {
        throw new Error(`Unknown template "${options.template}". Use one of: ubi, event, state, opt, unwanted.`);
    }

    const reqId = options.id || 'REQ-001';
    const title = options.title || 'New Requirement';
    const usageId = normalizeUsageId(reqId);

    const stub = [
        `requirement ${usageId} : Requirement {`,
        `    attribute redefines reqId = "${reqId}";`,
        `    attribute redefines title = "${title}";`,
        `    attribute redefines category = RequirementCategory::System;`,
        `    attribute redefines syntaxStyle = EARSTemplate::${tpl.enumValue};`,
        '    attribute redefines modality = RequirementModality::Shall;',
        `    attribute redefines text = "${tpl.text}";`,
        '    attribute redefines source = "TBD";',
        '}',
    ].join('\n');

    if (options.output) {
        const outPath = resolve(options.output);
        writeFileSync(outPath, `${stub}\n`, 'utf8');
        console.log(chalk.green(`✓ Wrote requirement stub to ${outPath}`));
        return;
    }

    process.stdout.write(`${stub}\n`);
}

function normalizeUsageId(reqId: string): string {
    const cleaned = reqId
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!cleaned) return 'req_001';
    if (/^[0-9]/.test(cleaned)) return `req_${cleaned}`;
    return cleaned;
}
