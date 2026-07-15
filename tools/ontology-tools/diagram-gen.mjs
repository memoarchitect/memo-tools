// ─── Ontology Diagram Generator ─────────────────────────────────────────────
//
// Emits a draw.io file summarizing the ontology: one swim-lane per ontology
// package, a sub-lane per architecture layer, uniform element boxes. Every
// element box carries a `link` attribute back to the .sysml file that defines
// it. Cross-package inheritance edges live on a named "Tracing" mxLayer that
// is hidden by default (toggle via draw.io's View → Layers).
//
// After layout the generator runs a bounding-box intersection check — any
// overlap between sibling element boxes, layer sub-lanes, or package lanes
// causes the build to fail.
//
// Primary output:  docs/likec4/memo-ontology-architecture.drawio
// Tee'd copy:      docs/likec4/memo-ontology-architecture.generated.drawio
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { parseAllOntologyDefinitions, REPO_ROOT } from './sysml-reader.mjs';

// ─── Layout constants ──────────────────────────────────────────────────────
const KIND_W = 160;
const KIND_H = 22;
const KIND_GAP_X = 8;
const KIND_GAP_Y = 6;
const LAYER_HEADER = 24;
const LAYER_PAD = 10;
const LAYER_GAP_X = 14;
const LAYER_GAP_Y = 14;
const COLS = 4;               // kinds per row in a layer sub-lane
const PKG_HEADER = 36;
const PKG_PAD = 14;
const PKG_GAP_Y = 26;
const PAGE_MARGIN = 40;

// ─── Layer palette ─────────────────────────────────────────────────────────
const LAYER_STYLES = {
    operational:            { fill: '#F5EEF8', stroke: '#8E44AD', label: 'Operational Analysis' },
    system:                 { fill: '#F3E5F5', stroke: '#7C3AED', label: 'System Analysis' },
    logical:                { fill: '#E8F8F5', stroke: '#1ABC9C', label: 'Logical Architecture' },
    hardware:               { fill: '#E9F7EF', stroke: '#27AE60', label: 'Hardware Architecture' },
    physical:               { fill: '#E9F7EF', stroke: '#27AE60', label: 'Physical (legacy)' },
    software:               { fill: '#E8F4FD', stroke: '#2980B9', label: 'Software Architecture' },
    interfaces:             { fill: '#E0F7FA', stroke: '#009688', label: 'Interfaces' },
    requirements:           { fill: '#FDECEA', stroke: '#E53935', label: 'Requirements' },
    verification:           { fill: '#F1F8E9', stroke: '#7CB342', label: 'Verification' },
    functional:             { fill: '#FEF9E7', stroke: '#F4A623', label: 'Functional' },
    analysis:               { fill: '#FFF3E0', stroke: '#F57C00', label: 'Analysis' },
    crosscutting:           { fill: '#ECEFF1', stroke: '#546E7A', label: 'Relationships' },
    risk:                   { fill: '#FDEDEC', stroke: '#E74C3C', label: 'Risk Management' },
    safety:                 { fill: '#FADBD8', stroke: '#C0392B', label: 'Safety' },
    'design-control':       { fill: '#EAF2F8', stroke: '#2874A6', label: 'Design Control' },
    'software-lifecycle':   { fill: '#EAF2F8', stroke: '#F39C12', label: 'Software Lifecycle' },
    operations:             { fill: '#E8F6F3', stroke: '#16A085', label: 'Operations' },
    ui:                     { fill: '#EBF5FB', stroke: '#3498DB', label: 'UI' },
    clinical:               { fill: '#E8F8F5', stroke: '#17A589', label: 'Clinical' },
    'clinical-trial':       { fill: '#E8F8F5', stroke: '#17A589', label: 'Clinical Trial' },
    qms:                    { fill: '#EAEDED', stroke: '#2C3E50', label: 'QMS' },
    cybersecurity:          { fill: '#FDEDEC', stroke: '#922B21', label: 'Cybersecurity' },
    privacy:                { fill: '#E8DAEF', stroke: '#6C3483', label: 'Privacy' },
    middleware:             { fill: '#E3F2FD', stroke: '#0288D1', label: 'Middleware' },
    interop:                { fill: '#E0F7FA', stroke: '#00838F', label: 'Interoperability' },
    procedure:              { fill: '#F3E5F5', stroke: '#6A1B9A', label: 'Clinical Procedure' },
    platform:               { fill: '#EDE7F6', stroke: '#4527A0', label: 'Platform' },
    unknown:                { fill: '#ECEFF1', stroke: '#607D8B', label: 'Unclassified' },
};
function styleForLayer(id) {
    return LAYER_STYLES[id] ?? { fill: '#ECEFF1', stroke: '#546E7A', label: id };
}

const PKG_STYLE = { fill: '#DAE8FC', stroke: '#6C8EBF' };

// ─── XML escape ─────────────────────────────────────────────────────────────
function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        c === '&' ? '&amp;' :
        c === '<' ? '&lt;' :
        c === '>' ? '&gt;' :
        c === '"' ? '&quot;' : '&apos;'
    ));
}

// ─── Layout ─────────────────────────────────────────────────────────────────
//
// Returns a hierarchical layout tree:
//   { packages: [ { id, name, x, y, w, h, layers: [ { id, x, y, w, h, kinds: [ { id, name, x, y, w, h, link } ] } ] } ] }
//
// Coordinates:
//   package.x/y — page-absolute
//   layer.x/y   — relative to package
//   kind.x/y    — relative to layer
// -----------------------------------------------------------------------------
function buildLayout(packages, definitions) {
    // Group definitions by package + layer
    const byPkg = new Map();
    for (const d of definitions) {
        if (!byPkg.has(d.packageName)) byPkg.set(d.packageName, new Map());
        const layerMap = byPkg.get(d.packageName);
        if (!layerMap.has(d.layer)) layerMap.set(d.layer, []);
        layerMap.get(d.layer).push(d);
    }

    const layoutPkgs = [];
    let cursorY = PAGE_MARGIN;

    // Deterministic order: by package name.
    const pkgList = packages.filter((p) => byPkg.has(p.name));
    pkgList.sort((a, b) => a.name.localeCompare(b.name));

    for (const pkg of pkgList) {
        const layerMap = byPkg.get(pkg.name);
        const layerIds = [...layerMap.keys()].sort();

        // Lay out layers left-to-right, wrapping if the package gets too wide.
        // Practical: put all layers on one row; if total width > threshold, wrap.
        const layers = [];
        for (const layerId of layerIds) {
            const kinds = layerMap.get(layerId).sort((a, b) => a.name.localeCompare(b.name));
            const cols = Math.min(COLS, Math.max(1, kinds.length));
            const rows = Math.ceil(kinds.length / cols);
            const innerW = cols * KIND_W + (cols - 1) * KIND_GAP_X;
            const innerH = rows * KIND_H + (rows - 1) * KIND_GAP_Y;
            const w = LAYER_PAD * 2 + innerW;
            const h = LAYER_HEADER + LAYER_PAD * 2 + innerH;

            const kindNodes = kinds.map((d, i) => {
                const c = i % cols;
                const r = Math.floor(i / cols);
                return {
                    id: `kind_${encodeId(pkg.name)}_${encodeId(layerId)}_${encodeId(d.name)}`,
                    name: d.name,
                    construct: d.construct,
                    superType: d.superType,
                    link: d.relPath,
                    x: LAYER_PAD + c * (KIND_W + KIND_GAP_X),
                    y: LAYER_HEADER + LAYER_PAD + r * (KIND_H + KIND_GAP_Y),
                    w: KIND_W,
                    h: KIND_H,
                };
            });

            layers.push({
                id: `lyr_${encodeId(pkg.name)}_${encodeId(layerId)}`,
                layerId,
                label: styleForLayer(layerId).label,
                style: styleForLayer(layerId),
                w,
                h,
                kinds: kindNodes,
            });
        }

        // Pack layers into rows within the package.
        const maxInnerWidth = 1600;
        let rowX = PKG_PAD;
        let rowY = PKG_HEADER;
        let rowH = 0;
        let pkgMaxRight = PKG_PAD;

        for (const layer of layers) {
            if (rowX > PKG_PAD && rowX + layer.w > maxInnerWidth) {
                rowX = PKG_PAD;
                rowY += rowH + LAYER_GAP_Y;
                rowH = 0;
            }
            layer.x = rowX;
            layer.y = rowY;
            rowX += layer.w + LAYER_GAP_X;
            rowH = Math.max(rowH, layer.h);
            pkgMaxRight = Math.max(pkgMaxRight, layer.x + layer.w);
        }
        const pkgH = rowY + rowH + PKG_PAD;
        const pkgW = pkgMaxRight + PKG_PAD;

        layoutPkgs.push({
            id: `pkg_${encodeId(pkg.name)}`,
            name: pkg.name,
            x: PAGE_MARGIN,
            y: cursorY,
            w: pkgW,
            h: pkgH,
            layers,
        });
        cursorY += pkgH + PKG_GAP_Y;
    }

    const pageW = Math.max(...layoutPkgs.map((p) => p.x + p.w), PAGE_MARGIN) + PAGE_MARGIN;
    const pageH = cursorY + PAGE_MARGIN;

    return { packages: layoutPkgs, pageW, pageH };
}

function encodeId(s) {
    return s.replace(/[^A-Za-z0-9]/g, '_');
}

// ─── Overlap check ─────────────────────────────────────────────────────────
function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function checkOverlaps(layout) {
    const errors = [];

    // Package vs package (page coords)
    for (let i = 0; i < layout.packages.length; i++) {
        for (let j = i + 1; j < layout.packages.length; j++) {
            if (rectsOverlap(layout.packages[i], layout.packages[j])) {
                errors.push(`package overlap: ${layout.packages[i].name} ∩ ${layout.packages[j].name}`);
            }
        }
    }

    // Layer vs layer within a package
    for (const pkg of layout.packages) {
        for (let i = 0; i < pkg.layers.length; i++) {
            for (let j = i + 1; j < pkg.layers.length; j++) {
                if (rectsOverlap(pkg.layers[i], pkg.layers[j])) {
                    errors.push(`layer overlap in ${pkg.name}: ${pkg.layers[i].layerId} ∩ ${pkg.layers[j].layerId}`);
                }
            }
        }
        // Kind vs kind within a layer
        for (const lyr of pkg.layers) {
            for (let i = 0; i < lyr.kinds.length; i++) {
                for (let j = i + 1; j < lyr.kinds.length; j++) {
                    if (rectsOverlap(lyr.kinds[i], lyr.kinds[j])) {
                        errors.push(`kind overlap in ${pkg.name}/${lyr.layerId}: ${lyr.kinds[i].name} ∩ ${lyr.kinds[j].name}`);
                    }
                }
            }
        }
    }

    return errors;
}

// ─── Inheritance edges (Tracing layer) ─────────────────────────────────────
function buildInheritanceEdges(layout, definitions) {
    // Map simple name → list of kind-node ids across all packages.
    const nameToNodes = new Map();
    for (const pkg of layout.packages) {
        for (const lyr of pkg.layers) {
            for (const k of lyr.kinds) {
                if (!nameToNodes.has(k.name)) nameToNodes.set(k.name, []);
                nameToNodes.get(k.name).push(k.id);
            }
        }
    }
    const edges = [];
    const seen = new Set();
    for (const d of definitions) {
        if (!d.superType) continue;
        const sourceIds = nameToNodes.get(d.name) ?? [];
        const targetIds = nameToNodes.get(d.superType) ?? [];
        if (sourceIds.length === 0 || targetIds.length === 0) continue;
        for (const s of sourceIds) {
            for (const t of targetIds) {
                const key = `${s}->${t}`;
                if (seen.has(key)) continue;
                seen.add(key);
                edges.push({ id: `edge_${edges.length}`, source: s, target: t });
            }
        }
    }
    return edges;
}

// ─── Emit XML ──────────────────────────────────────────────────────────────
function emitDrawio(layout, edges) {
    const lines = [];
    lines.push(`<mxfile host="memo-diagram-gen" modified="${new Date().toISOString()}" agent="@memo/ontology-tools" version="29.6.6">`);
    lines.push(`  <diagram id="memo-ontology" name="MEMO Ontology">`);
    lines.push(`    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="4" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${layout.pageW}" pageHeight="${layout.pageH}" math="0" shadow="0">`);
    lines.push(`      <root>`);
    // Default layer
    lines.push(`        <mxCell id="0" />`);
    lines.push(`        <mxCell id="1" parent="0" value="Base" />`);
    // Tracing layer — hidden by default
    lines.push(`        <mxCell id="tracing" parent="0" value="Tracing" visible="0" />`);

    // Legend
    const legendX = PAGE_MARGIN;
    const legendY = Math.max(layout.pageH - 60, layout.packages[layout.packages.length - 1]?.y + layout.packages[layout.packages.length - 1]?.h + 16 || PAGE_MARGIN);
    lines.push(`        <mxCell id="legend" parent="1" value="Legend: open the &apos;Tracing&apos; layer via View → Layers to reveal cross-package inheritance edges." vertex="1" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#334155;fillColor=none;strokeColor=none;">`);
    lines.push(`          <mxGeometry x="${legendX}" y="${legendY}" width="900" height="24" as="geometry" />`);
    lines.push(`        </mxCell>`);

    // Packages → layers → kinds
    for (const pkg of layout.packages) {
        const pkgStyle = `swimlane;fontStyle=1;fontSize=13;fillColor=${PKG_STYLE.fill};strokeColor=${PKG_STYLE.stroke};fontColor=#1B3A4B;startSize=${PKG_HEADER};rounded=1;arcSize=3;shadow=0;swimlaneLine=1;align=left;spacingLeft=8;`;
        lines.push(`        <mxCell id="${pkg.id}" parent="1" value="${esc(pkg.name)}" vertex="1" style="${pkgStyle}">`);
        lines.push(`          <mxGeometry x="${pkg.x}" y="${pkg.y}" width="${pkg.w}" height="${pkg.h}" as="geometry" />`);
        lines.push(`        </mxCell>`);

        for (const lyr of pkg.layers) {
            const lstyle = `swimlane;fontSize=10;fillColor=${lyr.style.fill};strokeColor=${lyr.style.stroke};fontColor=#333333;startSize=${LAYER_HEADER};rounded=1;arcSize=3;swimlaneLine=1;fontStyle=1;`;
            lines.push(`          <mxCell id="${lyr.id}" parent="${pkg.id}" value="${esc(lyr.label)}" vertex="1" style="${lstyle}">`);
            lines.push(`            <mxGeometry x="${lyr.x}" y="${lyr.y}" width="${lyr.w}" height="${lyr.h}" as="geometry" />`);
            lines.push(`          </mxCell>`);

            for (const kind of lyr.kinds) {
                const kindStyle = `rounded=1;whiteSpace=wrap;html=1;fontSize=9;fillColor=#FFFFFF;strokeColor=${lyr.style.stroke};fontColor=#1a1a1a;arcSize=20;shadow=0;`;
                // UserObject wrapper gives us the `link` attribute that draw.io
                // renders as a clickable URL on the shape.
                lines.push(`            <UserObject label="${esc(kind.name)}" link="${esc(kind.link)}" id="${kind.id}">`);
                lines.push(`              <mxCell parent="${lyr.id}" vertex="1" style="${kindStyle}">`);
                lines.push(`                <mxGeometry x="${kind.x}" y="${kind.y}" width="${kind.w}" height="${kind.h}" as="geometry" />`);
                lines.push(`              </mxCell>`);
                lines.push(`            </UserObject>`);
            }
        }
    }

    // Inheritance edges on the Tracing layer
    for (const e of edges) {
        const estyle = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.5;exitY=0;entryX=0.5;entryY=1;endArrow=block;endFill=0;strokeColor=#6C8EBF;dashed=1;`;
        lines.push(`        <mxCell id="${e.id}" parent="tracing" edge="1" source="${e.source}" target="${e.target}" style="${estyle}" value="«extends»">`);
        lines.push(`          <mxGeometry relative="1" as="geometry" />`);
        lines.push(`        </mxCell>`);
    }

    lines.push(`      </root>`);
    lines.push(`    </mxGraphModel>`);
    lines.push(`  </diagram>`);
    lines.push(`</mxfile>`);
    return lines.join('\n') + '\n';
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
    const outDir = join(REPO_ROOT, 'docs/likec4');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const { packages, definitions } = parseAllOntologyDefinitions();
    console.log(`[diagram:ontology] parsed ${definitions.length} definitions from ${packages.length} packages`);

    const layout = buildLayout(packages, definitions);
    const overlaps = checkOverlaps(layout);
    if (overlaps.length > 0) {
        console.error(`[diagram:ontology] overlap check FAILED (${overlaps.length}):`);
        for (const e of overlaps.slice(0, 20)) console.error(`  - ${e}`);
        if (overlaps.length > 20) console.error(`  ... and ${overlaps.length - 20} more`);
        process.exit(1);
    }
    console.log(`[diagram:ontology] overlap check passed`);

    const edges = buildInheritanceEdges(layout, definitions);
    console.log(`[diagram:ontology] ${edges.length} inheritance edges on Tracing layer`);

    const xml = emitDrawio(layout, edges);

    // Tee outputs: canonical drawio + explicit .generated marker.
    const primary = join(outDir, 'memo-ontology-architecture.drawio');
    const generated = join(outDir, 'memo-ontology-architecture.generated.drawio');

    // Archive the hand-maintained original once, if it has never been archived.
    const backup = join(outDir, 'memo-ontology-architecture.drawio.pre-generator.bkp');
    if (existsSync(primary) && !existsSync(backup)) {
        // Heuristic: the hand-maintained file won't carry our generator agent stamp.
        try {
            const current = readFileSync(primary, 'utf-8');
            if (!current.includes('agent="@memo/ontology-tools"')) {
                renameSync(primary, backup);
                console.log(`[diagram:ontology] archived hand-maintained file → ${relative(REPO_ROOT, backup)}`);
            }
        } catch { /* ignore */ }
    }

    // Remove stale editor lock-file leftover if present.
    const staleBkp = join(outDir, '.$memo-ontology-architecture.drawio.bkp');
    if (existsSync(staleBkp)) {
        try { unlinkSync(staleBkp); console.log(`[diagram:ontology] removed stale ${relative(REPO_ROOT, staleBkp)}`); } catch { /* ignore */ }
    }

    writeFileSync(primary, xml);
    writeFileSync(generated, xml);
    console.log(`[diagram:ontology] wrote ${relative(REPO_ROOT, primary)} (${xml.length.toLocaleString()} bytes)`);
    console.log(`[diagram:ontology] wrote ${relative(REPO_ROOT, generated)}`);
}

main();
