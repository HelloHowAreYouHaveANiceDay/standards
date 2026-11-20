#!/usr/bin/env bash
# Tag each profiles/ci-local/<v>/ (v >= 1.5.0) that lacks tag ci-local/v<v>, at the commit that added <v>/SHA256SUMS.
# Idempotent: existing tags are never moved. DRY_RUN=1 prints instead of tagging/pushing.
set -euo pipefail
MIN=1.5.0
for d in profiles/ci-local/*/; do
  v=$(basename "$d")
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  [ "$(printf '%s\n%s\n' "$MIN" "$v" | sort -V | head -n1)" = "$MIN" ] || { echo "skip $v (< $MIN)"; continue; }
  tag="ci-local/v$v"
  if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1 || git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "exists $tag"; continue
  fi
  sha=$(git log --diff-filter=A --format=%H -- "profiles/ci-local/$v/SHA256SUMS" | tail -n1)
  [ -n "$sha" ] || { echo "no SHA256SUMS history for $v" >&2; exit 1; }
  if [ "${DRY_RUN:-}" = 1 ]; then echo "would tag $tag at $sha"; continue; fi
  git tag "$tag" "$sha"
  git push origin "refs/tags/$tag"
  echo "tagged $tag at $sha"
done
