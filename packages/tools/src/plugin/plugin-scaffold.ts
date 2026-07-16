// ─── Plugin Scaffolding ──────────────────────────────────────────────────────
//
// Generates starter files for new MEMO plugins.
// `memo plugin create <name> --type export`
// ─────────────────────────────────────────────────────────────────────────────

import type { PluginType } from './plugin-types.js';

/** Options for scaffolding a plugin */
export interface ScaffoldOptions {
    name: string;
    type: PluginType;
    description?: string;
    author?: string;
    license?: string;
}

/** A scaffolded file */
export interface ScaffoldFile {
    path: string;
    content: string;
}

/** Generate scaffold files for a new plugin */
export function scaffoldPlugin(options: ScaffoldOptions): ScaffoldFile[] {
    const { name, type, description, author, license } = options;
    const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const pluginId = safeName;
    const displayName = name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const files: ScaffoldFile[] = [];

    // memo.plugin.yaml
    files.push({
        path: 'memo.plugin.yaml',
        content: `id: "${pluginId}"
name: "${displayName}"
version: "0.1.0"
type: ${type}
description: "${description || `MEMO ${type} plugin`}"
entrypoint: "lib/index.js"
${author ? `author: "${author}"` : ''}
${license ? `license: "${license}"` : 'license: "MIT"'}
tags: [memo-plugin, ${type}]
`,
    });

    // package.json
    files.push({
        path: 'package.json',
        content: JSON.stringify({
            name: `memo-plugin-${safeName}`,
            version: '0.1.0',
            description: description || `MEMO ${type} plugin`,
            type: 'module',
            main: './lib/index.js',
            types: './lib/index.d.ts',
            scripts: {
                build: 'tsc',
                test: 'vitest run',
                dev: 'tsc --watch',
            },
            dependencies: {
                '@memo/tools': 'workspace:*',
            },
            devDependencies: {
                typescript: '~5.5.0',
                vitest: '^2.1.0',
            },
            ...(author ? { author } : {}),
            license: license || 'MIT',
            files: ['lib/'],
        }, null, 2) + '\n',
    });

    // tsconfig.json
    files.push({
        path: 'tsconfig.json',
        content: JSON.stringify({
            compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                declaration: true,
                outDir: './lib',
                rootDir: './src',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
            },
            include: ['src/'],
        }, null, 2) + '\n',
    });

    // Source file based on plugin type
    files.push({
        path: 'src/index.ts',
        content: generatePluginSource(pluginId, displayName, type),
    });

    // Test file
    files.push({
        path: 'src/__tests__/plugin.test.ts',
        content: generatePluginTest(pluginId, type),
    });

    return files;
}

function generatePluginSource(id: string, name: string, type: PluginType): string {
    switch (type) {
        case 'export':
            return `import type { ExportPlugin, PluginContext, ExportResult } from '@memo/tools';
import type { DhfDocument } from '@memo/tools';

const plugin: ExportPlugin = {
    id: '${id}',
    name: '${name}',
    version: '0.1.0',
    type: 'export',
    extension: '.txt',
    mimeType: 'text/plain',

    async render(doc: DhfDocument, ctx: PluginContext, options?: Record<string, unknown>): Promise<ExportResult> {
        // TODO: Implement your export logic here
        const lines: string[] = [];
        lines.push(\`# \${doc.frontmatter.title}\`);
        lines.push(\`Generated: \${doc.frontmatter.generatedAt}\`);
        lines.push('');

        for (const section of doc.sections) {
            lines.push(\`## \${section.title}\`);
            lines.push(\`Status: \${section.status}\`);
            lines.push('');
        }

        return {
            content: lines.join('\\n'),
            extension: '.txt',
            mimeType: 'text/plain',
        };
    },
};

export default plugin;
`;

        case 'analysis':
            return `import type { AnalysisPlugin, PluginContext, AnalysisResult } from '@memo/tools';

const plugin: AnalysisPlugin = {
    id: '${id}',
    name: '${name}',
    version: '0.1.0',
    type: 'analysis',

    async analyse(ctx: PluginContext, options?: Record<string, unknown>): Promise<AnalysisResult> {
        // TODO: Implement your analysis logic here
        const elements = ctx.query.allElements();
        const relationships = ctx.query.allRelationships();

        return {
            toolId: '${id}',
            title: '${name}',
            data: {
                elementCount: elements.length,
                relationshipCount: relationships.length,
            },
            summary: \`Analyzed \${elements.length} elements and \${relationships.length} relationships.\`,
        };
    },
};

export default plugin;
`;

        case 'validation':
            return `import type { ValidationPlugin, PluginContext } from '@memo/tools';
import type { Violation } from '@memo/tools';

const plugin: ValidationPlugin = {
    id: '${id}',
    name: '${name}',
    version: '0.1.0',
    type: 'validation',

    async validate(ctx: PluginContext, options?: Record<string, unknown>): Promise<Violation[]> {
        const violations: Violation[] = [];

        // TODO: Implement your validation logic here
        // Example: check that all elements have documentation
        for (const el of ctx.query.allElements()) {
            if (!el.doc) {
                violations.push({
                    ruleId: '${id}-001',
                    description: \`Element \${el.name} is missing documentation.\`,
                    severity: 'warning',
                    elementId: el.id,
                    elementKind: el.kind,
                    elementName: el.name,
                    layer: el.layer,
                });
            }
        }

        return violations;
    },
};

export default plugin;
`;

        case 'generator':
            return `import type { GeneratorPlugin, PluginContext } from '@memo/tools';

const plugin: GeneratorPlugin = {
    id: '${id}',
    name: '${name}',
    version: '0.1.0',
    type: 'generator',

    async generate(ctx: PluginContext, options?: Record<string, unknown>): Promise<void> {
        // TODO: Implement your generator logic here
        // Generators run before build and can write files, modify model data, etc.
        //
        // Example: generate a summary file
        // const fs = await import('node:fs');
        // const summary = \`Model: \${ctx.config.projectName}\\nElements: \${ctx.query.totalElements()}\`;
        // fs.writeFileSync(path.join(ctx.projectDir, 'model-summary.txt'), summary);
        console.log('Generator ${id} ran successfully.');
    },
};

export default plugin;
`;
    }
}

function generatePluginTest(id: string, type: PluginType): string {
    return `import { describe, it, expect } from 'vitest';
import plugin from '../index.js';

describe('${id} plugin', () => {
    it('has correct metadata', () => {
        expect(plugin.id).toBe('${id}');
        expect(plugin.type).toBe('${type}');
        expect(plugin.name).toBeTruthy();
        expect(plugin.version).toBeTruthy();
    });
});
`;
}
