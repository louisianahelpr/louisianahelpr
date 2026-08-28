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

## Summary — as of 2026-08-27

| Status | Count | Share |
| --- | ---: | ---: |
| **WALKED** — operated end-to-end against real data, with a durable artifact | **0** | 0% |
| **PARTIAL** — touched by an automated E2E spec (Chromium against a *mocked* Supabase) | **27** | 20% |
| **NEVER WALKED** | **107** | 80% |
| **Total tracked units** | **134** | |

Breakdown of the 134: 37 real routes + 14 redirect routes + 18 Profile tabs +
2 Activity tabs + 63 edge functions.

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

## 1. Routes — screens (37)

Source of truth: the `<Route>` table in `src/App.tsx`. Enumerated, not guessed.

| Route | Component | Status | Last genuinely walked | Evidence |
| --- | --- | --- | --- | --- |
| `/` | Index / MarketingRedirect | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/login` | Login | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/signup` | Signup | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/signup-pending` | SignupPending | NEVER WALKED | never | — |
| `/complete-profile` | CompleteProfile | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/account-pending` | AccountPending | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/account-denied` | AccountDenied | NEVER WALKED | never | — |
| `/account-banned` | AccountBanned | NEVER WALKED | never | — |
| `/forgot-password` | ForgotPassword | NEVER WALKED | never | — |
| `/reset-password` | ResetPassword | NEVER WALKED | never | — |
| `/dashboard` | Dashboard | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/profile` | Profile | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/post-job` | PostJob | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/my-jobs` | Activity (applied) | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/my-posts` | Activity (posted) | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/payment-success` | PaymentSuccess | NEVER WALKED | never | — |
| `/user/:userId` | UserProfile | NEVER WALKED | never | — |
| `/admin` | Admin | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/messages` | Messages | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/support` | Support | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/legal` | Legal | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/jobs` | Jobs (public) | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/jobs/:id` | JobDetail | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/browse` | DashboardGuest | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/subscription` | SubscriptionPage | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/str-settings` | StrSettings | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/auto-tip` | AutoTip | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/gift-card` | PayItForward | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/family` | FamilyDashboard (flagged) | NEVER WALKED | never | — |
| `/family/accept/:token` | FamilyAcceptPage (flagged) | NEVER WALKED | never | — |
| `/home-history` | HomeHistory | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/work-record` | WorkRecord | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/help` | HelpCenter | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/wrapped` | HelprWrapped | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/benefits` | BenefitsPage | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `/pets` | PetProfiles | PARTIAL | never | E2E spec navigates here (mocked backend) |
| `*` | NotFound | NEVER WALKED | never | — |

## 2. Routes — redirects (14)

A redirect is walked when you have observed the *landing* URL after navigating
to the source, not when you have read the `<Navigate>` element.

| Route | Redirects to | Status | Evidence |
| --- | --- | --- | --- |
| `/activity` | `/my-posts` | NEVER WALKED | — |
| `/earnings` | `/profile?tab=earnings` | NEVER WALKED | — |
| `/terms` | `/legal?tab=terms` | NEVER WALKED | — |
| `/privacy` | `/legal?tab=privacy` | NEVER WALKED | — |
| `/rules` | `/legal?tab=community` | NEVER WALKED | — |
| `/data-rights` | `/profile?tab=legal` | NEVER WALKED | — |
| `/schedule` | `/profile?tab=schedule` | NEVER WALKED | — |
| `/availability` | `/profile?tab=availability` | NEVER WALKED | — |
| `/saved-helpers` | `/profile?tab=saved_helpers` | NEVER WALKED | — |
| `/pay-it-forward` | `/gift-card` | NEVER WALKED | — |
| `/analytics` | `/profile?tab=earnings` | NEVER WALKED | — |
| `/dashboard/post-login` | `/dashboard` | NEVER WALKED | — |
| `/settings/profile` | `/profile` | NEVER WALKED | — |
| `/settings` | `/profile` | NEVER WALKED | — |

## 3. Profile tabs (18)

Source of truth: `TAB_TITLES` in `src/pages/profile/types.ts`, plus the
`landing` tab. Each is a distinct screen reached as `/profile?tab=<key>`.
`/profile` being PARTIAL above does **not** cover any of these.

| Tab | Screen | Status | Evidence |
| --- | --- | --- | --- |
| `landing` | Profile landing | NEVER WALKED | — |
| `profile` | Edit Profile | NEVER WALKED | — |
| `earnings` | Earnings & Payouts | NEVER WALKED | — |
| `payment` | Earnings & Payouts (legacy deep link) | NEVER WALKED | — |
| `schedule` | Schedule | NEVER WALKED | — |
| `availability` | Availability | NEVER WALKED | — |
| `security` | Account Security | NEVER WALKED | — |
| `legal` | Legal & Policies | NEVER WALKED | — |
| `reviews` | My Reviews | NEVER WALKED | — |
| `referral` | Referrals | NEVER WALKED | — |
| `subscription` | Membership | NEVER WALKED | — |
| `support` | Help & Support | NEVER WALKED | — |
| `notifications` | Notifications | NEVER WALKED | — |
| `posted_jobs` | Posted Jobs | NEVER WALKED | — |
| `completed_jobs` | Completed Jobs | NEVER WALKED | — |
| `warnings` | Warnings & Strikes | NEVER WALKED | — |
| `credentials` | Licensed & Insured | NEVER WALKED | — |
| `saved_helpers` | Saved Helprs | NEVER WALKED | — |
| `accessibility` | Accessibility | NEVER WALKED | — |

## 4. Activity tabs (2)

Source of truth: `type Tab` in `src/components/activity/activityConstants.ts`.
Each tab additionally has status filters and per-status card states — force
them; a tab seen in one status is not a walked tab.

| Tab | Route | Status | Evidence |
| --- | --- | --- | --- |
| `posted` | `/my-posts` | PARTIAL | E2E spec navigates here (mocked backend) |
| `applied` | `/my-jobs` | PARTIAL | E2E spec navigates here (mocked backend) |

## 5. Edge functions (63)

Source of truth: `supabase/functions/` (excluding `_shared`). "Walked" here
means **executed against the deployed function** and the status observed —
`curl` output or a Supabase log row. Reading the handler is not evidence, and
neither is the function appearing in `list_edge_functions` (deployed is not
working — a function can be live and 503 on every call, which `mapkit-token`
did).

All 63 are `NEVER WALKED`. Record evidence as `2026-08-27 · curl → 200`.

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

## Related mechanisms

- `.claude/skills/lh-audit/SKILL.md` — the audit standard. It requires every
  report to carry a third section, **UNVERIFIED — could not reach, and why**.
  A row here that is `NEVER WALKED` should show up in that section of any audit
  claiming to have covered it.
- `npm run check:audit-evidence -- <report.md>` — scans a written audit report
  for claims that carry no artifact and prints the ratio.
