#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != "--check" ]]; then
  echo "usage: scripts/sync-upstream.sh --check" >&2
  echo "Checks whether upstream/main reconciles cleanly in a disposable worktree; it never changes the current branch." >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel)
if [[ -n $(git -C "$root" status --porcelain) ]]; then
  echo "working tree must be clean before an upstream sync check" >&2
  exit 1
fi

remote=$(git -C "$root" remote get-url upstream 2>/dev/null || true)
if [[ $remote != "https://github.com/DietrichGebert/ponytail.git" && $remote != "git@github.com:DietrichGebert/ponytail.git" ]]; then
  echo "upstream remote is missing or unexpected: ${remote:-<none>}" >&2
  exit 1
fi

git -C "$root" fetch upstream main
if git -C "$root" merge-base --is-ancestor upstream/main HEAD; then
  echo "upstream/main is already contained in HEAD"
  exit 0
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/ponytail-on-stimulants-sync.XXXXXX")
cleanup() {
  git -C "$root" worktree remove --force "$tmp" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git -C "$root" worktree add --detach "$tmp" HEAD >/dev/null
cd "$tmp"
if ! git merge --no-commit --no-ff upstream/main; then
  echo "upstream reconciliation has conflicts; review these fork-owned policy surfaces manually:" >&2
  git diff --name-only --diff-filter=U >&2
  git merge --abort || true
  exit 1
fi

node scripts/build-openclaw-skills.js
node scripts/check-rule-copies.js
node scripts/check-versions.js
git merge --abort
echo "upstream/main reconciles structurally in a disposable worktree"
