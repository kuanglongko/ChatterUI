#!/usr/bin/env bash
# PATCH: session-id
#
# Keep this fork's session-id changes rebased on top of upstream and export
# them as a single, `git am`-able patch.
#
# Usage:
#   scripts/update-and-patch.sh [upstream-remote] [upstream-branch]
#
# Defaults:
#   upstream-remote = upstream
#   upstream-branch = master
#
# First-time setup:
#   git remote add upstream https://github.com/Vali-98/ChatterUI.git
#
# Apply the exported patch to a fresh upstream checkout:
#   git am patches/*.patch
set -euo pipefail

UPSTREAM_REMOTE="${1:-upstream}"
UPSTREAM_BRANCH="${2:-master}"
UPSTREAM_REF="${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
PATCH_DIR="${PATCH_DIR:-patches}"
BACKUP_DIR="${BACKUP_DIR:-.patch-backup}"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "error: working tree is not clean; commit or stash your changes first" >&2
    exit 1
fi

if ! git rev-parse --verify --quiet "${UPSTREAM_REF}" >/dev/null; then
    echo "error: ${UPSTREAM_REF} not found; add the upstream remote first" >&2
    exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# 1. Back up the current local commits before touching history.
mkdir -p "${BACKUP_DIR}"
rm -f "${BACKUP_DIR}"/*.patch
git format-patch "${UPSTREAM_REF}..HEAD" -o "${BACKUP_DIR}" >/dev/null
echo "backed up local commits to ${BACKUP_DIR}/"

# 2. Bring in the new upstream state.
git fetch "${UPSTREAM_REMOTE}"
git rebase "${UPSTREAM_REF}"

# 3. Re-export the (now rebased) commits from a clean base.
mkdir -p "${PATCH_DIR}"
rm -f "${PATCH_DIR}"/*.patch
git format-patch "${UPSTREAM_REF}..HEAD" -o "${PATCH_DIR}" >/dev/null
echo "exported rebased patches to ${PATCH_DIR}/"
echo "branch: ${CURRENT_BRANCH} -> $(git rev-parse --short HEAD)"
echo
echo "If the rebase stopped on a conflict:"
echo "  1. resolve the files listed by git"
echo "  2. git add <files> && git rebase --continue"
echo "  3. rerun this script (or just: git format-patch ${UPSTREAM_REF}..HEAD -o ${PATCH_DIR})"
