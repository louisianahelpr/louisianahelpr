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

### Titles are one line — never two (owner, 2026-08-24)

A screen title on the phone/app surface never wraps: every header-row
`<h1>`/`<h2>` carries `truncate` (+ `min-w-0` in a flex row) so a long title
ellipsizes instead of stacking. This covers `PageHeader`, `AuthShell`,
`ProfileTabHeader`, `ScreenHeaderRow`, `DocumentPageCards`, and the hand-rolled
public-doc title rows. Centered full-screen lockout states
(`DashboardBlockedScreen`) are the one exemption — truncating a lockout
message mid-word is worse than a wrap; keep those titles short instead.

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

## 7. Ownership split (revised 2026-08-25)

Two sessions were editing the same files and reverting each other. The split
below replaces the original app-surface/webpage-surface one, which stopped
working the moment both lanes started auditing the SAME authed screens.

**Why it was revised.** On 2026-08-25 the two lanes independently found and
fixed `/wrapped`'s missing desktop rail AND the Membership "Once" disclosure —
duplicate work that then collided in a rebase. One lane also nearly committed a
repair for a typecheck break the other had already pushed, and two migrations
were stamped `20260825183000` within minutes of each other, which failed
`db push` on `schema_migrations_pkey` and BLOCKED EVERY QUEUED MIGRATION until
one was re-timestamped. Splitting by *surface* does not prevent any of that,
because "the webpage" and "the app" are the same React tree.

**Split by ROUTE, not by surface.** Each lane owns whole routes end to end —
the page, its sub-components, and its copy:

- **Lane A — the money loop:** `/post-job`, `/my-posts`, `/my-jobs`,
  `/messages`, `/payment-success`, job cards, escrow/dispute/payout surfaces.
- **Lane B — identity & account:** `/profile` + every `?tab=`, `/user/:id`,
  auth screens, `/subscription`, membership.
- **Lane C — public & operator:** landing, Footer, `/help`, `/legal`,
  `/support`, `/jobs`, `/browse`, and all of `/admin`.

Rules that make the split hold:

1. **Shared primitives (`components/ui/*`) are nobody's by default.** A change
   there is raised, not made unilaterally — unchanged from the original split,
   and the one rule that was never the problem.
2. **Migrations carry the lane letter in the filename** (`..._a_<name>.sql`)
   and each lane uses a distinct minute offset (A :00, B :15, C :30). A
   colliding timestamp is not a merge conflict — git takes both files happily
   and the failure only appears at deploy, where it stalls the whole queue.
3. **Announce before touching another lane's route.** Finding a bug outside
   your lane is normal; fixing it silently is what produces the duplicate.
4. **Re-pull immediately before every commit.** Non-negotiable when three
   lanes push to `main` directly.

### Settled questions — do not reopen without reading the history

- **Social auth buttons: STACKED, full width, mark + word.** Four passes have
  flipped this; the reasoning is in `SocialAuthButtons.tsx`.
- **Business signup is not offered on the consumer create-account form.**
  It stays reachable at `/signup?type=business` and from Sign in.
- **Auth screens are label-only** — no field placeholders (the MFA code field's
  format hint is the one exception).

## 8. What a headless browser cannot verify

Added 2026-08-26 after a fix was reported as shipped without ever being seen.

The audit sweeps drive headless Chromium. It renders the app's own DOM
faithfully, so layout, overflow, colour and copy are all provable there. It
does **not** render browser-drawn (user-agent) widgets, and
`getComputedStyle(el, "::-webkit-…")` silently returns the *host element's*
styles when the pseudo-element is not exposed — so a check against it reads as
a clean pass while proving nothing.

Concretely, these are NOT verifiable headlessly and need a real browser (or a
headed screenshot) before anyone claims they are fixed:

- `::-webkit-search-cancel-button` — the native "clear" X inside
  `input[type="search"]`. Every search field in this app also renders its own
  X, so the two stack up; `index.css` suppresses the native one. Headless draws
  neither, so before/after look identical.
- Native `<select>`, date/time and file pickers.
- Scrollbar chrome, autofill background, spellcheck underlines.
- `:autofill`, and anything a password manager injects.

Rule: if the thing you changed is drawn by the browser rather than by the app,
say "shipped, unverified — needs a real browser" rather than "verified". A
stylesheet assertion (the rule is present and matches) is worth stating, but it
is evidence the rule *loaded*, not that the pixel changed.

## 6. Popups — the ONE shell (added 2026-08-31)

The owner has asked for this five times in one week, in these words: "the
dialogs all look different they need to be 1 shared component" · "make sure all
these pop up dialogs are consistent" · "all these need to share same shell" ·
"all pop up dialogs need the same design and shell" · "need to share the same
sheet and design". Every rule below exists because a real popup broke it. If a
new popup disagrees with this section, the popup is wrong.

**Primitives.** Three, and only three: `Dialog` (`ui/dialog.tsx`),
`AlertDialog` (`ui/alert-dialog.tsx`, and `BrandConfirmDialog` on top of it) and
`Sheet` (`ui/sheet.tsx`). All three paint `.glass-modal`, use the same
`hsla(38,22%,22%,0.08)` backdrop, the same `p-4 sm:p-5` padding ramp, and the
same 28px radius. Never build a popup on a raw `DialogPrimitive.Content`.

**Measure.** `w-[calc(100vw-2rem)]` on phones (16px inset each side) and
`sm:w-full sm:max-w-lg` — a fixed 512px card — from `sm` up. NOT `sm:w-auto`:
shrink-to-fit made the same app render dialogs at 285/297/384/435/494/512px and
made multi-step dialogs resize between their own steps. Content controls
HEIGHT; the measure is shared. No call site overrides the width. A genuinely
different measure (a media viewer, the deliberately-wide job detail) is listed
in `STRUCTURAL_EXCEPTIONS` in `ui/dialogShell.test.ts` with its reason.

**Header.** `DialogHero` / `AlertDialogHero` / `SheetHero` — one title line,
left-aligned, with the bare ✕ on the same row at `right-3 top-3`. No eyebrow,
no subtitle, no icon row, no per-call-site `className`. **A popup does not get
an icon in its header**: if icons are ever wanted they become one documented
slot in the shared Hero, used by every popup or by none.

**Body.** Description copy is `font-serif italic text-ds-12 leading-relaxed` at
`hsl(var(--olivewood) / 0.8)` — what `BrandConfirmDialog` renders. Consequences
that are a list are a `<ul>`; a single reversible fact is a sentence; the sienna
`callout` is reserved for the one thing the user must not miss.

**"Pick one reason" is a single column of full-width rows** — never a grid of
chips. Variable-length prose labels in a grid cannot be tidy: they wrap to
different heights, their icons land at different y, and an odd count orphans the
last tile. Rows give every label the same left edge, room to wrap, and no
orphan at any count. Selected row = `btn-grad-primary` with parchment text.
(Grids are still fine for fixed short tokens — a day count, a dollar amount.)

**Footer.** The shared `DialogFooter` / `AlertDialogFooter` / `SheetFooter` —
all three are the same row and no call site overrides the arrangement. Stacked
full-width with the primary on TOP on a phone; right-aligned inline from `sm`.
Buttons are the shared `<Button>` at its default 56px height.

- Primary action → `variant="primary"` (glossy `btn-grad-primary`).
- Secondary sitting beside a primary → `variant="ghost"` (bare text).
- A footer whose ONLY control is the dismiss → `variant="outline"`, a real
  button. A bare ghost label alone in a row reads as text floating at the
  bottom of the card, which the owner objected to by name.

**Primary colour maps to consequence, and there are exactly TWO.**
`variant="primary"` (olive, glossy) for everything that proceeds;
`variant="destructive"` (`--destructive` red) when the action removes, bans,
restricts, penalises or takes away protection AND the person doing it cannot
undo it from that screen. Nothing else. Before this pass the app had seven
fills for "the button that commits the action" — glossy bark, flat bark, red,
burnt sienna, olivewood, amber, and a 16% sienna tint — with no rule mapping
colour to consequence.

**Glossy, never flat.** A primary or a selected control is
`.btn-grad-primary`. An inline `style` that sets `backgroundImage: "none"` is
deleting the shared gradient by hand; it is always a defect.

**Dismissal.** Every popup closes three ways: the ✕, Escape, and (dialogs and
sheets) the scrim. A controlled `open` with no `onOpenChange` makes the ✕ and
Escape silently inert — if a popup is a deliberate hard gate, pass
`closeDisabled` so the ✕ renders dimmed rather than dead.

**Proof.** `src/components/ui/dialogShell.test.ts` pins the shared measure, the
absence of per-call-site escape hatches on all three Heroes, the one footer
row, and backdrop parity between the two overlay primitives. Rendered proof is
measured, not eyeballed: card width, inset, per-button height, label clipping,
document overflow, focus-in/focus-return and Escape, at 320/375/768/1440.
