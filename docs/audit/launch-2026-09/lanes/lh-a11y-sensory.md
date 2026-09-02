# lh-a11y-sensory — launch audit lane report

## Scope covered
Contrast/colorblind safety, semantic labels, touch targets, Dynamic Type at
max, Reduce Motion wiring, keyboard/switch/voice-control semantics, haptic
intentionality. Read `?tab=accessibility` (AccessibilityTab.tsx) and its
wiring. Cross-referenced the seeded `a11y-axe.yml` CI gate (§6b) before
sweeping — it runs axe wcag2a/2aa/21a/21aa across ~186 screens x 4 variants
(phone-light, phone-dark, small-light, desktop-light) on every push and PR,
confirmed `active` and green on the last 8 runs (`gh run list`). That gate
already covers most missing-label / contrast / landmark defect classes, so
this lane concentrated on what axe structurally cannot see: Dynamic Type at
max, Reduce Motion wiring, WebKit-only rendering, and haptic behavior.

## Verified working (with evidence)
- **Dynamic Type shrink bug (the documented `-apple-system-body` 13px/WebKit
  trap) is FIXED, not re-filed.** Live A/B in real Playwright WebKit vs
  Chromium against the dev server (`scratch-dyntype.mjs`, since removed):
  `apple-system-body` resolves to `13px` in WebKit / `16px` in Chromium as
  expected, but `--user-text-scale` reads `1` in BOTH — `measureDynamicTypeScale()`
  (`src/lib/accessibility.ts:111`) now floors with `Math.max(px / IOS_DEFAULT_BODY_PX, 1)`,
  so the probe can only scale UP, never down. Confirms the fix documented in
  CLAUDE.md/PROTOCOL.md is live in code, not just claimed.
- **Reduce Motion is genuinely wired, not just declared.** Live Playwright
  check (Chromium `reducedMotion: 'reduce'` context) against the running app:
  every element's computed `animationDuration`/`transitionDuration` collapsed
  to `1e-05s` (0.01ms) under the preference, vs real durations (0.15s–1s) with
  no preference set. Source: `src/index.css` ~line 2502, a `*, ::before, ::after`
  universal-selector catch-all with `!important` that clamps every animation/
  transition, so it also covers `.animate-ds-page-in` (the per-page entrance
  animation applied via `AppPage.tsx`) even though that specific class has no
  individual reduced-motion override — the catch-all is the actual mechanism,
  confirmed live, not assumed from its presence in source. Verified this rule
  survives the production build (`dist/assets/index-*.css` contains the
  `animation-duration:.01ms!important` rule) so it isn't a dev-server-only
  artifact (the CLAUDE.md-documented `backdrop-filter` minifier trap does not
  apply here, since this isn't a duplicate-property collapse).
- **The `prefers-reduced-transparency` backdrop-filter fix (CLAUDE.md-documented
  incident) is fixed and stayed fixed.** `grep -c "backdrop-filter:none"
  dist/assets/index-*.css` → 1 occurrence (not 0, not >1) — consistent with a
  correctly surviving single declaration, not a re-introduced duplicate-property
  collapse.
- **Haptics are debounced correctly at the one place continuous-firing risk is
  real.** `usePullToRefresh.ts:66/119-160` — the threshold-crossing haptic
  fires exactly once per pull via an explicit guard ref, and the base
  `safe()` wrapper (`src/lib/haptics.ts:55-62`) suppresses passive `"impact"`
  haptics under Reduce Motion while still firing `"result"` haptics
  (success/warning/error) since those convey status, not motion — the
  documented split is correct and consistent across `hapticImpactForce` /
  `hapticLight/Medium/Heavy` / `hapticSuccess/Warning/Error`.
- **The aria-hidden Radix `hideOthers()` trap (role=dialog + aria-modal=true +
  aria-hidden=true, documented in CLAUDE.md) is already guarded on
  `PhotoLightbox.tsx`** via a MutationObserver that un-hides itself
  (`src/components/dashboard/PhotoLightbox.tsx:126-148`) — verified by reading
  the guard and its own repro note ("opened from JobDetailDialog").
- **Status is never color-alone where checked.** `JobCard.tsx:454/469`
  ("Urgent" badge) and Sonner's toast defaults (`src/components/ui/sonner.tsx`
  — no `icons` override found, so Sonner's built-in check/x/triangle icons
  ship per toast type alongside the text) both pair an icon/text label with
  color, not color alone. `AdminHelperTiers.tsx:40` is the one raw-Tailwind
  (non-token) status color in the app, but it labels a text word ("Active"),
  not color-only — flagged to no one further, it's a cohesion/token-usage
  item outside this lane, not an a11y defect.

## Defects found and fixed (AS-001, MEDIUM)
**MessageAttachment.tsx's photo-attachment lightbox lacked the aria-hidden
self-heal that its structural twin `PhotoLightbox.tsx` already has**, despite
identical architecture (`createPortal` to `<body>`, `role="dialog"
aria-modal="true"`, `fixed inset-0`). MessageAttachment.tsx's own comment at
the portal (`pointerEvents: "auto"`) already documents that the "lightbox
open while another Radix modal is active" scenario was previously reproduced
on the sibling PhotoLightbox viewer inside JobDetailDialog — i.e. this exact
class of bug already happened once in this codebase, and only the
pointer-events half of the known fix had been ported to this file, not the
aria-hidden half. Net effect when triggered: a photo viewer visible on screen
but `aria-hidden="true"`, invisible to VoiceOver/screen readers.
- Evidence: `src/components/dashboard/PhotoLightbox.tsx:126-148` (has the
  guard) vs `src/components/MessageAttachment.tsx:279-325` (had the identical
  portal shape, lacked the guard) — filed as AS-001.
- Fix: ported the identical MutationObserver un-hide pattern into
  `MessageAttachment.tsx` (new `lightboxRef`, effect mirrors PhotoLightbox's
  verbatim). `node scripts/parsecheck.mjs src/components/MessageAttachment.tsx`
  → clean. Isolated to this one file, no shared/orchestrator-owned files
  touched. Marked `fixed` on the bus (AS-001).

## Assessed and NOT changed — deliberate owner tradeoff, documented as such
**JobDetailDialog's Save/Share/Report corner icons render at 32x32px
(`compact` prop on `IconActionButton`/`ShareJobButton`), below the app's own
44x44 HIG/WCAG-2.5.5 floor** that the shared close X (also in this same row)
explicitly enforces. This is real and reproducible by reading
`IconActionButton.tsx:50-59/89-92` and `ShareJobButton.tsx:258-264` — both
carry an inline `minHeight/minWidth: "32px"` specifically to beat the global
`button { min-height/min-width: 44px }` floor in `index.css`. But this is not
an oversight: the comment records it as an explicit, already-litigated owner
decision via a pop-up question (2026-08-30: shrink these specifically
"because it makes a large gap above title"), and the `compactClose` prop that
would have let the shared X itself shrink below 44px was deliberately removed
2026-09-02 for being under the floor — i.e. the 44px floor is being actively
protected everywhere EXCEPT these three corner icons, on purpose. Filing this
as a fresh "bug" and fixing it would re-litigate a decision the owner already
made with the actual tradeoff (title-row height) stated. Recording it here
per the audit standard's "assess-then-justify" guidance rather than as a
worklist item — flagging for awareness: Save/Share/Report on the single most-
viewed dialog in the app are ~30% smaller than HIG recommends, which is a
real (if deliberate) miss-tap risk for low-dexterity or tremor users on a
frequently-used control.
- No fix applied; no bus finding filed (a documented, owner-decided tradeoff
  is not a fresh defect). If the owner wants this revisited, the concrete
  ask is: keep the X at 44x44, grow the three corner icons back toward it
  (36-40px is a reasonable middle ground that keeps the "gap above title"
  win while narrowing the miss-tap gap), or add extra invisible hit-area
  padding the way `.tap-44`/`.link-standard` already do elsewhere in this
  codebase for exactly this shape of problem (visual size vs. tap size).

## UNVERIFIED — could not reach, and why
- **Actual max Dynamic Type rendering (text wrap/clip/overflow) on real
  iOS/WKWebView.** CLAUDE.md and this lane's own brief are explicit that
  macOS (and therefore any desktop WebKit, including Playwright's WebKit
  build) has no Dynamic Type at all — `-apple-system-body` only reports real
  accessibility text sizes on an actual iOS device/simulator. This lane
  verified the SCALE COMPUTATION is now safe (never shrinks) via WebKit A/B,
  but did not screenshot actual max-Dynamic-Type layout on an iOS Simulator —
  that requires `xcrun simctl`, which this lane did not request/receive setup
  approval for within its effort budget. This is the honest gap: the
  arithmetic is proven correct, the rendered layout at max size is not
  independently screenshotted.
- **Switch Control / VoiceOver rotor walkthrough on-device.** Assessed via
  code (aria-labels present on the icon buttons sampled, `role="switch"` +
  `aria-checked` correctly used on the AccessibilityTab senior-mode toggle,
  `role="group"` + `aria-label` on the color-mode segmented control) but not
  driven with an actual VoiceOver session — same iOS-device gap as above.
- **Full colorblind-safety sweep beyond the samples checked.** Time-boxed;
  spot-checked Urgent badge, toast icons, and the one raw-Tailwind status
  color, but did not sweep every badge/status pill in the app (Verified
  Helpr ribbon, credential tiers, dispute status, admin queue rows). The
  seeded axe CI gate (wcag2aa) catches straightforward contrast failures on
  all ~186 screens already, which narrows what a manual sweep would add to
  color-alone signaling specifically (axe cannot detect "meaning conveyed by
  hue alone" — only contrast ratio) — this remains a real gap in coverage,
  named rather than silently skipped.
- **`?tab=accessibility` toggles' downstream effect across ALL 23 profile
  tabs / whole app**, beyond reading `useDarkMode`/senior-mode wiring in
  source. Confirmed the toggle correctly drives `theme` state and
  `role="switch" aria-checked`; did not click through all 23 tabs under
  senior-mode to visually confirm every one honors the larger-text/bigger-
  target promise (that promise is implemented via a global `senior-mode`
  class + CSS, per `src/index.css:3113` and the `.001ms` reduced-motion
  override seen in the dist build — the class is real and does something
  app-wide — but a full per-tab visual confirmation was not completed).

## Out-of-scope conclusions
None beyond what PROTOCOL.md §6 already states for the whole fleet — nothing
in this lane's checklist maps to the "not applicable to this stack" table.

## Coverage manifest (abbreviated — see findings above for the detailed trail)
| Area | Status |
|---|---|
| Dynamic Type scale computation (WebKit vs Chromium) | checked-clean (already fixed, verified live) |
| Dynamic Type max-size on-device rendering | UNVERIFIED — no iOS sim in this pass |
| Reduce Motion global wiring | checked-clean (verified live, dev + dist build) |
| `prefers-reduced-transparency` backdrop-filter regression | checked-clean (dist build check) |
| Touch targets — shared dialog close X | checked-clean (44x44, asserted+measured per code comments) |
| Touch targets — JobDetailDialog corner icons | issue-found, deliberate tradeoff, not fixed (documented above) |
| aria-hidden Radix overlay trap — PhotoLightbox | checked-clean (guard present) |
| aria-hidden Radix overlay trap — MessageAttachment | issue-found, FIXED (AS-001) |
| Haptics debounce/rate-limit | checked-clean |
| Color-alone status signaling (sampled) | checked-clean on samples; full sweep UNVERIFIED |
| `?tab=accessibility` toggle wiring (source-level) | checked-clean |
| `?tab=accessibility` toggle effect across all tabs (visual) | UNVERIFIED |
| VoiceOver/Switch Control on-device | UNVERIFIED |

## What I fixed
- `src/components/MessageAttachment.tsx` — ported the aria-hidden self-heal
  MutationObserver from `PhotoLightbox.tsx` into the photo-attachment
  lightbox portal (AS-001, MEDIUM, fixed and marked on the bus).

That is the one fix this lane shipped. Everything else in scope was either
already correct and verified live (Dynamic Type scale, Reduce Motion, the
transparency regression, haptics, PhotoLightbox's own guard), a deliberate
owner-decided tradeoff not re-litigated (JobDetailDialog corner icons), or an
honestly-named gap requiring an iOS Simulator this pass didn't reach
(Dynamic Type max-size rendering, on-device VoiceOver/Switch Control, full
colorblind sweep).
