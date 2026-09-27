"""Stage 1 export for the SysIDE provider.

Loads a project with SysIDE's Python API and, only when the load is clean,
writes what stage 2 consumes: the OMG SysML v2 API JSON of every document, and an
element index that the standard JSON does not carry (each element's qualified
name and source position). A load with errors writes nothing but the
diagnostics and exits 1, because stage 2 never runs on a failed stage 1.

Usage:
    python memo_stage1_syside.py --out stage1.json --library DIR [--library DIR ...] PROJECT_DIR

`--library` directories (MEMO's ontology) are loaded and exported like the
project, but marked `"role": "library"` so stage 2 and a cache can tell them
apart. Files under `.venv` or `site-packages` are skipped: an analysis
environment may hold a copy of SysIDE's standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import syside
import _syside

FORMAT = "memo-stage1/1"


def sysml_files(root: Path) -> list[Path]:
    skip = {".venv", "site-packages", "node_modules", ".git", "output"}
    return sorted(
        p for p in root.rglob("*.sysml")
        if not any(part in skip for part in p.parts)
    )


def severity_of(diagnostic) -> str:
    return str(getattr(diagnostic, "severity", "")).rsplit(".", 1)[-1].lower()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("project", type=Path)
    parser.add_argument("--library", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    project_root = args.project.resolve()
    library_roots = [lib.resolve() for lib in args.library]
    library_files = [f for root in library_roots for f in sysml_files(root)]
    project_files = sysml_files(project_root)
    role_of = {str(f): "library" for f in library_files}
    role_of.update({str(f): "project" for f in project_files})

    started = time.perf_counter()
    model, diagnostics = syside.try_load_model([str(f) for f in library_files + project_files])
    loaded = time.perf_counter()

    reported = []
    for diagnostic in diagnostics.all:
        text = str(diagnostic)
        reported.append({"severity": severity_of(diagnostic), "text": text})
    if any(d["severity"] == "error" for d in reported):
        json.dump({"format": FORMAT, "provider": "syside", "clean": False,
                   "diagnostics": reported}, args.out.open("w"))
        for d in reported:
            if d["severity"] == "error":
                print(d["text"], file=sys.stderr)
        return 1

    options = syside.SerializationOptions.minimal().with_options(use_standard_names=True)
    documents = []
    index: dict[str, dict] = {}
    for shared in model.user_docs:
        with shared.lock() as document:
            path = Path(document.url.path).resolve()
            role = role_of.get(str(path))
            if role is None:
                continue
            base = project_root if role == "project" else next(
                (root for root in library_roots if root in path.parents), path.parent)
            relative = os.path.relpath(path, base)
            elements = json.loads(_syside.json.dumps(document.root_node, options))
            documents.append({"file": relative, "role": role, "elements": elements})
            exported_ids = {element["@id"] for element in elements}
            for element in document.all_nodes(syside.Element):
                if str(element.element_id) not in exported_ids:
                    continue
                entry = {"file": relative, "role": role}
                qualified = element.qualified_name
                if qualified:
                    entry["qualifiedName"] = str(qualified)
                cst = element.cst_node
                if cst is not None:
                    point = cst.start_point
                    entry.update(startByte=cst.start_byte, endByte=cst.end_byte,
                                 line=point.line + 1, column=point.character + 1)
                index[str(element.element_id)] = entry
    exported = time.perf_counter()

    json.dump({
        "format": FORMAT,
        "provider": "syside",
        "providerVersion": syside.__version__,
        "clean": True,
        "diagnostics": reported,
        "documents": documents,
        "index": index,
        "timings": {"loadSeconds": round(loaded - started, 3),
                    "exportSeconds": round(exported - loaded, 3)},
    }, args.out.open("w"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
