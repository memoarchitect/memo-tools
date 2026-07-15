#!/usr/bin/env bash
# ─── Test Clean Install (npm distribution simulation) ────────────────────────
#
# Simulates what an end user experiences:
#   1. pnpm pack each package → tarballs
#   2. Create a temp project directory
#   3. npm install from tarballs (like `npm install @memo/cli`)
#   4. Run memo init, memo validate
#
# Usage:
#   pnpm run build   # must build first
#   ./scripts/test-clean-install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR=$(mktemp -d)
TARBALLS_DIR="$TEMP_DIR/tarballs"
PROJECT_DIR="$TEMP_DIR/test-project"

mkdir -p "$TARBALLS_DIR" "$PROJECT_DIR"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  MEMO — Distribution Test (pnpm pack + npm install)"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Repo:     $REPO_DIR"
echo "  Tarballs: $TARBALLS_DIR"
echo "  Project:  $PROJECT_DIR"
echo ""

# ── 1. Pack each package ──────────────────────────────────────────────────────
echo "① Packing packages..."

cd "$REPO_DIR/packages/ontology-core"
ONTOLOGY_CORE_TGZ=$(pnpm pack --pack-destination "$TARBALLS_DIR" 2>/dev/null | tail -1)
echo "  ✓ @memo/ontology-core    → $(basename "$ONTOLOGY_CORE_TGZ")"

cd "$REPO_DIR/packages/ontology-medical"
ONTOLOGY_MEDICAL_TGZ=$(pnpm pack --pack-destination "$TARBALLS_DIR" 2>/dev/null | tail -1)
echo "  ✓ @memo/ontology-medical → $(basename "$ONTOLOGY_MEDICAL_TGZ")"

cd "$REPO_DIR/packages/core"
CORE_TGZ=$(pnpm pack --pack-destination "$TARBALLS_DIR" 2>/dev/null | tail -1)
echo "  ✓ @memo/core     → $(basename "$CORE_TGZ")"

cd "$REPO_DIR/packages/medical-modeling-profile"
MEDICAL_TGZ=$(pnpm pack --pack-destination "$TARBALLS_DIR" 2>/dev/null | tail -1)
echo "  ✓ @memo/medical-modeling-profile  → $(basename "$MEDICAL_TGZ")"

cd "$REPO_DIR/packages/cli"
CLI_TGZ=$(pnpm pack --pack-destination "$TARBALLS_DIR" 2>/dev/null | tail -1)
echo "  ✓ @memo/cli      → $(basename "$CLI_TGZ")"

echo ""
echo "  Tarballs:"
ls -lh "$TARBALLS_DIR"/*.tgz | awk '{print "    " $5 "  " $NF}'
echo ""

# ── 2. Create test project ───────────────────────────────────────────────────
echo "② Creating test project..."

cd "$PROJECT_DIR"
npm init -y --silent > /dev/null 2>&1

echo "  ✓ npm init"
echo ""

# ── 3. Install from tarballs ─────────────────────────────────────────────────
echo "③ Installing from tarballs (npm install)..."

npm install \
  "$TARBALLS_DIR"/memo-ontology-core-*.tgz \
  "$TARBALLS_DIR"/memo-ontology-medical-*.tgz \
  "$TARBALLS_DIR"/memo-core-*.tgz \
  "$TARBALLS_DIR"/memo-medical-*.tgz \
  "$TARBALLS_DIR"/memo-cli-*.tgz \
  2>&1 | tail -5

echo "  ✓ npm install"
echo ""

# ── 4. Verify installed contents ─────────────────────────────────────────────
echo "④ Verifying installed package contents..."

CHECKS_PASSED=0
CHECKS_TOTAL=0

check_file() {
    CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
    if [ -f "$1" ]; then
        echo "  ✓ $1"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        echo "  ✗ MISSING: $1"
    fi
}

check_file "node_modules/@memo/core/lib/index.js"
check_file "node_modules/@memo/core/lib/index.d.ts"
check_file "node_modules/@memo/cli/lib/bin/memo.js"
check_file "node_modules/@memo/ontology-core/memo.config.yaml"
check_file "node_modules/@memo/ontology-core/sysml/index.sysml"
check_file "node_modules/@memo/ontology-medical/memo.config.yaml"
check_file "node_modules/@memo/ontology-medical/sysml/index.sysml"
check_file "node_modules/@memo/medical-modeling-profile/memo.config.yaml"

echo ""

# ── 5. Verify bin ─────────────────────────────────────────────────────────────
echo "⑤ Checking memo binary..."

if npx memo --version > /dev/null 2>&1; then
    echo "  ✓ memo --version: $(npx memo --version 2>/dev/null)"
else
    echo "  ✗ memo binary not found"
    echo "  Temp dir: $TEMP_DIR"
    exit 1
fi
echo ""

# ── 6. Test memo init ────────────────────────────────────────────────────────
echo "⑥ Testing: memo init my-device..."

npx memo init my-device 2>&1

if [ -f my-device/memo.config.yaml ] && [ -f my-device/model/my-device.sysml ]; then
    echo "  ✓ memo init — files created:"
    echo "    - my-device/memo.config.yaml"
    echo "    - my-device/model/my-device.sysml"
else
    echo "  ✗ memo init FAILED — missing files"
    ls -R my-device/ 2>/dev/null || echo "  (directory not created)"
    echo "  Temp dir: $TEMP_DIR"
    exit 1
fi
echo ""

# ── 7. Test memo validate ────────────────────────────────────────────────────
echo "⑦ Testing: memo validate my-device/..."

cd my-device
npx memo validate . 2>&1 | head -15 || true
cd "$PROJECT_DIR"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════"
if [ "$CHECKS_PASSED" -eq "$CHECKS_TOTAL" ]; then
    echo "  ✅ All checks passed! ($CHECKS_PASSED/$CHECKS_TOTAL)"
else
    echo "  ⚠  $CHECKS_PASSED/$CHECKS_TOTAL checks passed"
fi
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Test project at: $PROJECT_DIR"
echo "  To clean up:     rm -rf $TEMP_DIR"
echo ""
