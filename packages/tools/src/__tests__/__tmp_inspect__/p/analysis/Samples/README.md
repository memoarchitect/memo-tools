# MEMO analysis samples

These notebooks are created by `memo init` and are designed to work with any
MEMO textual SysML v2 project. They locate the nearest `model/` or `src/`
directory automatically and query it through the typed Syside API.

## Prerequisites

Use Python 3.12 or newer with JupyterLab and Syside installed and licensed:

```bash
python -m venv analysis/.venv
source analysis/.venv/bin/activate
python -m pip install jupyterlab syside
cd analysis
jupyter lab --port 8888
```

Configure the Syside license using its supported keyring or environment setup.
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

The notebooks use `syside.try_load_model()`, so partial analysis remains
available while the project contains parser or semantic diagnostics. Review the
reported diagnostics before treating analysis results as release evidence.
