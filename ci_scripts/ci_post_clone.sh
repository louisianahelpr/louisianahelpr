#!/bin/sh
# Xcode Cloud post-clone hook.
#
# Runs after Xcode Cloud clones the repo, BEFORE it spins up the Xcode build.
# Our job here is to prepare the iOS workspace exactly like the local
# `npm run sync:ios` script does — install Node deps, build the Vite web
# bundle into `dist/`, then `cap sync` it into `ios/App/App/public/` so
# the Capacitor shell has the latest web assets baked in.
#
# Apple documents this as the supported way to do JS toolchain work in
# Xcode Cloud: https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
#
# Without this script, Xcode Cloud would build the iOS shell with whatever
# `ios/App/App/public/` was committed to git (which we deliberately keep
# as a stale checked-in snapshot, since it's regenerated on every build).

set -e

echo "▸ Xcode Cloud: post-clone hook started"
echo "▸ CI_PRIMARY_REPOSITORY_PATH=$CI_PRIMARY_REPOSITORY_PATH"

# Xcode Cloud's working directory is `ci_scripts/`; the repo root is one up.
cd "$CI_PRIMARY_REPOSITORY_PATH"
echo "▸ Working dir: $(pwd)"

# ── Install Node ──────────────────────────────────────────────────────
# Xcode Cloud's macOS image has Homebrew but no Node preinstalled. Install
# Node 24 (project uses @types/node@25 so 24+ is required) via Homebrew.
# This adds ~30s to each build; that's fine since it's not the critical
# path for code signing / xcodebuild.
if ! command -v node >/dev/null 2>&1; then
  echo "▸ Installing Node via Homebrew…"
  brew install node@24
  brew link --overwrite node@24
fi
echo "▸ Node: $(node --version)"
echo "▸ npm:  $(npm --version)"

# ── Install JS dependencies ───────────────────────────────────────────
# Use `npm ci` for reproducible installs from the committed lockfile.
echo "▸ npm ci"
npm ci --no-audit --no-fund

# ── Build the Vite web bundle ─────────────────────────────────────────
# `build:ios` is the Capacitor-flavored variant of `npm run build`. It
# sets `VITE_CAPACITOR_BUILD=1` (which the app reads to enable native
# code paths) and runs `sync:ios-metadata` first so version/build numbers
# in `fastlane/ios_app_metadata.yml` get reflected in `dist/`.
echo "▸ npm run build:ios"
npm run build:ios

# ── Sync into the iOS shell ───────────────────────────────────────────
# Without this, `dist/` would be on disk but `ios/App/App/public/` (the
# directory Xcode actually bundles into the .app) would be stale.
echo "▸ npx cap sync ios"
npx cap sync ios

echo "✓ Xcode Cloud post-clone hook complete — repo ready for xcodebuild"
