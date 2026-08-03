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
} as const;

export function sysmlMemoGuidancePrompt(): string {
    return [
        `Guidance package: sysml-memo@${SYSML_MEMO_GUIDANCE.version}`,
        'Generic SysML v2 guidance:',
        ...SYSML_MEMO_GUIDANCE.sysml.map(rule => `- ${rule}`),
        'MEMO extension guidance:',
        ...SYSML_MEMO_GUIDANCE.memo.map(rule => `- ${rule}`),
    ].join('\n');
}
