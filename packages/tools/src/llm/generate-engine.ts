// ─── SysML Generation Engine (M73) ───────────────────────────────────────────
//
// Generates valid SysML v2 definitions from natural language descriptions.
// Uses ontology context to constrain output to valid kinds and relationships.
// Example: "Add a pressure sensor component with USB interface."
// ─────────────────────────────────────────────────────────────────────────────

import type { OntologyView } from '../model/kind-registry.js';
import type { LLMProvider, ChatMessage } from './llm-provider.js';
import { serializeOntologyContext } from './model-context.js';
import { sysmlMemoGuidancePrompt } from './sysml-guidance.js';

/** Result of SysML generation */
export interface GenerateResult {
    /** Generated SysML v2 code */
    sysml: string;
    /** Explanation of what was generated */
    explanation: string;
    /** Suggested filename */
    suggestedFile?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

const SYSTEM_PROMPT = `You are MEMO SysML Generator, an expert in SysML v2 syntax and medical device architecture modeling (ISO 14971, IEC 62304).

You generate a best-effort SysML v2 draft based on natural language descriptions. The server validates it and may ask you to repair it; do not claim it is valid before that validation happens.

SysML v2 syntax reference:
- Package: \`package MyPackage { ... }\`
- Part definition: \`part def ComponentName { ... }\`
- Part usage: \`part componentInstance : ComponentName { ... }\`
- Requirement definition: \`requirement def ReqName { ... }\`
- Requirement usage: \`requirement reqInstance : ReqName { ... }\`
- Action definition: \`action def ActionName { ... }\`
- Action usage: \`action actionInstance : ActionName { ... }\`
- Port definition: \`port def PortName { ... }\`
- Interface definition: \`interface def InterfaceName { ... }\`
- Item definition: \`item def ItemName { ... }\`
- Connection: \`connection : RelType connect source to target;\`
- Attribute: \`attribute redefines attrName = "value";\`
- Documentation: \`doc /* description */\`
- Specialization: \`part def Child :> Parent { ... }\`

Guidelines:
- Use the ontology context to determine which kinds (part def types) are valid.
- Use the correct SysML v2 construct for each kind (part def, requirement def, etc.).
- Place elements in a package named after the relevant architecture layer.
- Add documentation comments for each element.
- Add relevant attributes (e.g., severity, probability for hazards).
- Generate connections/relationships when the description implies them.
- Keep the output focused — generate only what was requested.

IMPORTANT: Output ONLY the SysML code block and a brief explanation. Format your response as:

\`\`\`sysml
// generated code here
\`\`\`

**Explanation:** Brief description of what was generated.

**Suggested file:** filename.sysml

${sysmlMemoGuidancePrompt()}`;

/**
 * Generate SysML v2 code from a natural language description.
 */
export async function generateSysml(
    description: string,
    ontology: OntologyView,
    provider: LLMProvider,
): Promise<GenerateResult> {
    const ontologyContext = serializeOntologyContext(ontology);

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Here is the ontology context for this project:\n\n${ontologyContext}\n\n---\n\nGenerate SysML for: ${description}`,
        },
    ];

    const result = await provider.complete({
        messages,
        temperature: 0.3,
        maxTokens: 4096,
    });

    // Parse the response
    const parsed = parseGenerateResponse(result.content);

    return {
        ...parsed,
        usage: result.usage,
    };
}

/** Ask for one corrected candidate using normalized, structured diagnostics. */
export async function repairSysml(
    description: string,
    candidate: string,
    diagnostics: readonly unknown[],
    ontology: { kinds: Record<string, any>; relationshipTypes: any[] },
    provider: LLMProvider,
): Promise<GenerateResult> {
    const result = await provider.complete({
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: `Repair this SysML draft for: ${description}\n\nCurrent draft:\n\`\`\`sysml\n${candidate}\n\`\`\`\n\nStructured diagnostics:\n${JSON.stringify(diagnostics, null, 2)}\n\n${serializeOntologyContext(ontology)}`,
            },
        ],
        temperature: 0.1,
        maxTokens: 4096,
    });
    return { ...parseGenerateResponse(result.content), usage: result.usage };
}

/** Parse the LLM response into structured output */
function parseGenerateResponse(content: string): Omit<GenerateResult, 'usage'> {
    // Extract SysML code block
    const codeMatch = content.match(/```(?:sysml)?\s*\n([\s\S]*?)```/);
    const sysml = codeMatch ? codeMatch[1].trim() : content.trim();

    // Extract explanation
    const explMatch = content.match(/\*\*Explanation:\*\*\s*(.*?)(?:\n\n|\*\*|$)/s);
    const explanation = explMatch ? explMatch[1].trim() : 'SysML definitions generated from description.';

    // Extract suggested file
    const fileMatch = content.match(/\*\*Suggested file:\*\*\s*(\S+)/);
    const suggestedFile = fileMatch ? fileMatch[1].trim() : undefined;

    return { sysml, explanation, suggestedFile };
}
