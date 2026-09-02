# lh-webkit-differ — WebKit vs Chromium A/B pass

Worktree: `~/.lh-audit/lh-webkit-differ` @ `origin/main` (ab2e4d15).
Tooling: Playwright `chromium` + `webkit` (webkit-2336, one-time 77MB
headless install), a purpose-built differ script
(`~/.lh-audit/lh-webkit-differ/webkit-diff.mjs`) that loads each route in
both engines against the same running server, diffs `getComputedStyle` on a
sampled element set (`html`, `body`, `h1`, `p`, `button`, `nav`, the first
`fixed`-positioned element, the first `glass`/`liquid-glass`/backdrop-filter
element) plus the design-system custom properties (`--user-text-scale`,
`--desktop-sidebar-w`), and reports `doc.scrollWidth`/`scrollHeight`,
element rects (>3px tolerance), and console/page errors. Values are
normalized before diffing (subpixel float noise rounded to 0.5px,
`font-family` quote-stripped) so only real divergence is reported.

Read-only throughout — never clicked/submitted/toggled anything; used a
minted magic-link session (same mechanism as `scripts/audit-capture.mjs`)
against the existing seeded test account
(`eli.test.helper@louisianahelpr.com`) for authed routes, no account
mutation.

## What I found

**WD-001 (HIGH, blocker)** — filed and handed to `team-lead` because the fix
lives in `src/index.css`, an orchestrator-only file. In the **production
build only** (`npm run build`, verified via `npx vite preview`), every
frosted-glass surface in the app (`.glass`, `.glass-nav`,
`.glass-nav.is-scrolled`, `.liquid-glass`, `.tracker-merged>.liquid-glass`,
`.glass-header`, `.glass-dock`, `.glass-modal`, `.glass-field`, the
`:has()` adornment override, `.skeleton-glass` — 11 rules,
`src/index.css:1290,1732,1751,1876,1929,1942,1965,1979,2006,2026,2343`)
renders with **zero backdrop blur for every Chromium-based visitor** — web
desktop Chrome/Edge and the **Android Capacitor WebView** — while WebKit/
Safari/iOS gets the correct blur. This is the mirror image of the
already-fixed reduce-transparency minifier bug documented in CLAUDE.md: that
fix special-cased one rule pair behind `@supports`; every other
`backdrop-filter`/`-webkit-backdrop-filter` pair in the file has no such
guard, so Vite's minifier collapses the pair and keeps only the
last-declared property (source order is unprefixed-then-`-webkit-`, so the
unprefixed one is dropped). Confirmed (re-run with `npx playwright` via
`node check-dist-glass.mjs`, out/check-dist-glass-output.txt) Chromium does
not apply blur from a bare `-webkit-backdrop-filter` with no unprefixed
twin — `getComputedStyle` reports the effective `backdrop-filter` as
`none`.
Dev server is unaffected (unminified — both properties survive), which is
why this needed a `dist/` check, not a dev-server one, to find.
Evidence: `out/dist-glass-chromium.png`, `out/dist-glass-webkit.png`
(screenshots), `out/check-dist-glass-output.txt` (computed-style values),
plus a rule-block scan of `dist/assets/index-*.css` confirming all 11
rules (raw grep/python3 output reproduced in the WD-001 bus entry).

## Verified working (no diff found)

- **`font: -apple-system-body` fix holds**, dev server and dist alike
  (evidence: `out/check-usertextscale-output.txt`): WebKit still resolves it
  to 13px (macOS system-body size, as documented), but `--user-text-scale`
  stays `1` in both engines — the 2026-09-01 fix is intact and did not
  regress.
- **The reduce-transparency `@supports` guard holds in the actual built
  bundle** (evidence: `out/reduce-transparency-grep.txt`, output of
  `grep -c "backdrop-filter:none" dist/assets/*.css` and a breakdown of the
  6 occurrences, see out/reduce-transparency-grep.txt, re-run via
  `grep -c backdrop-filter:none dist/assets/*.css`): the unprefixed
  `backdrop-filter:none!important` survives (not just the `-webkit-` half)
  — this is the ALREADY-fixed case working as designed, distinct from
  WD-001's un-guarded siblings (re-run: `npx playwright` not needed here,
  just `grep -c backdrop-filter:none dist/assets/*.css` — out/reduce-transparency-grep.txt).
- **`100dvh` (AppShell viewport lock)**: measured at 390×844 (`/messages`,
  authed) — WebKit reports `843.98px` vs Chromium's `844px` for the
  shell frame, a sub-pixel rounding difference with zero resulting overflow
  (`docScrollHeight === innerHeight` in both). No dvh-specific WebKit bug
  found.
- **Computed-style parity across 34 routes + 17 `/profile?tab=` variants**:
  zero non-noise diffs on `font-size`, `line-height`, `font-family`,
  `width`/`height`, `position`, `transform`, `backdrop-filter`,
  `display`/`flex-direction`/`gap`/`grid-template-columns`, `z-index`,
  and the two design-system custom properties, at 1440×900.
- One transient diff on `/profile?tab=earnings` (a `transform`/`opacity`
  mismatch on a `glass-el` selector) turned out to be **DOM churn, not an
  engine bug** — re-tested at 1500/3000/5000ms settle times in both engines
  and the selected element itself changed between reads as earnings cards
  loaded async; not reproducible as a stable cross-engine difference.
  Retracted before filing (see "Leads I disproved" below).

## Leads I disproved (do not re-file without new evidence)

- **`/profile?tab=earnings` glass-element `transform`/`opacity` diff** —
  looked real on a single quick pass (chromium: `transform: none`; webkit:
  `matrix(0.98,0,0,0.98,0,-8)` + `opacity:0`), but a slower 1500/3000/5000ms
  settle re-test showed the querySelector was landing on a *different*
  transient DOM element each read (an entrance-animating skeleton card being
  replaced by the loaded one) in each engine, not the same element rendering
  differently. Not a WebKit bug — a selector-stability artifact of async
  data loading. If this needs auditing properly, target a stable
  `data-testid`, not a loose class selector, and wait for network-idle on
  the earnings query specifically.
- **`/browse` bypasses `useSearchParamMirror`** — `DashboardGuest.tsx`
  (`/browse`) uses raw `useSearchParams` from react-router instead of the
  circuit-breaker hook that `Activity.tsx` (`/my-jobs`, `/my-posts`) and
  `useDashboardFilters.ts` already adopted, which is exactly the
  `useSearchParamMirror` audit CLAUDE.md tells this lane to check ("verify
  it is used everywhere search params are written", citing `/browse` by
  name as a historically-affected route). BUT: `/browse` only calls
  `setSearchParams` from **one** site (`closeDetailJob`, a single write on
  dialog close, not a filter-driven loop), so it cannot produce the
  ~25-100 replaceState burst in a 10s window that trips WebKit's throttle —
  the crash mechanism this hook exists to prevent. I could not reproduce a
  crash and am not filing this as WD — it's real code-shape drift (worth a
  `lh-copy-content`/`lh-silent-failure`-style cleanup note that `/browse`
  should adopt the shared hook for consistency) but not a live WebKit risk
  by the evidence bar. Flagging here so a future pass doesn't re-derive it
  as a false HIGH.

## Coverage manifest

**Guest/public routes (18)** — all checked-clean (zero diffs) at 1440×900,
dev server, both engines:
`/`, `/login`, `/signup`, `/signup-pending`, `/complete-profile`,
`/account-pending`, `/account-denied`, `/account-banned`,
`/forgot-password`, `/reset-password`, `/user/:id` (dummy uuid),
`/support`, `/legal`, `/jobs`, `/browse`, `/help`, `/wrapped` (redirects to
`/login?redirect=...` when unauthenticated — checked equally in both
engines), 404 catch-all.

**Authed routes (15)** — checked-clean at 1440×900, minted session
(evidence: `out/report-authed-authed.json`, `finalUrl` field per route in
both engines): `/dashboard`, `/profile`, `/my-jobs`, `/my-posts`,
`/messages` rendered their real screen; `/post-job`, `/payment-success`,
`/admin`, `/str-settings`, `/auto-tip`, `/gift-card`, `/analytics`,
`/home-history`, `/work-record`, `/pets` all redirected to `/dashboard`
for this seeded non-admin/non-elevated test account, identically in both
engines. Re-run via `npx playwright` with `node webkit-diff.mjs authed
--authed`, and see `out/report-authed-authed.json`'s per-route `finalUrl`
field — not a WebKit-specific finding, just means the underlying screen
itself was not A/B'd for this account.

**`/profile?tab=*` (17 of 23)** — checked-clean:
accessibility, availability, credentials, earnings, landing, legal,
notifications, payment, profile, referral, reviews, saved_helpers,
schedule, security, subscription, support, warnings.

**Production build** — `npm run build` + `vite preview`, `/login` and
`/dashboard` A/B'd; found WD-001 (above).

## UNVERIFIED — could not reach, and why

- **`/admin?view=*` (24 variants)** — the seeded test account
  (`eli.test.helper@…`) is not `is_admin`; `/admin` redirects to
  `/dashboard` in both engines. Elevating it would mutate shared account
  state, which under the protocol requires
  `snapshotAccountState()`/`restoreAccountState()` machinery this
  narrowly-scoped rendering pass didn't build. Deprioritized given the
  lane's mandate is engine-divergence, not admin-surface coverage
  (`lh-admin-moderation` owns that surface). If this needs auditing for
  WebKit-specific divergence, elevate a dedicated throwaway admin test
  account rather than the shared seeded one.
- **`/admin/people:*`, `?tab=admin/people:*` (6 variants)** — same reason.
- **`/post-job`, `/payment-success`, `/admin`, `/str-settings`,
  `/auto-tip`, `/gift-card`, `/analytics`, `/home-history`,
  `/work-record`, `/pets` — the actual rendered screen** (not just the
  redirect) — same seeded-account gating reason as above; re-run
  `npx playwright` via `node webkit-diff.mjs authed --authed` and see
  `out/report-authed-authed.json`: both engines land on the identical
  redirect, so there's no A/B divergence *in the redirect itself*, but this
  lane did not reach the
  underlying screens in either engine.
- **`/business/*` (Team/Billing/Contracts/Exports/Reports/API/Onboarding)**
  — not in `SURFACE.md`'s route list and requires a business-membership
  test account; out of this pass's budget.
- **Native WKWebView on-device/simulator** — this pass used Playwright's
  bundled WebKit build (headless, macOS-hosted, not compiled against the
  actual iOS WKWebView), per the orchestrator's explicit tooling
  instruction. It is the standard proxy CLAUDE.md itself recommends
  (`npx playwright install webkit`) and is how the original
  `-apple-system-body` bug was found, but it is not bit-identical to
  on-device Mobile Safari/WKWebView. A residual, smaller class of
  WKWebView-only divergence (e.g. Capacitor-injected APIs, native gesture
  interaction) is out of reach without `xcrun simctl` + a real app build,
  which this lane did not request given the mandate is CSS/rendering, not
  native bridge behavior (that's `lh-native-bridge`'s lane).
- **Overlays/dialogs/sheets (139 instances)** — not systematically A/B'd.
  Given the budget, I prioritized route-level computed-style parity (the
  documented defect class — `-apple-system-body`, the minifier collapse)
  over enumerating every dialog. The one overlay class checked
  (`.glass-modal`, shared by every `Dialog`/`AlertDialog`) is covered by
  WD-001 since it's a global CSS rule, not a per-instance one — so the fix
  for WD-001 fixes every dialog's blur at once. A dedicated overlay-by-
  overlay WebKit pass (position:fixed containing-block, focus trap,
  scroll-lock) is not done and would need the mutating/interactive
  tooling this read-only pass avoided.

## What I could not fix myself

WD-001's only fix site is `src/index.css`, which is explicitly
orchestrator-only per `PROTOCOL.md` §1 ("Territory"). Filed the finding with
a proposed fix (reorder each `backdrop-filter`/`-webkit-backdrop-filter`
pair so the unprefixed property is declared last, mirroring how Tailwind's
own generated utilities already survive the minifier) and messaged
`team-lead` directly with the full repro + evidence. Offered to re-verify
(dist build + dual-engine computed-style re-check) once it lands.

Nothing else in this lane's findings required a fix — the rest of the sweep
came back clean or was retracted as a non-reproducible lead (see above).
