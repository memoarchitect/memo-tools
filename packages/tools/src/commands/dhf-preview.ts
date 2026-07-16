// ─── DHF Preview Command ──────────────────────────────────────────────────────
//
// Starts a local HTTP server that:
//   - Serves rendered DHF markdown documents as styled HTML
//   - Watches dhf/ directory and memo.dhf.yaml for changes (live reload)
//   - Provides a document index at /
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, watch } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import chalk from 'chalk';
import {
    findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries,
    validateModel, computeCompleteness,
    createQueryContext,
} from '@memo/tools';
import { compileMarkdownDocument } from '@memo/tools';
import { loadDhfConfigV2, extractProjectMeta } from '@memo/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import type { BuilderRegistries, MemoModel, MEMOConfig, ValidationResult, CompletenessReport } from '@memo/tools';

const PREVIEW_PORT_DEFAULT = 3001;

// ─── Minimal markdown → HTML converter (no external dep) ─────────────────────

function markdownToHtml(md: string): string {
    // Very lightweight: headings, bold, italic, tables, code blocks, lists
    let html = md
        // Fenced code blocks
        .replace(/```[\w-]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Headings
        .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
        .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
        // Horizontal rule
        .replace(/^---$/gm, '<hr>')
        // Bold + italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        // Tables (simple pipe tables)
        .replace(/^\|(.+)\|$/gm, (line) => {
            const isHeader = false;
            const cells = line.slice(1, -1).split('|').map(c => c.trim());
            const td = cells.map(c => `<td>${c}</td>`).join('');
            return `<tr>${td}</tr>`;
        })
        // Blockquotes
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        // Lists
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Paragraphs (double newlines)
        .replace(/\n\n(?!<[h|p|u|o|l|t|b|d|h])/g, '</p><p>');

    return `<p>${html}</p>`;
}

function wrapHtml(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — MEMO DHF Preview</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: #1B3A4B; background: #F7F7F5; margin: 0; padding: 0; }
  .sidebar { position: fixed; top: 0; left: 0; width: 240px; height: 100vh; overflow-y: auto; background: #1B3A4B; color: #E5E7EB; padding: 20px 16px; }
  .sidebar h2 { font-size: 13px; font-weight: 700; color: #2DD4A8; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; }
  .sidebar a { display: block; color: #9CA3AF; text-decoration: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 2px; }
  .sidebar a:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .main { margin-left: 240px; padding: 40px 48px; max-width: 900px; }
  h1 { font-size: 26px; font-weight: 700; color: #1B3A4B; border-bottom: 2px solid #2DD4A8; padding-bottom: 12px; margin-bottom: 24px; }
  h2 { font-size: 18px; font-weight: 700; color: #1B3A4B; margin-top: 32px; }
  h3 { font-size: 15px; font-weight: 600; color: #374151; }
  h4 { font-size: 14px; font-weight: 600; color: #6B7280; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', monospace; font-size: 12px; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { border-left: 3px solid #2DD4A8; margin: 16px 0; padding: 8px 16px; background: #f0fdf9; color: #374151; font-style: italic; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  a { color: #2563eb; }
  li { margin-bottom: 4px; }
  .reload-banner { display: none; position: fixed; top: 0; left: 0; right: 0; background: #2DD4A8; color: #1B3A4B; text-align: center; padding: 8px; font-size: 13px; font-weight: 600; z-index: 100; }
</style>
<script>
  // Live reload via polling
  let lastHash = '';
  setInterval(async () => {
    try {
      const r = await fetch('/__memo_reload');
      const { hash } = await r.json();
      if (lastHash && hash !== lastHash) { window.location.reload(); }
      lastHash = hash;
    } catch {}
  }, 1500);
</script>
</head>
<body>
<div class="sidebar" id="sidebar">
  <h2>MEMO DHF</h2>
  <div id="nav-links">Loading...</div>
</div>
<div class="main">
${body}
</div>
<script>
  fetch('/__memo_nav').then(r => r.json()).then(links => {
    document.getElementById('nav-links').innerHTML = links
      .map(l => \`<a href="/doc/\${l.id}">\${l.title}</a>\`)
      .join('');
  }).catch(() => {});
</script>
</body>
</html>`;
}

// ─── Find DHF markdown files ──────────────────────────────────────────────────

function findDhfFiles(dhfDir: string): Array<{ id: string; path: string }> {
    const results: Array<{ id: string; path: string }> = [];

    function scan(dir: string): void {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(full);
                } else if (entry.name.endsWith('.md')) {
                    const rel = relative(dhfDir, full).replace(/\.md$/, '').replace(/\\/g, '/');
                    results.push({ id: rel, path: full });
                }
            }
        } catch { /* skip */ }
    }

    scan(dhfDir);
    return results;
}

// ─── Main preview server ──────────────────────────────────────────────────────

export async function dhfPreviewCommand(options: { port?: number }): Promise<void> {
    const cwd = process.cwd();
    const port = options.port ?? PREVIEW_PORT_DEFAULT;

    console.log(chalk.bold('\nMEMO DHF Preview\n'));

    // Load model
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found in current directory.'));
        process.exit(1);
    }

    let queryCtx: ReturnType<typeof createQueryContext> | null = null;
    let dhfConfig = loadDhfConfigV2(cwd);
    let reloadHash = Date.now().toString();

    async function refreshModel(): Promise<void> {
        try {
            const config = loadAndResolveConfig(configPath!);
            let ontologyRegistries: BuilderRegistries | undefined;
            try {
                const loadResult = await loadOntologyRegistries(configPath!);
                if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
            } catch { /* skip */ }

            const sysmlFiles: string[] = [];
            function findSysml(dir: string): void {
                try {
                    for (const e of readdirSync(dir, { withFileTypes: true })) {
                        const full = join(dir, e.name);
                        if (e.isDirectory() && e.name !== 'node_modules') findSysml(full);
                        else if (e.name.endsWith('.sysml')) sysmlFiles.push(full);
                    }
                } catch { /* skip */ }
            }
            findSysml(cwd);

            const { documents, errors } = await parseFiles(sysmlFiles, cwd + '/');
            const model = buildMemoModel(documents, config, errors, ontologyRegistries);
            const validation = validateModel(model);
            const completeness = computeCompleteness(model, validation, config);
            queryCtx = createQueryContext(model, validation, completeness, config);
            dhfConfig = loadDhfConfigV2(cwd) ?? {};
            reloadHash = Date.now().toString();
            console.log(chalk.gray(`  Model refreshed: ${model.elements.size} elements`));
        } catch (err) {
            console.error(chalk.red(`  Model refresh failed: ${err instanceof Error ? err.message : err}`));
        }
    }

    await refreshModel();

    const dhfDir = resolve(cwd, 'dhf');
    const navLinks: Array<{ id: string; title: string }> = [];

    // Watch for changes
    const watchDirs = [dhfDir, cwd].filter(d => existsSync(d));
    for (const dir of watchDirs) {
        try {
            watch(dir, { recursive: true }, (_evt, filename) => {
                if (!filename) return;
                if (filename.endsWith('.sysml') || filename.endsWith('.yaml') || filename.endsWith('.yml') || filename.endsWith('.md')) {
                    refreshModel();
                }
            });
        } catch { /* watch not available on all platforms */ }
    }

    const server = createServer(async (req, res) => {
        const url = req.url ?? '/';

        // Live reload hash endpoint
        if (url === '/__memo_reload') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ hash: reloadHash }));
            return;
        }

        // Nav links endpoint
        if (url === '/__memo_nav') {
            const files = existsSync(dhfDir) ? findDhfFiles(dhfDir) : [];
            const links = files.map(f => ({
                id: encodeURIComponent(f.id),
                title: f.id.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? f.id,
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(links));
            return;
        }

        // Document render
        if (url.startsWith('/doc/')) {
            const docId = decodeURIComponent(url.slice(5));
            const files = existsSync(dhfDir) ? findDhfFiles(dhfDir) : [];
            const file = files.find(f => f.id === docId);

            if (!file || !queryCtx) {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(wrapHtml('Not Found', '<h1>Document Not Found</h1>'));
                return;
            }

            try {
                const result = await compileMarkdownDocument({
                    templateId: file.path, // pass absolute path directly
                    ctx: queryCtx,
                    config: dhfConfig ?? {},
                });
                const html = wrapHtml(result.title, markdownToHtml(result.markdown));
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(wrapHtml('Error', `<h1>Error</h1><pre>${msg}</pre>`));
            }
            return;
        }

        // Index
        if (url === '/' || url === '/index.html') {
            const files = existsSync(dhfDir) ? findDhfFiles(dhfDir) : [];
            const product = dhfConfig?.project?.product ?? 'MEMO Project';
            const docLinks = files.map(f => {
                const title = f.id.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? f.id;
                const group = f.id.split('/')[0] ?? 'general';
                return `<tr><td><a href="/doc/${encodeURIComponent(f.id)}">${title}</a></td><td style="color:#6B7280">${group}</td></tr>`;
            }).join('\n');

            const body = `
<h1>${product} — DHF Preview</h1>
<p style="color:#6B7280">Live preview server — changes to .md and .sysml files are reflected automatically.</p>
<h2>Documents</h2>
<table>
<thead><tr><th>Document</th><th>Group</th></tr></thead>
<tbody>${docLinks || '<tr><td colspan="2" style="color:#9CA3AF">No DHF documents found. Run <code>memo dhf init</code> to scaffold.</td></tr>'}</tbody>
</table>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(wrapHtml(product, body));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    });

    server.listen(port, () => {
        console.log(chalk.green(`DHF preview running at http://localhost:${port}`));
        console.log(chalk.gray('  Watching for model and document changes...\n'));
        console.log(chalk.gray('  Press Ctrl+C to stop\n'));
    });
}
