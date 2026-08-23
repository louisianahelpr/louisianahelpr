# Platform conventions — Apple HIG, applied to BOTH surfaces

Louisiana Helpr ships one React codebase to a browser and to an iOS/Android
Capacitor WebView. These conventions were derived from Apple's Human Interface
Guidelines during the iOS audit of 2026-08-22 and adopted as the house rules for
the whole product, web included — a user who moves between the site and the app
should not be able to tell that two different rulebooks were used.

Every rule below was measured against the codebase, not assumed. Where a rule is
already satisfied it says so, because "already done" is the most useful thing to
know before starting a sweep.

## 1. Capitalisation

- **Title Case** for screen titles and popup titles: `PageHeader`, `AuthShell`,
  `ProfileTabHeader`, `AdminSectionHeader`, `DialogHero`, `SheetHero`,
  `AlertDialogHero`, `BrandConfirmDialog`.
- **Title Case** for button labels. (HIG title-cases controls, not just titles.)
- **Sentence case** for everything else: body copy, `EmptyState` / `ErrorState`
  descriptions, policy and legal text, alert *messages*, placeholder text,
  helper/hint text, toasts.

Conversion rules — each of these was got wrong on the first pass and caught in
preview, so apply them deliberately:

- Preserve HTML entities. `&amp;` is not a word and must not become `&Amp;`.
- Capitalise BOTH halves of a hyphenated compound: `Two-Step`, `Re-Upload`,
  `No-Show`.
- Capitalise phrasal-verb particles so pairs match: `Turn On` / `Turn Off`,
  `Log Out`, `Sign In`. (`on`/`off`/`out`/`up` are NOT lowercase prepositions here.)
- Leave any token that already carries an internal capital or a digit:
  `Helpr`, `CSV`, `W-9`, `ID`, `QR`, `Stripe`, `1099-K`, `LLC`.
- Lowercase mid-title: a, an, and, as, at, but, by, for, in, nor, of, or, per,
  so, the, to, via, vs, with, from, into, over, than, that, if — unless the word
  is first or last.

Status: screen + popup titles were converted (67 strings, 60 files, commit
`f2309699`). **Button labels are NOT done** — that sweep is still open.

## 2. Accessibility

- **Dynamic Type.** The OS text-size setting must drive the app. A manual
  in-app toggle is not a substitute — most users never find it.
- **Reduce Transparency.** `@media (prefers-reduced-transparency: reduce)` must
  drop `backdrop-filter` to an opaque fill. There are 31 blur surfaces in
  `index.css` and currently ZERO reduced-transparency rules.
- **Reduce Motion.** Already honoured — 29 rules in `index.css`. Keep it that way
  when adding animation.
- **Tap targets ≥44×44pt.** Known offender: calendar day cells are `h-9 w-9`
  (36px) in `components/ui/calendar.tsx`.
- **Colour is never the only signal.** Pair it with an icon, label or shape.
- Icon-only controls carry the FULL action on `aria-label`; if a visible word is
  added beside the icon, mark that word `aria-hidden` so a screen reader does
  not hear "Sign in with Apple, Apple".

## 3. Layout

- One `<h1>` per page. When a shared shell renders the page title, a section
  heading inside the page is an `<h2>`.
- Cards anchor to the TOP of the viewport, not the vertical centre. Centring a
  short card leaves a third of a phone screen blank above it.
- Detail/preview overlays present as a **bottom sheet on phone** widths and a
  centred dialog at `sm+`. Restore every centring override at the breakpoint so
  desktop is untouched.
- Beware `space-y-*`: `.space-y-N > * ~ *` outranks `.-mt-N` on specificity, so a
  negative top margin inside a `space-y` container is silently discarded. Shrink
  the child from the inside (`-my-*` on the element) instead.
- A 44pt touch box must OVERLAP its neighbouring gaps, not stack on top of them,
  or the control ends up floating in the largest whitespace on the screen.

## 4. Controls and colour

- **One strong brand-green control per screen.** Secondary/escape links must not
  reuse `--bark` next to a primary button built from it — they read as a second
  primary. Use muted `--olivewood` at medium weight.
- Destructive actions are red (`--destructive`). Already satisfied.
- Colours come from tokens via `style={{ color: "hsl(var(--token))" }}`, never
  Tailwind colour utilities.
- Form fields within one card are styled alike — do not give one a placeholder
  and its neighbour none. All three auth screens are label-only.

## 5. iOS-specific (applies to the phone-width web surface too)

- Input font-size ≥16px is the usual advice to prevent WKWebView focus-zoom.
  Verified 2026-08-22: at 15px with the current viewport meta the app does NOT
  zoom, and the viewport deliberately omits `user-scalable=no` so pinch-zoom
  stays available. Do not add `maximum-scale=1` to "fix" a problem that is not
  occurring — it would break zoom for low-vision users.
- Safe-area insets via `env(safe-area-inset-*)`; a bottom-flush sheet needs
  `calc(... + env(safe-area-inset-bottom))` for home-indicator clearance.
- Sign in with Apple renders FIRST and at equal prominence to other providers.

## 6. Already satisfied — do not "fix" these

Privacy purpose strings (all present and phrased as *why*), in-app account
deletion (App Store 5.1.1(v)), Sign in with Apple, destructive red,
`prefers-reduced-motion`, safe-area insets, swipe-back, haptics, splash screen,
pinch-zoom, no input auto-zoom.
