# Audit coverage ledger

**What this is:** the honest record of which parts of Louisiana Helpr have
actually been *operated* — driven in a browser or the iOS simulator, or queried
against the live database — versus which have only ever been *read*.

**Why it exists:** audits of this app have repeatedly reported it clean while
real breakage sat in production. The root cause is not carelessness, it is
substitution: when a session cannot actually operate the app (no session, no
data, no simulator), it silently falls back to reading the source and files the
result as verification. A report that tested nothing and a report that tested
everything look identical. This ledger makes them look different.

A "clean" audit filed against a ledger that is 80% `NEVER WALKED` is visibly an
incomplete audit, no matter how confident its prose.

---

## The unit changed on 2026-08-31: this ledger counts STATES now, not places

Everything below section 1 counts **places** — routes, redirects, tabs, admin
views, edge functions, overlay roots. 232 of them. That count was honestly
derived and it is still tracked, because a place nobody has opened is still a
gap.

It is not, however, the unit the defects live in.

On 2026-08-31 the owner found roughly twenty real defects in forty-five minutes
of tapping a real build, after several audits had reported the app clean. **Not
one of them was in a place this ledger was missing.** Every one was in a
*state*:

- a status with no branch of its own — `pending_approval` renders no card body
- a card expanded rather than collapsed — expansion gates ~90% of both job cards
- a job four days past due — `jobIsOverdue` re-buckets it and adds a band
- an arrival that was *claimed* but not *verified* — three captions off two
  nullable columns
- step 2 of a dialog — `ReportDialog` has three screens; every sweep saw one

The route sweep photographs each place once, in whatever state production data
happened to be in. It cannot see any of that, and the 155 `WALKED` rows below
do not claim it can. `/my-posts` being WALKED means the route rendered; it says
nothing about the eight statuses, the expansion axis, or the arrival lattice
that route can render.

**Section 8 adds the state axis: 195 state cells, derived from source.** The
two counts are complementary and are deliberately kept apart — a place walked
in one state is not a walked state, and merging them would let a 100% route
score hide a 3% state score, which is exactly how the app came to be reported
clean while broken.

| Axis | Unit | Total | Source of truth |
| --- | --- | ---: | --- |
| Places (sections 1–7) | route / tab / view / function / overlay root | 231 | `src/App.tsx`, `TAB_TITLES`, `type View`, `ls supabase/functions`, the overlay grep |
| **States (section 8)** | status × role × data-presence × expansion × step | **195** | `e2e/happy-path/state-matrix/stateMatrix.ts`, derived from the `job_status` enum, `application_status`, `deriveAppliedJobCardState` and the nullable columns each card branches on |

---

## Summary — as of 2026-08-31 (full-surface audit)

| Status | Count | Share |
| --- | ---: | ---: |
| **WALKED** — operated against real data, with a durable artifact | **154** | 67% |
| **PARTIAL** — touched only by an E2E spec (Chromium against a *mocked* Supabase) | **0** | 0% |
| **NEVER WALKED** | **77** | 33% |
| **Total tracked units** | **231** | |

Breakdown of the 231, each figure derived from source, not asserted:

| Group | Total | Walked | Never |
| --- | ---: | ---: | ---: |
| Real routes | 33 | 31 | 2 |
| Redirect routes | 14 | 14 | 0 |
| Profile tabs | 17 | 17 | 0 |
| Activity tabs | 2 | 2 | 0 |
| Admin views | 24 | 24 | 0 |
| Edge functions | 63 | 63 | 0 |
| **Overlay/dialog roots** | **78** | **3** | **75** |

The 2 unwalked routes are the parameterised pair, `/jobs/:id` and
`/user/:userId` — they need a live job id and profile id and were not driven in
this pass.

**The 78 overlays remain the largest hole in this app's coverage.** A control
sweep was run (1,600+ controls clicked across every authed route) but the
preview server was restarted underneath it three times for rebuilds, so its
dead-control verdicts are contaminated and are NOT recorded here. Nothing is
promoted on the strength of that run.

**The unit count changed on 2026-08-31 and the old 134 is not comparable.**
Three corrections, all verified against source rather than assumed:

- **37 -> 34 -> 33 real routes.** `/subscription` and both `/family` routes
  were still listed here; none is registered in `src/App.tsx` any more.
  `/benefits` (BenefitsPage) then left too — page and route deleted
  2026-08-31, no partner agreements behind it.
  `/subscription` was additionally advertised in `public/sitemap.xml` and
  served the 404 page to crawlers (fixed, commit af77c0e3).
- **18 -> 17 Profile tabs.** `posted_jobs` and `completed_jobs` left the `Tab`
  union; `accessibility` had joined it and was missing here. Both dead tabs
  rendered a heading-less page rather than falling back, which is now fixed
  (commit a19e9474).
- **+39 overlays.** The ledger tracked no dialog, sheet, popover or drawer at
  all, while `grep -roE "<(Dialog|AlertDialog|Sheet|Drawer|Popover|DropdownMenu|HoverCard)\s+open=" src --exclude-dir=ui`
  finds **78** overlay roots. An audit reporting "all routes walked" while 78
  popups had never been opened is exactly the substitution this file exists to
  prevent. 39 are tracked below; the rest need per-trigger entries.

### What the 2026-08-31 evidence actually is

Every route row promoted below carries the same artifact set, produced against
a **production build served locally** (`npm run build` + `vite preview`) with a
**real Supabase session** minted for the seeded Audit Helper account — real
rows, real RLS, not the mocked backend the Playwright suite uses:

- a PNG per route per breakpoint at 320/375/414/768/1024/1440 in light and
  375/1440 in dark, under `~/lh-audit-2026-08-30/`
- a measured layout record per route: `documentElement.scrollWidth <=
  clientWidth`, content-column extents, desktop fill %, `<h1>` count
- an axe-core run per route (`wcag2a wcag2aa wcag21a wcag21aa`)

Aggregate over all 69 authed+public routes, both themes, after the fixes in
this pass: **0 axe violations, 0 horizontal overflow, exactly one `<h1>` per
page, 0 pages under the 65% desktop-fill bar.**

This is honest about its own ceiling: it proves each route RENDERS and MEASURES
correctly against real data. It does not prove every control on it does
something, which is the separate control sweep noted per row.

**Read that top line before believing any audit report.** Zero units in this app
have a durable, human-or-machine-observed artifact proving they work against
real production-shaped data. That is the starting truth, not a failure of this
document.

### Why nothing starts as WALKED

`PARTIAL` is the ceiling anything can reach from the evidence currently in this
repository. The Playwright suite runs Chromium against a **mocked** Supabase
(see `e2e/happy-path/fixtures.ts`), so a green spec proves the React tree
renders and the interactions wire up — it does not prove the RPC exists, that
RLS lets the row through, that the edge function is deployed, or that the money
moved. Those are exactly the defect classes that reached production.

Prior audit reports in `docs/audit/` (`VISUAL-2026-08-24.md`,
`OVERNIGHT-2026-08-18.md`, `FABLE-LEAD-2026-08-23.md`, the `01-`–`06-` sweeps)
do describe real screen-by-screen work — but they do not carry per-screen
artifacts that survive to today (no retained screenshot paths, no captured HTTP
statuses, no row output). Under this ledger's rule, a claim without a surviving
artifact is not evidence. Those entries stay `NEVER WALKED` until someone walks
them and leaves the artifact behind. That is the intended, non-punitive
behaviour: an honest gap beats a fabricated pass.

---

## How a session updates this ledger

Read this before editing a single row.

1. **Only real evidence promotes a row.** A code read never does — not "I traced
   the component and it's correct", not "the query looks right", not "the
   migration defines it". If your only artifact is a file path plus reasoning,
   the row does not move.
2. **What counts as evidence** (record it in the Evidence column, concretely):
   - a screenshot path from Chrome or the iOS simulator (`/path/shot.png`)
   - an HTTP status + URL you actually issued (`curl -s -o /dev/null -w '%{http_code}' … → 200`)
   - a SQL result you actually ran (`select count(*) … → 14 rows`)
   - command output with the command shown (`gh run list … → success`)
   - a commit SHA that fixed and verified it
3. **What does not count:** "verified", "confirmed working", "looks correct",
   "tests pass" with no run output, a migration file, a green CI badge with no
   named check, or another agent's summary.
4. **Downgrade freely.** If a row says `WALKED` and you cannot find the artifact
   it cites, set it back to `NEVER WALKED` and say so. Removing a false pass is
   as valuable as adding a true one.
5. **Staleness is expected and fine.** Rows go stale; that is information, not
   debt. Do not refresh a date without redoing the walk. Never mass-update this
   file, and never update it in the same edit as the change you are claiming to
   have verified.
6. **Timestamp format:** ISO date + method, e.g. `2026-08-27 · iOS sim`.

Methods, spelled: `browser` (Chrome, real session), `iOS sim`, `device`,
`DB query` (Supabase, live), `curl` (edge function, live), `E2E` (Playwright,
**mocked** backend — never promotes past `PARTIAL`).

---

## 1. Routes — screens (33)

Source of truth: the `<Route>` table in `src/App.tsx`. Enumerated, not guessed.

| Route | Component | Status | Last genuinely walked | Evidence |
| --- | --- | --- | --- | --- |
| `/` | Index / MarketingRedirect | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/login` | Login | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/signup` | Signup | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/signup-pending` | SignupPending | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/complete-profile` | CompleteProfile | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/account-pending` | AccountPending | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/account-denied` | AccountDenied | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/account-banned` | AccountBanned | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/forgot-password` | ForgotPassword | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/reset-password` | ResetPassword | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/dashboard` | Dashboard | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/profile` | Profile | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/post-job` | PostJob | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/my-jobs` | Activity (applied) | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/my-posts` | Activity (posted) | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/payment-success` | PaymentSuccess | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/admin` | Admin | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/messages` | Messages | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/support` | Support | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/legal` | Legal | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/jobs` | Jobs (public) | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/browse` | DashboardGuest | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/str-settings` | StrSettings | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/auto-tip` | AutoTip | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/gift-card` | PayItForward | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/home-history` | HomeHistory | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/work-record` | WorkRecord | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/help` | HelpCenter | WALKED | 2026-09-01 · browser | Re-walked by the copy-parity lane at 375 + 1440 with all 7 sections and 23 answers EXPANDED (the FAQ is a two-level accordion; a collapsed pass reads only 695 chars and certifies nothing). scrollWidth == clientWidth at both, 0 elements wider than viewport, 0 page errors, h1 1. 21 of 22 rewritten claims asserted present in rendered text; /tmp/help-{375,1440}-final.png |
| `/wrapped` | HelprWrapped | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/pets` | PetProfiles | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `*` | NotFound | WALKED | 2026-08-31 · browser | driven as /nonexistent-audit-404; 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/jobs/:id` | JobDetail | NEVER WALKED | never | needs a live job id — not driven this pass |
| `/user/:userId` | UserProfile | NEVER WALKED | never | needs a live profile id — not driven this pass |


## 2. Routes — redirects (14)

A redirect is walked when you have observed the *landing* URL after navigating
to the source, not when you have read the `<Navigate>` element.

| Route | Redirects to | Status | Evidence |
| --- | --- | --- | --- |
| `/activity` | `/my-posts` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/earnings` | `/profile?tab=earnings` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/terms` | `/legal?tab=terms` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/privacy` | `/legal?tab=privacy` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/rules` | `/legal?tab=community` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/data-rights` | `/profile?tab=legal` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/schedule` | `/profile?tab=schedule` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/availability` | `/profile?tab=availability` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/saved-helpers` | `/profile?tab=saved_helpers` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/pay-it-forward` | `/gift-card` | WALKED | **query-string preservation now driven, not just the landing URL.** `?claim=<token>` survives signed-out (`/login?redirect=%2Fgift-card%3Fclaim%3D…`) and signed-in (`claim-pif-credit` invoked with `{"claim_token":"…"}`); prod A/B shows the pre-fix `?redirect=%2Fgift-card` with the token gone. 2026-09-01 · browser (Playwright) |
| `/analytics` | `/profile?tab=earnings` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/dashboard/post-login` | `/dashboard` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/settings/profile` | `/profile` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
| `/settings` | `/profile` | WALKED | landing URL observed in browser; 2026-08-31 · browser |


## 3. Profile tabs (17)

Source of truth: `TAB_TITLES` in `src/pages/profile/types.ts`, plus the
`landing` tab. Each is a distinct screen reached as `/profile?tab=<key>`.
`/profile` being PARTIAL above does **not** cover any of these.

| Tab | Screen | Status | Evidence |
| --- | --- | --- | --- |
| `landing` | Profile landing | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `profile` | Edit Profile | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ — 11 chip contrast failures found & fixed (ebae904f) |
| `earnings` | Earnings & Payouts | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `schedule` | Schedule | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `availability` | Availability | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ — 12 contrast failures found & fixed (5910a925) |
| `payment` | Earnings & Payouts (legacy deep link) | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `security` | Account Security | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `legal` | Legal & Policies | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `reviews` | My Reviews | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `referral` | Referrals | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `subscription` | Membership | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `support` | Help & Support | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `notifications` | Notifications | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ — 6 contrast failures found & fixed (5910a925). 2026-09-01: destination resolution moved off `link`-parsing onto the new `notifications.job_id` reference (`notificationDestination.ts`, 26 unit tests). DB half NOT yet on prod — migration 20260901035600 deploys on merge; measured instead against a full 1617-row prod replica in PGlite (2-page fetch; the 1000-row PostgREST cap would have silently reported 1000 as the whole table). |
| `warnings` | Warnings & Strikes | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ — 5 contrast failures found & fixed (ebae904f) |
| `credentials` | Licensed & Insured | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `saved_helpers` | Saved Helprs | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |
| `accessibility` | Accessibility | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ |


## 4. Activity tabs (2)

Source of truth: `type Tab` in `src/components/activity/activityConstants.ts`.
Each tab additionally has status filters and per-status card states — force
them; a tab seen in one status is not a walked tab.

| Tab | Route | Status | Evidence |
| --- | --- | --- | --- |
| `posted` | `/my-posts` | WALKED | 2026-08-31 · browser; incl. ?filter=scheduled/waiting/done, 6 breakpoints. 2026-09-01 · browser (Playwright/Chromium 1440, session = helpr-audit-web-0824@mailinator.com, the job's own poster): notification deep-link resolution driven end to end. `?job=db21c20d…` → `/my-posts?job=…&filter=done`, chip **Done 3** the ONLY one selected, card "Rake and bag front-yard leaves" rendered (236×23 visible), 0 h-overflow — /tmp/lhnotif/A-resolved-destination.png. Stale-filter case `?job=…&filter=offered` now also resolves to `filter=done`; with the precedence line temporarily reverted the same URL gave **0 chips selected and no card**, which is the defect. |
| `applied` | `/my-jobs` | WALKED | 2026-08-31 · browser; incl. ?filter=scheduled/waiting/completed, 6 breakpoints |

## 5. Edge functions (63)

Source of truth: `supabase/functions/` (excluding `_shared`). "Walked" here
means **executed against the deployed function** and the status observed —
`curl` output or a Supabase log row. Reading the handler is not evidence, and
neither is the function appearing in `list_edge_functions` (deployed is not
working — a function can be live and 503 on every call, which `mapkit-token`
did).

2026-08-31 re-sweep: **all 63 executed again via curl** (OPTIONS + POST,
unauthenticated), every status recorded to
`~/lh-audit-2026-08-30/edge-functions.txt` — still 0×404, all deployed and
answering. Two findings came out of it:

- **`ai-job-builder` had NO auth check at all**, only a per-IP rate limit. It
  accepts the publishable key that ships in the public client bundle, so an
  unauthenticated caller could pull full LLM completions billed to our Gemini
  account — confirmed against prod with a real completion, then fixed and
  re-verified live (401 unauthenticated, 200 authenticated). Commit 09f1a479.
- **A handful answer 5xx where the rest answer 401** on an unauthenticated
  POST: `create-payment`, `stripe-connect`, `pro-customer-portal`,
  `cash-out-credits`, `helpr-pass-wallet`. The first three carry an honest
  `{"error":"Not authenticated"}` body — they reject correctly and merely
  return the wrong status code, so this is monitoring hygiene rather than a
  hole. Still open.

Earlier 2026-08-29 sweep for reference: Beyond reachability, these were exercised end-to-end against
prod: `create-payment` (real $86.00 test-mode checkout, PI succeeded),
`stripe-webhook` (checkout.session.completed applied escrow),
`create-notification` + `send-notification-email` + `process-email-queue`
(notification → queued → status `sent` in `email_send_log`, after fix
37c7913e), `stripe-connect` (Refresh Status flipped payout flags),
`pro-customer-portal` (200 + billing portal URL authed),
`ai-job-builder` (200, sane draft for a raking prompt),
`mapkit-token` (200 JWT — prior permanent 503 is fixed),
`cash-out-credits` (400 human copy authed). Known non-working:
`helpr-pass-wallet` 501 (signing certs not provisioned, honest message),
`create-bgc-payment` 503 (intentional provider-migration pause).

`admin-delete-user`, `admin-resend-verification`, `admin-update-email`,
`admin-user-actions`, `ai-job-builder`, `auth-email-hook`, `auto-expire-jobs`,
`auto-release-payment`, `auto-resolve-disputes`, `auto-tip-charge`,
`boost-job`, `brand-asset`, `calculate-tax`, `cash-out-credits`,
`charge-recurring-visits`, `check-pro-subscription`, `claim-pif-credit`,
`cleanup-abandoned-accounts`, `cleanup-notifications`, `complete-signup`,
`contact-support`, `create-bgc-payment`, `create-boost-payment`,
`create-notification`, `create-payment`, `create-pif-donation`,
`create-pro-checkout`, `daily-match-digest`, `delete-own-account`,
`email-tracking`, `engagement-automations`, `execute-dispute-split`,
`expire-subscriptions`, `expiring-jobs-push`, `health-check`,
`helpr-pass-wallet`, `instant-job-match`, `instant-payout`, `mapkit-token`,
`money-reconciliation`, `notify-email-change`, `pay-onboarding-fee`,
`payment-confirm-reminder`, `pro-customer-portal`, `process-email-queue`,
`process-scheduled-payouts`, `release-payout`, `review-nag-cron`,
`saved-helper-availability-push`, `send-account-status-email`,
`send-marketing-blast`, `send-notification-email`, `send-push-notification`,
`slack-ops-alert`, `str-ical-sync`, `stripe-connect`, `stripe-idv-start`,
`stripe-idv-webhook`, `stripe-payouts`, `stripe-webhook`,
`verification-webhook`, `void-cancelled-payments`, `weekly-helper-report`.

> Keep this section a list rather than a table on purpose: it is meant to be
> re-derived from `ls supabase/functions` whenever it is touched, so a function
> added in a migration-era PR cannot quietly go untracked.

### 2026-09-01 — dispute settlement lane (auto-resolve-disputes + admin Quick actions)

| Cell | Status | Evidence |
| --- | --- | --- |
| `auto-resolve-disputes` — full branch matrix | WALKED | Executed against the real function source in the edge harness. `src/test/edge/auto-resolve-disputes.test.ts`, 25 tests: auth, resolve, chargeback-race loss, unsucceeded PI, escalated skip, reminder dedupe (incl. cross-kind and truncated-read), both sweeps, and the forged-job refusal. |
| `settle_dispute_record` (new RPC, 20260901034758) | WALKED | Real Postgres via PGlite: `~/.lh-dispute-pglite/run.mjs`, migration applied verbatim 3×, **56 assertions, ALL PASS**. Grants, SECURITY DEFINER, idempotency, the `payment_status` gate, caller-vs-ledger cross-check, negative-amount refusal, no-clobber of a real split ledger. |
| `create-payment` `admin_release_dispute` / `admin_refund_dispute` | WALKED | `src/test/edge/create-payment.test.ts` (53 tests, +9 new): reviewability fields, dispute-record close reconciled against the `payout_transfers` ledger, audit row with `.select("id")`, fail-closed on a failed transfer, Slack alert on a failed close / zero-row audit write. |
| `can_review_job` after an admin Quick Release | WALKED | `~/.lh-dispute-pglite/review.mjs` — verbatim `can_review_job` from 20260823200000. Pre-fix: poster=false, helper=false (permanently). Post-fix: both true. |
| Prod dispute state | WALKED | Read-only service-role queries 2026-09-01. `public.disputes` = 2 rows, both `status='open'`, both `execution_status IS NULL`. Both jobs `is_seed=true`, `payment_status='escrow'` with NO `stripe_payment_intent_id`/`stripe_session_id` and no `payout_transfers` / `payment_refunds` rows — no real money is held. Deadlines now 9 and 10 days past. |
| Escalated-reminder spam | WALKED | Prod count **168 → 220 in 24h** for ONE seed job across 13 admins (first 2026-08-29T00:21Z) — exactly the predicted 52/day, unbounded. Now capped at one per admin per job per 24h. |
| `execute-dispute-split` stuck-state sweep | WALKED (read) + UNVERIFIED (drive) | No prod row has ever had a non-null `execution_status` (verified: `execution_status=not.is.null` → `[]`), so the stuck-split branch could only be driven in the harness, not against real data. |
| Negative controls | WALKED | 16 total, each reverting one line and confirming the suite goes red, then restoring: 8 on the first pass, 8 more on the review-round hardenings (payment_status gate, caller-vs-ledger check, negative-amount refusal, sweep outcome derivation, dedupe-key title, ledger-authoritative payout). |

**UNVERIFIED in this lane:** the deployed behaviour of `settle_dispute_record`
in production — it is confirmed ABSENT today (`PGRST202`, verified live) and
ships on merge via `db-deploy.yml`. The `PGRST202` deploy-lag path in both
callers is covered by a harness test but not by a real deploy-window run.

---

### 2026-09-01 — seed-job visibility + saved-search alerts lane

| Cell | Status | Evidence |
| --- | --- | --- |
| `SHOW_SEED_JOBS_PUBLICLY` reach, all 3 browse surfaces, anon | WALKED | Live prod, anon key: `/jobs` `get_ranked_open_jobs()` → 12 rows, 12 fixtures; with `p_include_seed:false` → **0 rows**. `get_open_jobs_for_map(p_include_seed:false)` → **404 PGRST202** "Could not find the function public.get_open_jobs_for_map(p_include_seed)". `open_jobs_browse?select=is_seed` → **400 42703** "column open_jobs_browse.is_seed does not exist". Confirms the flag reached 1 of 3. |
| Same, as a signed-in NON-ADMIN helper | WALKED | Purpose-built account `helpr-seedlane-audit-0901@mailinator.com` (`user_roles` = `customer` only — the seeded `helper` account holds `admin` and would have made RLS look wide open). Identical results on all six calls. Account deleted at end of lane. |
| Prod fixture ratio | WALKED | Service-role: 20 open jobs, **20 fixtures / 0 real** at lane start; 17 open / 16 fixtures / 1 non-fixture (`unpaid`, invisible) at lane end. Flipping the flag today would have emptied `/jobs` and left every fixture on the map and the browse list. |
| `public.seed_jobs_hidden_publicly()` + all 3 surfaces + alert trigger | WALKED | PGlite, prod-shaped schema, migration `20260901035245` applied **verbatim 3×**: `~/.lh-seed-pglite/run.mjs`, **136 assertions, 0 failed** (44 per pass). Flag off → 3/3 fixtures on each surface for anon AND signed-in helper; flag on → 0/3 on each, non-fixture rows byte-identical. |
| Client cannot widen the gate | WALKED | `p_include_seed:true` with the flag ON returns 0 fixtures (S3); `p_include_seed:false` with the flag OFF still narrows (S4). Predicate is `NOT is_seed OR (p_include_seed AND NOT seed_hidden)`. |
| SECURITY DEFINER is load-bearing | WALKED | S7d: under `SET ROLE authenticated`, the caller reads **0 rows** from `platform_settings` (admin-only RLS) yet still gets 0 fixtures. An INVOKER reader would have made the switch a silent no-op for every guest — the exact defect class this lane exists for. |
| Fails toward today's behaviour | WALKED | S7c: `feature_flags` blanked → `seed_jobs_hidden_publicly()` = false and all 3 fixtures return. A missing key can never empty the marketplace. |
| Grants / arity / reloptions across REPLACE | WALKED | S6a–e: `get_ranked_open_jobs` callable at 0/1/2/3-arg arity, exactly one `pg_proc` row (no overload), anon+authenticated EXECUTE intact on all three functions, `open_jobs_browse` SELECT grants intact, `security_invoker=false` re-asserted. `scripts/check-migration-grants.mjs` caught a missing REVOKE on `miles_between` — fixed. |
| Saved search never fires — D-1 (radius token) | WALKED | **Live prod.** Saved search stored exactly as the UI writes it (`location_keyword='nearby:25'`, `category='cleaning'`), then a matching job posted in the same parish, same category, 0 mi away → **0 notifications**. The predicate that ran was `location ILIKE '%nearby:25%'` against `"123 Elm St, Baton Rouge, LA 70801"`. |
| Saved search never fires — D-2 (invisible job) | WALKED | **Live prod.** Same search with the radius removed → 1 notification, link `/dashboard?job=<id>` — and that job as the alerted helper sees it: `open_jobs_browse` **0 rows**, `get_ranked_open_jobs` **0 rows** (`payment_status='unpaid'`). The alert linked to a job nobody could open. |
| Prod saved-search population | WALKED | `saved_searches` = **0 rows** before and after this lane; `match_digest_queue` = 1 row. The feature has never fired for a real user. |
| Repaired trigger — full behaviour matrix | WALKED | PGlite V1–V15 (×3 replay passes): token converted to `radius_miles`; unpaid INSERT alerts nobody; funding fires exactly one alert; the linked job **is** in `open_jobs_browse` for the alerted helper; edit/re-save/boost never re-alert; 74.7 mi ≠ match / 3.6 mi = match at radius 25; parish fallback; no-coords-no-parish = no match; query matches title+description; a literal `%` is a character not a wildcard; fixtures obey the shared authority; pending direct offers excluded; poster and banned helper never alerted; throttle and digest mode intact; `send-notification-email` invoked with the right payload; two WHEN-gated triggers replace the unconditional one. |
| `miles_between` ↔ `haversineMiles` | WALKED | Graded against the client implementation verbatim over 4 coordinate pairs: max delta **< 0.001 mi** (R = 3958.8 both sides), so the feed's radius filter and the alert's agree on the boundary. |
| Silent-write guards (`SavedSearches.tsx`) | WALKED | The DELETE had **no zero-row guard** (a delete that matched nothing removed the row from the list, fired the success haptic, and the alert kept notifying). Insert / update / delete now all pass `.select("id")` through `unwrapMutation()` with `user_id` scoping and a re-read on rejection. |
| Unbounded read | WALKED | `load()` was `select("*")` with no limit against a 1000-row PostgREST cap (reproduced live: `notifications?limit=5000` → exactly **1000** of 1617). Now `.limit(50)` with the 10-per-user cap named in the comment. |
| Saved Searches dialog @375 / @1440, Chrome | WALKED | Playwright + a genuine non-admin session against the dev server. Both breakpoints: `scrollWidth === clientWidth`, **0** elements wider than the viewport, **0** console errors, dialog centred (x=464 w=512 at 1440 → centre 720 = 1440/2). Empty state and 2-row list state both captured. Meta line now reads `Active filters: "lawn" · Category: Cleaning · $50 – $150 · Within 25 mi` — previously it printed the raw `nearby:25` token and only the max budget. |
| Drift guard | WALKED | `src/config/showSeedJobs.parity.test.ts`, 8 tests: grades the **latest** definition of all four gated objects in the migration tree, the fail-open COALESCE, the narrowing-only `p_include_seed` predicate, and that no client-side seed constant has come back. |

**UNVERIFIED in this lane:**
- The migration's behaviour **in production** — `20260901035245` is unpushed and
  ships on merge via `db-deploy.yml`. Everything after the flip is PGlite
  evidence, not prod evidence. Prod evidence covers only the BEFORE state.
- The **iOS/WKWebView** surface for the Saved Searches dialog — not opened this
  lane (Chrome only, at 375 and 1440).
- The **native push / email** legs of a repaired saved-search alert. The trigger
  is proven to `INSERT` the notification row and to invoke
  `send-notification-email` with the right payload (PGlite stub records the
  call), but no real APNs delivery was driven — prod has **0 `push_tokens`
  rows**, so there is nothing to deliver to.
- Whether the owner wants the flip surfaced as an **admin toggle**. The switch
  is a one-line `UPDATE` today; `AdminSettings.tsx`'s Feature Flags card is
  framed as emergency kill-switches ("Off is the normal state"), which this flag
  does not fit, and that file is outside this lane.

---

## 6. Admin views (24)

Source of truth: `type View` in `src/pages/Admin.tsx:45`. Each is a distinct
screen reached as `/admin?view=<key>`. `/admin` being walked does NOT cover
them. Reached by minting a session and elevating the seeded account via
`user_roles`.

| View | Status | Evidence |
| --- | --- | --- |
| `home` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `analytics` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `people` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `jobs` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `settings` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `disputes` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `broadcasts` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `notifications` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `notiflogs` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `reports` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `support` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `referrals` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `subscriptions` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `fraud` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `audit` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `health` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `export` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `payouts` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `tiers` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `marketing` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `idvreview` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `credentials` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `exceptions` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |
| `banreview` | WALKED | 2026-08-31 · browser; rendered + axe + layout at 1440 light & dark, ~/lh-audit-2026-08-30/ |

All 24 rendered clean: 0 axe violations, 0 horizontal overflow, exactly one
`<h1>` each, none under the 65% desktop-fill bar. Note this covers the views'
READ surface only — the destructive dialogs they host (ban, refund, delete,
status override) are in section 7 and remain unwalked.

## 7. Overlays — dialogs, sheets, popovers, drawers (78)

Source of truth:
`grep -roE "<(Dialog|AlertDialog|Sheet|Drawer|Popover|DropdownMenu|HoverCard)\s+open=" src --exclude-dir=ui`
-> 78 roots. This axis did not exist in the ledger before 2026-08-31, which is
why previous audits could report "all routes walked" while no popup in the app
had ever been opened by an auditor.

**Status: 3 of 78 WALKED.**

| Overlay | Trigger | Status | Evidence |
| --- | --- | --- | --- |
| `FilterSheet` | `/dashboard` → Filters | WALKED | 2026-08-31 · browser; opened light+dark, axe 0 inside the dialog, Escape closes; `~/lh-audit-2026-08-30/dialogs/filter-sheet-{light,dark}.png` |
| `JobDetailDialog` | `/dashboard` → job card | WALKED | 2026-08-31 · browser; real seeded row "Deep clean a 3-bedroom / $220 / Lafayette / Tre B. 5.0", axe 0, Escape closes; `dialogs/job-detail-dialog-{light,dark}.png` |
| `SecurityTab` change-email | `/profile?tab=security` → Change | WALKED | 2026-08-31 · browser; opened light+dark, axe 0, Escape closes; `dialogs/security-change-email-{light,dark}.png` |

**A harness driving this app from a fresh context MUST dismiss the onboarding
tour first.** `OnboardingTour` opens over `/dashboard` on every new browser
context and blurs the page behind it, so an unprepared sweep screenshots the
tour rather than the screen, and every click it attempts is intercepted by the
tour's overlay. Seed
`localStorage["helpr_onboarding"] = {completed:true,currentStep:0,completedSteps:[]}`.
The first screenshot pass of 2026-08-31 hit exactly this and was regenerated.

A blind control sweep clicked 1,600+ controls across every
authed route, but the preview server was restarted under it three times during
rebuilds and it then hung with four workers stuck at 54/69 cells, so its results
are contaminated and nothing is promoted on them. The
sweep also proved it MUTATES state — it toggled the seeded helper's
`push_enabled` to false and all seven `helper_availability` rows to unavailable
(both restored, verified by SQL read). Any future overlay sweep must snapshot
and restore the account it drives.

An overlay is WALKED when it has been OPENED and OPERATED, with a screenshot.
Reading the component does not count. Destructive confirms (ban / refund /
delete / status override / cancel / withdraw) additionally require a SQL read
afterwards proving the write landed — the "reports success, wrote nothing"
class is the whole reason this bar exists.

| Group | Roots | Status |
| --- | ---: | --- |
| Global (App.tsx-mounted: permission rationale, terms re-consent, app lock, offline, strike, toasts, success moment) | 9 | NEVER WALKED |
| Dashboard / Browse / Jobs | 12 | NEVER WALKED |
| Activity (largest family: boost, tip, cancel, dispute, review, completion, W9, applicants) | 25 | NEVER WALKED |
| Messages | 10 | NEVER WALKED |
| Profile (incl. delete account, 2FA, instant payout, ProUpgradeSheet paywall) | 14 | 2 of 14 WALKED — DeleteAccountDialog steps 1 and 2, driven at 375 and 1440 (2026-08-31, see §Account deletion below). Remaining 12 NEVER WALKED |
| Post Job (IDV gate, redirect overlay, pickers) | 10 | NEVER WALKED |
| Nav / shell (GateSheet guest paywall, quick menu, sidebar) | 5 | NEVER WALKED |
| Admin (command palette, ban, refund, remove, status override, user detail) | 18 | NEVER WALKED |
| Native OS prompts (camera, geo, push, Face ID, share, social auth, in-app browser) | 9 classes | NEVER WALKED — needs the iOS sim |

## 8. States (195)

Source of truth: `e2e/happy-path/state-matrix/stateMatrix.ts`, derived from the
`job_status` enum in the generated `types.ts`, the `application_status` enum,
`deriveAppliedJobCardState` in `appliedJobCardHelpers.ts`, and the nullable
columns each card branches on. Explained in `docs/audit/STATE_MATRIX.md`;
regenerate the manifest with

```
EMIT_STATE_MATRIX=1 npx playwright test --project=happy-path state-sweep -g "emit manifest"
```

**195 state cells, 334 frames.** A cell is `WALKED` when the sweep DROVE it —
forced the exact row shape, loaded the surface, expanded the card or opened the
overlay, confirmed the surface actually entered that state, and left a
screenshot plus an observation record behind. A frame the sweep captured but
could not drive is `UNVERIFIED` with the reason, never a pass.

| Surface | Cells | Frames |
| --- | ---: | ---: |
| Poster job card (`/my-posts`) | 76 | — |
| Helper job card (`/my-jobs`) | 48 | — |
| Tracker rail | 22 | — |
| Activity shell (tab × bucket × density) | 26 | — |
| Job detail dialog | 9 | — |
| Multi-step / state-bearing dialogs | 14 | — |
| **Total** | **195** | **334** |

| `job_status` | Cells |
| --- | ---: |
| `open` | 34 |
| `in_progress` | 36 |
| `accepted` | 25 |
| `completed` | 18 |
| `disputed` | 18 |
| `revision_requested` | 10 |
| `cancelled` | 9 |
| `pending_approval` | 2 |

**2026-08-31 — `pending_approval` was retired as a product state; its `2` stays
put on purpose.** That column counts *state-matrix cells*, not production rows,
and `e2e/happy-path/state-matrix/stateMatrix.ts` still emits two of them.
Changing the number here without changing the module would desync this ledger
from the source it names one paragraph above. The state itself is dead:
`businesses` / `business_members` were dropped by `20260828011811` and return
PGRST205 on prod; the only writer (`initialStatus` in
`src/pages/postjob/jobSubmitHelpers.ts`) had zero call sites and is deleted; the
enum label is kept deliberately so a stray row can never render a blank card.
The two-row data repair
(`supabase/migrations/20260831232522_retire_business_approval_residue.sql`) is
**written but untracked, so it has not deployed** — prod still holds exactly two
`pending_approval` jobs, both `is_seed = true`, verified by direct query on
2026-08-31. Full reasoning in `STATE_MATRIX.md`. When that migration ships, the
right move is to mark both cells `unreachable` in `stateMatrix.ts` with the
reason, and let this table follow the module.

### Status of this axis — 2026-08-31

**Every cell starts UNVERIFIED and is promoted only by a driven frame.** Read
`$STATE_SWEEP_OUT/index.json`, not this table, for the current number — it
carries the per-cell verdict and the reason for every cell that was not driven,
and this ledger deliberately does not duplicate a count that a run can
invalidate without anyone noticing.

**First clean run, 2026-08-31 (Chromium against a mocked Supabase, a Vite dev
server, 4 workers, 8.3 minutes):**

| | Frames | Note |
| --- | ---: | --- |
| Expected | 334 | |
| Captured | 334 | a PNG and a review record for every one |
| **Driven** | **296** | the surface was confirmed to have entered the named state |
| UNVERIFIED | 38 | each with a recorded reason, below |

`PARTIAL` is the ceiling for all 296 under this ledger's own rule: the rows are
`page.route()` responses, not a real backend. A driven frame proves the React
tree renders that state. It does not prove the RPC returns it or that RLS lets
it through.

The 38 UNVERIFIED frames, with reasons:

| Reason | Frames | Class |
| --- | ---: | --- |
| the job-detail dialog did not open from a feed card | 26 | harness gap — the feed-card trigger selector does not match; tracked as `interaction` |
| a named trigger was not found (`Apply`, `Decline`, `Continue`) | 8 | harness gap — three multi-step dialogs whose step 2 is still unreached |
| the region could not be resolved; the frame is the whole viewport | 4 | the frame exists and is reviewable, but at page scope rather than card scope |
| declared gaps | 6 | the `native` / `unreachable` cells below |

Three harness bugs were found and fixed inside that day, each by READING a
record rather than trusting a green result. All three had the same shape — the
harness reported success while measuring the wrong thing:

- **The sweep was collapsing the page header instead of expanding the card.**
  `button[aria-expanded]` matched `ActivityHeader`'s filter chevron first, so
  every "expanded" cell photographed a collapsed card and still recorded
  `driven: true`. Caught by finding "Expand Job Details" in the `copy` of a
  cell that was supposed to be open. The sweep now matches the toggle by its
  own label and CONFIRMS the card opened before recording the frame.
- **`?filter=all` groups the list into accordions and only Active starts
  open.** Every `completed` / `cancelled` / `disputed` poster cell loaded a
  page whose card was inside a shut accordion, found nothing, and reported
  "the seeded row did not reach the list" — wrong, and wrong in the direction
  of blaming the app. `Cancelled` sits behind a second gate again ("Show
  Cancelled"). Both are opened now.
- **The drive loop was too slow to finish a single cell.** Twenty-odd
  Playwright locator round trips per frame, each with its own actionability
  polling, exhausted the per-test budget against a dev server; whole runs
  wrote zero frames while the failure pointed at whichever call happened to be
  in flight. Collapsed to one `page.evaluate`: a cell went from a 135-second
  timeout to 3.8 seconds.

Six cells are declared gaps that no browser run can promote, each with its
reason in the manifest:

| Cell | Why it can never be `WALKED` here |
| --- | --- |
| `gap-in-flight-button-guards` | R6 — six mutation-in-flight button states reachable only by winning a race against a mocked 201 |
| `gap-app-lock-after-jetsam` | Chromium has no WKWebView content-process jetsam. Physical device only. |
| `gap-keyboard-covers-sheet` | Chromium has no software keyboard and does not resize the visual viewport the way WKWebView does |
| `gap-safe-area-insets` | Chromium reports every `env(safe-area-inset-*)` as 0 |
| `gap-native-os-prompts` | Camera / geo / push / Face ID / share / social auth render outside the web view |
| `gap-realtime-transitions` | `fixtures.ts` installs an inert WebSocket by design; both endpoints of each transition are enumerated, the animation between them is not |

### Findings this axis produced on its first run

Each is stated with the cell that produced it and the measurement, so it can be
re-run or refuted. None of them violates any predicate the existing gates check.

**1. `pending_approval` had never been rendered in any screenshot this repo has
produced.** It is absent from `e2e/happy-path/seedData.ts`, which seeds seven of
the eight statuses, and it is the one status with no card-body branch of its
own. Found by enumerating the enum rather than the seed file. Cells
`posted-pending-approval-awaiting-approver-{collapsed,expanded}` are the first
frames of it that exist.

**2. Corroborated: the same status was missing from `statusBadge`.** The map in
`activityConstants.ts` carried 7 of 8, and the test that exists to catch exactly
that (`activityConstants.test.ts`) hardcoded the same 7, so it never could. The
`src/` lane fixed this during the same session by retyping the map as
`Record<JobStatus, string>` — a compile error now, not a comment asking people
to remember. Recorded here because the state matrix and that fix found the same
hole independently, which is the point of deriving coverage from the enum.

**3. Two money controls for one action, one enabled and one disabled, in one
card — 17 frames.** In `applied-active-arrival-verified-*` and
`applied-active-payout-gate-closed-*`, `JobTracking`'s Done-step CTA renders as
an enabled primary **"Request My Payout"** while `ActiveJobSection`'s completion
button sits below it, disabled, reading **"Upload before & after photos
first"**. The tracker CTA enforces the identical gate — but only on click, via
a round trip and a toast (`JobTracking.tsx:707-737`). The comment on that gate
says the two "must not disagree again"; they no longer disagree about the rule,
but they still disagree about what the reader is allowed to do before pressing,
and the one that looks pressable is the one that fails. Detected by pairing
`actions[]` labels with the `describe` of the state; no predicate in this repo
would flag it, because both are valid buttons.

**4. The poster card never labels its description; the helper card always
does — 0 of 85 against 71 of 71.** Every helper-side frame that renders the
description carries an `h4 "Job description"` eyebrow at 10px above it. **Zero
of the 85 expanded poster-card frames carry any eyebrow**: their `sections`
list goes straight from the `h2` title to the `h3` "Job tracking", with the
identical description text in between, unlabelled. Same content, same card
family, one labelled and one not. This is the "missing section eyebrows" class,
located and counted.

> **SUPERSEDED 2026-08-31 — the visible half of this finding no longer exists,
> and the measurement above must not be re-run as written.** Eyebrows were
> retired app-wide (`src/index.css`: `.text-display-eyebrow { display: none }`,
> under the 2026-07-25 "all eyebrows gone" decision recorded at that rule), and
> the `SectionEyebrow` component is gone from `src/` entirely —
> `grep -rn "SectionEyebrow" src/` returns zero hits. The helper card's heading
> survives as `<h4 id="job-desc-…" className="sr-only">Job description</h4>`
> inside a `<section aria-labelledby>`
> (`src/components/activity/AppliedJobCard.tsx`), so it paints nothing.
> **The asymmetry this finding rests on — "one labelled and one not" — is
> therefore false as stated: both cards are now visually unlabelled, by
> decision.**
>
> The half that survives is real and narrower, and is the one to carry forward:
> the helper card still carries an *accessible* name for that block and the
> poster card carries none, so a screen reader announces the section on one
> card and an unnamed region on the other. Re-measure on `sections` entries
> that include `sr-only` headings, never on painted eyebrows.

**5. The tracker rail paints two saturated hue families on one row of step
dots — 81 driven frames.** Passed steps are `rgb(38,115,66)` (h142, a true
green, `--success-ink`); the current step is `rgb(154,102,25)` (h36, amber,
`--amber-solid`). Green-for-done beside amber-for-current is legible and looks
deliberate, so this is surfaced as a QUESTION for the reviewer rather than
filed as a defect — which is exactly what the `siblingColorSplits` signal is
for. Worth recording alongside it: a capture taken earlier the same day, before
`src/` simplified `currentTone` to `allDone ? success-ink : amber-solid`, showed
the current dot as `rgb(95,101,67)` (h71, `--bark`, an olive) beside the same
h142 green — two greens on one rail, the owner's original finding, reproduced
deterministically at a named cell. The signal that catches it is now permanent.

**6. Chromium cannot see Dynamic Type — and the simulator can.** Frames captured
through `scripts/ios-state-probe.sh` at `content_size medium` and at
`accessibility-extra-extra-extra-large` are laid out identically: same title
size, same card heights, same number of cards on screen. The OS text-size
setting does nothing in this app. Expected for a Capacitor app that has not
opted in, so a design gap rather than a regression — but no browser sweep, axe
rule or prior audit could have reported it. See `IOS_COVERAGE.md`.

## Related mechanisms

- `.claude/skills/lh-audit/SKILL.md` — the audit standard. It requires every
  report to carry a third section, **UNVERIFIED — could not reach, and why**.
  A row here that is `NEVER WALKED` should show up in that section of any audit
  claiming to have covered it.
- `npm run check:audit-evidence -- <report.md>` — scans a written audit report
  for claims that carry no artifact and prints the ratio.
- `e2e/happy-path/state-matrix/` — the state enumerator, the state sweep and
  the observation extractor behind section 8. `docs/audit/STATE_MATRIX.md`
  explains the axes and the nine collapsing rules.
- `scripts/state-review.mjs` + `docs/audit/STATE_REVIEW_PROMPT.md` — the review
  pass. It never returns a green tick on its own: with no reviewer configured
  it reports N frames AWAITING REVIEW.
- `scripts/ios-state-probe.sh` + `docs/audit/IOS_COVERAGE.md` — the WKWebView
  harness and an honest statement of what still needs hardware.

---

## What none of this tooling can see

Every mechanism in this file has a ceiling. Naming the ceilings is the point of
the file, so they are collected here rather than left implied.

**1. The engine the app actually ships on.** Sections 1–8 are Chromium. The
production app is a WKWebView. Chromium has no content-process jetsam, no
software keyboard, and reports every `env(safe-area-inset-*)` as zero — so the
app-lock bug, the keyboard-covers-the-sheet bug and every safe-area bug are
invisible to it *by construction*, not by omission. `IOS_COVERAGE.md` records
what the simulator covers (deep-link navigation, appearance, Dynamic Type,
cold launch, real portrait insets) and what needs a physical device (jetsam,
push delivery, biometrics, camera, real GPS for the arrival geofence).

**2. The backend, on any Playwright row.** The state sweep's rows are
`page.route()` responses. A driven cell proves the React tree renders that
shape. It does not prove the RPC returns it, that RLS lets it through, that the
edge function is deployed, or that the money moved — and those are the classes
that reached production. Section 5's curl sweep and the `DB query` method are
the only evidence in this file that touches a real backend.

**3. Motion.** Every artifact here is a still frame. A transition that flashes
the wrong colour, a layout that jumps on mount, a skeleton that never resolves,
a toast that covers the control it is about — none of them survives into a PNG.

**4. Two surfaces at once.** Each state cell renders one job. A list where an
`accepted` chip sits directly above a `completed` chip — the pair whose colours
differ only by tint alpha, `--bark/0.12` against `--bark/0.18` — is covered only
by the `rich` density cells of the activity shell, and nowhere else.

**5. Anything a predicate can be written for is the easy half.** The gates in
this repo assert overflow, axe, tap size and heading count. Every one of the
~20 defects the owner found on 2026-08-31 passes all four. That is not a bug in
the gates; it is what predicates are. The state sweep exists to put a person or
a model in front of the pixels, and a run of it that nobody reviewed is worth
exactly as much as the route sweep nobody reviewed.

**6. States nobody enumerated.** Section 8's manifest is derived from source,
but it was derived by a person reading that source. A branch nobody found is a
cell nobody wrote. The nine collapsing rules in `STATE_MATRIX.md` exist so that
what was deliberately left out is written down and falsifiable — but they say
nothing about what was missed by accident.

---

## Account deletion & data retention — 2026-08-31 (privacy/compliance lane)

**Unit walked:** the whole `delete-own-account` path, end to end, against prod
(`fncmgoasalhdgfwzhsqa`) with purpose-built test accounts, plus the
`DeleteAccountDialog` overlay in Chrome. Four reported defects were re-verified
before any of them was touched; two of the four turned out to be broader than
reported.

### OPERATED — with the artifact

| Claim | Artifact |
| --- | --- |
| Client-side active-job pre-check throws `22P02` for every user | `GET /rest/v1/jobs?status=in.(accepted,arrived,in_progress,awaiting)` → `400 {"code":"22P02","message":"invalid input value for enum job_status: \"arrived\""}` |
| `auth.admin.deleteUser` refuses with a raw `23503` | `DELETE /auth/v1/admin/users/<uid>` → `500 {"code":"23503","message":"update or delete on table \"users\" violates foreign key constraint \"jobs_helper_id_fkey\""}` |
| The FIRST blocker is `jobs.helper_id`, not `payout_transfers` | Peeling constraints one at a time on a test account: `jobs_helper_id_fkey`, then `payout_transfers_helper_id_fkey`, then the delete succeeded |
| Deleting a review's AUTHOR erases the review | Counterparty's reviews went 1 → 0 on the author's deletion (rating 5, prod row) |
| Government ID survives a "successful" deletion | `id-documents/<uid>/licence.jpg` → HTTP 200 with the service key, after `deleteUser` returned 200 |
| Avatar survives, anonymously | `GET /storage/v1/object/public/avatars/<uid>/avatar.png` → HTTP 200 with NO auth header |
| PII messages survive with a dangling `sender_id` | `messages` row `"my address is 123 Elm St, call 555-0142"` still queryable post-delete (`messages` has no FK) |
| **10 of 31 prod accounts (32%) cannot be deleted today** | Census across all 12 live blocking FK columns + the transitive `payout_transfers.job_id` path |
| Storage purge works and is verified, not assumed | Fresh account, 3 objects across `avatars`/`id-documents`/`user-documents` → all removed, re-listed to confirm 0 left, ID doc then 400 |
| Migration is replay-safe | PGlite (real Postgres, WASM), applied 3× consecutively; FK snapshot byte-identical after each; 54 assertions pass |
| Delete dialog fits both breakpoints | `documentElement.scrollWidth === clientWidth` at 375 and 1440, steps 1 and 2; both actions above the fold at 375×812 after copy tightening (dialog scroll overflow 103px → 19px) |

### NOT OPERATED — and why

| Cell | Why |
| --- | --- |
| Post-migration deletion against **prod** | The migration cannot reach prod without a merge (`db-deploy.yml`), and this lane was told not to commit. The FK/retention half is proven in PGlite instead; the storage/auth half IS proven against prod. |
| Stripe subscription cancellation on a real subscription | `profiles.stripe_subscription_id` ships in an undeployed migration (`20260901011254`), so no prod row carries a subscription id yet. The code path degrades explicitly and records it in `steps`; the degradation was read, not driven. |
| `admin-delete-user` and `cleanup-abandoned-accounts` invoked live | Both now share the same `purgeAccount()` implementation that was driven through `delete-own-account`, but neither endpoint was itself called in this pass. |
| iOS / WKWebView surface | Chrome only this pass. |
| Cloudflare cache behaviour over time | See the finding below — observed once, not observed expiring. |

### Finding this lane could NOT fix in its own scope

**Deleting a public-bucket object does not stop anonymous access at its
canonical URL.** After the origin object was verifiably removed
(cache-busted URL → HTTP 400), the plain URL still answered **HTTP 200** with
`cf-cache-status: HIT`. Given at least one prod `avatar_url` is a photograph of
a driver's licence in the public `avatars` bucket, purging on deletion is
necessary but not sufficient — the fix is to stop serving identity-bearing
media from a public bucket at all (signed URLs or a transform endpoint). That
is the avatar/storage lane's call, not this one's.

### Second pass — what an adversarial review caught that 56 green assertions did not

The first cut of this change passed a 56-assertion PGlite suite, a 3× replay
check, both typecheckers and a rendered browser pass. A `silent-failure-hunter`
sweep then found four HIGH defects in it, two of which would have made account
deletion **permanently impossible** — the exact failure the change was written
to remove, relocated to a different population. Both were verified against prod
before being fixed:

| Defect | How it was confirmed | Why the harness missed it |
| --- | --- | --- |
| `purge_user_data()` set `jobs.location = NULL`, but the column is `NOT NULL` → `23502` aborts the whole transaction → deterministic 503 forever for every user with a retained job | PostgREST OpenAPI `definitions.jobs.required` on prod lists `location` | **The PGlite schema declared it nullable.** A harness that is not prod-shaped in the one dimension under test proves nothing, however many assertions it runs. |
| Storage purge was non-recursive: `remove("<uid>/portfolio")` is a no-op on a prefix, and the verification re-list then failed forever — while the flat avatar/ID objects had already been deleted, so every retry left the account further half-purged | Nested prefixes read from the upload call sites: `avatars/<uid>/portfolio/`, `user-documents/<uid>/credentials/`, `user-documents/<uid>/support/`, `application-attachments/<uid>/<jobId>/` | Storage is not in PGlite at all, and the prod storage test used a fixture with only flat objects. |
| `disputes.opener_id` was still `ON DELETE CASCADE` — the opener leaving destroyed the whole settlement: both parties' `evidence_urls`, `decision_text`, `payout_split` | `20260609140000_disputes_table.sql:37` | The FK list was assembled from the *deletion-blocking* set (NO ACTION / RESTRICT). A CASCADE is not a blocker, so it never appeared. |
| `messages` deleted on `receiver_id` too, destroying the counterparty's own messages — and `messages.attachment_url` is the only pointer to `message-attachments/<job_id>/<sender_id>/`, so those files were stranded permanently | `messages` columns read from prod | Policy error, not a harness gap: the same mistake as the review cascade, pointed the other way. |

Also fixed from that review: step 4a deleted `refunded`/`paid`/`failed` jobs
because its money test was a denylist (now an allowlist, and it will not delete
a job a helper was assigned to or applied to); the profile-redaction guard
tested 7 of the 20 columns it nulled and reported "already clean" over the
other 13 (now a dedicated `profiles.anonymized_at` stamp); a Stripe cancel
failure was never consulted by the success gate, so a deleted account could
bill forever while the dialog promised otherwise (now gates); `admin-delete-user`
dropped its profile-read error and reported transient failures as 404
(now `maybeSingle` + explicit error, and an orphan auth row with no profile is
deletable rather than stuck).

**The harness is now prod-shaped and provably catches the defect it missed.**
Re-running the suite with the `jobs.location` fix reverted reproduces
`23502 null value in column "location" of relation "jobs"`; with it restored,
**68 assertions pass, migration applied 3× with a byte-identical FK snapshot.**

---

## Force-update gate — 2026-09-01 (version-gating lane)

`platform_settings.min_supported_build` had existed since 20260609160000 with a
column comment naming the file that read it. That file did not exist. This lane
built it: `src/lib/minSupportedBuild.ts` → `src/hooks/useVersionCheck.ts` →
`src/components/ForceUpdateGate.tsx`, wired above `AppLockGate` in `App.tsx`,
plus migration `20260901035235` to expose the column through
`get_public_platform_settings()`.

Method for every row below: real Chromium (Playwright) against the dev server
with the Supabase RPC intercepted per case, plus jsdom unit tests, plus
read-only service-role queries against prod. Script:
`.claude-scratch/verify-force-update.mjs` — 45 checks, 43 pass, the 2 failures
are the App Store finding below and are real, not flaky.

| Cell | Status | Evidence |
| --- | --- | --- |
| Build ABOVE the minimum → app loads | WALKED | browser · `6000 vs 5000`: block screen absent, `#main-content` count 1. Also asserted at the boundary (`5906 vs 5906` → loads) in `ForceUpdateGate.test.tsx`. |
| Build BELOW the minimum → BLOCKED | WALKED | browser · driven twice: through the harness (`build=5906&min=6000`) and through the REAL read path with the RPC returning `min_supported_build: 6000`. Block screen present both times; `#main-content` absent, so the app tree is unmounted rather than hidden. Screenshot `.audit-shots/force-update/blocked-375.png`. |
| `min_supported_build = 0` (off) → app loads | WALKED | browser · both via the harness and via an intercepted RPC returning 0. |
| Settings read FAILS → app loads (FAIL OPEN) | WALKED | browser · four independent failure modes, all non-blocking: network `route.abort("failed")`; HTTP 500; RPC response omitting the column (the deploy-lag window); and the live prod RPC uninterrupted, which omits it today. |
| Fail-open unit matrix | WALKED | `src/lib/minSupportedBuild.test.ts` — 32 assertions: RPC error, RPC throw, empty row set, null, non-numeric, negative, >999,999, dotted CFBundleVersion, and the Supabase `error` being logged rather than dropped. |
| Web is never blocked | WALKED | browser · loaded `/` with no demo flag and the RPC armed at `999999`: block screen absent AND the gate issued **0 settings calls** — the platform check short-circuits before the request. |
| No horizontal overflow, 320/375/768/1440 | WALKED | browser · `documentElement.scrollWidth <= clientWidth` at all four (320/320, 375/375, 768/768, 1440/1440) and zero elements wider than the viewport. Screenshots `.audit-shots/force-update/blocked-{320,375,768,1440}.png`. |
| Primary CTA is glossy | WALKED | browser · computed `background-image` read at all four widths = `radial-gradient(125% 125% at 32% 22%, rgb(100,110,73) 0%, …)`. Read as a real gradient, not as a class name. |
| CTA tap target ≥ 44px | WALKED | browser · 272×56 at 320px; 327×56 at 375; 384×56 at 768 and 1440. |
| Block screen a11y | WALKED | browser · `role="dialog"`, `aria-modal="true"`, accessible name "Update Helpr to continue". |
| Support escape from the block | WALKED | browser · `mailto:admin@louisianahelpr.com` with subject and a body carrying `Installed build: 5906` / `Required build: 6000`; both numbers also rendered in plain text on screen. |
| **App Store link resolves** | **ISSUE FOUND** | `curl -sIL https://apps.apple.com/us/app/helpr/id6754470134` → **HTTP 404**; `https://apps.apple.com/app/id6754470134` → 404; `itunes.apple.com/lookup?id=6754470134&country=us\|gb\|ca\|au` → `resultCount 0` in all four; name search returns no Helpr. The id, not the slug, is what the lookup keys on, so this is not a renamed listing. Pre-existing (the URL came from `Footer.tsx`), now load-bearing. |
| Prod `platform_settings` state | WALKED | Read-only service-role, 2026-09-01: `min_supported_build = 0`, `latest_build = 0` — unchanged by this lane, every case above simulated. |
| Prod RPC shape today | WALKED | `POST /rest/v1/rpc/get_public_platform_settings` (service-role and anon) returns 8 columns, **no `min_supported_build`** — the migration is not deployed. Also confirmed the reason it must go through the RPC: anon `GET /rest/v1/platform_settings?select=min_supported_build` → `200 []` (RLS filters every row and returns success, not an error). |
| Native build number source | WALKED (read) | `ios/App/App/Info.plist:24` `CFBundleVersion 5906`; `project.pbxproj` `CURRENT_PROJECT_VERSION = 5906`, `MARKETING_VERSION = 1.0.4`. Read at runtime via `@capacitor/app` `App.getInfo().build`. |
| Resume re-check registers | WALKED | `ForceUpdateGate.test.tsx` asserts `App.addListener("resume", …)` is registered on a native mount. |

**UNVERIFIED — and why:**

- **Reading a REAL native build number.** Never done. `App.getInfo()` is
  `unimplemented` on web and the browser pass substitutes 5906 through a
  DEV-only harness (`?force_update_demo=1`, folded out of production builds by
  `import.meta.env.DEV`). Confirming that `getInfo().build` really returns
  `"5906"` needs a simulator or device build; nothing in a browser can
  establish it. This is the honest answer, not a deferral: the value's shape
  (an integer string) is asserted from `Info.plist` and from the plugin's own
  type declarations, but the call has not been made on a device.
- **The block screen in WKWebView.** Chrome only. Not driven in the iOS
  simulator, so safe-area insets on a notched device and the block screen's
  behaviour over a real cold start are unconfirmed.
- **The resume re-check firing for real.** The listener registration is
  asserted; an actual background→foreground transition flipping a live app from
  running to blocked has not been driven.
- **The deployed RPC.** Migration `20260901035235` is written, not deployed
  (ships via `db-deploy.yml` on merge). Its post-deploy shape is asserted only
  against an intercepted response. The deploy-lag window itself IS covered —
  the "column omitted" case is one of the four fail-open drives above.

---

## Copy-parity lane — 2026-09-01 (claims graded against their implementations)

**Unit: CLAIMS, not places.** `/help` was already `WALKED` above and was still
carrying nine false statements. A page can be rendered, measured, axe-clean and
completely untrue; "walked" answers *does it draw*, never *is it correct*. These
rows record the second question.

| Claim | Verdict | Evidence |
|---|---|---|
| Escrow is held when a poster **accepts** an application | FALSE -> fixed | Money is captured at checkout when the job is POSTED (`useJobSubmit.ts` -> create-payment `action:"escrow"`; recorded held by `checkoutSessionCompleted.ts:664`). `accept_application` (20260518120000) touches no payment state. |
| "Once you accept, a cancellation fee applies" | FALSE -> fixed | Fee is TIME-based, not acceptance-based: `_shared/cancellationFee.ts:22-30` — no helper 0%, 24h+ 0%, <24h 25%, <2h 50%. |
| Dispute is opened "from the job detail screen" | FALSE -> fixed | No such control. Lives on the Activity card via `DisputeLink`; requires a revision to lapse first (`DisputeLink.tsx:58-74`) and expires 7 days after completion (:88-95). |
| Credential tiers include "ID-verified only", offered on every job | FALSE -> fixed | Three tiers ship (`detailsSectionConstants.ts:39-43`), selector renders for four categories only (:28-33). |
| Cancellation rate shown after "5+ **completed** jobs" | FALSE -> fixed | `jobs_total >= 5` where jobs_total = COUNT(*) both sides, any status (20260901002325:221-231). |
| Senior Mode "enables a trusted family member to monitor jobs" | FALSE -> fixed | Feature deleted by `20260829083842_drop_family_care.sql`. The FAQ was the only place it still existed. |
| "Settings -> Delete account" | FALSE -> fixed | No Settings group; groups are Work/Money/Account/Legal. Control is the last pill on the landing (`SettingsSection.tsx:148`). Deletion is also refused while escrow is held (`delete-own-account/index.ts:56-105`) — previously undisclosed. |
| "manage or cancel from Manage membership" | FALSE -> fixed | No control by that name. Tab is "Membership", button is "Manage" (`SubscriptionTab.tsx:664`). |
| "standard payouts are always free" | FALSE -> fixed | A one-time onboarding fee is deducted from the first payout (`process-scheduled-payouts/index.ts:103-111`). |
| "Both parties are notified every 12 hours" (Legal) | FALSE -> fixed | ONE notification, to `customer_id` only, idempotent via `payment_confirm_notif_sent` (`payment-confirm-reminder/index.ts:222-260`). 12 is a delay, not a period. |
| "Three strikes = ban" (Legal TL;DR) | FALSE -> fixed | All four ladders pass `p_permanent_requires_review => true` (20260829030000:298,373,466; 20260831183302:195). No ladder bans anyone. |
| 72-hour dispute window auto-releases to the Helpr | TRUE | `dispute_deadline := disputed_at + interval '72 hours'` (20260330201452); `auto-resolve-disputes/index.ts:113-133` releases; escalated disputes are skipped by design (:55-70). |
| 500 ft GPS arrival radius (Legal) | TRUE | `v_verified := v_dist <= 500` (20260828011057). |
| "up to $25 in referral credits" | TRUE | `enforce_referral_cap` 5 x $5 (20260403151012). |
| Fee ladder 12/11/10/8% | TRUE | Derived from `TIER_PERKS` (`subscriptionTiers.ts:126,142,164,189`). |
| Early access 5/10/20 min | TRUE, **not derived** | `subscriptionTiers.ts:156,175,199`. Minute counts live in `earlyAccess.ts`'s tier switch; `TIER_PERKS` carries only a boolean, so the Help Center retypes them. No constant exists to interpolate — residual drift risk, reported not fixed. |

**Guards proven able to fail.** Both suites were mutation-tested: a divergence
was reintroduced, the failure observed, the file restored (integrity re-checked
against `git status`). 15 mutations, 15 caught. Four guards were found
STRUCTURALLY BLIND and fixed before they could catch anything:

1. `escrowTiming.copyParity` graded the reminder cadence with
   `/(\d+) \* 60 \* 60 \* 1000/`, which matched `24` out of the SEVEN-DAY
   observability lookback `7 * 24 * 60 * 60 * 1000` — the real delay is a named
   constant `\d+` cannot see. It failed the copy for disagreeing with a number
   from an unrelated window.
2. Its 72-hour loop filtered hits with `.numbers.includes(72)` before asserting
   they equalled 72 — so it only ever graded lines that were already correct.
   Changing 72 to 48 dropped the line out of the loop. Proven: green.
3. `consequenceCopyParity` matched `DISTINCT ... report` and
   `p_permanent_requires_review => true` against RAW migration text, and both
   hits were in HEADER COMMENTS. Deleting the aggregate at :174, or flipping the
   real call at :195 to `false` — a ladder that starts auto-banning with no
   admin review — left both suites green.
4. Both files' comment strippers used `/\/\*[\s\S]*?\*\//g`, which treats
   `accept="image/*"` (`DisputeDialog.tsx:302`) as a comment opener and deleted
   thirty lines of real policy copy from every scan. A stripper that eats copy
   makes a guard quietly narrower than it reads.

**UNVERIFIED — and why:**

- **iOS/WKWebView.** `/help` was driven in Chrome only (Playwright, headless).
  Not opened in the simulator, so Dynamic Type, safe-area insets and the
  accordion's touch behaviour on a notched device are unconfirmed.
- **`/help` search.** The page has no search input in the rendered DOM; the
  earlier ledger row implies one was expected. Not investigated — outside this
  lane's scope, flagged for whoever owns HelpCenter.tsx.
- **Prod dispute backlog.** The owner's report of disputes 9 days past deadline
  was NOT reproduced — no MCP/database access this session. Code reading gives
  two silent paths that would strand one: an escalated dispute is skipped by
  design (:55-70), and a dispute whose PaymentIntent is not `succeeded` is
  skipped with only a `console.error` (:98-108). Neither leaves a row, a metric
  or an alert. Owner-facing.
- **`payment-confirm-reminder`'s schedule hole.** Measured from source, not
  driven: cron is `15 15 * * *` (daily, 20260829010000) against a 12-hour
  eligibility window, so roughly half of submissions age out unreminded. The
  function computes this itself (`SCHEDULE_LEAVES_A_HOLE`, :82) and prescribes
  a six-hourly schedule. Routed to a sibling lane; copy cannot fix a schedule.

---

## Avatar / storage PII lane — 2026-09-01

Scope: the public `avatars` bucket, the `<UserAvatar>` photo guards, and the
two surfaces that consume their verdict. Owned files only
(`UserAvatar.tsx`, `avatarImage.ts`, `ProfileHeaderCard.tsx`,
`PhotoNameSection.tsx`).

### Verified working — with artifact

| Claim | Artifact |
| --- | --- |
| A driver's licence WAS anonymously fetchable | `HEAD /storage/v1/object/public/avatars/d1d41c75-…/avatar.jpeg`, no credentials → `HTTP 200`, `content-type: image/jpeg`, `content-length: 817249` |
| It is not any more | Same request → `HTTP 400` / `{"code":"NoSuchKey"}`; `render/image` route also 400; folder re-listed → `[]` |
| A US passport data page was ALSO anonymously fetchable, on a second profile | `HEAD …/avatars/7f65ef12-…/avatar.jpg` → `HTTP 200 image/jpeg 457287` before; `400 NoSuchKey` after |
| Both rows no longer point at the objects | `profiles.avatar_url` is `null` for `bb5ccf67-…` and `9d8cb28b-…` (PATCH returned representation) |
| The `avatars` bucket holds no other identity document | 16 objects enumerated, all opened, 2 were identity documents (both above), 14 were not |
| Every folder in `avatars` belongs to a seed/test account or the owner | 15 folders joined to `profiles.user_id`; no third party's data was read or modified |
| `user-documents` is genuinely private | Anonymous `GET` on `/object/public/`, `/object/authenticated/` and `/object/` → all `400`; with the publishable anon key → `400`. Same for `id-documents`, `proof-photos`, `business-documents`, `message-attachments`, `application-attachments` |
| Anonymous callers cannot enumerate any bucket | `POST /object/list/<bucket>` with the anon key → `403 AccessDenied`; with no key → `400` (missing authorization) |
| Deleting an `avatars` object DOES take effect at the edge | 3× `HEAD` on both deleted URLs → `cf-cache-status: BYPASS` every time. The bucket serves `cache-control: no-cache` (confirmed on a live control object), so Cloudflare never held these. **This narrows the earlier account-deletion lane's `cf-cache-status: HIT` finding — it does not reproduce on `avatars`.** |
| `onPhotoRejected` fires on a real prod blank avatar | `/profile?tab=profile` as `6b472670` (the smooth brown→olive gradient): `<img>` removed from the DOM, monogram `CT`, caption “That photo came through blank — tap to pick another.” at 375 AND 1440 |
| The "ID verified" badge no longer sits over a monogram | `/user/6b472670-…` with `stripe_identity_verified` temporarily true: `[aria-label="ID verified by Stripe"]` count `0`, while the "Stripe verified" trust pill still renders — the signal moved, it was not lost. 375 + 1440 |
| No solid avatar came back | Painted-pixel sample of the rendered avatar box: luma range 171.0 / Laplacian 27.15 at 375; 136.8 / 13.65 at 1440 — both far above the blank thresholds (6 / 3) |
| No horizontal overflow on either surface | `documentElement.scrollWidth === clientWidth` at 375 and 1440 on both routes |
| The two-detector blank check still works | The rejected avatar is the linear-gradient case (luma range ~17, passes detector 1) — it can only have been caught by the Laplacian |
| Gates | `npx tsc -b --noEmit` → exit 0; 64 tests pass across `avatarImage.test.ts` (35, new), `UserAvatar.test.tsx` (10, new), `PhotoNameSection.test.tsx` (9, new), `storagePolicies.test.ts` (10, existing) |

### Defects found

| Severity | Finding | Artifact |
| --- | --- | --- |
| HIGH | A photo of a Louisiana driver's licence was the avatar on a live profile, world-readable | anonymous `HTTP 200 image/jpeg` — fixed |
| HIGH | A photo of a US passport data page was the avatar on the owner's `admin@louisianahelpr.com` profile, world-readable. Not in the original report — found by the sweep | anonymous `HTTP 200 image/jpeg` — fixed |
| HIGH | **Avatar replacement leaves the old object live.** The storage path embeds the file extension (`<uid>/avatar.<ext>`), so re-uploading a `.png` over a `.jpg` writes a NEW object and the old one stays publicly fetchable forever while `avatar_url` points elsewhere. A member who uploads an ID, notices, and re-uploads a selfie has NOT removed the ID. | `e977a30f-…` holds BOTH `avatar.jpeg` (referenced) and `avatar.png` (orphaned). 3 of 14 live objects are orphaned this way. Upload sites are `Profile.tsx:455`, `completeProfile/uploadProfileFiles.ts`, `complete-signup/index.ts` — all outside this lane. |
| MEDIUM | `uploadProfileFiles.ts` applies **no** client-side type or size check at all (the other two avatar call sites check both) | read at source; only the bucket's 5 MB + mime allow-list stops anything |
| LOW | `avatarInitials` used `charAt(0)`, splitting a surrogate pair, so an emoji-first name rendered a lone surrogate — the exact "meaningless block" the module exists to prevent. Caught by a new test, fixed. | `avatarImage.test.ts` "never returns an empty string" / "keeps non-letter ink" |

### UNVERIFIED — and why

- **iOS / WKWebView.** Chrome (Playwright, headless) only. The Chrome MCP
  extension was not connected this session and the sim was not launched.
- **The upload-side fix for the orphaned-object defect.** Diagnosed and proven,
  not fixed — all three upload call sites are outside this lane's ownership.
- **Whether either identity document was fetched by anyone before removal.**
  Storage access logs were not queried; no way to establish this from the
  data available here. Must be assumed possible.
- **Third-party/browser caches.** Cloudflare provably did not hold these
  (`BYPASS`, `no-cache`), but anyone who already fetched either URL still has
  the bytes. Deletion cannot undo that.

---

## Offline writes / deep-link integrity lane — 2026-09-01

Three findings handed in as "one of these loses money silently." All three were
real. The scope was `src/lib/queryClient.ts`, `src/lib/requireOnline.ts`, the
`/pay-it-forward` redirect in `src/App.tsx`, the AASA file and
`ios/App.entitlements`.

**A note on how this lane's own coverage row was wrong.** The `/pay-it-forward`
redirect was already marked WALKED, evidenced as "landing URL observed in
browser." That is exactly the check that cannot see this defect: the landing URL
was correct — `/gift-card` — and the query string, which carried the money, was
gone. A redirect is not walked until the thing it is *carrying* is asserted.
Every redirect row above still rests on the weaker evidence.

### OPERATED — with the artifact

- **Offline write, save/unsave — prod vs fixed build, same account, same job,
  same procedure** (Playwright, `ctx.setOffline(true)`):

  | | prod (unfixed) | fixed build |
  |---|---|---|
  | `aria-label` @ +300/700/2500ms | `Unsave job` (stuck — false success) | `Save job` (rolled back) |
  | toasts | *(none)* | `Couldn't save that job right now — Tap retry to try again. Retry` |
  | requests since tap | `0` | `1` |
  | prod `saved_jobs` while offline | `0 -> 0` | `0 -> 0` |
  | after close (reload) + reconnect | `0 -> 0` | `0 -> 0` — no silent replay |

  Both runs also show the global banner "You're offline. Showing the last data
  we have." That banner is why this looked handled: the app *does* say it is
  offline, while the specific write vanishes without a word.

- **Offline write, MONEY path** (`/gift-card` → "Continue to Checkout", $25,
  recipient set, form valid, then offline): prod `netSinceTap=0` and no toast —
  a money button that does nothing and says nothing. Fixed build `netSinceTap=1`
  and `Couldn't send gift card — Couldn't start your gift card. Please try again.`

- **`?claim=` survival** — signed out: `/pay-it-forward?claim=X` →
  `/login?redirect=%2Fgift-card%3Fclaim%3DX` (prod: `%2Fgift-card`, token
  destroyed). Signed in: lands `/gift-card`, `claim-pif-credit` invoked once with
  `{"claim_token":"X"}`; the param is then stripped by PayItForward's
  exactly-once effect, which is correct.

- **AASA coverage, measured against every prod notification link**
  (`scripts/aasa-link-census.mjs`, 1617 rows):

  | | before | after |
  |---|---|---|
  | matched (opens app) | 217 (13.5%) | 1073 (66.6%) |
  | excluded (deliberate) | 0 | 536 |
  | unmatched (opens Safari) | 1394 (86.5%) | 2 (0.1%) |

  The 858 non-admin misses are closed. The 536 admin rows now actually match the
  `NOT` rules — previously `NOT /admin/*` matched neither `/admin` nor
  `/admin?view=`, so the deliberate exclusion was catching none of its traffic.

  `notifications` is a live table, so the absolute counts drift between runs
  (a re-run an hour later read 1686 non-null rows: 1083 matched / 601 excluded
  / **2 unmatched**). The shape is what matters and it is stable: the only
  uncovered shape left is `/warnings`, and that one is uncovered *deliberately*
  — see the defect below.

- **Entitlements** — `plutil -lint` OK on both; associated-domains now identical
  between the active `ios/App/App/App.entitlements` and the mirror
  `ios/App.entitlements`. Apex re-verified as unclaimable: apex AASA returns
  `HTTP/2 307` to www, www returns `HTTP/2 200`, and Apple does not follow
  redirects.

- **Gates** — `tsc -b --noEmit` exit 0; `queryClient.test.ts` +
  `requireOnline.test.ts` + `deepLinkRoute.test.ts` 30/30.

### NOT OPERATED — and why

- **iOS / WKWebView.** Chrome MCP extension not connected; the sim was not
  launched. Everything above is Chrome (Playwright, headless).
- **Universal-link association itself. This needs a real device and cannot be
  proven here at all.** The AASA is served correctly and its path list now
  matches prod traffic, but whether iOS actually opens the app for a given link
  depends on Apple's CDN having re-fetched the file and on the installed build
  carrying the matching entitlement. Neither the simulator nor curl establishes
  it. It must be checked on a device after the next TestFlight build.
- **`requireOnline()` on native.** The Capacitor branch is unit-tested (7 cases,
  including the WKWebView case where `navigator.onLine` lies) but has not been
  exercised in a real WKWebView.
- **The other 5 `useMutation` call sites** (`StrSettings` ×2, `PetProfiles`,
  `useApplyFlow`) were read and inventoried, not driven offline.

### Defects found that this lane could NOT fix (outside its ownership)

- **`/warnings` has no route — HIGH-ish, and it is why 2 links still miss.**
  Two prod notification rows link to `/warnings`. `App.tsx` defines no such
  route, so it falls through `path="*"` to `NotFound`. The tab it means exists
  (`/profile?tab=warnings`). It is deliberately NOT claimed in the AASA, because
  claiming it would only swap a web dead end for an in-app dead end. Fix is a
  redirect in `App.tsx` (`/warnings` → `/profile?tab=warnings`), which is
  outside this lane's `App.tsx` scope (pay-it-forward redirect only).
- **`normalizeDeepLinkUrl` drops `url.hash`** (`src/lib/deepLinkRoute.ts`, the
  final `return \`${path}${search}\``). This is what currently blocks claiming
  `/reset-password` and `/account-pending` in the AASA — both carry their
  session in the fragment. One-line fix, but the file is outside this lane.
- **The 11 other bare `<Navigate>`s in `App.tsx`** still drop `search`/`hash`.
  None is currently reached with a query (verified against both
  `notifications.link` and `error_logs.url`), so they are latent, not live —
  but 8 of them redirect to a target that already carries its own `?tab=`, so
  they need *merge* semantics, not the plain `PreserveQueryRedirect` this lane
  added. See the sweep table in the lane report.

---

## `charge-recurring-visits` — 2026-09-01 (L3 via the edge harness)

Reconciling this lane's pass against the row above: the function is **still in
the "never invoked over HTTP" list, and that is still accurate.** `.env`'s
`SUPABASE_SERVICE_ROLE_KEY` is the 219-char legacy JWT while the deployed
handler compares the bearer against `SECRET_KEY` (`sb_secret_*`), so no call
from this machine can get past `verifyCronSecret`.

What *was* operated instead: the real function source, driven end to end through
`src/test/edge/harness.ts` (19 scenarios, each negative-controlled by reverting
the fix and watching the test fail), plus read-only prod queries for the census
and the 1000-row cap. Depth **L3 on the logic, never L3 on the deployed
endpoint** — the same split §7.9 records for the rest of that lane.

Prod is unchanged and unexercised: 0 series parents, 0 generated visits, 0
release rows, 64 jobs total. Full findings, evidence and open items:
**`COVERAGE_2026-08-31.md` § "`charge-recurring-visits` — audited 2026-09-01"**
(that file has more than one `## 8`; several lanes appended sections the same
day, so cite it by title, not by number).

### Second pass — what the `security-auditor` sweep caught that 64 green tests did not

A review agent run against this lane's own diff found a **HIGH in the new code**,
measured with a real render probe. Recording it because the failure mode is
general, not incidental to avatars.

**`onPhotoRejected` emitted a spurious `null` AFTER a confirmed rejection.**
`useEffect(…, [imageSrc])` also runs on MOUNT, where there is nothing to reset —
and the ref callback (`inspect`) has already reached a verdict by then, because
refs fire in the commit phase before passive effects. The mount run cleared it:

```
mount on a cached blank bitmap:  [null, "blank-bitmap", null, "blank-bitmap"]
                                 isBlankAvatarBitmap called 2×, <img> rebuilt
```

Both consumers acted on the bogus `null`: `ProfileHeaderCard`'s shield went
true→false→true→false, **repainting the ID-verified badge over the blank block
the gate exists to suppress**, and `PhotoNameSection`'s `aria-live` caption
announced the wrong verdict on the way past. Invisible for a GOOD photo —
`setFailure(null)` hits React's eager bailout when state is already `null` — so
only the rejected path, the one that matters, was affected. Fixed with a
render-phase reset guarded by a `prevSrc` ref (React's documented pattern),
which also drops the wasted request and halves the sampling.

**Why the tests missed it: they asserted `seen[seen.length - 1]`, not the
sequence.** Last-emission assertions cannot see a wrong value in the middle.
All rejection tests now assert the full array. Two further tests were weak in
the same way and were rewritten, then **mutation-tested to prove they fail on
the regression they name**:

| Test | Was | Now | Mutation check |
| --- | --- | --- | --- |
| blank-bitmap verdict | last emission only | `toEqual([null,"blank-bitmap"])` | restore the mount-clobbering effect → fails |
| CORS retry | asserted attributes, all of which still hold with `key={corsMode}` deleted | asserts the `<img>` is a NEW element | delete `key={corsMode}` → fails |
| "cannot judge → show it" | vacuous — the mock ignored its argument, so it only restated the mock | drives the REAL detector against a tainted canvas, through the component | — |
| (new) | — | asserts the detector is handed the LIVE `<img>`, not a detached clone | — |

Also fixed: `avatarInitials("ßeta ßeta")` returned `"SSSS"` (uppercasing can
LENGTHEN — `ß`→`SS`), overflowing the monogram; capped with `.slice(0, 2)`.
`ProfileHeaderCard` now seeds `photoRejection` from `avatar_url` so a member
with no avatar never gets one painted frame of shield-over-monogram.

**Still open, outside this lane:** `IdentityHeader.tsx` renders `<UserAvatar>`
without `onPhotoRejected` and keeps `showsPhoto = hasPhoto && !isPlaceholder…`,
so the badge-over-monogram defect **still ships on the member's own profile
hero** — the surface the owner originally screenshotted. Its comment saying the
bitmap verdict "is NOT reachable from here" is now stale. Compounding it,
`avatarBroken`/`setAvatarBroken` is now a dead prop chain from `Profile.tsx:89`
down (no caller sets it since the `onError` handlers were removed), so
`useProfileLandingDerived`'s `hasPhoto` has silently lost its load-error term.
Both files are outside this lane's ownership.

Gates after the fixes: `npx tsc -b --noEmit` exit 0; **1,356 tests across 121
files** pass (every test file in the `UserAvatar` consumer areas, since it is a
shared primitive); both surfaces re-driven at 375 and 1440 with identical
results to the pre-fix pass.
