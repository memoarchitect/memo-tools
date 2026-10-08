# MEMO analysis samples

These notebooks are created by `memo init` and work with any MEMO textual
SysML v2 project. Each one reads the model through `analysis/memo_model.py`,
which compiles the project with the compiler its settings select
(`toolchain.compiler`), exactly as `memo compile` does. Changing the
project's compiler changes what every notebook analyses.

## Prerequisites

- Python 3.12 or newer with JupyterLab.
- The `memo` command on `PATH`, or `MEMO_CLI` set to the command that runs it.
- What the selected compiler needs, as `memo toolchain probe` reports. A
  compiler that builds no SysML v2 model of its own (`internal`) cannot serve
  the notebooks; `memo_model.load()` says so.

```bash
python -m venv analysis/.venv
source analysis/.venv/bin/activate
python -m pip install jupyterlab
cd analysis
jupyter lab --port 8888
```

MEMO Architect's **Analysis → Jupyter Notebooks** menu opens the local server at
`http://127.0.0.1:8888`.

## Included notebooks

| Notebook | Purpose |
|---|---|
| `01-model-overview.ipynb` | Model size, semantic composition, and diagnostic summary. |
| `02-architecture-hotspots.ipynb` | Busy containers, deep ownership paths, and dominant types. |
| `03-model-quality.ipynb` | Diagnostics, unnamed elements, repeated names, and empty definitions. |
| `04-change-impact-explorer.ipynb` | Search an element and inspect its structural neighborhood. |
| `05-model-charts.ipynb` | Bar and donut charts rendered without extra plotting packages. |
| `06-ownership-graph.ipynb` | SVG network graph of model ownership relationships. |
| `07-model-inventory-table.ipynb` | Filterable inventory parameters, HTML table, and CSV export. |

A model loads only once the compiler accepts it: `memo_model.load()` raises
with the compiler's errors otherwise. Compilers can differ in the elements they
write for the same text (anonymous features in particular), so counts can
differ slightly from one compiler to another.
