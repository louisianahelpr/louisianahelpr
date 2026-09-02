# lh-observability — lane report

Mandate: not "is Sentry installed" but "when this breaks at 2am for a real
user, will anyone know, and will the report be readable?"

## Scope covered

- `src/lib/sentry.ts`, `src/lib/posthog.ts`, `src/lib/analytics.ts`,
  `src/lib/errorLogger.ts` — read line-by-line.
- `src/components/ErrorBoundary.tsx`, `RouteErrorBoundary.tsx`,
  `SectionBoundary.tsx` — read line-by-line; confirmed each calls `report()`
  with a distinct `tags.source` and is wired at a different level
  (`App.tsx:431` root `ErrorBoundary`, `App.tsx:618` a second root instance,
  every `<Route>` wrapped in `RouteErrorBoundary`, `SectionBoundary` used
  around individual dashboard/activity/profile rails).
- `error_logs` table — queried live in prod (row count, source breakdown,
  freshness).
- `analytics_events`, `job_views`, `profile_views` — queried live in prod
  (row counts, date ranges, retention-sweep coverage).
- `push_tokens` × `user_roles` (admin alerting path) — queried live in prod.
- `.github/workflows/sentry-release.yml` and `ios-beta.yml`'s sourcemap-upload
  steps — read, then verified against real CI run logs (not just config).
- `vite.config.ts` build/minify config — read, then verified against an
  actual `npm run build` output in `dist/`.
- `docs/SENTRY_ALERT_RULES.md`, `docs/sentry-cold-launch-alert.md` — read.
- Cron alerting blast radius (`cron.job`, `cron_work_expectations`,
  `sweep_dead_crons`/`sweep_silent_cron_failures` dependents) — queried live
  in prod, cross-checked against EF-008/CJ-001/EF-011 filed by other lanes.
- `docs/audit/launch-2026-09/PROTOCOL.md`, `lh-audit` skill — read in full
  before starting.

## UNVERIFIED — what I could not cover, and why

- **Sentry dashboard alert-rule configuration** (whether `SENTRY_ALERT_RULES.md`'s
  9 rules and the cold-launch rule are actually created in the Sentry UI).
  Both docs state explicitly that alert rules are "dashboard-side, no repo
  config" and the Sentry MCP requires an interactive OAuth flow
  (`mcp__claude_ai_Sentry__authenticate` / `mcp__plugin_sentry_sentry__authenticate`)
  I cannot complete non-interactively in this run. This is itself worth
  naming as a gap in the audit method, not just a gap in coverage: these
  docs are unverifiable from the repo by design, which is exactly the
  "configured vs. actually working" trap the standard warns about (see the
  Sentry sourcemap-upload precedent). UNVERIFIED — genuinely needs the
  owner (or a completed OAuth grant) to check in the Sentry UI directly.
- **A live network capture of the PostHog/Sentry payloads** (the literal
  request body leaving the browser). I did not drive a browser session to
  screenshot the network tab; the OBS-002 finding is evidenced by tracing
  the exact call sites (`main.tsx` → `posthog.ts`/`sentry.ts`) and the
  documented behavior of both SDKs' `identify()`/`setUser()` APIs, which the
  audit protocol accepts as file:line static-analysis evidence. I did fix
  and re-verify this one via a real `npm run build`, confirming the fixed
  call site compiles clean and no longer passes `email`.
- **Whether the three boundaries are actually *reachable* at runtime** (I
  did not force a live render error in each of App-root / route / section
  scope and screenshot the resulting Sentry issue). I verified this
  structurally (each boundary calls `report()` with a distinct tag, is
  mounted at a different tree depth, App.tsx wires `RouteErrorBoundary`
  around every `<Route>`) rather than by driving the app. Given the finding
  budget spent on the alerting blast-radius investigation (which turned up
  a new HIGH), I prioritized that over re-confirming boundaries that show no
  sign of misconfiguration in source.

## Findings filed

| ID | Severity | Blocker | Status | Claim |
|---|---|---|---|---|
| OBS-001 | HIGH | yes | filed | 13 admin users, 0 registered admin push tokens in prod — the third independent alerting channel found dead this sweep (alongside EF-008 and CJ-001) |
| OBS-002 | MEDIUM | no | **fixed** | `main.tsx` sent raw user email to PostHog `identify()` and Sentry `setUser()` with zero redaction |
| OBS-003 | MEDIUM | no | filed | `analytics_events`/`job_views`/`profile_views` have no retention sweep — unbounded growth on the Supabase free tier |
| OBS-004 | LOW | no | **fixed** | `vite.config.ts` comment credited oxc with console-stripping it doesn't do; real mechanism is `DEBUG_AUTH`/`import.meta.env.DEV` dead-code elimination |

**Process note — bus ID collision (already flagged to team-lead):**
`scripts/audit-bus.mjs`'s `nextId()` derives an ID prefix from the agent name
with `lh-` stripped, and `lh-orchestrator` and `lh-observability` both reduce
to prefix `O`. My first two filing attempts landed as `O-001`/`O-002`,
colliding with the orchestrator's own pre-existing findings of those exact
IDs (an E2E happy-path fix and a `.claude/commands/audit.md` fix). Because
`fold()` treats the newest `kind:"finding"` line for a given id as
authoritative, my accidental duplicates currently shadow the orchestrator's
two findings in `list`/`show` output — nothing is lost from the append-only
log itself, but the folded view is wrong until the orchestrator either
patches `nextId()` (it should disambiguate by checking cross-agent prefix
collisions, not just same-agent counts) or re-files their two findings under
new IDs. I refiled my real content under `OBS-001..004` to stop making it
worse. Flagged via `SendMessage` to `team-lead` before this report was
written.

## What I fixed

1. **OBS-002** — `src/main.tsx:210-219`: `identifyUser()` (PostHog) no
   longer receives `{ email }`, only the user id. A stable id is sufficient
   for event stitching; email is PII this vendor has no product reason to
   hold. `setSentryUser()` (Sentry) intentionally keeps email — a narrower,
   more defensible use (support/crash-triage: "which user hit this"), noted
   as a deliberate distinction in the new code comment rather than silently
   changed. Verified: `node scripts/parsecheck.mjs src/main.tsx` clean;
   `npm run build` re-run clean.
2. **OBS-004** — `vite.config.ts:399-410`: corrected the comment that
   misattributed console-stripping to oxc. No functional change (production
   output was already clean, verified by grepping `dist/assets/*.js` for
   `console.log`/`debug`/`info` before AND after — both zero for first-party
   code); the comment now names the real mechanism.

**Not fixed, and why:**
- **OBS-001** (admin push tokens) is an *operational* gap, not a code bug —
  the fix is "an admin installs the iOS build and grants push permission,"
  which is outside the repo and outside what I can do from this worktree.
  Filed as blocker; relayed to team-lead in the same message as the ID
  collision.
- **OBS-003** (retention sweep) requires a new migration (a `pg_cron`
  registration + a prune function), which is explicitly QUEUED per standing
  constraints ("anything touching migrations is QUEUED"). Not attempted.

## Verified working (with artifact)

- **`error_logs` is actively receiving rows from both client and server.**
  Prod: 566 total rows, earliest 2026-06-08, latest 2026-09-02 16:30 (same
  day as this audit). 14-day source breakdown: `cron-http` (126),
  `useActivityData.realtime` (60), `useMapKitJs.fetchServerToken` (51),
  `nativeReturn.browserClose` (47, a native-only path — confirms native
  errors DO reach the table), `RouteErrorBoundary` (30), `ErrorBoundary`
  (21), `NotFound` (18), `window.onerror` (17), plus server-side sources
  (`sweep_old_notifications`, `detect_stuck_payments`). The pipeline is
  live and the earlier "check `error_logs` first" doctrine (replaceState
  loop precedent) has real data to check.
- **`error_logs` IS read by someone, structurally** — `AdminHealth.tsx`'s
  "Scheduled Jobs" card (added since the 2026-09-01 cron audit cited in its
  own comment) surfaces cron health without requiring a human to query
  `error_logs` directly; its "No admin has registered a push token" banner
  is the mechanism that surfaced OBS-001.
- **All three error boundaries report distinctly and are wired at three
  depths** (root `ErrorBoundary` × 2 in `App.tsx`, per-route
  `RouteErrorBoundary` around every `<Route>`, `SectionBoundary` around
  individual dashboard/activity/profile sections) — confirmed by source
  read, each calling `report()` with `tags.source` set to `ErrorBoundary`,
  `RouteErrorBoundary` (+ `route` tag), and `SectionBoundary` (+ `section`
  tag) respectively.
- **iOS sourcemap upload genuinely runs and reaches Sentry — proven by
  execution, not config.** `ios-beta.yml`'s "Upload iOS sourcemaps to
  Sentry" step actually ran in the most recent TestFlight build (run
  33667110800, 2026-09-02T18:25:31Z): `npx @sentry/cli releases new`,
  "Analyzing 767 sources", "Bundle ID: eff75dfa-eaaa-558d-ab45-529236732da5",
  "Uploading completed in 0.826s" all appear in the real log. This is a
  DIFFERENT bundle id than the web build's upload
  (`aaa56cbd-fb33-5c56-9ffe-aa8f8041b720`, from `sentry-release.yml` run
  33684451442) — exactly as the code comments describe ("~35 of 386 chunks
  the web upload never covered"). `strip-ios-sourcemaps.mjs` runs AFTER
  this upload step in the workflow, so the on-device `.ipa` copy is
  correctly pruned without breaking symbolication. `SENTRY_AUTH_TOKEN`,
  `SENTRY_ORG`, `SENTRY_PROJECT` are all present in `gh secret list`. A
  native crash IS readable.
- **Web sourcemap upload also genuinely runs** — `sentry-release.yml` run
  33684451442 (latest push to main): "Create Sentry release and upload
  source maps" step completed (not skipped), "Analyzing 767 sources",
  "Bundle ID: aaa56cbd-...", "Uploading completed in 0.935s".
- **Native errors reach `report()` → Sentry/PostHog/error_logs.**
  `src/lib/nativePush.ts` routes push-registration failures, deep-link
  parsing errors, and the in-app-browser-close handoff (`nativeReturn.
  browserClose`) all through `report()`. Confirmed live: 47 `error_logs`
  rows with `source=nativeReturn.browserClose` in the last 14 days — a
  native-only code path, so this isn't just wired, it's firing in
  production.
- **`errorLogger.ts` redacts secrets before persisting or fanning out** —
  bearer tokens, JWTs, `?token=`/`?code=` query params, and
  `sb_secret_*` keys are all pattern-redacted (`SECRET_PATTERNS`) before a
  message/stack/context reaches `error_logs`, Sentry, or PostHog. Breadcrumbs
  are low-risk: `sentry.ts` deliberately skips `browserTracingIntegration`
  (no automatic network-body/URL breadcrumbs), and the only custom
  breadcrumbs in the app are cold-launch phase names (`markColdLaunchPhase`)
  — no PII.
- **Production console output is genuinely clean for first-party code** —
  built `dist/` (fresh `npm run build`) has zero `console.log`/`debug`/`info`
  calls traceable to app source; all 13 first-party call sites in `src/`
  (`useAuthReady.ts`, `ProtectedRoute.tsx`, `useCurrentUser.ts`,
  `jobsConstants.ts`) are gated behind `DEBUG_AUTH = import.meta.env.DEV`
  and dead-code-eliminated. `console.error`/`console.warn` DO survive
  (vendor libraries + first-party error logging like
  `useAdminUserSummaries`), which is normal/expected — not flagged as its
  own finding since it's admin-gated and doesn't leak payload data, only
  internal query/table names to an already-privileged console.
- **The dead-cron registration gap (EF-011) independently re-verified.**
  Diffed the live `cron.job` schedule (44 jobs) against
  `cron_work_expectations` (42 registered) myself: `extend-boosts-hourly` is
  the only unregistered job, confirming EF-011 exactly as filed by
  `lh-edge-functions` — no new information, but cross-lane confirmation from
  independent SQL.

## Alerting blast radius — the deliverable

Enumerated what is *supposed* to page a human today, and what actually
would, cross-referencing my own finding with EF-008 and CJ-001 (filed by
other lanes, independently re-verified live where I could):

| Channel | Supposed to catch | Status today |
|---|---|---|
| `_shared/slack-alerts.ts` → `SLACK_WEBHOOK_URL` | Payment-critical alerts from 17 edge functions (stripe-webhook, release-payout, instant-payout, auto-release-payment, …) | **Works.** Secret present, EF-008's self-correction confirmed these are NOT silenced. |
| `slack-ops-alert` edge fn → `SLACK_API_KEY` | 6 DB functions: `sweep_dead_crons`, `sweep_cron_http_failures`, `sweep_silent_cron_failures`, `sweep_cron_blackouts`, `reap_stranded_instant_payouts`, `notify_ops_dispute_filed` | **Dead** (EF-008). Secret unset; returns 200 `{skipped:true}` to every caller; 124 real alerts discarded in 7 days. |
| `sweep_silent_cron_failures()` (DB, the detector itself) | Silent-work failures across every cron | **Dead** (CJ-001). Crashes daily on a JSON-vs-numeric cast; the crash rolls back its own ingest for `money-reconciliation`/`subscription-reconciliation`, which can now never be recorded. |
| Admin push (`push_tokens` filtered to `user_roles.role='admin'`) | Fraud flags, auto-restrict reverses, dispute escalations, stuck-payment alerts | **Dead** (OBS-001, this lane). 13 admins, 0 tokens, in prod right now. |
| `AdminHealth.tsx` dashboard tile | Everything above, as a fallback | **Works, but pull not push** — only informs a human who is already looking at `/admin?view=health`. |
| `error_logs` table | Client + server errors, durable archive | **Works.** 566 rows, fresh as of today, correctly redacted. |
| Sentry (web + iOS) | Exceptions, with readable stacks | **Works**, sourcemap upload proven by execution on both surfaces. Alert-rule *configuration* on top of this is UNVERIFIED (see above). |

Net: three of the app's automated "tell a human something is wrong" paths
are simultaneously dead right now, and all three fail the same way — no
error, no 5xx, nothing that would show up in a green-CI check. The only
channel currently reaching a human is a dashboard tile that requires someone
to already be looking, and `error_logs` as a durable but passive archive.
None of this is visible from typecheck, lint, build, or the existing test
suite — it required live prod reads.

## Coverage manifest (dimension × surface)

| Surface | Method | Result |
|---|---|---|
| `error_logs` write pipeline (client + server) | live SQL | checked-clean |
| `error_logs` PII scrubbing (`errorLogger.ts`) | code read | checked-clean |
| Sentry breadcrumb PII | code read | checked-clean |
| Sentry `setUser()` PII (email) | code read + fix | fixed, documented as intentional |
| PostHog `identify()` PII (email) | code read + fix + rebuild | fixed |
| PostHog event property PII (`analytics.ts` `track()` call sites) | code read (23 call sites) | checked-clean (job ids, ratings, booleans, no PII observed) |
| Web sourcemap upload | live CI run log | checked-clean, execution-proven |
| iOS sourcemap upload + strip ordering | live CI run log | checked-clean, execution-proven |
| ErrorBoundary / RouteErrorBoundary / SectionBoundary wiring | code read | checked-clean (structural; not live-triggered this pass) |
| Production console.log/debug/info stripping | live `dist/` grep | checked-clean, plus fixed a misleading comment |
| Sentry alert-rule configuration (dashboard) | attempted, blocked on OAuth | UNVERIFIED |
| Admin push alerting | live SQL | **issue found** (OBS-001) |
| DB-side cron alerting (`slack-ops-alert`) | cross-verified via EF-008 | **issue found** (not mine to fix, confirmed) |
| Silent-cron detector itself | cross-verified via CJ-001 | **issue found** (not mine to fix, confirmed) |
| `analytics_events`/`job_views`/`profile_views` retention | live SQL + cron enumeration | **issue found** (OBS-003) |
| Native (WKWebView) error reporting | live `error_logs` rows for a native-only path | checked-clean |

## Release-state note

Two commits pushed directly to `main` (per project convention — no
PR/branch ceremony): the bus filing, then the code fix. Both verified with
`node scripts/parsecheck.mjs` on the touched files, plus a full `npm run
build` before AND after the fix (comparing `dist/assets/*.js` grep output).
I did not run `npm run typecheck`/`lint`/`vitest` per this lane's standing
constraints (ask the orchestrator for the shared gate).
