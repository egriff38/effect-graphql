#!/usr/bin/env bash
# release.sh — cut a release of packages/core (the published `effect-graphql`).
#
# Usage:
#   ./release.sh patch     # 0.2.1 -> 0.2.2
#   ./release.sh minor     # 0.2.1 -> 0.3.0
#   ./release.sh major     # 0.2.1 -> 1.0.0
#   ./release.sh 0.3.0-rc.1  # explicit version
#
# The script:
#   1. Verifies the working tree is clean and on master.
#   2. Runs the full verify chain (typecheck + test + build) at the workspace root.
#   3. Bumps packages/core/package.json version, commits the bump, tags it.
#   4. Pushes commit + tag.
#   5. Publishes packages/core to npm.
#
# Requires: npm auth (`npm whoami`), bun.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <patch|minor|major|X.Y.Z[-prerelease]>" >&2
  exit 1
fi

BUMP="$1"

# 1. Gate on clean tree + master branch
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean; commit or stash first" >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "master" ]; then
  echo "error: releases must be cut from master (currently on $BRANCH)" >&2
  exit 1
fi

# 2. Verify chain — same as CI runs, from the workspace root so `bun --filter` fans out.
echo "==> typecheck"
bun run typecheck
echo "==> test"
bun run test
echo "==> build"
bun run build

# 3. Bump + commit + tag — package.json inside packages/core, tag is repo-wide.
cd packages/core
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
VERSION="${NEW_VERSION#v}"
cd - > /dev/null

git add packages/core/package.json
git commit -m "chore(release): $VERSION"
git tag -a "$NEW_VERSION" -m "$VERSION"

# 4. Push commit and tag
echo "==> pushing to origin"
git push origin master
git push origin "$NEW_VERSION"

# 5. Publish from packages/core
echo "==> npm publish"
cd packages/core
npm publish --access public
cd - > /dev/null

echo ""
echo "released $VERSION"
echo "  tag:   https://github.com/egriff38/effect-graphql/releases/tag/$NEW_VERSION"
echo "  npm:   https://www.npmjs.com/package/effect-graphql/v/$VERSION"
