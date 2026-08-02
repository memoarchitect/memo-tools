// Project conversion (design section 18.4, half A deliverable 1).
//
// The claim under test is narrow and load-bearing: the conversion describes
// every change before making any of them, refuses rather than duplicating when
// two files would land in one place, and reaches a fixed point after one run.
// Everything else this command does is a convenience; those three properties
// are what decide whether existing user projects survive it.
//
// The corpus is a real pre-conversion snapshot (`fixtures/convert-corpus/`)
// plus synthetic projects that isolate one hazard each. The synthetic ones are
// not a substitute for the snapshot — they are written by the same person who
// wrote the converter, and they agree with it by construction.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
    applyConversion,
    classifyFile,
    derivePackageName,
    deriveProjectPrefix,
    isMirroringPackageName,
    planConversion,
    readSourceFacts,
    renderPlan,
    rewriteArtifactUris,
    rewritePackageReferences,
} from '../model/project-conversion.js';

const TMP = resolve(__dirname, '__tmp_conversion__');
const CORPUS = resolve(__dirname, 'fixtures/convert-corpus');

function write(relPath: string, content: string): void {
    const full = join(TMP, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
}

/** Every file under `dir`, relative and sorted — the shape of a project. */
function tree(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(relative(dir, full).split('\\').join('/'));
        }
    };
    walk(dir);
    return out.sort();
}

/** Content of every file under `dir`, for exact before/after comparison. */
function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rel of tree(dir)) out.set(rel, readFileSync(join(dir, rel)).toString('base64'));
    return out;
}

beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
});

// ─── Naming ───────────────────────────────────────────────────────────────────

describe('namespace derivation', () => {
    it('drops the structural path segments from the shared package prefix', () => {
        // The whole point of the catalog layout is that the directory tree
        // carries the location, so a prefix that still spells `model_catalog`
        // would produce names restating it twice.
        expect(deriveProjectPrefix([
            'proj_model_catalog_risk',
            'proj_model_catalog_requirements',
            'proj_model_views_risk_view',
        ])).toBe('proj');
    });

    it('returns undefined when no file declares a package', () => {
        expect(deriveProjectPrefix([])).toBeUndefined();
    });

    it('mirrors the directory chain and drops a basename that restates its directory', () => {
        expect(derivePackageName('p', 'architecture/functional/functions.sysml'))
            .toBe('p_architecture_functional_functions');
        expect(derivePackageName('p', 'assurance/requirements/requirements.sysml'))
            .toBe('p_assurance_requirements');
        expect(derivePackageName('p', 'viewpoints/risk/viewpoint.sysml'))
            .toBe('p_viewpoints_risk');
        expect(derivePackageName('p', 'artifacts/assets/catalog.sysml'))
            .toBe('p_artifacts_assets');
    });

    it('accepts both the canonical name and the directory-level short form in place', () => {
        // MEMO's own hand-authored catalog uses the short form in places
        // (`safety_risk/risk.sysml` declares `…_assurance_safety_risk`). Both
        // sit at or under the directory's namespace, so both mirror; rewriting
        // one to the other would be churn on a user's model for no semantic
        // gain.
        expect(isMirroringPackageName('p_assurance_safety_risk_risk', 'p', 'assurance/safety_risk/risk.sysml'))
            .toBe(true);
        expect(isMirroringPackageName('p_assurance_safety_risk', 'p', 'assurance/safety_risk/risk.sysml'))
            .toBe(true);
        expect(isMirroringPackageName('p_somewhere_else', 'p', 'assurance/safety_risk/risk.sysml'))
            .toBe(false);
    });
});

// ─── Reference rewriting ──────────────────────────────────────────────────────

describe('reference rewriting', () => {
    it('renames longer package names before their prefixes', () => {
        // `a_b` is a prefix of `a_b_c`. Renaming in declaration order would
        // turn `a_b_c` into `x_c` and corrupt every reference to it.
        const renames = new Map([['a_b', 'x'], ['a_b_c', 'y']]);
        const text = 'private import a_b_c::*;\nprivate import a_b::*;\n';
        expect(rewritePackageReferences(text, renames))
            .toBe('private import y::*;\nprivate import x::*;\n');
    });

    it('leaves names that merely contain a renamed name alone', () => {
        const renames = new Map([['a_b', 'x']]);
        expect(rewritePackageReferences('import a_bc::*;', renames)).toBe('import a_bc::*;');
    });

    it('rewrites expose clauses, not only imports', () => {
        const renames = new Map([['old_pkg', 'new_pkg']]);
        expect(rewritePackageReferences('    expose old_pkg::*;', renames))
            .toBe('    expose new_pkg::*;');
    });

    it('follows artifact payload URIs when the payload moves', () => {
        const moves = new Map([['model/assets/main/x.png', 'model/catalog/artifacts/assets/main/x.png']]);
        const text = 'attribute :>> imageUri = "model/assets/main/x.png";';
        expect(rewriteArtifactUris(text, moves))
            .toBe('attribute :>> imageUri = "model/catalog/artifacts/assets/main/x.png";');
    });

    it('follows a URI written relative to model/', () => {
        const moves = new Map([['model/assets/main/x.png', 'model/catalog/artifacts/assets/main/x.png']]);
        expect(rewriteArtifactUris('uri = "assets/main/x.png";', moves))
            .toBe('uri = "catalog/artifacts/assets/main/x.png";');
    });
});

// ─── Classification ───────────────────────────────────────────────────────────

describe('view classification', () => {
    const group = (usage: string) => usage.replace(/Viewpoint$/, '').toLowerCase();

    it('files a view under the viewpoint it declares, not its filename prefix', () => {
        // GPCA's real case: the filename says `behavior`, the model says the
        // logical viewpoint governs it. The model wins.
        const facts = readSourceFacts([
            'package p_model_views_behavior_action_flow_view {',
            '    view gpcaActionFlowView : MemoDiagramView {',
            '        part :>> viewpointDefinition = logicalViewpoint;',
            '    }',
            '}',
        ].join('\n'));
        const { role, to } = classifyFile('model/views/behavior_action_flow_view.sysml', facts, group);
        expect(role).toBe('view');
        expect(to.split(/[\\/]/).join('/'))
            .toBe('model/catalog/viewpoints/logical/views/behavior_action_flow_view.sysml');
    });

    it('leaves a vendored reusable package where it is', () => {
        const facts = readSourceFacts('package p_methodology_gpca { }');
        expect(classifyFile('methodology/gpca_methodology.sysml', facts, group).role)
            .toBe('vendored-reusable');
    });

    it('does not relocate catalog content on a guess at its ontology layer', () => {
        // A converter that decided `gpca_risk.sysml` "is" safety/risk content
        // would be forming an opinion about model semantics, and a wrong guess
        // silently moves a user's model into a namespace they did not choose.
        const facts = readSourceFacts('package p_model_catalog_gpca_risk { }');
        const { role, to } = classifyFile('model/catalog/gpca_risk.sysml', facts, group);
        expect(role).toBe('catalog');
        expect(to).toBe('model/catalog/gpca_risk.sysml');
    });
});

// ─── Dry run ──────────────────────────────────────────────────────────────────

describe('dry run', () => {
    beforeEach(() => {
        write('model/views/risk_fmea_view.sysml', [
            'package proj_model_views_risk_fmea_view {',
            '    view fmea : MemoDiagramView {',
            '        part :>> viewpointDefinition = riskViewpoint;',
            '    }',
            '}',
        ].join('\n'));
        write('model/catalog/things.sysml', 'package proj_model_catalog_things { }');
        write('memo.config.yaml', 'projectName: proj\nmethodology: "@memoarchitect/methodology-default"\n');
    });

    it('plans a non-trivial conversion without touching the disk', () => {
        const before = snapshot(TMP);
        const plan = planConversion(TMP);

        expect(plan.changes.length).toBeGreaterThan(0);
        expect(plan.alreadyConverted).toBe(false);
        expect(snapshot(TMP)).toEqual(before);
    });

    it('reports the moves, the renames, and what it will delete', () => {
        const report = renderPlan(planConversion(TMP));
        expect(report).toContain('model/views/risk_fmea_view.sysml');
        expect(report).toContain('viewpoints');
        expect(report).toContain('memo.config.yaml');
    });

    it('consumes the legacy semantic settings file rather than leaving it beside the result', () => {
        // `settings-boundary` rejects a semantic YAML field at load, so a
        // conversion that left `memo.config.yaml` in place would produce a
        // project that refuses to open.
        expect(planConversion(TMP).removals).toContain('memo.config.yaml');
    });

    it('writes the entrypoint the project lacks', () => {
        const plan = planConversion(TMP);
        const entry = plan.newFiles.find(f => f.path.endsWith('project.sysml'));
        expect(entry).toBeDefined();
        expect(entry!.content).toContain('ProjectMethodBinding');
        expect(entry!.content).toContain('scopeMode');
    });
});

// ─── Collision refusal ────────────────────────────────────────────────────────

describe('collision refusal', () => {
    it('refuses when two files would land on one destination, and writes nothing', () => {
        // Both views declare the same viewpoint and share a basename, so both
        // target `viewpoints/risk/views/overview.sysml`. Suffixing one would
        // silently duplicate a user's model content under a name they never
        // chose; the conversion refuses instead.
        for (const dir of ['a', 'b']) {
            write(`model/${dir}/overview.sysml`, [
                `package proj_model_${dir}_overview {`,
                '    view overview : MemoDiagramView {',
                '        part :>> viewpointDefinition = riskViewpoint;',
                '    }',
                '}',
            ].join('\n'));
        }
        const before = snapshot(TMP);
        const plan = planConversion(TMP);

        expect(plan.collisions.map(c => c.code)).toContain('destination-conflict');
        expect(() => applyConversion(plan)).toThrow(/Refusing to convert/);
        expect(snapshot(TMP)).toEqual(before);
    });

    it('refuses when two files would declare one package name', () => {
        write('model/views/x/report.sysml', [
            'package proj_a {',
            '    view r1 : MemoDiagramView { part :>> viewpointDefinition = riskViewpoint; }',
            '}',
        ].join('\n'));
        write('model/catalog/viewpoints/risk/views/report.sysml', [
            'package proj_viewpoints_risk_views_report { }',
        ].join('\n'));

        const plan = planConversion(TMP);
        expect(plan.collisions.length).toBeGreaterThan(0);
        expect(() => applyConversion(plan)).toThrow();
    });

    it('reports every collision in one pass rather than the first', () => {
        write('model/x/a.sysml', 'package p_x_a {\n    view v1 : V { part :>> viewpointDefinition = rV; }\n}');
        write('model/y/a.sysml', 'package p_y_a {\n    view v2 : V { part :>> viewpointDefinition = rV; }\n}');
        write('model/z/a.sysml', 'package p_z_a {\n    view v3 : V { part :>> viewpointDefinition = rV; }\n}');
        const plan = planConversion(TMP);
        // One destination clash covering three files, plus the package-name
        // clash they also produce — both reported, neither thrown.
        expect(plan.collisions.length).toBeGreaterThanOrEqual(1);
        expect(plan.collisions[0].files.length).toBe(3);
    });

    it('renders a refusal instead of a plan when there are collisions', () => {
        write('model/x/a.sysml', 'package p_x_a {\n    view v1 : V { part :>> viewpointDefinition = rV; }\n}');
        write('model/y/a.sysml', 'package p_y_a {\n    view v2 : V { part :>> viewpointDefinition = rV; }\n}');
        expect(renderPlan(planConversion(TMP))).toContain('REFUSED');
    });
});

// ─── Applying ─────────────────────────────────────────────────────────────────

describe('applying', () => {
    beforeEach(() => {
        write('model/views/risk_fmea_view.sysml', [
            'package proj_model_views_risk_fmea_view {',
            '    private import proj_model_catalog_things::*;',
            '    view fmea : MemoDiagramView {',
            '        expose proj_model_views_risk_fmea_view::*;',
            '        part :>> viewpointDefinition = riskViewpoint;',
            '    }',
            '}',
        ].join('\n'));
        write('model/catalog/things.sysml', [
            'package proj_model_catalog_things {',
            '    part cap : ScreenCapture {',
            '        attribute :>> imageUri = "model/assets/main/shot.png";',
            '    }',
            '}',
        ].join('\n'));
        write('model/assets/main/shot.png', 'PNGDATA');
    });

    it('moves rather than copies — one file at the destination, none at the source', () => {
        applyConversion(planConversion(TMP));
        expect(existsSync(join(TMP, 'model/views/risk_fmea_view.sysml'))).toBe(false);
        expect(existsSync(join(TMP, 'model/catalog/viewpoints/risk/views/risk_fmea_view.sysml'))).toBe(true);
    });

    it('prunes the emptied legacy directories', () => {
        // An empty `model/views/` beside `model/catalog/viewpoints/` is the
        // superseded layout the conversion exists to eliminate.
        applyConversion(planConversion(TMP));
        expect(existsSync(join(TMP, 'model/views'))).toBe(false);
    });

    it('rewrites references in files that did not themselves move', () => {
        applyConversion(planConversion(TMP));
        const view = readFileSync(join(TMP, 'model/catalog/viewpoints/risk/views/risk_fmea_view.sysml'), 'utf-8');
        expect(view).toContain('package proj_viewpoints_risk_views_risk_fmea_view');
        expect(view).toContain('expose proj_viewpoints_risk_views_risk_fmea_view::*;');
    });

    it('moves the artifact payload and rewrites the URI that addresses it', () => {
        applyConversion(planConversion(TMP));
        expect(existsSync(join(TMP, 'model/catalog/artifacts/assets/main/shot.png'))).toBe(true);
        expect(readFileSync(join(TMP, 'model/catalog/things.sysml'), 'utf-8'))
            .toContain('"model/catalog/artifacts/assets/main/shot.png"');
    });

    it('preserves payload bytes exactly', () => {
        applyConversion(planConversion(TMP));
        expect(readFileSync(join(TMP, 'model/catalog/artifacts/assets/main/shot.png'), 'utf-8'))
            .toBe('PNGDATA');
    });

    it('creates the viewpoint file the relocated views now need beneath them', () => {
        applyConversion(planConversion(TMP));
        expect(existsSync(join(TMP, 'model/catalog/viewpoints/risk/viewpoint.sysml'))).toBe(true);
    });

    it('reaches a fixed point: a second run changes nothing', () => {
        applyConversion(planConversion(TMP));
        const after = snapshot(TMP);

        const second = planConversion(TMP);
        expect(second.alreadyConverted).toBe(true);
        expect(second.collisions).toEqual([]);
        applyConversion(second);
        expect(snapshot(TMP)).toEqual(after);
    });
});

// ─── Already-native projects ──────────────────────────────────────────────────

describe('an already-converted project', () => {
    it('is a no-op on MEMO\'s own hand-authored catalog', () => {
        // `ui-screen-regions` was converted by hand in session 3. If the
        // converter wants to change it, one of the two is wrong about what the
        // native layout is — and this is the test that says so.
        const source = resolve(__dirname, '../../../../../memo/examples/ui-screen-regions');
        if (!existsSync(source)) return;   // ontology repo not checked out beside tools

        cpSync(source, join(TMP, 'ui'), { recursive: true });
        const plan = planConversion(join(TMP, 'ui'));

        expect(plan.collisions).toEqual([]);
        expect(plan.changes.filter(c => c.from !== c.to)).toEqual([]);
        expect(plan.newFiles).toEqual([]);
        expect(plan.alreadyConverted).toBe(true);
    });
});

// ─── The real pre-conversion snapshot ─────────────────────────────────────────

describe('the real pre-conversion GPCA snapshot', () => {
    let project: string;

    beforeEach(() => {
        project = join(TMP, 'gpca');
        cpSync(join(CORPUS, 'gpca-pre-native'), project, { recursive: true });
    });

    it('converts without a single collision', () => {
        const plan = planConversion(project);
        expect(plan.collisions).toEqual([]);
    });

    it('derives the project namespace from the source rather than a filename', () => {
        expect(planConversion(project).projectPrefix).toBe('memo_examples_gpca_pump');
    });

    it('relocates all 26 views out of model/views/ and under their viewpoints', () => {
        const plan = planConversion(project);
        const viewMoves = plan.changes.filter(c => c.from.includes('model/views/') && c.from !== c.to);
        expect(viewMoves).toHaveLength(26);
        expect(viewMoves.every(c => c.to.includes('viewpoints') && c.to.includes('views'))).toBe(true);
    });

    it('files each view under its declared viewpoint, contradicting the filename where they disagree', () => {
        const plan = planConversion(project);
        const to = (name: string) =>
            plan.changes.find(c => c.from.endsWith(name))!.to.split(/[\\/]/).join('/');

        // Filename says "behavior"; the model says `logicalArchitectureViewpoint`.
        // The group is named from the usage here because this call passes no
        // resolved ontology; with one, it is the directory that viewpoint's own
        // source sits in. Either way the grouping comes from the model.
        expect(to('behavior_action_flow_view.sysml')).toContain('viewpoints/logical_architecture/views/');
        // The eight `document_*` views belong to six different viewpoints.
        expect(to('document_hazard_analysis_view.sysml')).toContain('viewpoints/risk/views/');
        expect(to('document_sdd_view.sysml')).toContain('viewpoints/software/views/');
        expect(to('document_dhf_index_view.sysml')).toContain('viewpoints/requirements/views/');
    });

    it('lines the project\'s viewpoint directories up with the ontology\'s when one is resolved', () => {
        // `logicalArchitectureViewpoint` is declared in the ontology's
        // `src/viewpoints/logical/`, so the project's directory for it is
        // `logical` — the same name, not a second spelling of it.
        const plan = planConversion(project, {
            viewpointDeclarations: new Map([
                ['logicalArchitectureViewpoint', '/onto/src/viewpoints/logical/logical_viewpoint.sysml'],
            ]),
            viewpointPackages: new Map([
                ['logicalArchitectureViewpoint', 'memo_viewpoints_logical_logical_viewpoint'],
            ]),
        });
        const moved = plan.changes.find(c => c.from.endsWith('behavior_action_flow_view.sysml'))!;
        expect(moved.to.split(/[\\/]/).join('/')).toContain('viewpoints/logical/views/');

        const binding = plan.newFiles.find(f => f.path.includes(`viewpoints`) && f.path.includes('logical'));
        expect(binding!.content).toContain('public import memo_viewpoints_logical_logical_viewpoint::*;');
    });

    it('leaves the vendored methodology package outside the project catalog', () => {
        const plan = planConversion(project);
        expect(plan.changes.some(c => c.from.startsWith('methodology/'))).toBe(false);
        expect(plan.warnings.some(w => w.code === 'vendored-reusable-package')).toBe(true);
    });

    it('removes the memo.config.yaml the flip turned into a load rejection', () => {
        expect(planConversion(project).removals).toContain('memo.config.yaml');
    });

    it('leaves no file under model/ outside the catalog', () => {
        applyConversion(planConversion(project));
        const stray = tree(project)
            .filter(f => f.startsWith('model/') && !f.startsWith('model/catalog/'));
        expect(stray).toEqual([]);
    });

    it('leaves no reference to a renamed package behind', () => {
        const plan = planConversion(project);
        applyConversion(plan);
        const stale: string[] = [];
        for (const rel of tree(project)) {
            if (!rel.endsWith('.sysml')) continue;
            const text = readFileSync(join(project, rel), 'utf-8');
            for (const oldName of plan.packageRenames.keys()) {
                if (new RegExp(`\\b${oldName}\\b`).test(text)) stale.push(`${rel}: ${oldName}`);
            }
        }
        expect(stale).toEqual([]);
    });

    it('reaches a fixed point on the real snapshot too', () => {
        applyConversion(planConversion(project));
        const after = snapshot(project);
        const second = planConversion(project);
        expect(second.alreadyConverted).toBe(true);
        applyConversion(second);
        expect(snapshot(project)).toEqual(after);
    });

    it('loses no model content: every pre-conversion file is accounted for', () => {
        const before = tree(project).filter(f => f.endsWith('.sysml'));
        const plan = planConversion(project);
        applyConversion(plan);
        const after = tree(project).filter(f => f.endsWith('.sysml'));

        // Every file either stayed, moved to a known destination, or is one the
        // conversion created. Nothing vanishes.
        expect(after.length).toBe(before.length + plan.newFiles.filter(f => f.path.endsWith('.sysml')).length);
    });
});
