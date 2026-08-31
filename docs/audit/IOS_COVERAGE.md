# iOS coverage — what the simulator can reach, and what needs hardware

Companion to `docs/audit/STATE_MATRIX.md`. That document covers the state
space Chromium can render. This one is about the states it **cannot**, and is
deliberately written to be disappointing where the truth is disappointing.

Harness: `scripts/ios-state-probe.sh`.
Build/install harness (pre-existing): `scripts/sim-smoke.sh`.

---

## Why a separate document exists at all

Three of the defects the owner found by hand were invisible to every browser
harness in this repository, and would have stayed invisible however many
Playwright specs were added:

| Defect | Why Chromium cannot show it |
| --- | --- |
| App lock re-arming wrongly after backgrounding | iOS **jetsams the WKWebView content process** under memory pressure and restores the app from a snapshot. Chromium has no content-process jetsam and no snapshot restore. There is no browser equivalent of the event that causes the bug. |
| The software keyboard covering a sheet's primary action | Chromium has no software keyboard, and does not resize the visual viewport the way WKWebView does when one appears. Emulating it proves the emulation. |
| Safe-area bugs (notch, home indicator, landscape insets) | Chromium reports `env(safe-area-inset-*)` as `0` in every orientation. Setting them by hand in CSS tests the CSS, not the app. |

Any report that says "all screens verified" on the strength of a Playwright run
is, for these three classes, saying nothing at all.

---

## What the simulator genuinely covers — verified 2026-08-31

Each row was actually executed against the booted `LH-Audit-iPhone17Pro-261`
simulator with `com.Helpr` (build 5906) installed, not read out of a manual.

| Capability | Mechanism | Verified | Notes |
| --- | --- | --- | --- |
| Navigate to any in-app route | `xcrun simctl openurl <udid> "helpr:///my-posts"` | **yes** — landed on My Posts with real rows | Needs **no** Accessibility permission and no UI scripting. `helpr:///path` carries an empty host, which is the shape `normalizeDeepLinkUrl` (`src/lib/deepLinkRoute.ts`) expects from the native-return bounce. |
| Capture a frame | `xcrun simctl io <udid> screenshot` | **yes** | Full-resolution PNG, no window focus needed. |
| Light / dark | `xcrun simctl ui <udid> appearance dark` | **yes** — the app repainted dark | This is the OS appearance, so it exercises the real `prefers-color-scheme` path, not a localStorage override. |
| Deterministic status bar | `xcrun simctl status_bar <udid> override --time 9:41 …` | **yes** | Without it the clock changes every frame and every screenshot diffs. |
| Dynamic Type | `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large` | **yes — and it revealed a finding, below** | |
| Increase Contrast | `xcrun simctl ui <udid> increase_contrast enabled` | command accepted; **effect not yet reviewed** | Captured by `SWEEP=full`, not yet examined. |
| Cold-launch sequence | `xcrun simctl launch` + timed screenshots | **yes** (pre-existing `scripts/sim-smoke.sh`) | |
| Real safe-area insets, portrait | implicit — the frames are rendered by WKWebView on a notched device | **yes** | This is the only place in the repo where the insets are real. |

### A finding that only the simulator could produce

**Dynamic Type has no effect on the app's UI.** Frames captured at
`content_size medium` and at `accessibility-extra-extra-extra-large` are
laid out identically — same title size, same card heights, same number of
cards on screen. A user who has raised their system text size for
accessibility reasons gets the default size everywhere in Louisiana Helpr.

This is the expected default for a Capacitor app that does not opt in
(`-webkit-text-size-adjust` and font sizes in fixed `px` both suppress it), so
it is a design gap rather than a regression — but it is a gap no Chromium
sweep can see, no axe rule reports, and no previous audit has recorded.

Evidence: `/tmp/lh-ios-probe/*__type-*.png` from `SWEEP=full`, and the pair
captured while writing this (`content_size medium` vs
`accessibility-extra-extra-extra-large`, `/my-posts`, identical layout).
Status: **reported, not fixed** — the fix is a product decision, and this
agent does not own `src/`.

---

## What the simulator CANNOT reach

Stated plainly. None of these is worked around anywhere in this repo, and a
report claiming them covered is wrong.

### 1. Content-process jetsam — the app-lock bug's actual cause

There is no `simctl` verb that terminates a WKWebView content process, and the
simulator does not apply the per-process memory limits that cause it on device.
`simctl spawn … kill` reaches the app process, not the web content process, and
killing the app is a *different* lifecycle (cold launch, not snapshot restore),
so it does not reproduce the bug.

**Needs a physical device**, backgrounded with memory pressure applied by other
apps, or an Xcode-attached run using Safari Web Inspector to observe the
`pagehide`/reload cycle.

### 2. The software keyboard covering a sheet

The keyboard can be shown (`ConnectHardwareKeyboard` off, then focus a field),
but focusing a field inside the app requires *tapping* it, and this harness
cannot tap — see 4. So the keyboard class is reachable in principle and
unreachable with what is wired today.

**Needs** either XCUITest / Maestro, or Accessibility permission for UI
scripting, or a physical device and a person.

### 3. Landscape safe-area insets

Rotation is a Simulator.app menu action, not a `simctl` verb. The `SWEEP=full`
pass attempts it through AppleScript and, when Accessibility permission is not
granted, **skips it and writes `UNVERIFIED-landscape.txt`** rather than
capturing portrait frames under a landscape name. Landscape is where
`env(safe-area-inset-left/right)` stop being zero, so this is a real gap.

### 4. Tapping anything

Deep links navigate; they do not press buttons. Every `interaction` cell in the
state matrix — 13 dialogs, the job-detail apply step — is therefore **Chromium
only**. The dialogs that carry the most risk (cancel, dispute, decline, boost)
have never been opened inside WKWebView by any harness.

**Needs** XCUITest, Maestro, or Accessibility permission plus a UI-scripting
driver.

### 5. Any state the signed-in account does not already hold

This is the largest gap, and the reason the 195-cell state matrix is a
Chromium artifact.

The shipped bundle has **no mock layer**. `capacitor.config.ts` deliberately
ships with no `server.url`, so the web view loads `dist/` and talks to the real
Supabase. `page.route()` is a Playwright/CDP mechanism and does not exist
inside WKWebView. So on the simulator you see whatever the account has — which
on 2026-08-31 was three open jobs. `pending_approval`, `disputed`,
`revision_requested`, a claimed-not-verified arrival, a four-day-past-due job:
none of them existed on that account, and none was captured.

Three ways to close it, none of them wired today, in increasing order of cost:

1. **Seed a staging account.** Write the 195 cells' job rows into the staging
   Supabase against a dedicated test account, then walk the routes by deep
   link. Highest fidelity — real RLS, real RPCs, real WKWebView — and the only
   option that also proves the backend. Cost: a seeding script plus a staging
   account that has to be kept in the states the matrix names.
2. **A fixture-mode build.** `CAP_DEV_URL` already exists (dev only, stripped
   from production). Point a simulator build at a local server that serves the
   app with a fixture shim installed, and the same `stateMatrix.ts` cells drive
   WKWebView. Cost: a shim that must never reach a production bundle, which is
   exactly the kind of thing that eventually does.
3. **Nothing** — accept that the state matrix is browser-only, and use the
   simulator solely for the four native classes above. This is where the repo
   stands today, and this document exists so that is a decision rather than an
   accident.

### 6. Real-device-only, full stop

- Push notification delivery and the tap-through deep link
- Face ID / Touch ID (the simulator's enrolled-biometric fake is not the OS
  flow a user sees)
- Camera capture (the simulator has no camera)
- Real GPS drift and the arrival geofence that depends on it — the
  claimed-vs-verified distinction the state matrix cares most about is
  *decided by the server* from a real coordinate
- Apple Pay / Wallet
- Thermal and low-power-mode behaviour
- Anything about App Store distribution: entitlements, Universal Links from
  outside the app, TestFlight update flow

---

## Honest summary

Of the 195 state cells:

| | Cells | Where they can be seen |
| --- | ---: | --- |
| Reachable in Chromium with mocks | 176 (`auto`) + 13 (`interaction`) | `state-sweep.spec.ts` |
| Reachable on the simulator today | 0 as *states* — only whatever the signed-in account holds | `ios-state-probe.sh` |
| Not reachable anywhere in this repo | 4 declared `native` cells + 2 `unreachable` | named in the manifest with reasons |

The simulator's contribution is not state coverage. It is the only place the
app is rendered by the engine it actually ships on, so it is where the
appearance path, the safe areas, Dynamic Type and the cold launch are real. It
should be run for those, and it should not be cited as coverage of anything
else.
