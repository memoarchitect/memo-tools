"""Stage 1 export for the SysIDE provider.

Loads a project with SysIDE's Python API and, only when the load is clean,
writes what stage 2 consumes: the OMG SysML v2 API JSON of every document, and an
element index that the standard JSON does not carry (each element's qualified
name and source position). A load with errors writes nothing but the
diagnostics and exits 1, because stage 2 never runs on a failed stage 1.

Usage:
    python memo_stage1_syside.py --out stage1.json --library DIR [--library DIR ...] PROJECT_DIR
    python memo_stage1_syside.py --serve

`--library` directories (MEMO's ontology) are loaded and exported like the
project, but marked `"role": "library"` so stage 2 and a cache can tell them
apart. Files under `.venv` or `site-packages` are skipped: an analysis
environment may hold a copy of SysIDE's standard library.

`--serve` answers one JSON request per line on standard input, one JSON
response per line on standard output, until input ends. It keeps the libraries
loaded as a SysIDE environment between requests and writes their export once,
so a request costs the project alone, and it sends a project document again
only when that document's export changed (plans/memo-incremental-stage1.md):

    {"project": DIR, "libraries": [DIR, ...], "libraryKey": KEY, "libraryOut": PATH}

`libraryKey` names the libraries' content; the caller computes it. The
libraries' handoff is written to `libraryOut` when that file does not exist.
The response is the project's handoff (`documents` and `index` of the project
alone, `diagnostics` of the libraries and the project), with `"library":
{"path": PATH}` naming the libraries' handoff, or `{"error": TEXT}`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import syside
import _syside

FORMAT = "memo-stage1/1"
ANSI = re.compile(r"\x1b\[[0-9;]*m")


SKIPPED_DIRECTORIES = {".venv", "site-packages", "node_modules", ".git", "output"}


def sysml_files(root: Path) -> list[Path]:
    # Pruned while walking: an analysis environment under the project can hold
    # thousands of files, none of them the project's.
    found = []
    for directory, subdirectories, files in os.walk(root):
        subdirectories[:] = [d for d in subdirectories if d not in SKIPPED_DIRECTORIES]
        found.extend(Path(directory, f) for f in files if f.endswith(".sysml"))
    return sorted(found)


def read_elements(text: str, referenced: set[str]) -> list:
    """A document's API JSON, read in one pass that drops `@uri` from references
    and collects the ids they name. `@uri` locates the target's document by a
    path relative to this machine's install, which stage 2 never reads (the
    element index says where each element is) and which would make the output
    differ from one machine to the next."""
    def stripped(value: dict) -> dict:
        value.pop("@uri", None)
        if len(value) == 1 and "@id" in value:
            referenced.add(value["@id"])
        return value
    return json.loads(text, object_hook=stripped)


def severity_of(diagnostic) -> str:
    return str(getattr(diagnostic, "severity", "")).rsplit(".", 1)[-1].lower()


def classify(project_root: Path, library_roots: list[Path], files: list[str] | None = None) -> tuple[list[Path], list[Path]]:
    """The library files and the project files, each loaded once. `files` are the
    project's files as the caller resolved them (an `include` root may sit outside
    the project directory); without them the project directory is walked."""
    # Roots may nest (`src` and `src/methodology`): each file is loaded once.
    library_files = list(dict.fromkeys(f for root in library_roots for f in sysml_files(root)))
    # A library root may sit inside the project (a project's own methodology):
    # its files load once, as library, or every namespace in them is declared twice.
    in_library = set(library_files)
    candidates = sorted(dict.fromkeys(Path(f).resolve() for f in files)) if files is not None else sysml_files(project_root)
    project_files = [f for f in candidates if f not in in_library]
    return library_files, project_files


def reported(diagnostics) -> list[dict]:
    out = []
    for diagnostic in diagnostics.all:
        # The full message is what `syside check` prints: the snippet with its
        # carets (the span's width) and any related note. Colour is stripped.
        text = ANSI.sub("", diagnostic.full_message).rstrip()
        out.append({"severity": severity_of(diagnostic), "text": text})
    return out


def has_errors(diagnostics: list[dict]) -> bool:
    return any(d["severity"] == "error" for d in diagnostics)


OPTIONS = None


def serialized(document) -> str:
    """A document's API JSON as SysIDE writes it: the cheapest part of an export."""
    global OPTIONS
    if OPTIONS is None:
        OPTIONS = syside.SerializationOptions.minimal().with_options(use_standard_names=True)
    return _syside.json.dumps(document.root_node, OPTIONS)


def export_document(document, role: str, base: Path, raw: str | None = None) -> tuple[dict, dict[str, dict], set[str]]:
    """One document's API JSON, the index of the elements it declares, and the
    ids its references name. `raw` is its serialization, when already made."""
    path = Path(document.url.path).resolve()
    relative = os.path.relpath(path, base)
    referenced: set[str] = set()
    elements = read_elements(raw if raw is not None else serialized(document), referenced)
    exported_ids = {element["@id"] for element in elements}
    index: dict[str, dict] = {}
    for element in document.all_nodes(syside.Element):
        if str(element.element_id) not in exported_ids:
            continue
        entry = {"file": relative, "role": role, "root": str(base)}
        qualified = element.qualified_name
        if qualified:
            entry["qualifiedName"] = str(qualified)
        cst = element.cst_node
        if cst is not None:
            point = cst.start_point
            entry.update(startByte=cst.start_byte, endByte=cst.end_byte,
                         line=point.line + 1, column=point.character + 1)
        index[str(element.element_id)] = entry
    return {"file": relative, "role": role, "root": str(base), "elements": elements}, index, referenced


def base_of(path: Path, role: str, project_root: Path, library_roots: list[Path]) -> Path:
    return project_root if role == "project" else next(
        (root for root in library_roots if root in path.parents), path.parent)


def export(model, files: list[Path], role: str, project_root: Path, library_roots: list[Path],
           standard: dict[str, str | None], carried: frozenset[str] = frozenset()):
    """The API JSON of the model's documents among `files`, all of one role,
    with the element index of what they declare and of the standard library
    elements they reference (`standard`, id to qualified name). `carried` are
    the ids another handoff (the libraries') indexes, left to it."""
    wanted_files = {str(f) for f in files}
    referenced: set[str] = set()
    documents = []
    index: dict[str, dict] = {}
    for shared in model.user_docs:
        with shared.lock() as document:
            path = Path(document.url.path).resolve()
            if str(path) not in wanted_files:
                continue
            exported, entries, names = export_document(document, role, base_of(path, role, project_root, library_roots))
            documents.append(exported)
            index.update(entries)
            referenced |= names
    index_standard_references(documents, index, referenced, standard, carried)
    return documents, index


def standard_names(model) -> dict[str, str | None]:
    """Each standard library element's qualified name (None for an unnamed one),
    by id: read once, since walking the library is most of an export's cost."""
    names: dict[str, str | None] = {}
    for shared in model.stdlib_docs:
        with shared.lock() as document:
            for element in document.all_nodes(syside.Element):
                qualified = element.qualified_name
                names[str(element.element_id)] = str(qualified) if qualified else None
    return names


def index_standard_references(documents: list[dict], index: dict[str, dict], referenced: set[str],
                              standard: dict[str, str | None], carried: frozenset[str]) -> None:
    """Index the standard library elements the documents reference but the
    handoff does not carry, by qualified name, so stage 2 can name a type such
    as ScalarValues::Boolean."""
    exported_ids = {e["@id"] for d in documents for e in d["elements"]}
    for element_id in referenced - exported_ids - carried - set(index):
        if element_id in standard:
            qualified = standard[element_id]
            index[element_id] = {"role": "standard", **({"qualifiedName": qualified} if qualified else {})}


def handoff(clean: bool, diagnostics: list[dict], **rest) -> dict:
    return {"format": FORMAT, "provider": "syside", "providerVersion": syside.__version__,
            "clean": clean, "diagnostics": diagnostics, **rest}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("project", type=Path, nargs="?")
    parser.add_argument("--library", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.serve:
        return serve()
    if args.project is None or args.out is None:
        parser.error("PROJECT_DIR and --out are required unless --serve")

    project_root = args.project.resolve()
    library_roots = [lib.resolve() for lib in args.library]
    library_files, project_files = classify(project_root, library_roots)

    started = time.perf_counter()
    model, diagnostics = syside.try_load_model([str(f) for f in library_files + project_files])
    loaded = time.perf_counter()

    found = reported(diagnostics)
    if has_errors(found):
        json.dump(handoff(False, found), args.out.open("w"))
        for d in found:
            if d["severity"] == "error":
                print(d["text"], file=sys.stderr)
        return 1

    standard = standard_names(model)
    documents, index = export(model, library_files, "library", project_root, library_roots, standard)
    project_documents, project_index = export(model, project_files, "project", project_root, library_roots, standard)
    documents += project_documents
    index.update(project_index)
    exported = time.perf_counter()

    json.dump(handoff(True, found, documents=documents, index=index,
                      timings={"loadSeconds": round(loaded - started, 3),
                               "exportSeconds": round(exported - loaded, 3)}),
              args.out.open("w"))
    return 0


class Libraries:
    """The libraries loaded once, as an environment a project loads over."""

    def __init__(self, key: str, roots: list[Path], files: list[Path]):
        self.key = key
        self.roots = roots
        self.files = files
        model, diagnostics = syside.try_load_model([str(f) for f in files])
        self.model = model
        self.diagnostics = reported(diagnostics)
        self.environment = None if has_errors(self.diagnostics) else model.to_environment()
        self.standard = standard_names(model)
        self.carried: frozenset[str] | None = None

    def write(self, out: Path, project_root: Path) -> None:
        """The libraries' handoff, written once per content (`libraryKey`), and
        beside it the ids it indexes, which a project's handoff leaves to it."""
        ids = out.with_name(out.name + ".ids")
        if self.carried is not None and out.exists():
            return
        if out.exists() and ids.exists():
            self.carried = frozenset(ids.read_text().split())
            return
        documents, index = export(self.model, self.files, "library", project_root, self.roots, self.standard)
        self.carried = frozenset(index)
        out.parent.mkdir(parents=True, exist_ok=True)
        partial = f".{os.getpid()}.partial"
        written = out.with_name(out.name + partial)
        json.dump(handoff(True, self.diagnostics, documents=documents, index=index), written.open("w"))
        listed = ids.with_name(ids.name + partial)
        listed.write_text("\n".join(sorted(self.carried)))
        listed.replace(ids)
        written.replace(out)


class Exported:
    """A project document's export as last sent: its text, its serialization,
    export and index, and the ids it references."""

    def __init__(self, text: bytes, raw: str, document: dict, index: dict[str, dict], referenced: set[str]):
        self.text = text
        self.raw = raw
        self.document = document
        self.index = index
        self.referenced = referenced


class Project:
    """A project's documents as this worker last exported them, so a request
    sends again only the documents whose export changed. A document whose text
    changed is exported again; one whose text did not is serialized and compared
    with what was sent, since an edit elsewhere can change what it resolves to.
    `token` names what was last sent: a caller holding it may be sent
    `{"kept": true}` for a document it already has."""

    def __init__(self):
        self.exported: dict[str, Exported] = {}
        self.libraries_key: str | None = None
        self.token = 0

    def answer(self, model, project_files: list[Path], project_root: Path, libraries: Libraries, known) -> tuple[list[dict], dict]:
        texts = {str(f): f.read_bytes() for f in project_files}
        reusable = known == self.token and self.libraries_key == libraries.key and set(texts) == set(self.exported)
        if not reusable:
            self.exported = {}
        sent: set[str] = set()
        for shared in model.user_docs:
            with shared.lock() as document:
                path = str(Path(document.url.path).resolve())
                if path not in texts:
                    continue
                previous = self.exported.get(path)
                if previous is not None and previous.text == texts[path]:
                    raw = serialized(document)
                    if raw == previous.raw:
                        continue
                else:
                    raw = None
                raw = raw if raw is not None else serialized(document)
                exported, index, referenced = export_document(document, "project", project_root, raw)
                self.exported[path] = Exported(texts[path], raw, exported, index, referenced)
                sent.add(path)
        self.libraries_key = libraries.key
        self.token += 1
        documents = []
        referenced: set[str] = set()
        declared: set[str] = set()
        for f in project_files:
            entry = self.exported[str(f)]
            referenced |= entry.referenced
            declared |= entry.index.keys()
            if str(f) in sent:
                documents.append({**entry.document, "index": entry.index})
            else:
                documents.append({"file": entry.document["file"], "kept": True})
        standard: dict[str, dict] = {}
        for element_id in referenced - declared - (libraries.carried or frozenset()):
            if element_id in libraries.standard:
                qualified = libraries.standard[element_id]
                standard[element_id] = {"role": "standard", **({"qualifiedName": qualified} if qualified else {})}
        return documents, standard


def answer(request: dict, libraries: Libraries | None, project: Project) -> tuple[dict, Libraries | None]:
    project_root = Path(request["project"]).resolve()
    library_roots = [Path(root).resolve() for root in request.get("libraries", [])]
    library_files, project_files = classify(project_root, library_roots, request.get("files"))
    started = time.perf_counter()
    if libraries is None or libraries.key != request["libraryKey"] or libraries.files != library_files:
        libraries = Libraries(request["libraryKey"], library_roots, library_files)
    loaded_libraries = time.perf_counter()
    if libraries.environment is None:
        return handoff(False, libraries.diagnostics), libraries
    out = Path(request["libraryOut"])
    libraries.write(out, project_root)
    model, diagnostics = syside.try_load_model([str(f) for f in project_files], environment=libraries.environment)
    loaded = time.perf_counter()
    found = libraries.diagnostics + reported(diagnostics)
    if has_errors(found):
        return handoff(False, found), libraries
    documents, standard = project.answer(model, project_files, project_root, libraries, request.get("known"))
    exported = time.perf_counter()
    return handoff(True, found, documents=documents, index=standard, library={"path": str(out)},
                   token=project.token,
                   timings={"librarySeconds": round(loaded_libraries - started, 3),
                            "loadSeconds": round(loaded - loaded_libraries, 3),
                            "exportSeconds": round(exported - loaded, 3)}), libraries


def serve() -> int:
    libraries: Libraries | None = None
    project = Project()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            response, libraries = answer(json.loads(line), libraries, project)
        except Exception as error:  # reported to the caller, the worker stays up
            response = {"error": f"{type(error).__name__}: {error}"}
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
