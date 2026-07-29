import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface NotebookCell {
    id?: string;
    cell_type: 'markdown' | 'code';
    metadata: Record<string, unknown>;
    source: string[];
    execution_count?: null;
    outputs?: unknown[];
}

interface StarterNotebook {
    filename: string;
    title: string;
    description: string;
    codeCells: string[];
}

const LOAD_MODEL = `from pathlib import Path
from collections import Counter, defaultdict
import syside

def find_sysml_root(start=Path.cwd()):
    """Find the nearest model/ or src/ folder containing textual SysML."""
    for directory in (start, *start.parents):
        for folder_name in ('model', 'src'):
            candidate = directory / folder_name
            if candidate.is_dir() and next(candidate.rglob('*.sysml'), None):
                return candidate
    raise FileNotFoundError('No model/ or src/ directory containing .sysml files was found')

SYSML_ROOT = find_sysml_root()
SYSML_FILES = sorted(SYSML_ROOT.rglob('*.sysml'))
model, diagnostics = syside.try_load_model([str(path) for path in SYSML_FILES])
print(f'Loaded {len(SYSML_FILES)} SysML files from {SYSML_ROOT}')`;

const SAMPLES_README = `# MEMO analysis samples

These notebooks are created by \`memo init\` and are designed to work with any
MEMO textual SysML v2 project. They locate the nearest \`model/\` or \`src/\`
directory automatically and query it through the typed Syside API.

## Prerequisites

Use Python 3.12 or newer with JupyterLab and Syside installed and licensed:

\`\`\`bash
python -m venv analysis/.venv
source analysis/.venv/bin/activate
python -m pip install jupyterlab syside
cd analysis
jupyter lab --port 8888
\`\`\`

Configure the Syside license using its supported keyring or environment setup.
MEMO Architect's **Analysis → Jupyter Notebooks** menu opens the local server at
\`http://127.0.0.1:8888\`.

## Included notebooks

| Notebook | Purpose |
|---|---|
| \`01-model-overview.ipynb\` | Model size, semantic composition, and diagnostic summary. |
| \`02-architecture-hotspots.ipynb\` | Busy containers, deep ownership paths, and dominant types. |
| \`03-model-quality.ipynb\` | Diagnostics, unnamed elements, repeated names, and empty definitions. |
| \`04-change-impact-explorer.ipynb\` | Search an element and inspect its structural neighborhood. |
| \`05-model-charts.ipynb\` | Bar and donut charts rendered without extra plotting packages. |
| \`06-ownership-graph.ipynb\` | SVG network graph of model ownership relationships. |
| \`07-model-inventory-table.ipynb\` | Filterable inventory parameters, HTML table, and CSV export. |

The notebooks use \`syside.try_load_model()\`, so partial analysis remains
available while the project contains parser or semantic diagnostics. Review the
reported diagnostics before treating analysis results as release evidence.
`;

const STARTERS: StarterNotebook[] = [
    {
        filename: '01-model-overview.ipynb',
        title: 'Model overview',
        description: 'Visual summary of model size, semantic content, and diagnostics.',
        codeCells: [
            `from IPython.display import HTML, display

semantic_types = [
    'Package', 'PartDefinition', 'PartUsage', 'RequirementDefinition',
    'RequirementUsage', 'ActionDefinition', 'ActionUsage', 'PortDefinition',
    'PortUsage', 'ConnectionDefinition', 'ConnectionUsage', 'StateDefinition',
    'StateUsage', 'AttributeDefinition', 'AttributeUsage'
]
counts = {}
for type_name in semantic_types:
    node_type = getattr(syside, type_name, None)
    if node_type is not None:
        counts[type_name] = len(list(model.elements(node_type)))

largest = max(counts.values(), default=1)
rows = ''.join(
    f'<tr><td>{name}</td><td>{count:,}</td><td><div style="background:#2d8d70;height:12px;width:{max(2, count * 320 / largest):.0f}px"></div></td></tr>'
    for name, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)
)
display(HTML(f'<h3>Semantic inventory</h3><table><tr><th>Element type</th><th>Count</th><th>Relative size</th></tr>{rows}</table>'))

{
    'SysML files': len(SYSML_FILES),
    'Errors': len(list(diagnostics.errors)),
    'Warnings': len(list(diagnostics.warnings)),
    'Information': len(list(diagnostics.infos)),
}`,
        ],
    },
    {
        filename: '02-architecture-hotspots.ipynb',
        title: 'Architecture hotspots',
        description: 'Find busy containers, deep ownership paths, and dominant semantic types.',
        codeCells: [
            `from IPython.display import display

semantic_elements = (
    list(model.elements(syside.Usage, include_subtypes=True))
    + list(model.elements(syside.Definition, include_subtypes=True))
)

def safe_name(element):
    value = element.qualified_name or element.name or element.declared_name
    return str(value) if value else '<unnamed>'

def ownership_depth(element):
    depth, current, seen = 0, element.owner, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        depth += 1
        current = getattr(current, 'owner', None)
    return depth

containers = []
for element in semantic_elements:
    children = [child for child in element.owned_elements if isinstance(child, (syside.Usage, syside.Definition))]
    if children:
        containers.append((len(children), type(element).__name__, safe_name(element)))

print('Top containers by directly owned semantic elements')
display(sorted(containers, reverse=True)[:25])

print('Deepest ownership paths')
display(sorted(
    ((ownership_depth(item), type(item).__name__, safe_name(item)) for item in semantic_elements),
    reverse=True,
)[:25])

print('Most common semantic types')
Counter(type(item).__name__ for item in semantic_elements).most_common(30)`,
        ],
    },
    {
        filename: '03-model-quality.ipynb',
        title: 'Model quality review',
        description: 'Review diagnostics, unnamed elements, repeated names, and empty definitions.',
        codeCells: [
            `from IPython.display import display

usages = list(model.elements(syside.Usage, include_subtypes=True))
definitions = list(model.elements(syside.Definition, include_subtypes=True))
semantic_elements = usages + definitions

unnamed = [item for item in semantic_elements if not (item.name or item.declared_name)]
by_name = defaultdict(list)
for item in semantic_elements:
    value = item.qualified_name or item.name or item.declared_name
    name = str(value) if value else None
    if name:
        by_name[name].append(item)
duplicates = [(name, len(items), sorted({type(item).__name__ for item in items})) for name, items in by_name.items() if len(items) > 1]
empty_definitions = [
    item for item in definitions
    if not any(isinstance(child, (syside.Usage, syside.Definition)) for child in item.owned_elements)
]

display({
    'parser/semantic errors': len(list(diagnostics.errors)),
    'warnings': len(list(diagnostics.warnings)),
    'unnamed usages or definitions': len(unnamed),
    'repeated qualified names': len(duplicates),
    'definitions with no owned usages/definitions': len(empty_definitions),
})

print('Repeated qualified names (first 30)')
display(sorted(duplicates, key=lambda item: item[1], reverse=True)[:30])

print('Empty definition candidates (first 30)')
[(type(item).__name__, item.qualified_name or item.name) for item in empty_definitions[:30]]`,
            `print('First diagnostics to investigate')
for diagnostic in list(diagnostics.errors)[:20] + list(diagnostics.warnings)[:20]:
    print(diagnostic)`,
        ],
    },
    {
        filename: '04-change-impact-explorer.ipynb',
        title: 'Change-impact explorer',
        description: 'Search any element and inspect its owner, children, and directly related elements.',
        codeCells: [
            `QUERY = ''  # Example: 'pump', 'controller', 'safety', or a requirement name

semantic_elements = (
    list(model.elements(syside.Usage, include_subtypes=True))
    + list(model.elements(syside.Definition, include_subtypes=True))
)

def label(element):
    value = element.qualified_name or element.name or element.declared_name
    return str(value) if value else '<unnamed>'

if not QUERY:
    print('Set QUERY to a name fragment. Suggestions:')
    for suggestion in [label(item) for item in semantic_elements if item.name][:20]:
        print(' -', suggestion)
    matches = []
else:
    matches = [item for item in semantic_elements if QUERY.casefold() in label(item).casefold()]
    print(f'{len(matches)} match(es) for {QUERY!r}')

[(type(item).__name__, label(item)) for item in matches[:100]]`,
            `def neighborhood(element):
    owner = getattr(element, 'owner', None)
    children = [child for child in element.owned_elements if isinstance(child, (syside.Usage, syside.Definition))]
    related = []
    for relationship in element.owned_relationships:
        for candidate in relationship.related_elements:
            if candidate is not element:
                related.append(candidate)
    return {
        'selected': (type(element).__name__, label(element)),
        'owner': None if owner is None else (type(owner).__name__, label(owner)),
        'children': [(type(child).__name__, label(child)) for child in children[:50]],
        'directly related': [(type(item).__name__, label(item)) for item in related[:50]],
    }

[neighborhood(item) for item in matches[:10]]`,
        ],
    },
    {
        filename: '05-model-charts.ipynb',
        title: 'Model charts',
        description: 'Render semantic composition and diagnostic charts without external plotting packages.',
        codeCells: [
            `from html import escape
from IPython.display import HTML, display

type_names = [
    'PartUsage', 'RequirementUsage', 'ActionUsage', 'PortUsage',
    'ConnectionUsage', 'StateUsage', 'AttributeUsage', 'ItemUsage',
    'PartDefinition', 'RequirementDefinition', 'ActionDefinition', 'PortDefinition'
]
counts = {}
for type_name in type_names:
    node_type = getattr(syside, type_name, None)
    if node_type is not None:
        counts[type_name] = len(list(model.elements(node_type)))

palette = ['#2d8d70', '#3887c7', '#e58a2b', '#8357b6', '#cf5c62', '#4f9d9d']
largest = max(counts.values(), default=1)
bars = []
for index, (name, count) in enumerate(sorted(counts.items(), key=lambda item: item[1], reverse=True)):
    width = max(1, count * 100 / largest)
    color = palette[index % len(palette)]
    bars.append(f'''<div style="display:grid;grid-template-columns:180px 1fr 70px;gap:12px;align-items:center;margin:7px 0">
      <div>{escape(name)}</div><div style="background:#edf2f4;border-radius:6px;overflow:hidden"><div style="width:{width:.1f}%;height:20px;background:{color}"></div></div><strong>{count:,}</strong>
    </div>''')

error_count = len(list(diagnostics.errors))
warning_count = len(list(diagnostics.warnings))
info_count = len(list(diagnostics.infos))
total_diagnostics = max(1, error_count + warning_count + info_count)
diagnostic_gradient = (
    f'#cf5c62 0 {error_count / total_diagnostics * 100:.1f}%, '
    f'#e5a52b {error_count / total_diagnostics * 100:.1f}% {(error_count + warning_count) / total_diagnostics * 100:.1f}%, '
    f'#3887c7 {(error_count + warning_count) / total_diagnostics * 100:.1f}% 100%'
)

display(HTML(f'''<div style="font-family:system-ui;max-width:900px">
  <h2>Semantic composition</h2>{''.join(bars)}
  <h2 style="margin-top:28px">Diagnostics</h2>
  <div style="display:flex;align-items:center;gap:24px">
    <div style="width:150px;height:150px;border-radius:50%;background:conic-gradient({diagnostic_gradient});position:relative">
      <div style="position:absolute;inset:28px;background:white;border-radius:50%;display:grid;place-items:center;font-size:24px;font-weight:700">{error_count + warning_count + info_count}</div>
    </div>
    <table><tr><th>Severity</th><th>Count</th></tr><tr><td>Errors</td><td>{error_count}</td></tr><tr><td>Warnings</td><td>{warning_count}</td></tr><tr><td>Information</td><td>{info_count}</td></tr></table>
  </div>
</div>'''))`,
        ],
    },
    {
        filename: '06-ownership-graph.ipynb',
        title: 'Ownership graph',
        description: 'Draw an SVG network of model elements and their ownership relationships.',
        codeCells: [
            `from html import escape
from IPython.display import SVG, display

semantic_elements = (
    list(model.elements(syside.Usage, include_subtypes=True))
    + list(model.elements(syside.Definition, include_subtypes=True))
)

def node_name(element):
    value = element.name or element.declared_name or element.qualified_name
    return str(value) if value else '<unnamed>'

# Prefer named elements with semantic children, then fill with other named elements.
ranked = sorted(
    (item for item in semantic_elements if item.name or item.declared_name),
    key=lambda item: sum(isinstance(child, (syside.Usage, syside.Definition)) for child in item.owned_elements),
    reverse=True,
)
selected = ranked[:60]
selected_ids = {id(item) for item in selected}

def depth(element):
    value, current, seen = 0, element.owner, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current)); value += 1; current = getattr(current, 'owner', None)
    return value

columns = defaultdict(list)
for item in selected:
    columns[depth(item)].append(item)
depths = sorted(columns)
positions = {}
for column_index, level in enumerate(depths):
    for row_index, item in enumerate(columns[level]):
        positions[id(item)] = (30 + column_index * 240, 30 + row_index * 58)

width = max(500, 260 * max(1, len(depths)))
height = max(240, 70 + 58 * max((len(items) for items in columns.values()), default=1))
edges = []
nodes = []
colors = {'PartUsage':'#dff4ee', 'RequirementUsage':'#e8eefb', 'ActionUsage':'#fff0dc', 'PortUsage':'#efe5fa'}
for item in selected:
    x, y = positions[id(item)]
    owner = getattr(item, 'owner', None)
    if owner is not None and id(owner) in selected_ids:
        ox, oy = positions[id(owner)]
        edges.append(f'<path d="M {ox + 190} {oy + 20} C {ox + 215} {oy + 20}, {x - 25} {y + 20}, {x} {y + 20}" fill="none" stroke="#91a7b3" stroke-width="1.5"/>')
    kind = type(item).__name__
    fill = colors.get(kind, '#f4f6f7')
    label = escape(node_name(item)[:27])
    nodes.append(f'<g><rect x="{x}" y="{y}" width="190" height="40" rx="7" fill="{fill}" stroke="#547180"/><text x="{x + 9}" y="{y + 17}" font-size="11" font-weight="700">{label}</text><text x="{x + 9}" y="{y + 32}" font-size="9" fill="#587487">{kind}</text></g>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 {width} {height}" style="background:#fbfcfc;border:1px solid #d9e3e8;border-radius:10px">{''.join(edges)}{''.join(nodes)}</svg>'''
display(SVG(svg))
print(f'Displayed {len(selected)} elements and {len(edges)} ownership edges')`,
        ],
    },
    {
        filename: '07-model-inventory-table.ipynb',
        title: 'Model inventory table',
        description: 'Filter a model-independent element table and export the current result to CSV.',
        codeCells: [
            `from html import escape
from IPython.display import HTML, display

KIND_FILTER = ''   # Example: 'PartUsage' or 'Requirement'
NAME_FILTER = ''   # Case-insensitive name fragment
ROW_LIMIT = 250

semantic_elements = (
    list(model.elements(syside.Usage, include_subtypes=True))
    + list(model.elements(syside.Definition, include_subtypes=True))
)

def text(value):
    return str(value) if value else ''

records = []
for item in semantic_elements:
    kind = type(item).__name__
    name = text(item.name or item.declared_name)
    qualified_name = text(item.qualified_name)
    owner = getattr(item, 'owner', None)
    owner_name = text(getattr(owner, 'qualified_name', None) or getattr(owner, 'name', None))
    if KIND_FILTER and KIND_FILTER.casefold() not in kind.casefold():
        continue
    if NAME_FILTER and NAME_FILTER.casefold() not in (name + ' ' + qualified_name).casefold():
        continue
    records.append({'kind': kind, 'name': name, 'qualified_name': qualified_name, 'owner': owner_name})

records.sort(key=lambda row: (row['kind'], row['qualified_name'], row['name']))
visible = records[:ROW_LIMIT]
rows = ''.join(
    '<tr>' + ''.join(f'<td>{escape(row[key])}</td>' for key in ('kind', 'name', 'qualified_name', 'owner')) + '</tr>'
    for row in visible
)
display(HTML(f'''<p><strong>{len(records):,}</strong> matching elements; showing {len(visible):,}.</p>
<div style="max-height:620px;overflow:auto"><table style="font-size:12px"><thead style="position:sticky;top:0;background:white"><tr><th>Kind</th><th>Name</th><th>Qualified name</th><th>Owner</th></tr></thead><tbody>{rows}</tbody></table></div>'''))`,
            `import csv

OUTPUT = Path('model-inventory.csv')
with OUTPUT.open('w', newline='', encoding='utf-8') as stream:
    writer = csv.DictWriter(stream, fieldnames=['kind', 'name', 'qualified_name', 'owner'])
    writer.writeheader()
    writer.writerows(records)
print(f'Exported {len(records):,} rows to {OUTPUT.resolve()}')`,
        ],
    },
];

function markdownCell(starter: StarterNotebook): NotebookCell {
    return {
        cell_type: 'markdown',
        metadata: {},
        source: [`# ${starter.title}\n\n${starter.description}\n\nThis sample uses only standard SysML v2 concepts and automatically discovers the project's \`model/\` or \`src/\` directory.`],
    };
}

function codeCell(source: string): NotebookCell {
    return { cell_type: 'code', metadata: {}, source: [source], execution_count: null, outputs: [] };
}

function notebook(starter: StarterNotebook): unknown {
    const cells = [markdownCell(starter), codeCell(LOAD_MODEL), ...starter.codeCells.map(codeCell)]
        .map((cell, index) => ({ ...cell, id: `memo-${index + 1}` }));
    return {
        cells,
        metadata: {
            kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3' },
            memo: { starter: true, description: starter.description },
        },
        nbformat: 4,
        nbformat_minor: 5,
    };
}

/** Add model-independent Jupyter samples to a newly initialized project. */
export function scaffoldAnalysisSamples(projectDir: string): void {
    const samplesDir = resolve(projectDir, 'analysis', 'Samples');
    mkdirSync(samplesDir, { recursive: true });
    const readmePath = resolve(samplesDir, 'README.md');
    if (!existsSync(readmePath)) writeFileSync(readmePath, SAMPLES_README);
    for (const starter of STARTERS) {
        const path = resolve(samplesDir, starter.filename);
        if (!existsSync(path)) writeFileSync(path, JSON.stringify(notebook(starter), null, 2) + '\n');
    }
}

export const analysisSampleNames = STARTERS.map(starter => starter.filename);
