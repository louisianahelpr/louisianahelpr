# lh-visual-critic — the taste lane

**Question this lane answers:** does the whole app read as though one person with
impeccable product sense built every screen?

**Verdict: mostly yes, and closer than the last pass — but not on the controls that
repeat.** The page-level craft is high and consistent: 36 of 45 routes share one
title treatment, both themes swap cleanly, there is zero horizontal overflow
anywhere, the empty states are written and designed rather than left blank, and
two backlogs that previous passes tracked as open are now closed at `b170609a`.
What has not
converged is the *small repeated control*. The app currently has **four visual
languages for "pick one of N"**, **three different shared close buttons**, and
**two shapes of browser-tab title**. Each is invisible on any one screen and
obvious the moment two screens sit side by side, which is exactly the shape of
complaint the owner has raised six times.

## How this was measured

- Built `origin/main` (`b170609a`) in an isolated worktree (`~/.lh-audit/visual`)
  and served **`dist/` via `vite preview`** — never the dev server, and never
  production, because the app changed materially today and prod is yesterday's
  bundle.
- **188 cells**: 45 routes/tabs × {375×812, 1440×900} × {light, dark}, authed
  (real minted session) plus a guest pass. 191 PNGs.
- Every claim below is a **computed style or a measured rect**, not a class name
  and not an eyeball. Where an eyeball reading and a measurement disagreed, the
  measurement won and the eyeball claim was dropped (two of them were).
- Scope derived, not hand-listed: the 23 Profile tabs come from `TAB_TITLES` in
  `src/pages/profile/types.ts`.

Artifacts: `~/lh-audit-shots/visual-critic-2026-09-02/` — `probe.json` (188 cells),
`gloss/gloss.json` (Chromium ⇄ WebKit A/B), `dialogs/dialogs.json`,
`overlays/overlays.json`, plus the PNG corpus.

## 1. Verified working

| Claim | Artifact |
|---|---|
| **WD-001 is genuinely fixed, in both engines.** The same probe run in Playwright chromium and webkit against the built bundle returned byte-identical blur counts and kinds on 6 surfaces (4 / 6 / 12 / 4 / 6 / 29 blurred elements; identical filter sets). Statically, every `backdrop-filter` in `dist/assets/index-Czv4vQrW.css` has a `-webkit-` twin at 1:1 counts, and the reduced-transparency killswitch sits inside an `@supports` block the minifier cannot collapse. | VC-008 · `gloss/gloss.json` |
| **Dialogs are correctly centred.** The `Log Out?` confirmation measures `position: fixed`, `translate: -50% -50%`, centre (187.5, 406) in a 375×812 viewport — dead centre on both axes — with `glass-modal` computing `backdrop-filter: blur(40px)`. | `dialogs/dialogs.json` |
| **Zero horizontal overflow, all 188 cells.** No cell had `scrollWidth > clientWidth`; no element measured wider than the viewport at either width, in either theme. The desktop rail inset is applied once (`#root` padding-left `0px`; the rail is a right-side `position: fixed` nav) with no dead gutter. | `probe.json` |
| **The `DialogHero` backlog is closed at `b170609a`, and so is the `SheetHero` one.** 48 of 49 files rendering a `DialogContent` use `DialogHero`; the one exception is `PhotoLightbox`, a photo viewer with no title. All 9 product sheets use `SheetHero` (the 10th `SheetContent` is the shadcn `sidebar` primitive). The audit standard still records this as "~7 of 15 sheets" — **that figure is stale; re-verified today** at `b170609a`. | `~/lh-audit-shots/visual-critic-2026-09-02/hero-adoption.txt` |
| **The 7 tabs converted from routes today wear the canonical tab shell.** All of `PetProfiles`, `WorkRecord`, `HomeHistory`, `StrSettings`, `AutoTip`, `HelprWrapped`, `HelperAnalytics` open with `<div className="space-y-4">` + `<ProfileTabHeader>`, and all 23 tabs measure an identical **22.4px Bodoni Moda 700 `rgb(35,35,26)`** h1. HelperAnalytics in particular — the one that lost its own width wrapper — sits in the same column as its siblings with no gutter and no overflow at 375 or 1440. | `probe.json`, `375x812-light/profile-tab-*.png` |
| **Both themes swap completely.** A single `bodyBg` across all 47 routes per theme (`rgb(240,242,244)` light, `rgb(20,22,26)` dark) and no unswapped custom hex found in any capture. Dark renders are legible and card surfaces keep their own ground distinct from the canvas. | `probe.json`, `375x812-dark/*` |
| **The gloss trap is not currently firing.** Zero elements anywhere carry `btn-grad-primary` in their class list while computing `background-image: none` — checked across all 188 cells by reading the computed value, which is the only test that can detect it. | `probe.json` |
| **Empty states are a strength.** `/my-jobs` empty renders a glyph tile, a serif headline, a subline that names the real counts ("but you have 3 in Waiting and 2 in Done") and a CTA that moves you somewhere useful. `/messages` desktop and the 404 are the same standard. | `375x812-light/my-jobs.png`, `nonexistent-404-guest.png` |
| **The destructive-confirm tone is correctly reserved.** `BrandConfirmDialog` maps tone → shared `Button` variant, and Log Out (reversible) correctly gets the default gloss rather than the destructive red. Not a hierarchy defect. | `ui/BrandConfirmDialog.tsx:96-98` |

## 2. Defects — 10 filed

| id | sev | one line |
|---|---|---|
| VC-001 | MEDIUM | 7 of 23 Profile tabs paint a browser-tab title in a different shape from their 16 siblings; one (`analytics`) has no product name at all |
| VC-002 | MEDIUM | `?tab=legal` h1 says "Legal & Policies" while its tab says "Legal"; `?tab=wrapped` has three names for one feature |
| VC-003 | MEDIUM | Earnings ships two selection languages 140px apart, and the off-system one is painted the page-canvas colour |
| VC-006 | MEDIUM | The AlertDialog close X is 32×44 — the twin of the Dialog X that was raised to 44×44 today, on the primitive behind ~33 confirmations |
| VC-009 | MEDIUM | One of the six desktop nav-rail items is a different typeface, size, slant and weight from the other five |
| VC-010 | MEDIUM | Four visual languages, three corner radii and three label scales for "pick one of N" |
| VC-004 | LOW | The home screen has no visible title and three names ("Browse Jobs" / "Home" / `/dashboard`) |
| VC-005 | LOW | `/my-jobs` stacks three glossy CTAs where its siblings show one |
| VC-007 | LOW | The one close X every popup shares is three different controls |
| VC-008 | LOW | *(positive result — WD-001 verified clean in both engines; `gloss/chromium-filtersheet.png` vs `gloss/webkit-filtersheet.png`. Filed so the verifier can re-check it)* |

### The one that matters most: VC-010

Four answers to the identical question, all reachable inside the Profile tab set:

| control | selected state | radius | label |
|---|---|---|---|
| Accessibility → Color mode | `rgba(95,101,67,0.12)` tint, no gradient | 0px | 16px / 400 |
| Earnings → Money·History·Insights·Payouts | `rgb(240,242,244)` — **the page canvas colour** | 8px | 15px / 600 |
| Earnings → Lifetime·This Week·… | radial-gradient olive gloss | 9999px | 14px / 600 |
| Analytics → 90 days·12 months·2 years | radial-gradient olive gloss | 9999px | 14px / 600 |
| *(plus)* Messages → All·Unread·Active | underline on the active item, no fill | — | — |

Two of these sit on one screen, one scroll apart. The canonical treatment exists
and two controls use it; the other two invent their own. `EarningsViewSwitcher.tsx:70`
also sets its active state with an inline `background:` **shorthand**, which is the
second of the two documented gloss killers — so adding `btn-grad-primary` there
would silently do nothing.

### The one the lead specifically asked about: VC-006 / VC-007

Dialogs *were* re-centred correctly today, and the Dialog X *was* raised to 44×44.
Its two twins were not:

| | box | glyph | focus | press |
|---|---|---|---|---|
| `DialogContent` (dialog.tsx:350) | **44×44** (explicit style) | 18 alone / 16 beside icons | `focus-visible:` | `btn-press` |
| `AlertDialogContent` (alert-dialog.tsx:191) | **32×44** (`w-8`) | 18 | `focus-visible:` | `btn-press` |
| `SheetCloseButton` (sheet.tsx:147) | **40×40** (`h-10 w-10`) | **20** | `focus:` | `active:scale-[0.94]` |

`dialog.tsx`'s own comment deleted a `compactClose` prop the same day *because*
"32×32 is below the 44×44 HIG floor", and names "the old `right-3 w-8` geometry"
as the control it A/B'd against — that geometry is still shipping in the twin
file. Separately, `SheetCloseButton` still uses plain `focus:`, so mouse-clicking
a sheet's X draws the focus ring the owner asked to be removed on 2026-08-31
while mouse-clicking a dialog's X does not.

### The five hand-rolled overlays — the lead's standing question

Read at source and, where reachable, measured. Short answer: **four of five read
as part of the app; the two photo viewers are the odd ones, and deliberately so.**

- **`ApplicantsPanel`** — renders `<AppPage>` inside its portal, so it inherits
  the shared title/back-button chrome. Correctly `role="region"`, not `dialog`,
  because it is a full-screen push with no backdrop and no focus trap. Reads as
  the app.
- **`AppLockGate` / `ForceUpdateGate`** — both `bg-premium-page fixed inset-0`,
  z-100 and z-110 with the layering documented. Full-bleed brand ground. Reads as
  the app.
- **`PhotoLightbox` / `MessageAttachment`'s lightbox** — twins of each other,
  both a scrim + a 40×40 `rounded-full` white-glass X with an inline
  `backdrop-filter`. That is a *third* close treatment, but the deviation is
  reasoned in `sheet.tsx`'s own comment: these Xs sit on arbitrary user photos
  where a bare glyph can vanish into a matching-colour region. I would keep the
  disc and raise the box to 44×44 for the same HIG reason as VC-006.

## 3. UNVERIFIED — could not reach, and why

- **6 of 188 cells timed out** in the harness (nav + probe + screenshot all
  exceeded their limits on the same cell): `/browse` 375-light, `/settings`
  1440-light, `?tab=schedule` 1440-light, `/my-jobs` 1440-dark,
  `?tab=credentials` 1440-dark, `?tab=home_history` 1440-dark (each carries
  `navTimeout: true` in `probe.json`; each has a good capture elsewhere, e.g.
  `375x812-dark/my-jobs.png`). The failing set is
  scattered across routes and viewport/theme combos rather than clustered on one
  route, which is the signature of CPU contention with the other lanes rather
  than an app hang — but I did not prove that, so these are unverified, not clean.
  Each has a successful capture in at least one other viewport/theme.
- **Real `DialogContent` chrome was measured only indirectly.** I measured a live
  `AlertDialogContent` (`Log Out?`) and a live sheet, but never got a plain
  `DialogContent` open: the safe openers I could find either did not exist under
  the labels I guessed or opened no popup. `DialogContent`'s box is an explicit
  inline style so the 44×44 figure is literal, but the *rendered* dialog X was not
  measured. VC-007's Dialog column is source-exact, not runtime-measured.
- **The iOS simulator / WKWebView surface was not driven.** I A/B'd Playwright
  WebKit against Chromium, which covers the engine-difference class, but not the
  Capacitor shell (safe-area insets, keyboard avoidance, scroll jank on
  blur-heavy screens). Out of budget, and `lh-native-bridge` owns the shell.
- **Error states were not forced.** I captured loading and empty states but did
  not drive a network failure or a permission-denied render. `lh-state-matrix`
  owns that matrix; I did not want to duplicate its mutation-restore work.
- **The guest feed's tail.** `/browse` at 1440 ends after 10 cards with ~240px of
  blank panel and no footer, no pagination and no signup CTA on the one screen
  whose whole job is conversion. I am flagging this as a product observation
  rather than filing it, because whether `/browse` should carry the marketing
  footer is a routing decision that belongs to whoever owns `App.tsx`.

## 4. Explicit out-of-scope conclusions (PROTOCOL §6)

Nothing in §6's "do not hunt for these" list is a visual-cohesion question, so
none of it was audited here. Two adjacent notes worth recording:

- **The yellow wash in the iOS simulator is an iOS 26.4 runtime compositor bug,
  not a CSS defect.** Not filed, per the standing rule — and not encountered,
  since this lane ran in Playwright rather than the simulator.
- **The marketing hero h1** measures 116px Bodoni Moda **weight 900** at 1440,
  against weight 700 for every other Bodoni title in the app. That is a real
  outlier by measurement, but the hero H1 is explicitly locked by the owner, so it
  is recorded here and **deliberately not filed**.

## 5. What I fixed

**Nothing in `src/`.** This lane was dispatched as a judgment lane with the
explicit standing constraint "report, do not fix — never make unrequested visual
changes, never guess on colour or layout", and every finding above lands in
shared, orchestrator-only territory: `src/components/ui/dialog.tsx`,
`alert-dialog.tsx`, `sheet.tsx`, plus `DesktopSidebarNav.tsx`, `Profile.tsx` and
the seven converted page components. Concurrent lanes collide there. Every
finding is filed with a reproduction someone else can re-run.

One thing I did fix, outside `src/`: **the capture harness.** See below.

## 6. A harness defect that invalidates part of the existing corpus

`scripts/audit-capture.mjs`'s `mintSession()` fabricates the session's user as
`user: { id: TEST_USER_ID }`. supabase-js returns whatever is in `localStorage`
from `getSession()` without re-fetching, so `user.email_confirmed_at` is
`undefined`, `ProtectedRoute.tsx:281-283` fires its email-unconfirmed gate, and
`/account-pending` (finding the profile *is* approved) immediately re-navigates
to `/dashboard`. **Every non-`allowPending` protected route therefore screenshots
the dashboard and files that PNG under the other route's name.** Measured:
`/post-job` and `/gift-card` both landed on `/dashboard` with `bodyTextLen` 1016,
identical to `/dashboard`, on cold load, on reload and on in-app `pushState`.

This is not a product bug — verified read-only against prod
(`fncmgoasalhdgfwzhsqa`): `profiles.approval_status = 'approved'` and
`auth.users.email_confirmed_at = 2026-08-24T21:33:23Z`, and the same JWT read
through PostgREST under RLS agrees. **I nearly filed it as a launch blocker on
the core loop.** It is the exact mistake the protocol's lead-vs-fact rule exists
to prevent, arriving from the opposite direction: not a stale migration file, but
a stale instrument.

Fixed in my own harness by fetching `GET /auth/v1/user` with the minted access
token and asserting `email_confirmed_at` is present, so it cannot regress
silently. Relayed to `team-lead` for fan-out. **Any lane grading `/post-job` or
`/gift-card` from `~/lh-audit-shots` is grading the dashboard.**

## 7. Top things to look at next, in order

1. **VC-010 + VC-003 together.** One segmented-control primitive, one radius, one
   label scale, one selected treatment — the glossy pill that two of the four
   already use. Patching `EarningsViewSwitcher` alone still leaves three radii.
2. **VC-006.** Two lines in `alert-dialog.tsx:191` bring the confirm X to parity
   with the dialog X that was fixed today, on ~33 destructive confirmations.
3. **VC-001.** Delete the seven orphaned `usePageTitle` calls in the converted
   pages and let `TAB_TITLES` do the job the `Record<Tab, string>` guard was
   written to guarantee.
4. **VC-009.** One `<span>` in `DesktopSidebarNav.tsx:372`.
5. **VC-002.** Two strings. `LegalTab.tsx:323` vs `TAB_TITLES.legal`, and pick one
   name for Wrapped.

## 8. Evidence check

`npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-visual-critic.md`
reports 7 claims, 3 carrying an inline artifact. The 4 it flags are heuristic
misses rather than real gaps, and I am naming them rather than tuning the prose
around the checker: two are table rows whose artifact sits in the adjacent
`Artifact` column (the checker is line-based and does not read table cells) —
their evidence is `hero-adoption.txt` and `gloss/gloss.json`; the other two are
lines *inside* the UNVERIFIED section and the coverage manifest, which is exactly
where the checker's own advice ("move these to UNVERIFIED") would put them. Every
claim in §1 has a named artifact on disk.

## 8b. Coverage manifest

45 routes/tabs × 2 viewports × 2 themes = 188 cells attempted, **182 completed**,
6 unverified (listed in §3). 191 PNGs on disk.

**Authed (17):** `/dashboard` `/browse` `/my-jobs` `/my-posts` `/messages`
`/post-job` `/jobs` `/settings` `/help` `/legal` `/gift-card` `/saved-helpers`
`/earnings` `/schedule` `/availability` `/warnings` `/profile`

**Profile tabs (23, derived from `TAB_TITLES`):** profile · earnings · schedule ·
availability · payment · security · legal · reviews · referral · subscription ·
support · notifications · warnings · credentials · saved_helpers · accessibility ·
pets · work_record · home_history · str_settings · auto_tip · wrapped · analytics

**Guest (7):** `/` `/login` `/signup` `/forgot-password` `/legal` `/help` ·
404 catch-all

**Overlays driven:** Browse filter sheet (4 viewport×theme combos, plus Chromium
and WebKit), `Log Out?` confirmation. Read at source without being driven:
`AppLockGate`, `ForceUpdateGate`, `MessageAttachment`, `ApplicantsPanel`,
`PhotoLightbox`, `JobDetailDialog`, `PetForm`.

**Not driven, by choice:** anything that writes. `JobDetailDialog` calls
`record_job_view` on open (`jobDetailDialog/useJobDetailData.ts:103`), so job
cards were never opened; the only control this lane clicked was the Filters
button, verified client-only (no `supabase`/`rpc`/`mutate` call in
`FilterSheet.tsx`), and the Sign Out confirm, escaped immediately. No
account state was mutated, so no snapshot/restore was required.
