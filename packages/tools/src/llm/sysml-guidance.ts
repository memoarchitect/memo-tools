// ─── Versioned SysML + MEMO authoring guidance ──────────────────────────────
//
// Kept as data, rather than buried in a prompt, so every AI change can say
// exactly which guidance informed it.

export const SYSML_MEMO_GUIDANCE_VERSION = '1.0.0';

export const SYSML_MEMO_GUIDANCE = {
    version: SYSML_MEMO_GUIDANCE_VERSION,
    sysml: [
        'Use SysML v2 declarations and balanced braces.',
        'Keep generated content self-contained and name references consistently.',
        'Return only a SysML code block followed by the requested explanation.',
    ],
    memo: [
        'Use the project ontology context for MEMO kinds and relationships.',
        'Model methodology findings are advisory: report them; do not suppress source.',
        'Keep additions focused on the user request.',
    ],
    /** For an AI coding tool working on the model through the MCP server, in the order it works. */
    agent: {
        before: [
            'Call memo_ontology before writing or editing a .sysml file, and use only the kinds and relationship types it lists. If what you need is missing, say so rather than approximating.',
            'Find the exact id of anything you reference with memo_search_elements.',
        ],
        while: [
            'The .sysml files are the regulated record: treat them as production code under change control.',
            'Every element belongs to one architecture layer, decided by its kind. Do not move an element between layers as a side effect of another change.',
            'Relationships are typed and point one way. Use the types memo_ontology lists, in the direction it gives; memo_trace with direction "upstream" shows what points at an element.',
            'Terms from a standard (ISO 14971 risk vocabulary, IEC 62304 software safety classes) carry regulatory meaning. Use them exactly as the ontology defines them.',
            'The propose_* tools, when present, do not change the model: each proposal waits for the engineer to apply it in MEMO Architect (AI Tools › Pending changes). Say what you proposed; never claim the model changed.',
        ],
        after: [
            'Call memo_validate and resolve the errors you introduced. Findings that predate your change are not yours to fix unless asked.',
            'Traceability matters more than volume: a new requirement with no verification is a gap, not progress.',
        ],
    },
} as const;

/** The short form an MCP server sends with `initialize`, which the client shows its model. */
export function agentInstructions(): string {
    const { agent } = SYSML_MEMO_GUIDANCE;
    return [
        'MEMO models medical device architecture in SysML v2.',
        ...agent.before, ...agent.while, ...agent.after,
    ].join(' ');
}

/** The same guidance as a rules file for a client that reads one (Cursor's `.cursor/rules/memo.mdc`). */
export function agentRulesMarkdown(): string {
    const { agent } = SYSML_MEMO_GUIDANCE;
    const list = (rules: readonly string[]) => rules.map(rule => `- ${rule}`).join('\n');
    return [
        '---',
        'description: MEMO SysML v2 modelling conventions for this medical device project',
        'globs:',
        '  - "**/*.sysml"',
        'alwaysApply: false',
        '---',
        '',
        `# MEMO model conventions (sysml-memo@${SYSML_MEMO_GUIDANCE.version})`,
        '',
        'Written by MEMO Architect; it is replaced when AI coding tools are connected again.',
        '',
        '## Before you edit',
        '',
        list(agent.before),
        '',
        '## While you edit',
        '',
        list(agent.while),
        '',
        '## After you edit',
        '',
        list(agent.after),
        '',
    ].join('\n');
}

export function sysmlMemoGuidancePrompt(): string {
    return [
        `Guidance package: sysml-memo@${SYSML_MEMO_GUIDANCE.version}`,
        'Generic SysML v2 guidance:',
        ...SYSML_MEMO_GUIDANCE.sysml.map(rule => `- ${rule}`),
        'MEMO extension guidance:',
        ...SYSML_MEMO_GUIDANCE.memo.map(rule => `- ${rule}`),
    ].join('\n');
}
