import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
    ProvenanceTable,
    originForPackageType,
    isReusableOrigin,
    classifySourceChange,
    type ResolvedRoot,
} from '../model/source-provenance.js';

// Session 1, design section 7.1-7.3: origin is decided by the resolved
// dependency root a file sits under — never by construct kind or path shape.

const PROJECT = '/ws/infusion-pump';

function table(roots: ResolvedRoot[] = []) {
    return new ProvenanceTable(PROJECT, roots);
}

const ontologyRoot: ResolvedRoot = {
    dir: join(PROJECT, 'node_modules/@memoarchitect/ontology'),
    origin: 'ontology',
    packageName: '@memoarchitect/ontology',
    packageVersion: '0.6.5',
    importDepth: 2,
};

const methodologyRoot: ResolvedRoot = {
    dir: join(PROJECT, 'node_modules/@memoarchitect/methodology-default'),
    origin: 'methodology',
    packageName: '@memoarchitect/methodology-default',
    importDepth: 1,
    selectedBy: 'METH-MD-DEFAULT',
};

describe('originForPackageType', () => {
    it('maps manifest types to authority categories', () => {
        expect(originForPackageType('ontology')).toBe('ontology');
        expect(originForPackageType('profile')).toBe('ontology');
        expect(originForPackageType('methodology')).toBe('methodology');
        expect(originForPackageType('extension')).toBe('extension');
        expect(originForPackageType('device')).toBe('project');
    });

    it('treats an unknown type as ontology, not project', () => {
        // It arrived through dependency resolution, so it is not writable.
        // Calling it project content would offer edits on library files.
        expect(originForPackageType('something-new')).toBe('ontology');
        expect(originForPackageType(undefined)).toBe('ontology');
    });
});

describe('isReusableOrigin', () => {
    it('separates frozen reusable content from project content', () => {
        expect(isReusableOrigin('ontology')).toBe(true);
        expect(isReusableOrigin('methodology')).toBe(true);
        expect(isReusableOrigin('extension')).toBe(true);
        expect(isReusableOrigin('standard-library')).toBe(true);
        expect(isReusableOrigin('project')).toBe(false);
    });
});

describe('ProvenanceTable', () => {
    it('reports workspace files as writable project content', () => {
        const p = table([ontologyRoot]).lookup(join(PROJECT, 'model/catalog/architecture/system.sysml'))!;
        expect(p.origin).toBe('project');
        expect(p.writable).toBe(true);
        expect(p.sourceFile).toBe('model/catalog/architecture/system.sysml');
    });

    it('reports dependency files as read-only with package identity', () => {
        const p = table([ontologyRoot]).lookup(join(ontologyRoot.dir, 'src/core/memo_core.sysml'))!;
        expect(p.origin).toBe('ontology');
        expect(p.writable).toBe(false);
        expect(p.packageName).toBe('@memoarchitect/ontology');
        expect(p.packageVersion).toBe('0.6.5');
        expect(p.sourceFile).toBe('src/core/memo_core.sysml');
    });

    it('carries what selected a root', () => {
        const p = table([methodologyRoot]).lookup(join(methodologyRoot.dir, 'src/method.sysml'))!;
        expect(p.origin).toBe('methodology');
        expect(p.selectedBy).toBe('METH-MD-DEFAULT');
        expect(p.importDepth).toBe(1);
    });

    it('does not decide origin from construct kind or filename', () => {
        // The same declaration in two places gets two origins. Nothing about
        // the file's name or what it declares is consulted.
        const t = table([ontologyRoot]);
        expect(t.lookup(join(PROJECT, 'model/hazards.sysml'))!.origin).toBe('project');
        expect(t.lookup(join(ontologyRoot.dir, 'model/hazards.sysml'))!.origin).toBe('ontology');
    });

    it('resolves a nested root before the project that contains it', () => {
        // node_modules sits inside the workspace; longest match must win or
        // every dependency would be reported as editable project content.
        const p = table([ontologyRoot]).lookup(join(ontologyRoot.dir, 'src/x.sysml'))!;
        expect(p.origin).toBe('ontology');
    });

    it('resolves the more specific of two overlapping roots', () => {
        const inner: ResolvedRoot = {
            dir: join(ontologyRoot.dir, 'vendor/ext'),
            origin: 'extension',
            packageName: '@acme/ext',
            importDepth: 3,
        };
        const p = table([ontologyRoot, inner]).lookup(join(inner.dir, 'a.sysml'))!;
        expect(p.origin).toBe('extension');
        expect(p.packageName).toBe('@acme/ext');
    });

    it('does not treat a sibling directory as being inside a root', () => {
        // A prefix test on raw strings would place this under PROJECT.
        expect(table([]).lookup('/ws/infusion-pump-old/model/a.sysml')).toBeUndefined();
    });

    it('returns undefined rather than guessing for an unknown location', () => {
        expect(table([ontologyRoot]).lookup('/elsewhere/a.sysml')).toBeUndefined();
    });

    it('lookupOrProject supplies a project fallback for build-path callers', () => {
        const p = table([]).lookupOrProject('/elsewhere/a.sysml');
        expect(p.origin).toBe('project');
        expect(p.writable).toBe(true);
    });
});

describe('watch source classification', () => {
    it('uses the resolved root rather than a configured path list', () => {
        const t = table([ontologyRoot]);
        expect(classifySourceChange(join(PROJECT, 'model/catalog.sysml'), t)).toBe('project');
        expect(classifySourceChange(join(ontologyRoot.dir, 'src/core.sysml'), t)).toBe('reusable');
        expect(classifySourceChange('/elsewhere/file.sysml', t)).toBe('unknown');
    });
});

// ─── Qualified identity and short-name collisions (deliverable 3) ─────────────

describe('KindRegistry qualified identity', () => {
    it('records the qualified name alongside the short name', async () => {
        const { KindRegistry } = await import('../model/kind-registry.js');
        const registry = new KindRegistry();
        registry.register({
            name: 'Hazard', label: 'Hazard', layer: 'risk', sysmlConstruct: 'part def',
            qualifiedName: 'memo::assurance::safety_risk::Hazard',
            sourceFile: 'src/assurance/risk.sysml',
        });
        expect(registry.getQualifiedName('Hazard')).toBe('memo::assurance::safety_risk::Hazard');
        expect(registry.getCollisions()).toEqual([]);
    });

    it('reports two definitions competing for one short name', async () => {
        const { KindRegistry } = await import('../model/kind-registry.js');
        const registry = new KindRegistry();
        registry.register({
            name: 'WorkflowStep', label: 'WorkflowStep', layer: 'methodology', sysmlConstruct: 'action def',
            qualifiedName: 'memo_methodology_workflow::WorkflowStep',
            sourceFile: 'src/methodology/workflow/memo_workflow.sysml',
        });
        registry.register({
            name: 'WorkflowStep', label: 'WorkflowStep', layer: 'operational', sysmlConstruct: 'action def',
            qualifiedName: 'memo_architecture_operational_workflows::WorkflowStep',
            sourceFile: 'src/architecture/operational/workflows/memo_workflows.sysml',
        });
        const collisions = registry.getCollisions();
        expect(collisions).toHaveLength(1);
        expect(collisions[0].shortName).toBe('WorkflowStep');
        expect(collisions[0].qualifiedNames).toEqual([
            'memo_methodology_workflow::WorkflowStep',
            'memo_architecture_operational_workflows::WorkflowStep',
        ]);
        expect(collisions[0].sourceFiles).toHaveLength(2);
    });

    it('does not report re-registering the same qualified name', async () => {
        // withProjectExtensions copies every entry into a fresh registry; that
        // must not look like a collision.
        const { KindRegistry } = await import('../model/kind-registry.js');
        const registry = new KindRegistry();
        const entry = {
            name: 'Hazard', label: 'Hazard', layer: 'risk', sysmlConstruct: 'part def' as const,
            qualifiedName: 'memo::assurance::Hazard',
        };
        registry.register(entry);
        registry.register({ ...entry });
        expect(registry.getCollisions()).toEqual([]);
    });
});
