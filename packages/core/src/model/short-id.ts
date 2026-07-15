// ─── Short ID generation for MEMO elements ───────────────────────────────────
//
// Generates stable, human-readable short IDs in the form {KIND-PREFIX}-{SEQ},
// e.g. "SW-REQ-4291", "HZD-1823", "SYS-COMP-7432".
//
// The prefix is derived deterministically from the kind name (CamelCase split).
// The sequence number is a hash of the element's SysML id — stable across
// rebuilds as long as the element name in the source file doesn't change.
//
// URL family = first segment of the prefix (SW-REQ → SW, HZD → HZD).
// This determines the grouping in /catalog/:family/ routes.
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
    RiskControl: 'RISK-CTL',
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
    // Operational
    Stakeholder: 'STK',
    OperationalScenario: 'OPS',
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
 * Get the kind prefix for an element kind.
 * Returns a well-known override if available, otherwise auto-derives from CamelCase.
 */
export function kindToPrefix(kind: string): string {
    return KIND_PREFIX_OVERRIDES[kind] ?? derivePrefix(kind);
}

/**
 * The URL family segment — first hyphen-separated token of the prefix.
 * e.g. "SW-REQ" → "SW", "HZD-EVT" → "HZD", "SYS-COMP" → "SYS"
 */
export function prefixToFamily(prefix: string): string {
    return prefix.split('-')[0];
}

/**
 * Assign sequential short IDs to a group of elements of the same kind.
 *
 * Elements are sorted by their SysML id (lexicographic) for a deterministic,
 * stable order — adding a new element appends it at its sort position, and
 * deleting one does not renumber the survivors.
 *
 * Format: {KIND-PREFIX}-{n}  e.g. "HZD-1", "HZD-2", "SW-REQ-1", "SW-REQ-2"
 *
 * Returns a Map from element id → shortId.
 */
export function assignSequentialShortIds(
    kind: string,
    elementIds: string[],
): Map<string, string> {
    const prefix = kindToPrefix(kind);
    const sorted = [...elementIds].sort((a, b) => a.localeCompare(b));
    const out = new Map<string, string>();
    for (let i = 0; i < sorted.length; i++) {
        out.set(sorted[i], `${prefix}-${i + 1}`);
    }
    return out;
}

/**
 * Parse a shortId back to its prefix and sequence number.
 * e.g. "SW-REQ-3" → { prefix: "SW-REQ", seq: 3 }
 * Returns null if the format is unrecognised.
 */
export function parseShortId(shortId: string): { prefix: string; seq: number } | null {
    const match = shortId.match(/^(.+)-(\d+)$/);
    if (!match) return null;
    return { prefix: match[1], seq: parseInt(match[2], 10) };
}
