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

## Summary — as of 2026-08-31 (full-surface audit)

| Status | Count | Share |
| --- | ---: | ---: |
| **WALKED** — operated against real data, with a durable artifact | **155** | 67% |
| **PARTIAL** — touched only by an E2E spec (Chromium against a *mocked* Supabase) | **0** | 0% |
| **NEVER WALKED** | **77** | 33% |
| **Total tracked units** | **232** | |

Breakdown of the 232, each figure derived from source, not asserted:

| Group | Total | Walked | Never |
| --- | ---: | ---: | ---: |
| Real routes | 34 | 32 | 2 |
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

- **37 -> 34 real routes.** `/subscription` and both `/family` routes were
  still listed here; none is registered in `src/App.tsx` any more.
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

## 1. Routes — screens (34)

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
| `/help` | HelpCenter | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/wrapped` | HelprWrapped | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
| `/benefits` | BenefitsPage | WALKED | 2026-08-31 · browser | 6 breakpoints light + 2 dark, ~/lh-audit-2026-08-30/; axe 0, overflow 0, h1 1 |
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
| `/pay-it-forward` | `/gift-card` | WALKED | landing URL observed in browser; 2026-08-31 · browser |
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
| `notifications` | Notifications | WALKED | 2026-08-31 · browser; rendered + axe + layout measured at 1440 light & dark; ~/lh-audit-2026-08-30/ — 6 contrast failures found & fixed (5910a925) |
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
| `posted` | `/my-posts` | WALKED | 2026-08-31 · browser; incl. ?filter=scheduled/waiting/done, 6 breakpoints |
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
| Profile (incl. delete account, 2FA, instant payout, ProUpgradeSheet paywall) | 14 | NEVER WALKED |
| Post Job (IDV gate, redirect overlay, pickers) | 10 | NEVER WALKED |
| Nav / shell (GateSheet guest paywall, quick menu, sidebar) | 5 | NEVER WALKED |
| Admin (command palette, ban, refund, remove, status override, user detail) | 18 | NEVER WALKED |
| Native OS prompts (camera, geo, push, Face ID, share, social auth, in-app browser) | 9 classes | NEVER WALKED — needs the iOS sim |

## Related mechanisms

- `.claude/skills/lh-audit/SKILL.md` — the audit standard. It requires every
  report to carry a third section, **UNVERIFIED — could not reach, and why**.
  A row here that is `NEVER WALKED` should show up in that section of any audit
  claiming to have covered it.
- `npm run check:audit-evidence -- <report.md>` — scans a written audit report
  for claims that carry no artifact and prints the ratio.
