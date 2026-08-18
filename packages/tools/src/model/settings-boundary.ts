// ─── Configuration Boundary ───────────────────────────────────────────────────
//
// Semantic fields do not live in application settings, and a project that still
// carries one is told exactly what to write instead.
//
// The rule is that a rejected field is *rejected*: never read as a fallback,
// never compared against the native value, never given precedence. A field that
// is sometimes honoured is a second semantic input with extra steps, and the
// whole point of the flip is that there is only one.
//
// This module is deliberately dependency-free apart from `yaml`. The
// configuration-boundary criterion in section 19 is structural: the semantic
// model builder must have no dependency edge to application settings, which is
// only checkable if the settings layer is its own module rather than something
// woven through the loaders.
//
// Design reference: sections 5.3, 5.5, 16, 18.3 deliverable 5.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** One rejected field, and what to write instead. */
export interface SemanticFieldRejection {
    file: string;
    field: string;
    /** What now decides this, in SysML. */
    nativeReplacement: string;
    message: string;
}

/**
 * Fields that used to select model content, and the native construct that
 * replaced each one. The message a user sees names both, because "this field is
 * not supported" leaves them with a broken project and no next step.
 */
const SEMANTIC_FIELDS: Record<string, string> = {
    methodology:
        'the `ProjectMethodBinding` in model/catalog/project.sysml, whose `selectedMethodology` is a typed SysML reference',
    extends:
        'a native `private import` of the package in model/catalog/project.sysml',
    ontologies:
        'a native `private import` of the ontology package in model/catalog/project.sysml',
    modules:
        '`includedModule` on the methodology, or on the `ProjectMethodBinding` for project-specific additions',
    optionalModules:
        '`includedModule` on the methodology that selects them',
    type:
        'nothing — a package\'s authority now comes from the resolved root a file sits under, not from a declared kind',
    projectType:
        'nothing — a project is what its SysML declares; the type field selected no content it could not select natively',
    usage:
        'nothing — what a package supplies is what its SysML declares',
    sysmlDir:
        'kept as a locator only; it may say where source lives but must not select what is loaded',
    kinds:
        'ontology `part def` / `item def` declarations',
    relationshipTypes:
        'ontology `connection def` declarations',
    architectureLayers:
        '`LayerRendering` usages in the ontology',
    cosmaLayers:
        '`LayerRendering` usages in the ontology',
    layers:
        '`LayerRendering` usages in the ontology',
    explorer:
        '`ExplorerClassification` usages in the ontology',
    viewpoints:
        'native `viewpoint def` / `view def` packages under model/catalog/viewpoints/',
    rules:
        'native `constraint def` declarations, tailored through `RulePolicy`',
    workflows:
        '`MethodologyWorkflowStep` actions in the methodology',
    firstRun:
        'the template `memo init` scaffolds',
};

/** `sysmlDir` locates source; it is the one entry above that is still read. */
const LOCATOR_FIELDS = new Set(['sysmlDir', 'entrypoint', 'include', 'name', 'version', 'description', 'license', 'tags']);

/** Files that were entirely semantic and no longer exist as inputs. */
const RETIRED_FILES: Record<string, string> = {
    'memo.rules.yaml': 'native `constraint def` declarations plus `RulePolicy` tailoring',
    'memo.rules.yml': 'native `constraint def` declarations plus `RulePolicy` tailoring',
    'memo.viewpoints.yaml': 'native viewpoint/view packages under model/catalog/viewpoints/',
    'memo.viewpoints.yml': 'native viewpoint/view packages under model/catalog/viewpoints/',
    'memo.rendering.yaml': '`LayerRendering` and `ExplorerClassification` usages in the ontology',
    'memo.rendering.yml': '`LayerRendering` and `ExplorerClassification` usages in the ontology',
    'memo.config.yaml': 'model/catalog/project.sysml — native imports and a `ProjectMethodBinding`',
    'memo.config.yml': 'model/catalog/project.sysml — native imports and a `ProjectMethodBinding`',
};

/** YAML files that may exist as application settings and are checked field by field. */
const CHECKED_FILES = ['memo.package.yaml', 'memo.package.yml', 'memo.tools.yaml', 'memo.architect.yaml'];

/**
 * Check one directory for semantic configuration.
 *
 * Returns every rejection found rather than the first: a project mid-migration
 * usually has several, and fixing them one error at a time is a poor trade for
 * the user's afternoon.
 */
export function checkSemanticFields(dir: string): SemanticFieldRejection[] {
    const rejections: SemanticFieldRejection[] = [];

    for (const [name, replacement] of Object.entries(RETIRED_FILES)) {
        const path = join(dir, name);
        if (!existsSync(path)) continue;
        rejections.push({
            file: path,
            field: '(whole file)',
            nativeReplacement: replacement,
            message:
                `${name} is no longer a semantic input. Everything it used to decide is now declared in SysML: `
                + `${replacement}. Delete the file — it is not merged, compared, or used as a fallback.`,
        });
    }

    for (const name of CHECKED_FILES) {
        const path = join(dir, name);
        if (!existsSync(path)) continue;
        let parsed: Record<string, unknown> | undefined;
        try {
            parsed = parseYaml(readFileSync(path, 'utf-8')) as Record<string, unknown>;
        } catch {
            continue;   // a malformed settings file is the settings loader's problem
        }
        if (!parsed || typeof parsed !== 'object') continue;
        for (const field of Object.keys(parsed)) {
            if (LOCATOR_FIELDS.has(field)) continue;
            const replacement = SEMANTIC_FIELDS[field];
            if (!replacement) continue;
            rejections.push({
                file: path,
                field,
                nativeReplacement: replacement,
                message:
                    `${basename(path)} declares \`${field}:\`, which selects model content. Semantic content is `
                    + `declared in SysML: use ${replacement}. The field is rejected, not merged — remove it.`,
            });
        }
    }

    return rejections;
}

/** Format rejections for a CLI or a startup diagnostic. */
export function formatRejections(rejections: readonly SemanticFieldRejection[]): string {
    return rejections.map(r => `  ${r.file}: ${r.message}`).join('\n');
}
