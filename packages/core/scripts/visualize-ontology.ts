#!/usr/bin/env npx tsx
/**
 * visualize-ontology.ts — Parse SysML v2 ontology files and generate
 * an interactive HTML visualization with:
 *   - Type hierarchy (specialization arrows)
 *   - Domain color-coding (9 CoSMA layers)
 *   - Connection definitions with end types
 *   - Collapsible domains
 *   - Search/filter
 *
 * Usage: npx tsx packages/core/scripts/visualize-ontology.ts [sysml-dir] [output.html]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../src/language/memo-sysml-module.js';
import type {
    Model,
    PackageDeclaration,
    PartDefinition,
    RequirementDefinition,
    ActionDefinition,
    PortDefinition,
    InterfaceDefinition,
    ConnectionDefinition,
    AttributeDefinition,
    EnumDefinition,
    EndDeclaration,
    AttributeMember,
    DocComment,
    Specialization,
} from '../src/language/generated/ast.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

const args = process.argv.slice(2);
const sysmlDir = args[0] || resolve(fileURLToPath(import.meta.url), '../../../ontology/sysml');
const outputFile = args[1] || resolve(fileURLToPath(import.meta.url), '../../../ontology/dist/ontology-viewer.html');

// ─── Domain → color mapping (CoSMA layers) ──────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
    Business: '#8E44AD',
    Requirements: '#4A90D9',
    Risk: '#E74C3C',
    Functional: '#E67E22',
    Logical: '#7B68EE',
    Physical: '#95A5A6',
    Software: '#F39C12',
    Interfaces: '#1ABC9C',
    UI: '#3498DB',
    CrossCutting: '#2C3E50',
    Relationships: '#E91E63',
};

function domainFromPackage(pkgName: string): string {
    // Extract domain from package name like "MEMO_Ontology_Business"
    const parts = pkgName.split('_');
    return parts[parts.length - 1] || 'Unknown';
}

// ─── Collect SysML files ─────────────────────────────────────────────────────

function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            files.push(...findSysmlFiles(full));
        } else if (entry.endsWith('.sysml') && entry !== 'index.sysml') {
            files.push(full);
        }
    }
    return files;
}

// ─── AST extraction ──────────────────────────────────────────────────────────

interface TypeNode {
    id: string;
    name: string;
    kind: string; // 'part def', 'requirement def', etc.
    domain: string;
    color: string;
    superType?: string;
    attributes: { name: string; type: string }[];
    doc?: string;
    ends?: { name: string; type?: string; multiplicity?: string }[]; // for connection defs
    literals?: string[]; // for enum defs
}

interface Edge {
    from: string;
    to: string;
    label: string;
    style: 'specialization' | 'end';
}

function extractDoc(body: any[]): string | undefined {
    const docNode = body?.find((m: any) => m.$type === 'DocComment') as DocComment | undefined;
    if (!docNode) return undefined;
    // Strip `doc /* ... */` wrapper
    return docNode.content
        .replace(/^doc\s+\/\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .replace(/\n\s*\*\s?/g, ' ')
        .trim();
}

function extractAttributes(body: any[]): { name: string; type: string }[] {
    return (body || [])
        .filter((m: any) => m.$type === 'AttributeMember')
        .map((m: AttributeMember) => ({
            name: m.name,
            type: m.type || 'value',
        }));
}

function extractEnds(body: any[]): { name: string; type?: string; multiplicity?: string }[] {
    return (body || [])
        .filter((m: any) => m.$type === 'EndDeclaration')
        .map((m: EndDeclaration) => {
            let mult: string | undefined;
            if (m.multiplicity) {
                if (m.multiplicity.unbounded) {
                    mult = `${m.multiplicity.lower}..*`;
                } else if (m.multiplicity.exact !== undefined) {
                    mult = `${m.multiplicity.exact}`;
                } else {
                    mult = `${m.multiplicity.lower}..${m.multiplicity.upper}`;
                }
            }
            return { name: m.name, type: m.type || undefined, multiplicity: mult };
        });
}

async function extractFromFile(filePath: string): Promise<{ nodes: TypeNode[]; edges: Edge[] }> {
    const source = readFileSync(filePath, 'utf-8');
    const doc = await parse(source);
    const model = doc.parseResult.value;
    const nodes: TypeNode[] = [];
    const edges: Edge[] = [];

    for (const member of model.members) {
        if (member.$type !== 'PackageDeclaration') continue;
        const pkg = member as PackageDeclaration;
        const domain = domainFromPackage(pkg.name);
        const color = DOMAIN_COLORS[domain] || '#666';

        for (const m of pkg.members) {
            const defTypes: Record<string, string> = {
                PartDefinition: 'part def',
                RequirementDefinition: 'requirement def',
                ActionDefinition: 'action def',
                PortDefinition: 'port def',
                InterfaceDefinition: 'interface def',
                ConnectionDefinition: 'connection def',
                AttributeDefinition: 'attribute def',
                EnumDefinition: 'enum def',
            };

            const kind = defTypes[m.$type];
            if (!kind) continue;

            const def = m as any;
            const node: TypeNode = {
                id: def.name,
                name: def.name,
                kind,
                domain,
                color,
                attributes: extractAttributes(def.body),
                doc: extractDoc(def.body),
            };

            // Specialization
            if (def.specialization) {
                node.superType = (def.specialization as Specialization).superType;
                edges.push({
                    from: def.name,
                    to: node.superType!,
                    label: 'specializes',
                    style: 'specialization',
                });
            }

            // Connection def ends — also create edges to typed end targets
            if (m.$type === 'ConnectionDefinition') {
                node.ends = extractEnds(def.body);
                for (const end of node.ends) {
                    if (end.type) {
                        edges.push({
                            from: def.name,
                            to: end.type,
                            label: end.name,
                            style: 'end',
                        });
                    }
                }
            }

            // Enum literals
            if (m.$type === 'EnumDefinition') {
                node.literals = def.literals?.map((l: any) => l.name) || [];
            }

            nodes.push(node);
        }
    }

    return { nodes, edges };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Parsing SysML files from: ${sysmlDir}`);
    const files = findSysmlFiles(sysmlDir);
    console.log(`Found ${files.length} files`);

    const allNodes: TypeNode[] = [];
    const allEdges: Edge[] = [];

    for (const file of files) {
        const { nodes, edges } = await extractFromFile(file);
        allNodes.push(...nodes);
        allEdges.push(...edges);
    }

    console.log(`Extracted ${allNodes.length} types, ${allEdges.length} relationships`);

    // Generate HTML
    const html = generateHTML(allNodes, allEdges);
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, html);
    console.log(`Written to: ${outputFile}`);
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function generateHTML(nodes: TypeNode[], edges: Edge[]): string {
    const nodesJSON = JSON.stringify(nodes, null, 2);
    const edgesJSON = JSON.stringify(edges, null, 2);
    const domainColorsJSON = JSON.stringify(DOMAIN_COLORS, null, 2);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MEMO Ontology Viewer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; }
#app { display: flex; height: 100vh; }

/* Sidebar */
#sidebar { width: 320px; background: #16213e; border-right: 1px solid #0f3460; overflow-y: auto; flex-shrink: 0; }
#sidebar h1 { font-size: 16px; padding: 16px; border-bottom: 1px solid #0f3460; color: #e94560; }
#search { width: calc(100% - 32px); margin: 12px 16px; padding: 8px 12px; background: #1a1a2e; border: 1px solid #0f3460; color: #eee; border-radius: 6px; font-size: 13px; }
#search:focus { outline: none; border-color: #e94560; }
.domain-group { margin-bottom: 4px; }
.domain-header { display: flex; align-items: center; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 600; gap: 8px; }
.domain-header:hover { background: rgba(255,255,255,0.05); }
.domain-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.domain-count { color: #888; font-weight: 400; margin-left: auto; font-size: 11px; }
.domain-items { padding: 0 16px 4px 34px; }
.domain-items.collapsed { display: none; }
.type-item { padding: 4px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px; }
.type-item:hover { background: rgba(255,255,255,0.08); }
.type-item.selected { background: rgba(233,69,96,0.2); }
.type-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.1); color: #aaa; }

/* Main area */
#main { flex: 1; display: flex; flex-direction: column; }
#toolbar { padding: 8px 16px; background: #16213e; border-bottom: 1px solid #0f3460; display: flex; gap: 12px; align-items: center; font-size: 13px; }
#toolbar label { color: #888; }
#toolbar select { background: #1a1a2e; border: 1px solid #0f3460; color: #eee; padding: 4px 8px; border-radius: 4px; }
#canvas-wrapper { flex: 1; position: relative; overflow: hidden; }
canvas { display: block; }

/* Detail panel */
#detail { position: absolute; top: 16px; right: 16px; width: 340px; background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 16px; display: none; max-height: calc(100vh - 120px); overflow-y: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
#detail.visible { display: block; }
#detail h2 { font-size: 16px; margin-bottom: 4px; }
#detail .kind-label { font-size: 11px; color: #888; margin-bottom: 8px; }
#detail .doc { font-size: 12px; color: #bbb; margin-bottom: 12px; line-height: 1.5; }
#detail .section { margin-bottom: 12px; }
#detail .section h3 { font-size: 12px; color: #e94560; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
#detail .attr-row { font-size: 12px; padding: 2px 0; display: flex; gap: 8px; }
#detail .attr-name { color: #8BC6EC; }
#detail .attr-type { color: #888; }
#detail .end-row { font-size: 12px; padding: 2px 0; }
#detail .enum-lit { font-size: 12px; color: #F39C12; padding: 1px 0; }
#detail .super-link { color: #e94560; cursor: pointer; text-decoration: underline; font-size: 12px; }

/* Stats bar */
#stats { padding: 6px 16px; background: #0f3460; font-size: 11px; color: #888; display: flex; gap: 16px; }
</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <h1>MEMO Ontology v2.0</h1>
    <input type="text" id="search" placeholder="Search types..." autocomplete="off">
    <div id="domain-list"></div>
  </div>
  <div id="main">
    <div id="toolbar">
      <label>View:</label>
      <select id="view-mode">
        <option value="all">All Types</option>
        <option value="hierarchy">Hierarchy Only</option>
        <option value="connections">Connection Defs Only</option>
      </select>
      <label>Layout:</label>
      <select id="layout-mode">
        <option value="force">Force-Directed</option>
        <option value="domain">Group by Domain</option>
      </select>
    </div>
    <div id="canvas-wrapper">
      <canvas id="canvas"></canvas>
      <div id="detail"></div>
    </div>
    <div id="stats"></div>
  </div>
</div>

<script>
// ─── Data ────────────────────────────────────────────────────────────────────
const NODES = ${nodesJSON};
const EDGES = ${edgesJSON};
const DOMAIN_COLORS = ${domainColorsJSON};

// ─── State ───────────────────────────────────────────────────────────────────
let selectedId = null;
let hoveredId = null;
let searchTerm = '';
let viewMode = 'all';
let layoutMode = 'force';
let collapsedDomains = new Set();

// Physics
let positions = new Map();
let velocities = new Map();
let dragging = null;
let dragOffset = { x: 0, y: 0 };
let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ─── Init positions ──────────────────────────────────────────────────────────
function initPositions() {
    const domains = [...new Set(NODES.map(n => n.domain))];
    const cols = Math.ceil(Math.sqrt(domains.length));
    const rows = Math.ceil(domains.length / cols);

    NODES.forEach((node, i) => {
        const domIdx = domains.indexOf(node.domain);
        const col = domIdx % cols;
        const row = Math.floor(domIdx / cols);

        if (layoutMode === 'domain') {
            const cx = (col - (cols - 1) / 2) * 400;
            const cy = (row - (rows - 1) / 2) * 500;
            const angle = (i / NODES.length) * Math.PI * 2;
            const r = 100 + Math.random() * 80;
            positions.set(node.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        } else {
            positions.set(node.id, {
                x: (Math.random() - 0.5) * 800,
                y: (Math.random() - 0.5) * 600,
            });
        }
        velocities.set(node.id, { x: 0, y: 0 });
    });
}

// ─── Physics step ────────────────────────────────────────────────────────────
function physicsStep() {
    const visible = getVisibleNodes();
    const visibleIds = new Set(visible.map(n => n.id));
    const k = 0.001; // spring constant
    const repulsion = 8000;
    const damping = 0.85;
    const restLength = 120;

    // Repulsion between all visible nodes
    for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
            const a = positions.get(visible[i].id);
            const b = positions.get(visible[j].id);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = repulsion / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            velocities.get(visible[i].id).x -= fx;
            velocities.get(visible[i].id).y -= fy;
            velocities.get(visible[j].id).x += fx;
            velocities.get(visible[j].id).y += fy;
        }
    }

    // Spring forces along edges
    const visibleEdges = getVisibleEdges(visibleIds);
    for (const edge of visibleEdges) {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = k * (dist - restLength);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (velocities.has(edge.from)) {
            velocities.get(edge.from).x += fx;
            velocities.get(edge.from).y += fy;
        }
        if (velocities.has(edge.to)) {
            velocities.get(edge.to).x -= fx;
            velocities.get(edge.to).y -= fy;
        }
    }

    // Apply velocities
    for (const node of visible) {
        if (dragging === node.id) continue;
        const vel = velocities.get(node.id);
        const pos = positions.get(node.id);
        vel.x *= damping;
        vel.y *= damping;
        pos.x += vel.x;
        pos.y += vel.y;
    }
}

// ─── Filtering ───────────────────────────────────────────────────────────────
function getVisibleNodes() {
    return NODES.filter(n => {
        if (searchTerm && !n.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        if (viewMode === 'connections' && n.kind !== 'connection def') return false;
        if (viewMode === 'hierarchy' && n.kind === 'connection def') return false;
        return true;
    });
}

function getVisibleEdges(visibleIds) {
    return EDGES.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
const KIND_SHAPES = {
    'part def': 'rect',
    'requirement def': 'diamond',
    'action def': 'roundRect',
    'port def': 'circle',
    'interface def': 'circle',
    'connection def': 'hexagon',
    'attribute def': 'rect',
    'enum def': 'rect',
};

function resize() {
    const wrapper = document.getElementById('canvas-wrapper');
    canvas.width = wrapper.clientWidth * devicePixelRatio;
    canvas.height = wrapper.clientHeight * devicePixelRatio;
    canvas.style.width = wrapper.clientWidth + 'px';
    canvas.style.height = wrapper.clientHeight + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function worldToScreen(x, y) {
    return {
        x: (x - camera.x) * camera.zoom + canvas.width / devicePixelRatio / 2,
        y: (y - camera.y) * camera.zoom + canvas.height / devicePixelRatio / 2,
    };
}

function screenToWorld(sx, sy) {
    return {
        x: (sx - canvas.width / devicePixelRatio / 2) / camera.zoom + camera.x,
        y: (sy - canvas.height / devicePixelRatio / 2) / camera.zoom + camera.y,
    };
}

function drawArrow(fromX, fromY, toX, toY, color, dashed) {
    const headLen = 8;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    if (dashed) ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - 0.4), toY - headLen * Math.sin(angle - 0.4));
    ctx.lineTo(toX - headLen * Math.cos(angle + 0.4), toY - headLen * Math.sin(angle + 0.4));
    ctx.fill();
    ctx.setLineDash([]);
}

function drawNode(node) {
    const pos = positions.get(node.id);
    if (!pos) return;
    const { x, y } = worldToScreen(pos.x, pos.y);
    const w = Math.max(node.name.length * 7 + 20, 80);
    const h = 32;

    const isSelected = selectedId === node.id;
    const isHovered = hoveredId === node.id;
    const isConnected = selectedId && EDGES.some(e =>
        (e.from === selectedId && e.to === node.id) || (e.to === selectedId && e.from === node.id)
    );
    const alpha = selectedId && !isSelected && !isConnected ? 0.25 : 1;

    ctx.globalAlpha = alpha;

    // Shadow for selected
    if (isSelected || isHovered) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 12;
    }

    // Shape
    ctx.fillStyle = isSelected ? node.color : node.color + '33';
    ctx.strokeStyle = node.color;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;

    const shape = KIND_SHAPES[node.kind] || 'rect';
    if (shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(x, y - h/2 - 4);
        ctx.lineTo(x + w/2 + 4, y);
        ctx.lineTo(x, y + h/2 + 4);
        ctx.lineTo(x - w/2 - 4, y);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
    } else if (shape === 'circle') {
        const r = Math.max(w, h) / 2;
        ctx.beginPath();
        ctx.ellipse(x, y, r, h/2 + 2, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    } else if (shape === 'hexagon') {
        const r = w/2 + 4;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            const hx = x + r * Math.cos(a);
            const hy = y + (h/2 + 2) * Math.sin(a);
            i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
    } else if (shape === 'roundRect') {
        const rr = 10;
        ctx.beginPath();
        ctx.roundRect(x - w/2, y - h/2, w, h, rr);
        ctx.fill(); ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.rect(x - w/2, y - h/2, w, h);
        ctx.fill(); ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Label
    ctx.fillStyle = isSelected ? '#fff' : '#eee';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, x, y);

    ctx.globalAlpha = 1;
}

function draw() {
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    const visible = getVisibleNodes();
    const visibleIds = new Set(visible.map(n => n.id));
    const visibleEdges = getVisibleEdges(visibleIds);

    // Draw edges
    for (const edge of visibleEdges) {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        const f = worldToScreen(from.x, from.y);
        const t = worldToScreen(to.x, to.y);

        const isHighlighted = selectedId && (edge.from === selectedId || edge.to === selectedId);
        const alpha = selectedId && !isHighlighted ? 0.1 : 0.6;
        ctx.globalAlpha = alpha;

        const color = edge.style === 'specialization' ? '#e94560' : '#888';
        drawArrow(f.x, f.y, t.x, t.y, color, edge.style !== 'specialization');
        ctx.globalAlpha = 1;
    }

    // Draw nodes
    for (const node of visible) {
        drawNode(node);
    }

    // Stats
    document.getElementById('stats').textContent =
        visible.length + ' types | ' + visibleEdges.length + ' relationships | ' +
        [...new Set(visible.map(n => n.domain))].length + ' domains | zoom: ' +
        (camera.zoom * 100).toFixed(0) + '%';
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function buildSidebar() {
    const list = document.getElementById('domain-list');
    const domains = [...new Set(NODES.map(n => n.domain))];
    list.innerHTML = '';

    for (const domain of domains) {
        const items = NODES.filter(n => n.domain === domain &&
            (!searchTerm || n.name.toLowerCase().includes(searchTerm.toLowerCase())));
        if (items.length === 0) continue;

        const group = document.createElement('div');
        group.className = 'domain-group';

        const header = document.createElement('div');
        header.className = 'domain-header';
        const color = DOMAIN_COLORS[domain] || '#666';
        header.innerHTML = '<span class="domain-dot" style="background:' + color + '"></span>' +
            domain + '<span class="domain-count">' + items.length + '</span>';
        header.onclick = () => {
            if (collapsedDomains.has(domain)) collapsedDomains.delete(domain);
            else collapsedDomains.add(domain);
            buildSidebar();
        };
        group.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'domain-items' + (collapsedDomains.has(domain) ? ' collapsed' : '');

        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'type-item' + (selectedId === item.id ? ' selected' : '');
            const badge = item.kind.replace(' def', '');
            el.innerHTML = item.name + ' <span class="type-badge">' + badge + '</span>';
            el.onclick = () => { selectedId = item.id; showDetail(item); buildSidebar(); };
            itemsDiv.appendChild(el);
        }

        group.appendChild(itemsDiv);
        list.appendChild(group);
    }
}

// ─── Detail panel ────────────────────────────────────────────────────────────
function showDetail(node) {
    const detail = document.getElementById('detail');
    if (!node) { detail.classList.remove('visible'); return; }
    detail.classList.add('visible');

    let html = '<h2 style="color:' + node.color + '">' + node.name + '</h2>';
    html += '<div class="kind-label">' + node.kind + ' | ' + node.domain + '</div>';

    if (node.doc) html += '<div class="doc">' + node.doc + '</div>';

    if (node.superType) {
        html += '<div class="section"><h3>Specializes</h3>';
        html += '<span class="super-link" onclick="selectById(\\''+node.superType+'\\')">:> ' + node.superType + '</span></div>';
    }

    if (node.attributes.length > 0) {
        html += '<div class="section"><h3>Attributes</h3>';
        for (const a of node.attributes) {
            html += '<div class="attr-row"><span class="attr-name">' + a.name + '</span><span class="attr-type">: ' + a.type + '</span></div>';
        }
        html += '</div>';
    }

    if (node.ends && node.ends.length > 0) {
        html += '<div class="section"><h3>Ends</h3>';
        for (const e of node.ends) {
            const typeLink = e.type ? ' : <span class="super-link" onclick="selectById(\\\'' + e.type + '\\\')"> ' + e.type + '</span>' : '';
            html += '<div class="end-row">end ' + e.name + typeLink + (e.multiplicity ? ' [' + e.multiplicity + ']' : '') + '</div>';
        }
        html += '</div>';
    }

    if (node.literals && node.literals.length > 0) {
        html += '<div class="section"><h3>Literals</h3>';
        for (const l of node.literals) {
            html += '<div class="enum-lit">' + l + '</div>';
        }
        html += '</div>';
    }

    // Connected types
    const connected = EDGES.filter(e => e.from === node.id || e.to === node.id);
    if (connected.length > 0) {
        html += '<div class="section"><h3>Connections</h3>';
        for (const e of connected) {
            const other = e.from === node.id ? e.to : e.from;
            const dir = e.from === node.id ? '→' : '←';
            html += '<div class="attr-row"><span class="super-link" onclick="selectById(\\''+other+'\\')"> ' + dir + ' ' + other + '</span><span class="attr-type"> (' + e.label + ')</span></div>';
        }
        html += '</div>';
    }

    detail.innerHTML = html;
}

window.selectById = function(id) {
    selectedId = id;
    const node = NODES.find(n => n.id === id);
    if (node) showDetail(node);
    buildSidebar();

    // Center on node
    const pos = positions.get(id);
    if (pos) { camera.x = pos.x; camera.y = pos.y; }
};

// ─── Events ──────────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    buildSidebar();
});

document.getElementById('view-mode').addEventListener('change', (e) => {
    viewMode = e.target.value;
    buildSidebar();
});

document.getElementById('layout-mode').addEventListener('change', (e) => {
    layoutMode = e.target.value;
    initPositions();
});

function getNodeAtScreen(sx, sy) {
    const world = screenToWorld(sx, sy);
    for (const node of NODES) {
        const pos = positions.get(node.id);
        if (!pos) continue;
        const w = Math.max(node.name.length * 7 + 20, 80) / 2;
        if (Math.abs(world.x - pos.x) < w / camera.zoom && Math.abs(world.y - pos.y) < 20 / camera.zoom) {
            return node;
        }
    }
    return null;
}

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const node = getNodeAtScreen(sx, sy);

    if (node) {
        dragging = node.id;
        const pos = positions.get(node.id);
        const world = screenToWorld(sx, sy);
        dragOffset.x = pos.x - world.x;
        dragOffset.y = pos.y - world.y;
        selectedId = node.id;
        showDetail(node);
        buildSidebar();
    } else {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        selectedId = null;
        showDetail(null);
        buildSidebar();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (dragging) {
        const world = screenToWorld(sx, sy);
        const pos = positions.get(dragging);
        pos.x = world.x + dragOffset.x;
        pos.y = world.y + dragOffset.y;
        velocities.get(dragging).x = 0;
        velocities.get(dragging).y = 0;
    } else if (isPanning) {
        camera.x -= (e.clientX - panStart.x) / camera.zoom;
        camera.y -= (e.clientY - panStart.y) / camera.zoom;
        panStart = { x: e.clientX, y: e.clientY };
    } else {
        const node = getNodeAtScreen(sx, sy);
        hoveredId = node ? node.id : null;
        canvas.style.cursor = node ? 'pointer' : 'grab';
    }
});

canvas.addEventListener('mouseup', () => {
    dragging = null;
    isPanning = false;
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    camera.zoom = Math.max(0.1, Math.min(5, camera.zoom * factor));
}, { passive: false });

// Double-click to center
canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    camera.x = world.x;
    camera.y = world.y;
    camera.zoom = Math.min(camera.zoom * 1.5, 3);
});

window.addEventListener('resize', resize);

// ─── Animation loop ──────────────────────────────────────────────────────────
function loop() {
    physicsStep();
    draw();
    requestAnimationFrame(loop);
}

resize();
initPositions();
buildSidebar();
loop();
</script>
</body>
</html>`;
}

main().catch(console.error);
