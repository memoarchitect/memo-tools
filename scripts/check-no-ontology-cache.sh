#!/usr/bin/env bash
# ─── Guard: no ontology/model caching in web store ───────────────────────────
#
# Fails CI if any of:
#   1. persist() wrapping a slice that touches ontology/model/kind/relationship
#   2. localStorage.setItem with an ontology-ish key
#
# Run: bash scripts/check-no-ontology-cache.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

STORE_DIR="packages/web/src/store"
FAILED=0

# ── Check 1: persist() near ontology/model/kind/relationship ──────────────────
echo "Checking for forbidden persist() usage in $STORE_DIR..."
PERSIST_HITS=$(grep -rn "persist(" "$STORE_DIR" 2>/dev/null || true)
if [ -n "$PERSIST_HITS" ]; then
    echo "ERROR: Found persist() in web store — ontology/model state must not be persisted:"
    echo "$PERSIST_HITS"
    FAILED=1
fi

# ── Check 2: localStorage.setItem with ontology-ish keys ────────────────────
echo "Checking for forbidden localStorage.setItem with ontology/model keys..."
LOCALSTORAGE_HITS=$(grep -rn "localStorage\.setItem" "$STORE_DIR" 2>/dev/null \
    | grep -iE "ontology|model|kind|relationship" || true)
if [ -n "$LOCALSTORAGE_HITS" ]; then
    echo "ERROR: Found localStorage.setItem with ontology/model key — these must not be cached:"
    echo "$LOCALSTORAGE_HITS"
    FAILED=1
fi

# ── Check 3: memo:userViewpoints key must not be written ─────────────────────
echo "Checking for memo:userViewpoints write..."
VP_WRITE=$(grep -rn "memo:userViewpoints" "packages/web/src" 2>/dev/null \
    | grep "setItem" || true)
if [ -n "$VP_WRITE" ]; then
    echo "ERROR: Found localStorage.setItem('memo:userViewpoints') — this key is deprecated:"
    echo "$VP_WRITE"
    FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
    echo "OK: No forbidden ontology/model caching found."
else
    exit 1
fi
