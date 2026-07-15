// ─── Named Import Recipes ─────────────────────────────────────────────────────
//
// Predefined column-mapping configurations for common medical device artifact
// types. Users pick a recipe instead of configuring column mappings from scratch.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single column mapping: source spreadsheet column → MEMO attribute */
export interface ColumnMapping {
    /** Column header in the source artifact (case-insensitive match) */
    sourceColumn: string;
    /**
     * Target attribute name in the MEMO element CSV format.
     * Special values: 'id', 'name', 'kind', 'doc' map to the fixed columns.
     * Any other value becomes a dynamic attribute column.
     */
    targetAttribute: string;
    /**
     * Optional transform applied to the raw cell value before writing.
     * - 'sanitize-id': strip non-identifier chars, lowercase, prepend letter if starts with digit
     * - 'upper': UPPERCASE
     * - 'lower': lowercase
     */
    transform?: 'sanitize-id' | 'upper' | 'lower';
    /** Whether this mapping is required (import errors if column missing) */
    required?: boolean;
}

/** A named, documented import recipe for a common artifact type */
export interface ImportRecipe {
    id: string;
    name: string;
    description: string;
    /** Kind to assign when no kind column is present in the source */
    defaultKind?: string;
    /** Column mappings in priority order (first match wins for inference) */
    columnMappings: ColumnMapping[];
}

// ─── Built-in Recipes ────────────────────────────────────────────────────────

/** Requirements matrix: ID, title, description, priority, category columns */
export const RECIPE_REQUIREMENTS_MATRIX: ImportRecipe = {
    id: 'requirements-matrix',
    name: 'Requirements Matrix',
    description: 'Standard requirements spreadsheet with ID, title, description, priority columns. Typical export from DOORS, Jama, or a simple Excel requirements log.',
    defaultKind: 'Requirement',
    columnMappings: [
        { sourceColumn: 'req id',           targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'requirement id',   targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'id',               targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'req #',            targetAttribute: 'id',          transform: 'sanitize-id' },
        { sourceColumn: 'number',           targetAttribute: 'id',          transform: 'sanitize-id' },
        { sourceColumn: 'title',            targetAttribute: 'name',        required: true },
        { sourceColumn: 'requirement title',targetAttribute: 'name',        required: true },
        { sourceColumn: 'name',             targetAttribute: 'name',        required: true },
        { sourceColumn: 'summary',          targetAttribute: 'name' },
        { sourceColumn: 'description',      targetAttribute: 'doc' },
        { sourceColumn: 'text',             targetAttribute: 'doc' },
        { sourceColumn: 'statement',        targetAttribute: 'doc' },
        { sourceColumn: 'requirement text', targetAttribute: 'doc' },
        { sourceColumn: 'kind',             targetAttribute: 'kind' },
        { sourceColumn: 'type',             targetAttribute: 'kind' },
        { sourceColumn: 'category',         targetAttribute: 'category' },
        { sourceColumn: 'priority',         targetAttribute: 'priority' },
        { sourceColumn: 'rationale',        targetAttribute: 'rationale' },
        { sourceColumn: 'verification method', targetAttribute: 'verificationMethod' },
        { sourceColumn: 'status',           targetAttribute: 'status' },
    ],
};

/** Hazard log: hazard ID, description, severity, probability, risk level */
export const RECIPE_HAZARD_LOG: ImportRecipe = {
    id: 'hazard-log',
    name: 'Hazard Log',
    description: 'ISO 14971 hazard analysis spreadsheet with hazard ID, description, severity, probability and risk level columns.',
    defaultKind: 'Hazard',
    columnMappings: [
        { sourceColumn: 'hazard id',        targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'haz id',           targetAttribute: 'id',          transform: 'sanitize-id' },
        { sourceColumn: 'id',               targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'hazard',           targetAttribute: 'name',        required: true },
        { sourceColumn: 'hazard description', targetAttribute: 'name',      required: true },
        { sourceColumn: 'name',             targetAttribute: 'name',        required: true },
        { sourceColumn: 'description',      targetAttribute: 'doc' },
        { sourceColumn: 'hazardous situation', targetAttribute: 'doc' },
        { sourceColumn: 'kind',             targetAttribute: 'kind' },
        { sourceColumn: 'severity',         targetAttribute: 'severity' },
        { sourceColumn: 'probability',      targetAttribute: 'probability' },
        { sourceColumn: 'risk level',       targetAttribute: 'riskLevel' },
        { sourceColumn: 'risk',             targetAttribute: 'riskLevel' },
        { sourceColumn: 'harm',             targetAttribute: 'harm' },
        { sourceColumn: 'foreseeable misuse', targetAttribute: 'foreseeableMisuse' },
        { sourceColumn: 'mitigation',       targetAttribute: 'mitigation' },
        { sourceColumn: 'residual risk',    targetAttribute: 'residualRisk' },
        { sourceColumn: 'status',           targetAttribute: 'status' },
    ],
};

/** FMEA worksheet: component, failure mode, effect, severity, occurrence, detection, RPN */
export const RECIPE_FMEA_WORKSHEET: ImportRecipe = {
    id: 'fmea-worksheet',
    name: 'FMEA Worksheet',
    description: 'Failure Mode and Effects Analysis spreadsheet. Maps component failure modes to MEMO Failure kind with FMEA attributes (severity, occurrence, detection, RPN).',
    defaultKind: 'Failure',
    columnMappings: [
        { sourceColumn: 'id',               targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'fmea id',          targetAttribute: 'id',          transform: 'sanitize-id' },
        { sourceColumn: 'failure mode',     targetAttribute: 'name',        required: true },
        { sourceColumn: 'failure mode description', targetAttribute: 'name' },
        { sourceColumn: 'name',             targetAttribute: 'name',        required: true },
        { sourceColumn: 'description',      targetAttribute: 'doc' },
        { sourceColumn: 'effect',           targetAttribute: 'doc' },
        { sourceColumn: 'effect of failure', targetAttribute: 'effect' },
        { sourceColumn: 'kind',             targetAttribute: 'kind' },
        { sourceColumn: 'component',        targetAttribute: 'component' },
        { sourceColumn: 'function',         targetAttribute: 'function' },
        { sourceColumn: 'severity',         targetAttribute: 'severity' },
        { sourceColumn: 's',                targetAttribute: 'severity' },
        { sourceColumn: 'occurrence',       targetAttribute: 'occurrence' },
        { sourceColumn: 'o',                targetAttribute: 'occurrence' },
        { sourceColumn: 'detection',        targetAttribute: 'detection' },
        { sourceColumn: 'd',                targetAttribute: 'detection' },
        { sourceColumn: 'rpn',              targetAttribute: 'rpn' },
        { sourceColumn: 'risk priority number', targetAttribute: 'rpn' },
        { sourceColumn: 'cause',            targetAttribute: 'cause' },
        { sourceColumn: 'controls',         targetAttribute: 'controls' },
        { sourceColumn: 'action',           targetAttribute: 'action' },
    ],
};

/** Verification table: requirement ID reference, test method, result, pass/fail */
export const RECIPE_VERIFICATION_TABLE: ImportRecipe = {
    id: 'verification-table',
    name: 'Verification Table',
    description: 'Verification and validation traceability matrix mapping requirements to test methods and results.',
    defaultKind: 'VerificationTest',
    columnMappings: [
        { sourceColumn: 'test id',          targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'verification id',  targetAttribute: 'id',          transform: 'sanitize-id' },
        { sourceColumn: 'id',               targetAttribute: 'id',          transform: 'sanitize-id', required: true },
        { sourceColumn: 'test name',        targetAttribute: 'name',        required: true },
        { sourceColumn: 'name',             targetAttribute: 'name',        required: true },
        { sourceColumn: 'title',            targetAttribute: 'name' },
        { sourceColumn: 'description',      targetAttribute: 'doc' },
        { sourceColumn: 'objective',        targetAttribute: 'doc' },
        { sourceColumn: 'kind',             targetAttribute: 'kind' },
        { sourceColumn: 'requirement id',   targetAttribute: 'requirementId' },
        { sourceColumn: 'req id',           targetAttribute: 'requirementId' },
        { sourceColumn: 'method',           targetAttribute: 'method' },
        { sourceColumn: 'test method',      targetAttribute: 'method' },
        { sourceColumn: 'verification method', targetAttribute: 'method' },
        { sourceColumn: 'result',           targetAttribute: 'result' },
        { sourceColumn: 'pass/fail',        targetAttribute: 'result' },
        { sourceColumn: 'status',           targetAttribute: 'status' },
        { sourceColumn: 'evidence',         targetAttribute: 'evidence' },
        { sourceColumn: 'notes',            targetAttribute: 'notes' },
    ],
};

/** All built-in recipes in display order */
export const BUILTIN_RECIPES: ImportRecipe[] = [
    RECIPE_REQUIREMENTS_MATRIX,
    RECIPE_HAZARD_LOG,
    RECIPE_FMEA_WORKSHEET,
    RECIPE_VERIFICATION_TABLE,
];

/** Look up a built-in recipe by id */
export function findRecipe(id: string): ImportRecipe | undefined {
    return BUILTIN_RECIPES.find((r) => r.id === id);
}
