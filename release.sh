#!/usr/bin/env bash
# release.sh — cut a release.
#
# Usage:
#   ./release.sh patch     # 0.1.0 -> 0.1.1
#   ./release.sh minor     # 0.1.0 -> 0.2.0
#   ./release.sh major     # 0.1.0 -> 1.0.0
#   ./release.sh 0.2.0-rc.1  # explicit version
#
# The script:
#   1. Verifies the working tree is clean and on master.
#   2. Runs the full verify chain (typecheck + test + build).
#   3. Bumps package.json version, commits the bump, tags it.
#   4. Pushes commit + tag.
#   5. Publishes to npm.
#
# Requires: npm auth (`npm whoami`), bun, gh (for release notes).

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

# 2. Verify chain — same as CI runs
echo "==> typecheck"
bun run typecheck
echo "==> test"
bun run test
echo "==> build"
bun run build

# 3. Bump + commit + tag
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
# npm version prefixes with 'v', strip for the commit message
VERSION="${NEW_VERSION#v}"

git add package.json
git commit -m "chore(release): $VERSION"
git tag -a "$NEW_VERSION" -m "$VERSION"

# 4. Push commit and tag
echo "==> pushing to origin"
git push origin master
git push origin "$NEW_VERSION"

# 5. Publish
echo "==> npm publish"
npm publish --access public

echo ""
echo "released $VERSION"
echo "  tag:   https://github.com/egriff38/effect-graphql/releases/tag/$NEW_VERSION"
echo "  npm:   https://www.npmjs.com/package/effect-graphql/v/$VERSION"
