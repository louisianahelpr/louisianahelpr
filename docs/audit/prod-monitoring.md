# Production monitoring — what is captured, where it goes, who is told

Terminal 4, production watching, 2026-09-12. Verified live against prod
`fncmgoasalhdgfwzhsqa` (pg_policies, pg_trigger, cron.job, error_logs counts),
not from migration files.

## The paths, end to end

| Signal | Captured by | Lands in | Alerted how | Who sees it |
|---|---|---|---|---|
| Any `report()` call in the client (boundaries, ErrorState, QueryCache/MutationCache, money actions, global `error`/`unhandledrejection`) | `src/lib/errorLogger.ts` `report()` — redacts tokens/JWTs, strips query strings, drops localhost, tags `source` + `screen`, stamps `context.release` (build sha) | `public.error_logs` (RLS: `anyone_can_insert_errors`, `admins_can_read_errors`; TTL sweeper `sweep-old-error-logs`) **and** fan-out to Sentry + PostHog | `trg_error_logs_slack` (AFTER INSERT) → `slack-ops-alert` edge fn → `#ops-alerts`; identical message deduped 10 min. **NEW:** `.github/workflows/prod-errors.yml` every 15 min → GitHub issue `prod-errors` | Slack channel (everything); GitHub issue (only real-user error screens / request spikes); `/admin?view=health` |
| Client exceptions with stack + replay | `src/lib/sentry.ts` (`@sentry/react`, prod only, 10 % session replay, 100 % on error). Release = build sha via `.github/workflows/sentry-release.yml` (source maps uploaded on push to main) | Sentry project (`SENTRY_ORG`/`SENTRY_PROJECT` secrets) | Sentry's own alert rules / digest e-mails — **not configured from this repo**; owner reported learning about errors from the digest, i.e. hours later | Owner's inbox, when Sentry decides |
| Boot failure before the bundle loads ("Helpr couldn't load.") | `index.html` boot watchdog writes `localStorage.helpr_boot_failure`; the next successful boot reports it (`src/main.tsx`, source `BootWatchdog`, tag `screen`) | error_logs (as above) | as above — but only when that device boots successfully later | as above |
| Cron over HTTP that fails or answers 200 while doing nothing | `cron_http_failure_watcher` + `silent_cron_failure_detector` (`cron_run_log`, `sweep-silent-cron-failures`), `cron_sql_error_reporting` | error_logs rows with `tags.source = cron-http` (653 in the last 7 days — the single biggest source) | Slack via the same trigger | Slack |
| Scheduled GitHub workflows that stopped firing | `.github/workflows/schedule-heartbeat.yml` (daily, WATCHED list — now includes `prod-errors.yml`) | run log | `nightly-issue-sync` → issue `nightly-red` | Sessions must read `gh issue list -l nightly-red` at start (CLAUDE.md) |
| Backend health (Stripe, cron, queue depth, stuck payments) | `supabase/functions/health-check` (CRON_SECRET or admin JWT) | JSON | Called daily by `edge-function-smoke.yml` 13:00 UTC (red run → `nightly-red` issue) and on demand by the admin Health view | Admin view / nightly-red |
| Prod serving a stale build | `prod-freshness.yml` (push + daily 07:45) | run log | red run | Actions tab |

## What the numbers looked like when this was written

- 487 error_logs rows in the last 24 h; 7-day sources: `cron-http` 653, `realtimeRecovery` 464, `PaymentSuccess.confirmPayment` 14, boundaries 55 (`ErrorBoundary` 25, `RouteErrorBoundary` 30 over 30 days), `ProtectedRoute.profileFetchError` 3.
- 444 of the 7-day rows with a user belong to seed accounts (56 `profiles.is_seed`); 46 to real users; 711 anonymous (mostly cron).
- Every Playwright/test account is `is_seed = true`, so "exclude seed" is one predicate: `user_id NOT IN (SELECT user_id FROM profiles WHERE is_seed)`.

## Gaps found and closed in this pass

1. **The "Couldn't load" cards never reported.** Forty callers render `ErrorState` from a query error; `queryClient` had no `onError`, so error_logs saw the crashes and none of the failed loads. Now `QueryCache`/`MutationCache` report every final failure (tag `key` = first key segment) and `ErrorState` reports once per mount (`source: ErrorState`, tag `title`). Offline is skipped.
2. **No `screen` tag.** Boundaries tagged `route`/`section`/`path` inconsistently, ErrorBoundary nothing. Every surface now tags `screen` (pathname, no query); `currentScreen()` in errorLogger.
3. **Three money toasts without a report:** TipDialog (tip), ActivityDialogs (request_revision), AdminJobs (admin refund). Now `source: money.*`.
4. **No release on the row.** `context.release` = build sha on every row.
5. **Nothing turned rows into a page for the owner except the Slack firehose** (every distinct message, seed traffic included — the E2E suites alone post hundreds). The prod-errors workflow is the alarm: seed excluded, one issue, auto-closed.
6. **Guard:** `src/test/errorSurfacesReport.test.tsx` renders each surface and asserts `report()` with `source` + `screen`; diffs `e2e/errorScreens.ts` against what it rendered; asserts every `create-payment` caller reports. Proven red by removing one tag (3 tests fail).

## Still open (not closed here)

- Sentry alert rules live in Sentry's UI, unverified from the repo. The GitHub issue path does not depend on them.
- The Slack trigger fires on seed traffic too; consider excluding `is_seed` users there as well (owner asked for "any error", so left as is).
- `realtimeRecovery` (464/7d) and `cron-http` (653/7d) dominate the table; both are noise until someone decides a threshold. The prod-errors check ignores them (class `other`).
- The boot watchdog only reports if the same device later boots; a device that never recovers is invisible. Sentry cannot see it either (no bundle).
