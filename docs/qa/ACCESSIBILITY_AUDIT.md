# Accessibility audit

This document is split in two, because the two halves have different owners:

1. **Automated — CI owns it.** Runs on every UI-touching PR and push to main.
   Nobody hand-checks these; a regression fails the build. See below for
   exactly what that covers **and what it does not**.
2. **Device-only — a human with an iPhone owns it.** VoiceOver, Dynamic Type,
   Reduce Motion and Color Filters cannot be driven from a headless browser.
   This half is short on purpose: it is only the things a machine genuinely
   cannot do.

**Nothing in the manual half is ticked until someone actually performs it on a
real device.** An unticked box is the honest state, not an oversight — do not
tick one to make the page look finished.

---

## 1. Automated — covered by `.github/workflows/a11y-axe.yml`

The workflow runs `e2e/happy-path/visual-audit-sweep.spec.ts`, which scans
every screen with **axe-core 4.13** (`@axe-core/playwright`) using the tag set
`wcag2a` + `wcag2aa` + `wcag21a` + `wcag21aa` — **69 of axe's 105 rules**. Its
`zz gate` test fails the run on *any* violation in that set, on any screen
that failed to render at all, and — since 2026-09-02 — on any colour-contrast
result that measures below AA or that nothing can decide. That last pair is not
a refinement. axe files a colour-contrast result under `incomplete`, not
`violations`, whenever it cannot resolve the backdrop, and this app's page
canvas is a gradient, so *every* contrast result went there and the gate never
read it: `/` reported 0 violations and 25 incomplete contrast nodes on the
built bundle. `e2e/happy-path/contrastResolve.ts` now decides them from the
painted pixels. It runs at **five variants**: `phone-light`, `phone-dark`
(375×812 dark), `small-light` (320×640), `desktop-light` (1440×900),
`desktop-dark` (1440×900 dark). Dark mode matters: the worst single defect of
the last full audit — 35 screens — existed only there; `desktop-dark` exists
because until it was added the matrix varied theme at one width and width at
one theme, leaving dark mode above phone width swept by nothing.

`.github/workflows/ui-sweep.yml` runs the same axe scan over the **empty-state**
version of every screen on each push (phone-light), plus weekly seeded and
error-state sweeps. Evidence for a red run is uploaded as
`/tmp/ui-review/a11y-report.json` (per-screen violations with axe's own
measured contrast ratios) paired with the screenshot of each screen.

### What the automated job DOES cover

- **Contrast (WCAG 1.4.3 AA)** — `color-contrast`, on real composited colors,
  in **both themes**. This replaces the whole "Contrast pass" that used to be a
  manual checklist here: gold-warm callouts on parchment, burnt sienna on
  cream, bark gradient chat bubbles, disabled bark buttons, the sienna unread
  pip. If any of those drop below 4.5:1, CI is red with axe's measured ratio.
- **Names and labels** — `label`, `button-name`, `link-name`, `input-button-name`,
  `image-alt`, `input-image-alt`, `svg-img-alt`, `object-alt`, `area-alt`,
  `role-img-alt`, `summary-name`, `select-name`, `aria-*-name` for every widget
  role. An unlabelled icon button or an alt-less avatar fails.
- **ARIA correctness** — `aria-valid-attr`, `aria-valid-attr-value`,
  `aria-allowed-attr`, `aria-required-attr/children/parent`, `aria-roles`,
  `aria-hidden-focus`, `aria-prohibited-attr`, `nested-interactive`,
  `duplicate-id-aria`.
- **Structure primitives** — `list`, `listitem`, `definition-list`, `dlitem`,
  `td-has-header`, `th-has-data-cells`, `table-fake-caption`, `p-as-heading`
  (a styled paragraph masquerading as a heading), `bypass` (skip link /
  landmark bypass mechanism exists).
- **Document-level** — `document-title`, `html-has-lang`, `html-lang-valid`,
  `meta-viewport` (zoom not disabled), `meta-refresh`, `frame-title`.
- **Motion/media hazards** — `blink`, `marquee`, `no-autoplay-audio`,
  `css-orientation-lock`, `avoid-inline-spacing`.
- **Rendering** — every screen must actually render at all four variants; a
  screen that throws fails the gate rather than passing as "no violations".

### What it does NOT cover — do not assume these are checked

- **Touch-target size (44×44).** axe's `target-size` rule is tagged
  `wcag22aa`, which is **not** in the enabled tag set, so nothing measures tap
  targets today. This is a one-line change in the spec
  (`.withTags([… , "wcag22aa"])`) and worth doing; until then it stays a manual
  item below.
- **Heading order and landmarks.** `heading-order`, `region`,
  `landmark-one-main`, `page-has-heading-one` and `empty-heading` are all
  tagged `best-practice` in axe, not WCAG, so they are **not** enabled either.
  Same one-line fix (`"best-practice"`), same status: manual until then.
- **Focus order and keyboard traps** — `focus-order-semantics` and `tabindex`
  are `best-practice`; the *sequence* of focus, and whether a modal traps it
  correctly, is not machine-checkable anyway.
- **Anything a screen reader says.** axe checks that an accessible name
  *exists*; it cannot tell you the name is wrong, misleading, or reads a
  fabricated trust claim. That is the VoiceOver pass.
- **Dynamic Type, Reduce Motion, Color Filters** — OS-level settings; the
  browser sweep runs at default text size with animations on.
- **The native WKWebView surface.** The sweep runs headless Chromium. iOS
  rendering, VoiceOver's iOS behaviour, and Capacitor plugin surfaces are not
  in it.
- **Live regions, timing, and announcement of async state** (toasts, "sending",
  arrival updates) — static-snapshot scanning cannot see them.

---

## 2. Device-only checklist — a real iPhone, performed by a human

Everything below needs hardware. Do it in one sitting; it takes about an hour.

### VoiceOver golden flows
Settings → Accessibility → VoiceOver → On. Walk each flow end to end and
listen — the question is always "is what it says correct and sufficient?", not
"does it say something".

- [ ] **Onboarding** — form labels read with role + required state; "Continue"
      reads as dimmed when prerequisites are missing; password show/hide
      announces its state; step indicator reads "Step 2 of 3".
- [ ] **Dashboard** — HelprMark reads as a link home; job cards read title +
      budget + button hint; filter pills announce their state; decorative
      frosted-circle icons are NOT announced as separate tappable items.
- [ ] **Apply flow** — JobDetailDialog takes focus on its title; queue-position
      strip reads as a sentence; Apply reads "Apply, earn $X, button"; lightbox
      arrows and close are reachable by swipe.
- [ ] **Chat** — own bubbles announce as sent, others as received-from-name;
      read receipts have a "Read"/"Delivered" label; quick-reply chips read
      their full action.
- [ ] **Profile** — avatar alt matches the name; tier badges read inline with
      the name; verified ribbon announces; completion meter reads the
      percentage and the missing item.
- [ ] **Focus order** — tab/swipe order matches visual order on each of the
      above; every modal traps focus and returns it to the opener on close.

### Dynamic Type at maximum
Settings → Accessibility → Display & Text Size → Larger Text → max.

- [ ] Greeting card doesn't truncate the name; clamp scales.
- [ ] Job card title wraps to 2 lines with the payout chip still visible.
- [ ] PostJob category chips wrap rather than scrolling off-screen.
- [ ] Modal dialogs scroll internally — Cancel/Confirm stay reachable.
- [ ] Bottom nav labels don't overflow into the dock FAB.

### Reduce Motion
Settings → Accessibility → Motion → Reduce Motion → On.

- [ ] Toast slide-in disabled or shortened.
- [ ] AnimatedCounter shows a static value (no count-up).
- [ ] Pull-to-refresh works without the rotation flourish.
- [ ] Modal zoom-in degrades to a fade.
- [ ] Confetti on first job complete does not fire (or fires once, static).

### Touch targets (44×44pt, Apple HIG)
Manual until `wcag22aa` is enabled in the sweep (see above).

- [ ] Bottom nav tab tap area ≥ 44 (source says `min-h-[48px]` — confirm as
      rendered, not as written).
- [ ] Filter pill row buttons ≥ 44 including padding.
- [ ] Chat composer send button ≥ 44.
- [ ] Notification panel dismiss X — historically too small; verify after the
      safe-area fix.

### Color vision
Settings → Accessibility → Display & Text Size → Color Filters → Deuteranopia.

- [ ] Job status pills (Open / Awarded / Done / Cancelled) still
      distinguishable without relying on hue.
- [ ] Star rating sienna fill vs olivewood empty stays differentiated.
- [ ] Pro/Elite halo rings (sienna vs gold) remain distinct.

### Heading order and landmarks
Manual until `best-practice` rules are enabled in the sweep (see above).

- [ ] No skipped heading levels on Dashboard, Browse, Profile, Post a Job.
- [ ] Each page has exactly one `<main>` and a meaningful `<h1>`.

## Known carve-outs
- Boosted-job pulse still pulses under Reduce Motion — accepted per current
  design (ambient signal, not content motion).
- Map density buckets rely on color saturation; not compliant for color-only
  differentiation, accepted because the count is also in the popup.

## Sign off

The automated half needs no signature — read the CI result. Sign only for the
device-only pass, and only for what you actually performed.

| | |
|---|---|
| Device + iOS version | ____________ |
| App build (CFBundleVersion) | ____________ |
| Performed by | ____________ |
| Date | ____________ |
| Sections completed | ____________ |
| Sections skipped, and why | ____________ |
| Issues filed (ids) | ____________ |
