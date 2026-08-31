#!/bin/bash
# ios-state-probe — drive the REAL WKWebView build and capture the classes of
# defect Chromium physically cannot render.
#
# WHY THIS EXISTS
# ---------------
# Three of the owner's findings were WKWebView-only:
#
#   - the app-lock bug, which existed only because iOS jetsams the web view's
#     content process and the app is restored from a snapshot;
#   - the keyboard covering a sheet's primary action, which needs a software
#     keyboard and WKWebView's visual-viewport behaviour;
#   - the safe-area bugs, which need a real notch and home indicator.
#
# Chromium has no content-process jetsam, no software keyboard, and reports
# zero safe-area insets. No amount of Playwright fixes that. This script covers
# what the SIMULATOR genuinely can, and `docs/audit/IOS_COVERAGE.md` states
# plainly what still needs hardware. Nothing here is claimed beyond what it
# does.
#
# WHAT IT ACTUALLY DOES
#   - navigates by custom-scheme deep link (`helpr:///<route>`), which works
#     headlessly with NO Accessibility permission and no UI scripting;
#   - captures a PNG per route via `simctl io screenshot`;
#   - sweeps light/dark, Dynamic Type sizes, Increase Contrast and both
#     orientations, all through `simctl ui` / `simctl status_bar`;
#   - pins the status bar to 9:41 / full battery so frames diff cleanly;
#   - restores every setting it changed on exit, including on Ctrl-C.
#
# WHAT IT CANNOT DO — see docs/audit/IOS_COVERAGE.md for the full list
#   - force an app STATE. The shipped bundle has no mock layer: it loads the
#     real Supabase with whatever the signed-in account happens to hold. The
#     195-cell state matrix is therefore Chromium-only today.
#   - trigger a content-process jetsam. There is no simctl verb for it and the
#     simulator does not apply the memory limits that cause it on device.
#   - tap anything. Deep links navigate; they do not press buttons. Driving
#     controls needs XCUITest, Maestro, or Accessibility permission for UI
#     scripting — none of which is wired here.
#
# USAGE
#   scripts/ios-state-probe.sh                       # default routes, light+dark
#   DEVICE_ID=<udid> scripts/ios-state-probe.sh
#   ROUTES="/my-posts /my-jobs" scripts/ios-state-probe.sh
#   OUT=/tmp/ios-probe SWEEP=full scripts/ios-state-probe.sh   # + type sizes,
#                                                              #   contrast,
#                                                              #   landscape
#
# It does NOT build or install. Use scripts/sim-smoke.sh for that; this script
# assumes com.Helpr is already installed on the target simulator, and says so
# rather than silently building a stale bundle underneath you.

set -uo pipefail

BUNDLE_ID="${BUNDLE_ID:-com.Helpr}"
OUT="${OUT:-/tmp/lh-ios-probe}"
SWEEP="${SWEEP:-basic}"
SETTLE="${SETTLE:-2.5}"

# --- device -----------------------------------------------------------------
DEVICE_ID="${DEVICE_ID:-}"
if [ -z "$DEVICE_ID" ]; then
  DEVICE_ID=$(xcrun simctl list devices booted -j 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
for rt in d.values():
    for dev in rt:
        if dev.get("state")=="Booted":
            print(dev["udid"]); raise SystemExit' 2>/dev/null)
fi
if [ -z "$DEVICE_ID" ]; then
  echo "ios-state-probe: no booted simulator." >&2
  echo "  xcrun simctl boot 'iPhone 17 Pro' && open -a Simulator" >&2
  exit 2
fi

# Capture first, THEN match. `… | grep -q` closes the pipe as soon as it hits,
# simctl dies on SIGPIPE, and with `pipefail` the whole pipeline reports failure
# — so the app looked absent on a device where it was installed, and the script
# refused to run for the wrong reason.
INSTALLED_APPS="$(xcrun simctl listapps "$DEVICE_ID" 2>/dev/null)"
case "$INSTALLED_APPS" in
  *"\"$BUNDLE_ID\""*) ;;
  *)
  echo "ios-state-probe: $BUNDLE_ID is not installed on $DEVICE_ID." >&2
  echo "  Build and install it first:  scripts/sim-smoke.sh" >&2
  echo "  Refusing to continue — a probe of an absent app would report nothing" >&2
  echo "  and that would read the same as a clean run." >&2
    exit 2
    ;;
esac

mkdir -p "$OUT"
echo "▸ device  $DEVICE_ID"
echo "▸ bundle  $BUNDLE_ID"
echo "▸ out     $OUT"
echo "▸ sweep   $SWEEP"

# --- restore whatever we change, on every exit path -------------------------
cleanup() {
  xcrun simctl ui "$DEVICE_ID" appearance light >/dev/null 2>&1
  xcrun simctl ui "$DEVICE_ID" content_size medium >/dev/null 2>&1
  xcrun simctl ui "$DEVICE_ID" increase_contrast disabled >/dev/null 2>&1
  xcrun simctl status_bar "$DEVICE_ID" clear >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

# A pinned status bar makes two runs diffable. Without it the clock alone
# changes every frame and every screenshot looks like a regression.
xcrun simctl status_bar "$DEVICE_ID" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 >/dev/null 2>&1

# --- routes -----------------------------------------------------------------
# Deep links, not taps. `helpr:///<path>` carries an empty host by construction,
# which is exactly the shape `normalizeDeepLinkUrl` (src/lib/deepLinkRoute.ts)
# expects from the native-return bounce, so it routes without a Universal Link
# and without the app being in any particular prior state.
DEFAULT_ROUTES="/dashboard /my-posts /my-jobs /messages /post-job /profile /profile?tab=earnings /browse /jobs /support"
ROUTES="${ROUTES:-$DEFAULT_ROUTES}"

shoot() { # shoot <name>
  sleep "$SETTLE"
  xcrun simctl io "$DEVICE_ID" screenshot "$OUT/$1.png" >/dev/null 2>&1 \
    && echo "  ▸ $OUT/$1.png" \
    || echo "  ! screenshot failed for $1" >&2
}

visit() { # visit <route>
  xcrun simctl openurl "$DEVICE_ID" "helpr://$1" >/dev/null 2>&1
}

slug() { echo "$1" | sed 's|^/||; s|[/?=&]|-|g; s|^$|root|'; }

echo "▸ launching"
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1
sleep 4

# --- pass 1: every route, light then dark -----------------------------------
for appearance in light dark; do
  xcrun simctl ui "$DEVICE_ID" appearance "$appearance" >/dev/null 2>&1
  for route in $ROUTES; do
    visit "$route"
    shoot "$(slug "$route")__$appearance"
  done
done
xcrun simctl ui "$DEVICE_ID" appearance light >/dev/null 2>&1

if [ "$SWEEP" != "full" ]; then
  echo ""
  echo "✓ ${OUT}"
  echo "  Basic sweep only. SWEEP=full adds Dynamic Type, Increase Contrast and landscape."
  echo "  Review these with docs/audit/STATE_REVIEW_PROMPT.md — they are the ONLY frames"
  echo "  in this repo rendered by WKWebView rather than Chromium."
  exit 0
fi

# --- pass 2: Dynamic Type ---------------------------------------------------
# The app is a web view, so Dynamic Type reaches it only through
# -webkit-text-size-adjust / the system font metrics. If these frames are
# pixel-identical to `medium`, that IS the finding: the OS text-size setting
# does nothing, and no Chromium harness can tell you that.
for size in extra-small large accessibility-extra-extra-extra-large; do
  xcrun simctl ui "$DEVICE_ID" content_size "$size" >/dev/null 2>&1
  for route in /dashboard /my-posts /profile; do
    visit "$route"
    shoot "$(slug "$route")__type-$size"
  done
done
xcrun simctl ui "$DEVICE_ID" content_size medium >/dev/null 2>&1

# --- pass 3: Increase Contrast ---------------------------------------------
xcrun simctl ui "$DEVICE_ID" increase_contrast enabled >/dev/null 2>&1
for route in /dashboard /my-posts; do
  visit "$route"
  shoot "$(slug "$route")__increase-contrast"
done
xcrun simctl ui "$DEVICE_ID" increase_contrast disabled >/dev/null 2>&1

# --- pass 4: landscape ------------------------------------------------------
# The one orientation where env(safe-area-inset-left/right) become non-zero.
# Chromium reports zero for all four insets in every orientation, so a
# landscape notch cutting into content is invisible to the Playwright sweep.
#
# Rotation has no simctl verb; it is a Simulator.app menu action, so it goes
# through AppleScript. If UI scripting is not permitted this fails cleanly and
# says so rather than producing portrait frames labelled "landscape" — which
# would be a fabricated pass.
if osascript -e 'tell application "Simulator" to activate' >/dev/null 2>&1 &&
   osascript -e 'tell application "System Events" to tell process "Simulator" to keystroke (ASCII character 29) using command down' >/dev/null 2>&1; then
  sleep 2
  for route in /dashboard /my-posts; do
    visit "$route"
    shoot "$(slug "$route")__landscape"
  done
  osascript -e 'tell application "System Events" to tell process "Simulator" to keystroke (ASCII character 28) using command down' >/dev/null 2>&1
  sleep 1
else
  echo "  ! landscape pass SKIPPED — rotating the Simulator needs Accessibility" >&2
  echo "    permission for UI scripting (System Settings > Privacy & Security >" >&2
  echo "    Accessibility). Landscape safe-area insets are therefore UNVERIFIED." >&2
  echo "landscape: UNVERIFIED — Simulator rotation requires Accessibility permission" \
    > "$OUT/UNVERIFIED-landscape.txt"
fi

echo ""
echo "✓ ${OUT}"
echo ""
echo "Still UNVERIFIED after this run, and not fixable by adding passes here:"
echo "  - content-process jetsam / app-lock re-arm  (no simctl verb; device only)"
echo "  - software keyboard covering a sheet        (needs UI automation to focus a field)"
echo "  - any state the signed-in account does not already hold"
echo "See docs/audit/IOS_COVERAGE.md."
