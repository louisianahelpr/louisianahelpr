# Observability audit — 2026-05-28

Triage doc following the same-day double-regression in PRs **#355** and **#358**, both of which bricked every signed-in user's dashboard and reached prod without firing an alert.

- #355 — `permission denied for function has_role` (RLS helper). Caught when a developer cold-launched the sim, read the system log, and noticed `[StrikeBanner] failed to load ban status: {"code":"42501",...}`.
- #358 — same regression class one function deeper (`is_business_member`, `is_business_owner`, `mask_job_location`). The dashboard rendered the honest *"We couldn't load jobs"* ErrorState after #355 went out. Same diagnostic path.

Both bugs were in the observable surface but no alert ever fired because: (a) the relevant RPCs were called from `queryFn`s that destructured `data` only and let the `error` go to `report()` as a *warning* with no matching Sentry alert rule, and (b) Postgres 42501 errors don't pattern-match any existing rule in `docs/SENTRY_ALERT_RULES.md`.

---

## What we have today

### Initialization & breadcrumbs
- **Sentry** — `src/lib/sentry.ts`. DSN baked in, env-tagged, replay deferred behind `requestIdleCallback`, benign-error filter, `cold_launch=true` tag set for the first 10 s after boot, breadcrumb helper `markColdLaunchPhase(phase)`.
- **PostHog** — `src/lib/posthog.ts`. `capture_exceptions: true` mirrors window `error`/`unhandledrejection` to PostHog Error Tracking. Autocapture + surveys disabled for perf.
- **Local error_logs** — `src/lib/errorLogger.ts`. `report(err, opts)` queues rows into the Supabase `error_logs` table AND fans out to Sentry + PostHog. PII redacted (Bearer, JWT, `?token=`, `?code=`, `sb_secret_`). Skips localhost.
- **Analytics funnel** — `src/lib/analytics.ts`. `track(event, props)` writes to `analytics_events` + fans out to PostHog. Curated AhaEvent enum covers signup → first job → first payment funnel.
- **Cold-launch phase breadcrumbs** — `useAuthReady.ts` calls `markColdLaunchPhase("auth-ready-resolved")` on the first `isReady=true` transition. `initSentry()` itself drops `init`.

### Error reporting call sites (`report(...)` in src/, excluding tests) — 49 unique
A clean inventory by area:

| Area | Count | Source tags |
|---|---|---|
| Boundaries / global handlers | 4 | `RouteErrorBoundary`, `ErrorBoundary`, `window.onerror`, `unhandledrejection` |
| Dashboard data | 3 | `dashboard.ctx_query`, `dashboard.ctx_subquery`, `dashboard.open_jobs_browse_error` |
| Payouts / Stripe Connect | 4 | `PayoutSetupForm.status`/`.methods`/`.completedTrack`, `EarningsTab.fetchPayouts`/`.fetchLedger` |
| Job posting | 4 | `PostJob.uploadImage`, `PostJob.paymentInvoke`, `PostJob.orphanCleanup` (×2) |
| Notifications / push | 8 | `pushNotifications.registerSW`, `persistPushToken*`, `savePushToken`, `push.registrationError`, `push.autoRegister`, `appUrlOpen`, `useNativePushSetup`, `requestPushPermission` |
| Email notifications | 4 | `createNotification.insert`/`.email`/`.emailCatch`, `notifyAdminsOfEmailFailure` |
| Admin user actions | 6 | `AdminUsers.send*Email`, `AdminIDVQueue.sendVerifiedEmail`, `AdminHealth.sendTestPush`, `AdminUserNotes.load`, `DenyUserDialog.sendDenialEmail` |
| Marketplace + chat | 4 | `BrowseMap.rpc`, `CancellationDialog.autoVoid`, `DisputeDialog.uploadEvidence`, `PhotoProof.upload`/`.createSignedUrl` |
| Misc | 12 | `slackAlerts.dispatch`, `logAdminAction`, `inAppReview.requestReview`, `userBlocks.autoVoidAfterBlock`, `parishLookup.rpc`/`(catch)`, `Signup.referral`/`.businessCreation`/`.inviteLinking`/`.phoneDedupe.multipleMatches`, `DataRights.exportData`, `BusinessTeam.seatSubscriptionSync`, `PaymentSuccess.firstPaymentCount`, `useLoginTracking`, `NotFound.404`, `BusinessVerificationCard.fetch` |

### Existing Sentry alert rules (per `docs/SENTRY_ALERT_RULES.md`)
| # | Pattern | Tier |
|---|---|---|
| 1 | `message contains "does not exist"` AND NOT `relation` | P0 |
| 2 | `message contains "notifications_type_check"` | P0 |
| 3 | `message contains "Invalid job status transition"` | P0 |
| 4 | `message contains "transfer sent but ledger write failed"` | P0 |
| 5 | `message contains "send-push-notification" AND (failed/error/timeout/non-2xx)` | P0 |
| 6 | `tags.source IN {edge fn names}` seen >5×/1h | P1 |
| 7 | `message contains stripe-connect / onboarding` >3×/15m | P1 |
| 8 | Stripe webhook signature mismatch | P2 |
| 9 | Rate-limit hits >20×/1h | P2 |

Plus one issue-alert (per `docs/sentry-cold-launch-alert.md`): any new issue with `cold_launch:true` tag in prod.

---

## What we'd want to know within 5 minutes of breaking

| Scenario | Today's signal | Would it page? |
|---|---|---|
| Signed-in dashboard 0% loads (the #355/#358 class) | `dashboard.open_jobs_browse_error` reports as `severity: warning` to Sentry with message `permission denied for function …`. Not caught by any P0/P1 rule. | **No.** Lands in the issue stream silently. |
| Cold-launch fresh-install error on a real device | `cold_launch:true` tag + Sentry alert rule | **Yes** (within ~1 min of the rule firing). Only covers errors in the first 10 s after `initSentry()`. |
| Signed-in user can't reach `/dashboard` (profile fetch failure) | `ProtectedRoute.tsx:142` redirects to `/login` *silently* — no `report()`, no analytics event. `useCurrentUser` throws but the throw is consumed by React Query's `isError` flag. | **No.** Same silent /login bounce that caused #355's repro pain. |
| Login attempt fails (Supabase auth error) | `Login.tsx:64` shows `toast.error(error.message)`. No `report()`. Auth errors aren't on PostHog either. | **No.** A site-wide auth outage would surface only via support tickets. |
| Stripe Connect onboarding starts failing | Rule 7 fires after >3 errors in 15 min if the error message contains `stripe-connect`. Sources also tagged. | **Mostly yes**, but message text varies per Stripe API change; tag-based variant is safer. |
| `get_public_platform_settings` RPC starts erroring (the exact class of #355) | One call site (`useDashboardData.ts:51`) reports it as a `dashboard.ctx_subquery` warning. Two other call sites (`usePostJobForm.ts:98`, `DashboardGuest.tsx`-area) drop the error entirely. | **No alert** would fire, and the post-job form silently defaults to a 10% fee. |
| Push-token persistence fails (helpers stop getting job alerts) | `persistPushToken.upsert` reports to Sentry. No alert rule. | **No.** Helpers go quiet and we find out via churn. |
| New-user signup completes but profile insert fails | `Signup.referral`/`.businessCreation`/`.inviteLinking` report. Main profile insert isn't wrapped in `report()`. | **Partial.** Funnel-side: `signup_completed` event still fires from `track()` so PostHog funnel doesn't drop, masking the failure. |
| Edge function 5xx burst | Rule 6 catches by `tags.source` once >5×/1h. | **Yes.** |
| Notifications-table type CHECK regression | Rule 2 matches the exact constraint name. | **Yes.** |

---

## Gaps

### G1 — Postgres permission errors (42501) have no alert
**Scenario:** Exactly the #355/#358 class. `permission denied for function <name>` on any RLS helper, RPC, or view-projected function.
**Where in code:** Already surfaces via `report()` in `useDashboardData.ts:88` and `:163`. The error text is preserved; it just doesn't match a rule.
**Fix:** Add a P0 Sentry alert rule.
- Name: `P0 — Postgres permission denied (RLS / function GRANT drift)`
- Environment: `production`
- When: A new issue is created OR an existing issue regresses
- If: `message contains "permission denied for"` (covers both `permission denied for function X` and `permission denied for relation X`)
- Then: P0 target

### G2 — Dashboard-bricking errors filed as `severity: warning`
**Scenario:** The actual error that bricked every dashboard was reported with `severity: "warning"` (see `useDashboardData.ts:69` and `:164`). Sentry alert rules can be filtered by level — but our existing P0 rules don't filter by level, so this isn't *why* they missed. The real issue is that **the message text doesn't match any rule**. Still worth re-leveling: an error that bricks every signed-in user's primary surface is `error`, not `warning`.
**Where:** `src/hooks/useDashboardData.ts:69` (ctx_query), `:88` (ctx_subquery), `:163` (open_jobs_browse_error).
**Fix:** Promote to `severity: "error"`. Add a Sentry rule `tags.source startsWith "dashboard."` with `>3 in 5 min` → P0.

### G3 — `ProtectedRoute` silent `/login` bounces have zero observability
**Scenario:** When `useCurrentUser` exhausts retries (the symptom that #355 produced for hours before manual diagnosis), `ProtectedRoute.tsx:142` returns `<Navigate to="/login" replace />` with no report and no event. From Sentry's view: nothing happened. From PostHog's view: a `$pageview` for `/login`, indistinguishable from a normal sign-in flow.
**Where in code:** `src/components/ProtectedRoute.tsx:142-144`.
**Fix:** Before the `<Navigate>`, call `report(new Error("ProtectedRoute: forced /login bounce after profile fetch error"), { severity: "error", tags: { source: "ProtectedRoute.profileFetchError", path: location.pathname } })` and `track("forced_logout_bounce", { reason: "profile_fetch_error" })`. Add an alert: `tags.source equals "ProtectedRoute.profileFetchError"` seen >2×/5 min → P0. Add a PostHog funnel `sign_in → /dashboard` and alert on funnel-drop spikes (any drop above baseline noise means dashboards aren't loading for someone).

### G4 — Login auth errors are toasted but never reported
**Scenario:** Supabase auth outage / DB-side trigger break that rejects every sign-in. `Login.tsx:64` shows `toast.error(error.message)` and stops. No `report()`, no `track()`.
**Where:** `src/pages/Login.tsx:63-77`.
**Fix:** Inside the `if (error)` branch, call `report(error, { tags: { source: "Login.signIn", supabase_code: (error as any).status } })`. Add Sentry alert `tags.source equals "Login.signIn"` >5×/5 min → P1. Add a PostHog funnel from `signup_completed` → `email_verified` → first `$pageview` on `/dashboard` so a sudden funnel drop pages even if no exception is thrown.

### G5 — `get_public_platform_settings` failures silent in two call sites
**Scenario:** A grant regression on the same RPC that bricked the dashboard would also (a) silently default the post-job form's fee to 10%, (b) silently render the guest landing page with no enrichment. Neither call site checks `error`.
**Where:** `src/pages/postjob/usePostJobForm.ts:98`, `src/pages/DashboardGuest.tsx` (job-list `Promise.all`).
**Fix:** Convert to `unwrap()`-in-`queryFn` (see Dropped-error inventory below) and add an alert on `tags.source startsWith "usePostJobForm."` and an issue rule on `message contains "get_public_platform_settings"`.

### G6 — Push-token persistence failure has no alert
**Scenario:** Helpers stop getting job-match pings because `persistPushToken.upsert` started 403'ing after a `push_tokens` RLS migration. Reported, never paged.
**Where:** `src/lib/nativePush.ts:50-65`.
**Fix:** Add alert rule `tags.source IN {persistPushToken.upsert, savePushToken, push.registrationError, push.autoRegister}` >3×/15 min → P1.

### G7 — Migration unapplied to prod has no detector
**Scenario:** This is the meta-cause of #355 *and* the May-09 chat-push outage (per existing `SENTRY_ALERT_RULES.md`). The codebase merges and the migration sits unapplied for hours. The PGRST202 fallback path inside the React code silences the symptom, so the issue stream never shows the "function not found" error.
**Where:** Many sites: `src/hooks/useActivityData.ts`, `src/lib/notifications.ts`, fallbacks around `reject_other_applications_on_accept`, etc.
**Fix:** Wherever there's a PGRST202 silent fallback, also `report()` a one-time-per-session warning with a distinguishable tag (`source: "migration.unapplied_in_prod", rpc: "<name>"`). Add a P1 rule: `tags.source equals "migration.unapplied_in_prod"` → P1 with `@channel` to whoever holds the `supabase db push` keys. This is the "are you holding a merged migration you forgot to push" signal.

### G8 — No funnel-drop alert (PostHog side)
**Scenario:** A break that doesn't throw — e.g. the dashboard renders the ErrorState ("we couldn't load jobs") and stops. No Sentry event needs to fire. The user just bounces.
**Where:** PostHog dashboard, not code.
**Fix:** Three funnels worth tracking with anomaly alerts: (a) `signup_completed → first_job_application_sent` within 7 days, (b) `JobPosted → PaymentMade` within 1 day, (c) hourly count of `$pageview` on `/dashboard`. A sustained dip in (c) below 2 standard deviations of the trailing-30-day mean is the broadest possible "the app is broken for signed-in users" signal.

### G9 — `error_logs` table is write-only; no one reads it
**Scenario:** The table exists and gets every `report()` call (per `errorLogger.ts:138`). Nothing queries it on a schedule. A spike in `error_logs` rows would be a great cheap "something is wrong" signal that doesn't depend on Sentry's pricing tier or alert quotas.
**Where:** `supabase/migrations/20260510033255_error_logs_ttl_sweeper.sql` is the only mention beyond the writer.
**Fix:** Add a cron edge function (15 min cadence) that counts `error_logs` rows in the last 5 min grouped by `tags->>source`; emit a Slack alert via the existing `slackAlerts` mechanism (`src/lib/slackAlerts.ts`) if any source group exceeds a threshold. Bonus: this is the audit trail that survives Sentry quota burn.

---

## Dropped-error call sites

Pattern: `const { data… } = await supabase.{from,rpc,functions.invoke,storage…}(…)` without checking `error`. Listed in order of user-reach (every-page hooks first, then per-page, then admin/edge).

### High user-reach — frontend hooks and pages every signed-in user hits
| File:line | Code | Fix |
|---|---|---|
| `src/hooks/useActivityData.ts:107` | `const { data: helperProfiles } = await supabase.rpc("get_safe_profiles", …)` | Use `unwrap()`; this hook is the entire Activity tab. A broken `get_safe_profiles` (which already happened class-of in #358) silently renders every helper as "Helpr". |
| `src/hooks/useActivityData.ts:155` | `const { data: profiles } = await supabase.rpc("get_safe_profiles", …)` | Same. |
| `src/hooks/useActivityData.ts:166` | `const { data: directPosterProfiles } = await supabase.rpc("get_safe_profiles", …)` | Same. |
| `src/hooks/useActivityData.ts:289` | `const { data: profiles } = await supabase.from("profiles")…` | Same. |
| `src/pages/postjob/usePostJobForm.ts:98` | `supabase.rpc("get_public_platform_settings").then(({ data }) => …)` | **Highest priority.** Same RPC that bricked #355. Silently falls back to 10% fee. Wrap in `unwrap()` + `try/catch` + `report()`. |
| `src/pages/postjob/usePostJobForm.ts:363` | `const { data: prof } = await supabase.from("profiles").select("idv_status…")…` | Drops the error. If this query fails the gate fails-open or fails-stuck; either is wrong. |
| `src/pages/Login.tsx:99` | `const { data: prof } = await supabase.from("profiles")…` | The greeter — wrapped in `try/catch { /* fall through */ }`. Acceptable, but log at warning level for trend visibility. |
| `src/pages/Signup.tsx:200` | `const { data: existing } = await supabase.from("profiles").select("user_id").ilike("phone"…)` | Phone-dedupe lookup. Silent failure → false negative → duplicate accounts. |
| `src/pages/Signup.tsx:390` | `const { data: invites } = await supabase.rpc("get_pending_invite_for_email", …)` | Silent failure means business invites never resolve at signup. |
| `src/pages/Messages.tsx:546` | `const { data: existing } = await supabase.from("user_violations")…` | Determines whether to permanently ban a user for off-platform attempts. Silent failure here = wrong action. |
| `src/pages/Messages.tsx:564,584` | `const { data: adminRoles } = await supabase.from("user_roles")…` | Admin-notify fanout. Silent failure = admins never paged about banned-user events. |
| `src/components/BroadcastBanner.tsx:34,44` | `const { data: active } = await supabase.from("broadcast_messages")…` and dismissals | Banner just doesn't render. Low harm but no telemetry. |
| `src/components/dashboard/JobDetailDialog.tsx:86` | `const { data: userRes } = await supabase.auth.getUser()` (then `const { count }` from `jobs`) | "Repeat customer" badge. Silent failure → badge missing. Worth at least a warning. |

### Per-page action handlers (high consequence on action)
| File:line | Code | Fix |
|---|---|---|
| `src/pages/activity/useActivityActions.ts:272` | `const { data: prof } = await supabase.from("profiles").select("idv_status…")…` | IDV gate before accepting a job. Silent failure can block real users or let unverified through depending on fall-through. |
| `src/pages/activity/useActivityActions.ts:371,398,409,429,449,566,584` | Various silent `.from()` calls in the deny/accept/no-show flows | These run in mutation handlers. Wrap each in error checks; report violations of the admin-notify path especially. |
| `src/components/CancellationDialog.tsx:108,151` | `existing` violations + admin-roles fanout | Same pattern — admin notification silently drops if `user_roles` SELECT errors. |
| `src/components/CompletionPrompts.tsx:103,117` | `allReviews` and admin-roles. | Auto-flag-on-low-rating chain — silent failure means flag never fires. |
| `src/components/DisputeDialog.tsx:79,95` | Signed-URL + admin-roles fanout | Dispute evidence drops silently. |
| `src/components/JobTracking.tsx:176,221,235` | `job` lookups for arrival-distance, status, and notify-poster | The 500ft arrival gate and the in-progress promotion both depend on these. Silent failure = wrong behavior. |
| `src/components/activity/PostedJobCard.tsx:795` | `adminRoles` lookup in violation-report fanout | Admin notification silently drops. |
| `src/components/JobConfirmation.tsx:63` | `const { data: job } = await supabase.from("jobs").select("title, customer_id, helper_id")…` | Drops error on the job lookup that drives the confirmation screen. |
| `src/components/ReviewPanel.tsx:417` | `const { data: profiles } = await supabase.from("profiles")…` | Review-wall enrichment — silent failure renders unknown names. |
| `src/hooks/useReferralData.ts:48` | `const { data: inserted } = await supabase.from("referrals").insert(…).select()` | Referral creation silently swallows insert failures. |
| `src/lib/userBlocks.ts:56` | `const { data: activeJobs } = await supabase.from("jobs").select…` | Auto-cancel-on-block depends on this — silent failure leaves stale active jobs after a block. |
| `src/pages/BusinessTeam.tsx:100` | `const { data: p } = await supabase.from("profiles")…` | Team-page profile lookup. |

### Admin surfaces (lower reach, still load-bearing)
| File:line | Code | Fix |
|---|---|---|
| `src/components/admin/AdminHealth.tsx:119,206` | `adminUserIds` and `appRows` enrichment | Admin Health is the page that's supposed to *show* health — ironic for it to silently fail. |
| `src/components/admin/AutoRestrictedRail.tsx:46,59` | `profs` + `vios` | Rail just renders empty on failure. |
| `src/components/admin/AdminUserNotes.tsx:88` | `profiles` enrichment | Notes show without author names. |
| `src/components/admin/AdminPayoutBatches.tsx:101` | `profileRows` | Batch UI shows IDs instead of names. |
| `src/components/admin/AdminDisputes.tsx:53` | `profs` | Disputes page enrichment. |
| `src/components/admin/AdminReports.tsx:60` | `profiles` | Reports enrichment. |
| `src/components/admin/AdminSupport.tsx:59` | `profiles` | Support inbox enrichment. |
| `src/components/admin/AdminReferrals.tsx:72` | `profiles` | Referrals page enrichment. |
| `src/components/admin/AdminFraudDashboard.tsx:64` | `profiles` | Fraud-dashboard enrichment. |

**Count:** 47 distinct lines across 24 files. The fix shape is uniform:
- Inside a React Query `queryFn`, wrap the result with `unwrap()` (`src/lib/supabaseResult.ts`).
- Elsewhere, destructure both halves and `if (error) { report(error, { tags: { source: "<file>.<scope>" }, context: { …ids } }); return; }`.

The codebase already has the helper. It's a mechanical refactor and almost certainly worth doing in a single sweep before the next migration-induced regression — every site above could be the next #355.

---

## Top 5 recommended changes (priority order)

### 1. Add a `permission denied for` Sentry alert and re-level dashboard errors
The exact bug that bricked the dashboard had no rule. Add a P0 rule in Sentry (per gap **G1**) that pattern-matches `message contains "permission denied for"`. Simultaneously, in `src/hooks/useDashboardData.ts` lines 69, 88, and 163, change `severity: "warning"` to `"error"` (gap **G2**). The reasoning: this audit found the report() was working perfectly — the operational gap was that nothing in Sentry was listening. One alert rule plus a one-word edit closes the exact failure mode that ate the day. Synthetic-test instructions from `docs/SENTRY_ALERT_RULES.md` apply directly (use a SQL `REVOKE ... ; SELECT has_role(…)` in staging to reproduce).

### 2. Instrument `ProtectedRoute` forced-logout bounces and add a PostHog funnel-drop monitor
The biggest reason #355 took hours to diagnose was that the symptom (every signed-in user bounced to /login) produced zero observability events. Patch `src/components/ProtectedRoute.tsx:142` to fire `report(..., { severity: "error", tags: { source: "ProtectedRoute.profileFetchError" } })` AND `track("forced_logout_bounce", { reason })` before navigating. Then in PostHog, build an Insight: hourly count of `$pageview` on `/dashboard` over the last 30 days with an anomaly threshold; pipe to the same Slack channel as Sentry P1. This is the missing "users can't reach the app" alarm. Code change is ~5 lines; the Insight is dashboard-side. Adds an analytics event to `AhaEvent` in `src/lib/analytics.ts`.

### 3. Sweep the 47 dropped-error call sites onto `unwrap()` / `if (error)`
Every line in the dropped-error inventory above is a future #355: a Postgres permission, RLS, or shape-drift error that the UI will silently swallow. The mechanical fix uses the existing helper at `src/lib/supabaseResult.ts` for queryFn sites; the manual fix is `if (error) { report(error, { tags: { source: "<file>.<scope>" } }); … }` for non-query call sites. Order of operations: highest-reach hooks first (`useActivityData.ts`, `usePostJobForm.ts:98`, `Login.tsx`, `Signup.tsx:200,390`, `Messages.tsx:546,564,584`). The risk of doing this in one giant PR is regression breadth, so split per area (one PR per table in the inventory above) and rely on the fact that each change is conservative — the worst case is a query that used to silently empty now surfaces as an honest error state.

### 4. Add a "merged migration not pushed to prod" detector
The first cause behind both #355 and #358 wasn't a code bug — it was that `supabase db push` is manual and someone forgot. Every silent PGRST202 fallback in the codebase (search for `code === "PGRST202"`, ~5 sites including `src/pages/activity/useActivityActions.ts:314`) hides the symptom and removes the signal. Two changes: (a) Each PGRST202 fallback also calls `report(new Error("RPC missing in prod: <name>"), { severity: "error", tags: { source: "migration.unapplied_in_prod", rpc: "<name>" } })`. Make this one-shot-per-session to avoid an alert storm — store a `Set<string>` of reported RPC names in module scope. (b) Add a Sentry rule `tags.source equals "migration.unapplied_in_prod"` → P1 with `@channel`. The longer-term fix is the auto-deploy migrations work already documented in `docs/SUPABASE_AUTO_DEPLOY_MIGRATIONS.md`; this is the cheap interim signal.

### 5. Add an `error_logs` cron monitor as the Sentry-independent backstop
Every `report()` call already writes to the `error_logs` table (`src/lib/errorLogger.ts:138`). Nothing reads it on a schedule. Add a Supabase edge function (`supabase/functions/error-logs-cron/`) scheduled every 15 min via pg_cron that selects `count(*), tags->>'source' as source from error_logs where created_at > now() - interval '5 minutes' group by 2 having count(*) > <threshold-per-source>`. For any group exceeding threshold, post to Slack via the existing dispatch in `src/lib/slackAlerts.ts` (server-equivalent). Why: this is independent of Sentry's pricing tier, ignore-pattern matrix, and dashboard config. If Sentry itself goes down or someone wrong-clicks a mute, the Slack signal still fires. Per-source thresholds (e.g., 50/5min for `pushNotifications.registerSW`, 5/5min for anything `tags.source startsWith "dashboard."`) are tuned empirically against the trailing 30 days.
