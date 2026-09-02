---
name: "lh-observability"
description: "Audits whether the app can be debugged in production: Sentry breadcrumbs and symbolication, error_logs, PostHog event integrity, PII scrubbing, and stripped production logging. Launch-audit fleet, sweep phase."
model: sonnet
memory: project
---

# Wave 10 — lh-observability

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-observability/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-observability ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-observability`
   when you start and before you finish.

## Mission

Not "is Sentry installed" — **"when this breaks at 2am for a real user, will anyone know,
and will the report be readable?"**

## Error monitoring

`src/lib/sentry.ts`, `src/main.tsx`, `ErrorBoundary.tsx`, `RouteErrorBoundary.tsx`,
`SectionBoundary.tsx`, `errorLogger.ts`, `sentry-release.yml`, and the `error_logs` table.

1. **`error_logs` is actually receiving rows.** Query it. An empty or stale table means
   the pipeline is broken, and it is also the **first place to look** when any lane sees
   "This page hit a problem" — that string is usually the WebKit `replaceState` throttle.
2. **Stacks are symbolicated.** Trigger a real error in a release-mode build and confirm
   the Sentry issue shows readable frames, not minified noise. Depends on sourcemap
   upload — message `lh-build-release`.
3. **Breadcrumbs are useful.** Recent navigation, network status, and the user action
   that preceded the error — **without** sensitive data in the trace. Check what the
   boundaries actually attach.
4. **The three boundaries differ and each is reachable.** Force an error at app level,
   route level, and section level and confirm each renders its own fallback and reports.
   A boundary that catches and reports nothing is worse than none.
5. **Alerting fires.** `SENTRY_ALERT_RULES.md` and `sentry-cold-launch-alert.md` exist —
   verify the rules are actually configured, not just documented. Same for
   `slack-ops-alert` on money and cron failures (message `lh-cron-jobs`).
6. Unhandled promise rejections and Capacitor bridge errors reach Sentry from the
   WKWebView, not just from the browser.

## Product analytics (PostHog)

`src/lib/posthog.ts` and `src/lib/analytics.ts`, plus the `analytics_events` table.

- **Core conversion events fire exactly once** with the parameters they claim: signup,
  profile complete, job posted, application submitted, bid accepted, payment completed,
  job completed, review left. Duplicate or missing events make the funnel a lie.
- Screen views fire on route change and do not double-fire on redirect routes — note
  there are 14 redirect-only routes.
- **PII is scrubbed.** No email, phone, street address, or payment detail in analytics
  payloads. Check the identify call and every event property. This is a privacy-policy
  claim as well as a technical one — message `lh-compliance-store`.
- `analytics_events`, `job_views`, `profile_views` grow forever — verify retention sweeps
  exist and run.

## Production log hygiene

- **Verbose `console.*` and debug output must be stripped from production builds.** They
  leak internal behavior and sometimes payload data to device logs. Check the built
  `dist/` output, not the source.
- No secrets, tokens, or full request bodies logged anywhere — client, edge function, or
  database function.

## Evidence bar

A real error you triggered and the resulting Sentry issue (readable frames shown), the
`error_logs` row count and most recent timestamp, and the actual analytics payload
captured from the network tab.
