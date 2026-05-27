#!/bin/sh
# iOS Simulator cold-launch smoke test.
#
# Audit #1 from the 2026-05-27 "things our Chromium-mocked tests don't
# catch" backlog. Boots a simulator, builds the iOS app, installs it,
# launches it, and captures screenshots at intervals so the boot
# sequence can be reviewed visually (or fed to a downstream tool like
# Maestro for automated assertions).
#
# Usage:
#   scripts/sim-smoke.sh                  # iPhone 17 Pro, 4 screenshots, /tmp/sim-coldlaunch
#   DEVICE="iPhone SE" scripts/sim-smoke.sh
#   OUTPUT_DIR=./artifacts scripts/sim-smoke.sh
#
# What it does NOT do (yet):
#   - Automated assertions on what the screenshots contain (Phase 2 → Maestro)
#   - CI integration — runs locally only; macOS runner cost makes CI prohibitive
#     until Xcode Cloud or similar is wired (see docs/xcode-cloud-setup.md)
#
# Why this exists: tests in e2e/ run Chromium against a mocked Supabase
# backend. They cannot observe iOS WebKit behavior, Capacitor plugin
# interactions (appUrlOpen, push notifications), or cold-launch race
# conditions. This smoke harness gives a fast feedback loop on those.

set -e

DEVICE="${DEVICE:-iPhone 17 Pro}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/sim-coldlaunch}"
BUNDLE_ID="com.Helpr"
SCHEME="App"
WORKSPACE="ios/App/App.xcworkspace"
APP_NAME="Louisiana Helpr.app"
DERIVED_DATA="ios/App/build/sim"
APP_PATH="$(pwd)/${DERIVED_DATA}/Build/Products/Debug-iphonesimulator/${APP_NAME}"

echo "▸ Output dir: $OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# ── 1. Build the web bundle + Capacitor sync ──────────────────────────
echo "▸ npm run build:ios"
npm run build:ios >/dev/null

echo "▸ npx cap sync ios"
npx cap sync ios >/dev/null

# ── 2. Build the iOS .app for simulator (no signing) ──────────────────
echo "▸ xcodebuild -destination 'platform=iOS Simulator,name=$DEVICE'"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "platform=iOS Simulator,name=$DEVICE" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=YES \
  build \
  >/dev/null

# ── 3. Boot simulator if not already booted ───────────────────────────
echo "▸ Booting $DEVICE simulator (no-op if already booted)"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
sleep 2

# ── 4. Uninstall + reinstall to mimic fresh-install state ─────────────
echo "▸ Uninstall + install $BUNDLE_ID"
xcrun simctl uninstall booted "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install booted "$APP_PATH"

# ── 5. Launch + screenshot the cold-launch sequence ───────────────────
echo "▸ Launching $BUNDLE_ID"
xcrun simctl launch booted "$BUNDLE_ID" >/dev/null

# Screenshots at meaningful points in the cold-launch sequence:
# 500ms  — splash should still be visible OR first-paint of route
# 1500ms — initial route element rendered (Suspense fallback or content)
# 3000ms — auth-ready should have resolved; final route decision made
# 5000ms — steady state; any data-fetch errors visible
for delay_ms in 500 1500 3000 5000; do
  sec=$(awk "BEGIN { print $delay_ms / 1000 }")
  sleep "$sec"
  out="$OUTPUT_DIR/t-${delay_ms}ms.png"
  xcrun simctl io booted screenshot "$out" >/dev/null 2>&1
  echo "  ▸ $out"
done

echo ""
echo "✓ Done. Review screenshots in $OUTPUT_DIR/"
echo "  Expected on fresh install:"
echo "  - t-500ms.png  → splash OR Suspense fallback"
echo "  - t-1500ms.png → /browse (guest dashboard) or /login if regression"
echo "  - t-3000ms.png → /browse should be settled"
echo "  - t-5000ms.png → steady state on /browse"
