#!/usr/bin/env bash
set -euo pipefail
before="${1:-}"
version="$(tr -d '[:space:]' < VERSION)"
tag="v${version}"
previous=""
if [[ -n "$before" && ! "$before" =~ ^0+$ ]]; then previous="$(git show "${before}:VERSION" 2>/dev/null || true)"; fi
previous="${previous//[[:space:]]/}"
[[ "$previous" == "$version" ]] && exit 0
if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
  if [[ -z "$previous" ]]; then echo "${tag} already records the version that predates VERSION; no replacement needed."; exit 0; fi
  echo "Refusing to reuse existing ${tag}; choose a new VERSION." >&2; exit 1
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git tag -a "$tag" -m "Release ${tag}"
git push origin "$tag"
