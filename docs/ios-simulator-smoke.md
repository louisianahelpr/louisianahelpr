# iOS Simulator cold-launch smoke

A pre-publish sanity check that runs the actual iOS app in iOS Simulator and captures the cold-launch sequence. Catches the class of bugs that `e2e/visual-audit/responsive.spec.ts` + `e2e/happy-path/visual-audit-sweep.spec.ts` cannot — anything involving:

- iOS WebKit (the existing Playwright tests run Chromium)
- Capacitor plugins (`@capacitor/app` `appUrlOpen`, push notifications, status bar, keyboard)
- Cold-launch race conditions between auth, routing, and the supabase session restore
- Safe-area, viewport-fit, and other native-only CSS

## Why this exists

On 2026-05-27 a fresh-install TestFlight build hit a redirect bug (guest dashboard → `/login`) that none of the automated tests caught. The root cause was suspected to be the `appUrlOpen` handler in `src/lib/nativePush.ts`, which is *only* invoked at runtime by native Capacitor — there's no equivalent in Chromium. Without a way to actually run the iOS bundle, the fix loop is: ship to TestFlight → user finds bug → trace → guess fix → ship again. This smoke harness collapses that.

## What it does

`scripts/sim-smoke.sh`:

1. Builds the Vite web bundle with `VITE_CAPACITOR_BUILD=1` (same flags as a TestFlight build).
2. `cap sync`s the web bundle into `ios/App/App/public/`.
3. Builds an unsigned `.app` for the iPhone Simulator destination (`xcodebuild` with `CODE_SIGNING_ALLOWED=NO`).
4. Boots the iOS Simulator (defaults to `iPhone 17 Pro`).
5. Uninstalls any previous build (to mimic fresh-install state).
6. Installs + launches the new build.
7. Captures screenshots at 500 ms, 1500 ms, 3 s, and 5 s post-launch.

Total runtime: ~90 s for an incremental build, ~3 min cold.

## How to run

```bash
scripts/sim-smoke.sh
```

Override device:
```bash
DEVICE="iPhone SE" scripts/sim-smoke.sh
```

Override output dir:
```bash
OUTPUT_DIR=./artifacts scripts/sim-smoke.sh
```

Screenshots land in `/tmp/sim-coldlaunch/` by default. Open them to see the boot sequence visually.

## What to look for in the screenshots

| Time | Expected on fresh-install (signed out) | Expected on returning user (session restored) |
|---|---|---|
| **t = 500 ms** | LaunchScreen storyboard OR React's `RouteSuspenseFallback` (branded H + skeleton) | Same |
| **t = 1500 ms** | `/browse` — guest dashboard with "Log in" / "Sign up" top right | Skeleton of `/dashboard` |
| **t = 3000 ms** | `/browse` settled — jobs list (or "Something went wrong" if simulator has no internet) | `/dashboard` with jobs |
| **t = 5000 ms** | `/browse` steady state | `/dashboard` steady state |

**Regression signals:**
- A screenshot showing `/login` (email + password form) on a fresh install = `appUrlOpen` host filter broke
- A screenshot showing `/browse` then later a screenshot showing `/login` = ProtectedRoute or some other redirect firing post-render
- A screenshot showing a blank white screen for >3 s = JS bundle failed to load or the React app crashed (check Xcode console)

## Limitations

- **Cannot reproduce TestFlight-install-only bugs.** The Simulator doesn't simulate the "first launch after TestFlight install" referrer URL flow. Real-device install remains the final smoke.
- **No automated assertions.** Phase 2 of this audit is wiring Maestro (`brew install --cask maestro`) to assert "URL is /browse at t=3s" automatically. For now, a human eyeballs the screenshots.
- **No internet by default.** The Simulator inherits the Mac's network. If you're offline or behind a captive portal, the Supabase fetches will fail and you'll see "Something went wrong" cards — that's environmental, not a real bug.

## Phase 2 — Maestro automation (not done yet)

Once Maestro CLI is wired:

```yaml
# .maestro/cold-launch-guest.yaml
appId: com.Helpr
---
- launchApp:
    clearState: true
- assertVisible: "Browse Tasks"   # /browse loaded
- assertNotVisible: "Sign In"     # /login did NOT take over
- assertNotVisible: "Email"        # nor a sign-in form

# .maestro/cold-launch-authed.yaml
appId: com.Helpr
---
- launchApp:
    clearState: false   # preserve seeded session
- assertVisible: "Good morning"   # /dashboard greeting
```

These would let `scripts/sim-smoke.sh` exit non-zero on regression, enabling a future CI hook (once we have a Mac runner that isn't burning GitHub-billed macos-15 minutes — see [`docs/xcode-cloud-setup.md`](./xcode-cloud-setup.md)).

## Related

- [`docs/xcode-cloud-setup.md`](./xcode-cloud-setup.md) — Apple's free iOS CI; complements this smoke for CI-side runs
- `.github/workflows/ios-beta.yml` — TestFlight pipeline (cron disabled in PR #347 to stop the macOS billing drain)
- `fastlane/Fastfile` `:beta` lane — the local TestFlight ship path
