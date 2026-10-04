"""The project's SysML v2 model, for analysis notebooks.

`load()` compiles the project with the compiler its settings select
(`toolchain.compiler`, as every MEMO command does) by running
`memo compile --out`, and reads the result: each document's SysML v2 API JSON,
the compiler's diagnostics, and an index of where each element is declared.
A notebook reads the model through this module alone, so changing the
project's compiler changes what every notebook analyses, with nothing else to
edit.

The `memo` command is found as `$MEMO_CLI` (a command line, for example
`node /path/to/memo.js`) or as `memo` on `PATH`.

    import memo_model
    model = memo_model.load()
    parts = model.elements('PartUsage')
    usages = model.elements('Usage', include_subtypes=True)
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

FORMAT = "memo-compiled-model/1"

# Properties that hold an element's ownership, as the API JSON states them.
_OWNING_RELATIONSHIP = "owningRelationship"
_OWNED_RELATIONSHIP = "ownedRelationship"
_OWNED_RELATED_ELEMENT = "ownedRelatedElement"
_OWNING_RELATED_ELEMENT = "owningRelatedElement"


class ModelError(Exception):
    """The project could not be compiled into a model."""


@dataclass(frozen=True)
class Diagnostic:
    severity: str
    message: str
    code: str | None = None
    file: str | None = None
    line: int | None = None
    column: int | None = None

    def __str__(self) -> str:
        where = f"{self.file or ''}:{self.line or '?'}:{self.column or '?'}"
        code = f" ({self.code})" if self.code else ""
        return f"{where} {self.severity}{code}: {self.message}"


class Diagnostics:
    """What the compiler reported, by severity."""

    def __init__(self, items: list[Diagnostic]):
        self.all = items
        self.errors = [d for d in items if d.severity == "error"]
        self.warnings = [d for d in items if d.severity == "warning"]
        self.infos = [d for d in items if d.severity not in ("error", "warning")]

    def __len__(self) -> int:
        return len(self.all)

    def __iter__(self):
        return iter(self.all)


def _references(value) -> list[str]:
    if isinstance(value, dict) and "@id" in value:
        return [value["@id"]]
    if isinstance(value, list):
        return [item["@id"] for item in value if isinstance(item, dict) and "@id" in item]
    return []


class Element:
    """One element of the model, as its API JSON states it."""

    def __init__(self, model: Model, data: dict, role: str):
        self._model = model
        self.data = data
        self.role = role

    def __repr__(self) -> str:
        return f"<{self.type} {self.qualified_name or self.name or self.id}>"

    @property
    def id(self) -> str:
        return self.data["@id"]

    @property
    def type(self) -> str:
        """The element's metaclass, for example `PartUsage`."""
        return self.data["@type"]

    def is_a(self, *metaclasses: str) -> bool:
        """Whether the element's metaclass is, or specializes, one of these."""
        own = self._model._supertypes.get(self.type, [])
        return any(name == self.type or name in own for name in metaclasses)

    @property
    def declared_name(self) -> str | None:
        return self.data.get("declaredName")

    @property
    def name(self) -> str | None:
        return self.data.get("name") or self.declared_name

    @property
    def qualified_name(self) -> str | None:
        return self.data.get("qualifiedName") or self._model._index.get(self.id, {}).get("qualifiedName")

    @property
    def file(self) -> str | None:
        return self._model._index.get(self.id, {}).get("file")

    @property
    def line(self) -> int | None:
        return self._model._index.get(self.id, {}).get("line")

    @property
    def owner(self) -> Element | None:
        """The element that owns this one: a relationship's owning element, or
        the element owning the relationship that owns this one."""
        owning = _references(self.data.get(_OWNING_RELATED_ELEMENT))
        if owning:
            return self._model.element(owning[0])
        relationship = _references(self.data.get(_OWNING_RELATIONSHIP))
        if relationship:
            owning_relationship = self._model.element(relationship[0])
            if owning_relationship is not None:
                owners = _references(owning_relationship.data.get(_OWNING_RELATED_ELEMENT))
                if owners:
                    return self._model.element(owners[0])
        return None

    @property
    def owned_relationships(self) -> list[Element]:
        return self._model._resolve(_references(self.data.get(_OWNED_RELATIONSHIP)))

    @property
    def owned_elements(self) -> list[Element]:
        """The elements this one owns, through the relationships it owns."""
        owned: list[Element] = []
        for relationship in self.owned_relationships:
            owned.extend(self._model._resolve(_references(relationship.data.get(_OWNED_RELATED_ELEMENT))))
        return owned

    @property
    def related_elements(self) -> list[Element]:
        """For a relationship, every other element it references; the model's
        elements only, not the standard library's."""
        related: list[Element] = []
        for key, value in self.data.items():
            if key in (_OWNING_RELATED_ELEMENT, _OWNING_RELATIONSHIP, _OWNED_RELATIONSHIP) or key.startswith("@"):
                continue
            related.extend(self._model._resolve(_references(value)))
        return [element for element in related if element.id != self.id]


class Model:
    """The compiled model: its documents, elements and diagnostics."""

    def __init__(self, compiled: dict):
        if compiled.get("format") != FORMAT:
            raise ModelError(f"memo compile wrote {compiled.get('format')!r}, expected {FORMAT!r}")
        self.compiler: str = compiled["compiler"]
        self.compiler_version: str | None = compiled.get("compilerVersion")
        self.diagnostics = Diagnostics([Diagnostic(**d) for d in compiled.get("diagnostics", [])])
        self._index: dict[str, dict] = compiled.get("index", {})
        self._supertypes: dict[str, list[str]] = compiled.get("supertypes", {})
        self.documents = [d["file"] for d in compiled.get("documents", []) if d["role"] == "project"]
        self._elements: dict[str, Element] = {}
        for document in compiled.get("documents", []):
            for data in document["elements"]:
                self._elements[data["@id"]] = Element(self, data, document["role"])

    def element(self, element_id: str) -> Element | None:
        return self._elements.get(element_id)

    def _resolve(self, ids: list[str]) -> list[Element]:
        return [self._elements[i] for i in ids if i in self._elements]

    def elements(self, metaclass: str | None = None, include_subtypes: bool = False,
                 libraries: bool = False) -> list[Element]:
        """The project's elements of a metaclass (every one when None); with
        `include_subtypes`, of its specializations too; with `libraries`, the
        libraries' elements as well as the project's."""
        found = []
        for element in self._elements.values():
            if not libraries and element.role != "project":
                continue
            if metaclass is None or element.type == metaclass or (include_subtypes and element.is_a(metaclass)):
                found.append(element)
        return found


def find_project(start: Path | None = None) -> Path:
    """The nearest directory holding a MEMO project (`memo.package.yaml`)."""
    start = (start or Path.cwd()).resolve()
    for directory in (start, *start.parents):
        if (directory / "memo.package.yaml").is_file():
            return directory
    raise ModelError(f"No MEMO project (memo.package.yaml) above {start}")


def _memo_command() -> list[str]:
    configured = os.environ.get("MEMO_CLI")
    if configured:
        return shlex.split(configured)
    found = shutil.which("memo")
    if found:
        return [found]
    raise ModelError("The memo command was not found. Put it on PATH, or set MEMO_CLI to the command that runs it.")


def load(project: str | Path | None = None, force: bool = False) -> Model:
    """Compile the project with its selected compiler and read the model.

    A project the compiler rejects raises ModelError with its errors; MEMO
    analyses a model only once it is valid SysML."""
    root = Path(project).resolve() if project else find_project()
    with tempfile.TemporaryDirectory(prefix="memo-model-") as scratch:
        out = Path(scratch) / "model.json"
        command = [*_memo_command(), "compile", str(root), "--out", str(out)]
        if force:
            command.append("--force")
        run = subprocess.run(command, capture_output=True, text=True)
        if not out.exists():
            detail = (run.stderr or run.stdout).strip() or f"exit status {run.returncode}"
            raise ModelError(f"memo compile wrote no model: {detail}")
        model = Model(json.loads(out.read_text(encoding="utf-8")))
    if model.diagnostics.errors:
        listed = "\n".join(str(d) for d in model.diagnostics.errors[:20])
        raise ModelError(f"{model.compiler} reports {len(model.diagnostics.errors)} error(s):\n{listed}")
    return model
