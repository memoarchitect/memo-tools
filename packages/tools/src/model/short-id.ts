// ─── Short ID generation for MEMO elements ───────────────────────────────────
//
// Generates stable, human-readable short IDs in the form {PREFIX}-{SEQ},
// where PREFIX is exactly three alphabetic characters, e.g. "REQ-1",
// "HZD-2", "OPR-3".
//
// The prefix is derived deterministically from the kind name. The sequence
// number starts at 1 and increments within its prefix family.
//
// URL family is the three-letter prefix.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Well-known overrides for common medical-device kinds.
 * Auto-generation handles everything else.
 */
const KIND_PREFIX_OVERRIDES: Record<string, string> = {
    // Risk
    Hazard: 'HZD',
    HazardousEvent: 'HZD-EVT',
    HazardousSituation: 'HZD-SIT',
    Risk: 'RISK',
    RiskControlMeasure: 'RISK-CTL',
    MitigationMeasure: 'MIT',
    ResidualRisk: 'RRISK',
    // Requirements
    StakeholderRequirement: 'STK-REQ',
    Requirement: 'REQ',
    SoftwareSpecification: 'SW-SPEC',
    InterfaceRequirement: 'REQ',
    PerformanceRequirement: 'PERF-REQ',
    SafetyRequirement: 'SAF-REQ',
    RegulatoryRequirement: 'REG-REQ',
    FunctionalRequirement: 'REQ',
    NonFunctionalRequirement: 'NFR',
    // Architecture
    SystemComponent: 'SYS-COMP',
    SoftwareComponent: 'SW-COMP',
    HardwareComponent: 'HW-COMP',
    Subsystem: 'SUBSYS',
    Module: 'MOD',
    Interface: 'IF',
    Port: 'PORT',
    // Actions / behavior
    Action: 'ACT',
    ActionDefinition: 'ACT-DEF',
    UseCase: 'UC',
    Workflow: 'WFL',
    OperationalWorkflow: 'WFL',
    // Operational
    Stakeholder: 'STK',
    OperationalScenario: 'SCN',
    OperativeScenario: 'SCN',
    FunctionalScenario: 'SCN',
    UiScenario: 'SCN',
    Mission: 'MSNS',
    Capability: 'CAP',
    // Compliance / DHF
    DesignInput: 'DI',
    DesignOutput: 'DO',
    VerificationActivity: 'VER',
    ValidationActivity: 'VAL',
    TestCase: 'TC',
    // Generic fallbacks
    Item: 'ITM',
    Part: 'PART',
};

/**
 * Split a CamelCase string into its constituent words.
 * e.g. "SoftwareComponent" → ["Software", "Component"]
 */
function splitCamelCase(s: string): string[] {
    return s.replace(/([A-Z])/g, ' $1').trim().split(' ').filter(Boolean);
}

/**
 * Abbreviate a single word to a short prefix token.
 * Takes the first 2-3 letters, removing vowels if >3 chars.
 */
function abbreviateWord(word: string): string {
    if (word.length <= 3) return word.toUpperCase();
    // Drop interior vowels to get consonant abbreviation
    const consonants = word[0] + word.slice(1).replace(/[aeiouAEIOU]/g, '');
    return consonants.slice(0, 3).toUpperCase();
}

/**
 * Derive a kind prefix from a kind name using CamelCase splitting + abbreviation.
 * e.g. "SoftwareComponent" → "SFT-CMP", "Hazard" → "HZD"
 */
function derivePrefix(kind: string): string {
    const words = splitCamelCase(kind);
    if (words.length === 0) return 'EL';
    return words.map(abbreviateWord).join('-');
}

/**
 * Get the three-letter display prefix for an element kind. Multi-word type
 * names intentionally use one shared family (OperationalWorkflow → OPR),
 * leaving the numeric sequence to provide uniqueness.
 */
export function kindToPrefix(kind: string): string {
    const configured = KIND_PREFIX_OVERRIDES[kind]?.split('-')[0];
    const derived = derivePrefix(kind).split('-')[0];
    const candidate = configured?.length === 3 ? configured : derived;
    return candidate.replace(/[^A-Za-z]/g, '').toUpperCase().padEnd(3, 'X').slice(0, 3);
}

/**
 * The URL family segment — first hyphen-separated token of the prefix.
 * e.g. "REQ" → "REQ", "HZD" → "HZD", "OPR" → "OPR"
 */
export function prefixToFamily(prefix: string): string {
    return prefix.split('-')[0];
}

/**
 * Assign sequential short IDs to a group of elements sharing one prefix.
 *
 * Elements are sorted by their SysML id (lexicographic) for a deterministic,
 * stable order — adding a new element appends it at its sort position, and
 * deleting one does not renumber the survivors.
 *
 * Format: {PREFIX}-{n}  e.g. "HZD-1", "HZD-2", "OPR-1", "OPR-2"
 *
 * Returns a Map from element id → shortId.
 */
export function assignSequentialShortIds(
    prefix: string,
    elementIds: string[],
): Map<string, string> {
    const sorted = [...elementIds].sort((a, b) => a.localeCompare(b));
    const out = new Map<string, string>();
    for (let i = 0; i < sorted.length; i++) {
        out.set(sorted[i], `${prefix}-${i + 1}`);
    }
    return out;
}

/**
 * Parse a shortId back to its prefix and sequence number.
 * e.g. "OPR-3" → { prefix: "OPR", seq: 3 }
 * Returns null if the format is unrecognised.
 */
export function parseShortId(shortId: string): { prefix: string; seq: number } | null {
    const match = shortId.match(/^(.+)-(\d+)$/);
    if (!match) return null;
    return { prefix: match[1], seq: parseInt(match[2], 10) };
}
