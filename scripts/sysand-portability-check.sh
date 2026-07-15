#!/usr/bin/env bash
# ─── EE-5 Portability gate ───────────────────────────────────────────────────
#
# Proves the released MEMO ontology — now carrying native `constraint def` /
# `requirement def` bodies (Epic EE) — parses in an EXTERNAL, conformant SysML v2
# tool: Sensmetry `sysand` (same engine family as the SysIDE VS Code extension).
#
# If `sysand build` produces a `.kpar` with zero `error:` lines, the constraints
# are portable content and `memo-sysmlv2` can be cut as a genuine standalone
# release. If the external parser chokes, the rules are MEMO-locked and the gate
# fails the pipeline.
#
# This is a PARSE-fidelity gate, not an evaluation gate — the external tool is
# not required to evaluate the constraints, only to read them without error.
#
# Coordinates with Epic DD's conformance harness (`memo round-trip`,
# `memo check --sysml-compat`): those are MEMO-internal model heuristics; this
# step is the real external-tool round-trip.
#
# Reproduce locally:  ./scripts/sysand-portability-check.sh
# Requires:           sysand on PATH (https://docs.sysand.org/)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Projects to round-trip: each is an independent sysand project (has .project.json).
PROJECTS=(
  "memo"
  "memo/methodology"
)

if ! command -v sysand >/dev/null 2>&1; then
  echo "✖ sysand not found on PATH — install from https://docs.sysand.org/" >&2
  exit 127
fi

echo "── EE-5 portability gate: external SysML v2 parse via $(sysand --version) ──"

fail=0
for proj in "${PROJECTS[@]}"; do
  dir="$REPO_ROOT/$proj"
  echo ""
  echo "▶ $proj"

  # Collect this project's own .sysml files, excluding nested sub-projects
  # (directories that carry their own .project.json).
  files_file="$(mktemp)"
  python3 - "$dir" >"$files_file" <<'PY'
import os, sys
root = sys.argv[1]
subprojects = set()
for r, ds, fs in os.walk(root):
    if r != root and '.project.json' in fs:
        subprojects.add(os.path.abspath(r))
for r, ds, fs in os.walk(root):
    ar = os.path.abspath(r)
    if any(ar == s or ar.startswith(s + os.sep) for s in subprojects):
        continue
    for f in fs:
        if f.endswith('.sysml'):
            print(os.path.relpath(os.path.join(r, f), root))
PY

  count="$(grep -c . "$files_file" || true)"
  echo "  sources: $count .sysml files"

  (
    cd "$dir"
    rm -f .meta.json
    rm -rf output
    # Index sources (regenerates .meta.json deterministically; not committed).
    tr '\n' '\0' <"$files_file" | xargs -0 sysand include --compute-checksum >/dev/null
    # Build the KPAR — the actual external parse.
    out="$(sysand build 2>&1)" || true
    echo "$out" | sed 's/^/  /'
    if echo "$out" | grep -qi '^error:\|: error'; then
      echo "  ✖ external parse reported errors"
      exit 1
    fi
    kpar="$(ls output/*.kpar 2>/dev/null | head -1 || true)"
    if [ -z "$kpar" ]; then
      echo "  ✖ no .kpar produced"
      exit 1
    fi
    nsysml="$(unzip -l "$kpar" | grep -c '\.sysml' || true)"
    echo "  ✔ $(basename "$kpar") built — $nsysml source files, zero errors"
  ) || fail=1

  rm -f "$files_file"
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "✖ EE-5 portability gate FAILED — ontology does not parse in external tool."
  exit 1
fi
echo "✔ EE-5 portability gate PASSED — MEMO ontology constraints are portable SysML v2."
