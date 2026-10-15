import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLibraryRoots, discoverProjectSources } from '../model/native-project.js';

let base: string | undefined;
afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); base = undefined; delete process.env.MEMO_ONTOLOGY_PATH; });

/** A directory holding one package (`name`) whose SysML is in `src/`, as an ontology repository does. */
function packageAt(dir: string, name: string, version: string): void {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'memo.package.yaml'), `name: '${name}'\nversion: ${version}\nsysmlDir: ./src\n`);
    writeFileSync(join(dir, 'src', 'p.sysml'), `package ${name.replace(/\W/g, '_')} { }\n`);
}

/** The manifest a repository or an installation carries: the packages it maps, and the fields a manifest requires. */
function manifest(dir: string, packages: Record<string, string>): void {
    const mapped = Object.entries(packages).map(([name, path]) => `  "${name}": ${path}`).join('\n');
    writeFileSync(join(dir, 'memo.manifest.yaml'), [
        'manifest: 1', 'packages:', mapped, 'init:', '  defaultExtends: "onto"', '  rootImport: memo', `  template: ${Object.values(packages)[0]}`, 'examples: {}', '',
    ].join('\n'));
}

/** A repository that holds an ontology and a project inside it: what a pinned worktree of one is. */
function repository(): { repo: string; project: string } {
    base = mkdtempSync(join(tmpdir(), 'memo-roots-'));
    const repo = join(base, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    packageAt(join(repo, 'ontology'), 'onto', '1.0.0');
    manifest(repo, { onto: './ontology' });
    const project = join(repo, 'examples', 'p');
    mkdirSync(join(project, 'model'), { recursive: true });
    writeFileSync(join(project, 'memo.package.yaml'), 'name: p\nentrypoint: model/project.sysml\ninclude: [model]\n');
    writeFileSync(join(project, 'model', 'project.sysml'), 'package p { }\n');
    return { repo, project };
}

describe('a package name resolves to one library root', () => {
    it('keeps the repository the project sits in over the installed ontology, and says so once', () => {
        // The repository carries the ontology under the name the installation has: a pinned worktree of `memo`.
        base = mkdtempSync(join(tmpdir(), 'memo-roots-'));
        const repo = join(base, 'repo');
        mkdirSync(join(repo, '.git'), { recursive: true });
        packageAt(join(repo, 'ontology'), '@memoarchitect/ontology', '0.0.1');
        manifest(repo, { '@memoarchitect/ontology': './ontology' });
        const project = join(repo, 'examples', 'p');
        mkdirSync(join(project, 'model'), { recursive: true });
        writeFileSync(join(project, 'memo.package.yaml'), 'name: p\nentrypoint: model/project.sysml\ninclude: [model]\n');
        writeFileSync(join(project, 'model', 'project.sysml'), 'package p { }\n');

        const onto = discoverLibraryRoots(project).filter(r => r.packageName === '@memoarchitect/ontology');
        expect(onto).toHaveLength(1);
        expect(onto[0].dir).toContain(join(repo, 'ontology'));
        const warned = discoverProjectSources(project).diagnostics.filter(d => d.code === 'library-root-shadowed');
        expect(warned).toHaveLength(1);
    });

    it('lets an explicit MEMO_ONTOLOGY_PATH win, and reports the copy it passed over', () => {
        const { project } = repository();
        const chosen = join(base!, 'chosen');
        packageAt(join(chosen, 'ontology'), 'onto', '3.0.0');
        manifest(chosen, { onto: './ontology' });
        process.env.MEMO_ONTOLOGY_PATH = chosen;
        const roots = discoverLibraryRoots(project);
        const onto = roots.filter(r => r.packageName === 'onto');
        expect(onto).toHaveLength(1);
        expect(onto[0].packageVersion).toBe('3.0.0');
        const warned = discoverProjectSources(project).diagnostics.filter(d => d.code === 'library-root-shadowed');
        expect(warned).toHaveLength(1);
        expect(warned[0].severity).toBe('warning');
    });
});
