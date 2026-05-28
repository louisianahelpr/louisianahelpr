# Sentry cold-launch alert (audit #2)

Real-user signal for "the app is broken on fresh install right now." Catches anything our Chromium+mocked-Supabase tests miss — Capacitor plugin errors, native session restore failures, lazy-chunk load failures on flaky cellular, etc.

## How it works

When the app boots, `initSentry()` (`src/lib/sentry.ts`) calls `markColdLaunchStart()` which:

1. Sets the Sentry tag `cold_launch=true`
2. Schedules a 10 s timeout that flips the tag back to `cold_launch=false`

Any Sentry event captured within that 10 s window is tagged `cold_launch:true`. Errors after the window are tagged `cold_launch:false` (or untagged if Sentry initialized after the window expired). Breadcrumbs from `markColdLaunchPhase()` ride along on every error in that window so the diagnostic story is intact.

Already-instrumented phase breadcrumbs:
- `init` — `initSentry()` finished
- `auth-ready-resolved` — `useAuthReady` saw its first `INITIAL_SESSION`, `SIGNED_IN`, or timeout fallback

## Dashboard recipe (one-time setup in Sentry)

Sentry alert rules are dashboard-side (UI-managed, no repo config). Recipe:

1. Open [Sentry → Alerts → Create Alert](https://sentry.io/organizations/__YOUR_ORG__/alerts/rules/__YOUR_PROJECT__/new/).
2. Pick **"Issues"** alert type.
3. **WHEN** these conditions are met:
   - `A new issue is created` — *fires once per new bug class*
   - **AND** the event matches `tag:cold_launch:true`
4. **IF** these filters apply:
   - `environment:production`
   - `level:error` *(optional — drop info/warning breadcrumbs)*
5. **THEN** perform these actions:
   - Send a notification to **your-preferred-channel** (Slack, email, PagerDuty)
6. **Frequency**: at most once every 1 hour per issue (avoid alert storms during outages).
7. Name it `"Cold-launch regression — fresh-install break"`.
8. Save.

## Verifying it works

1. Trigger a synthetic cold-launch error in dev:
   ```ts
   // somewhere in src/main.tsx for testing, then remove:
   setTimeout(() => { throw new Error("cold-launch-test"); }, 500);
   ```
2. Cold-launch the app (TestFlight build, real device).
3. In Sentry, search `tag:cold_launch:true` — the test error should appear with the `auth-ready-resolved` breadcrumb chain.
4. The alert rule should fire to your configured channel.

## Why a 10 s window

Tuned empirically against the cold-launch sequence in this app:

| Phase | Typical latency |
|---|---|
| `initSentry()` runs (deferred after first paint) | 50–300 ms post-load |
| Capacitor Preferences hydrate resolves | 100–500 ms |
| `useAuthReady` sees `INITIAL_SESSION` event | 200–1500 ms |
| Profile fetch lands (if signed in) | 1–3 s |
| First protected route fully painted | 2–5 s |
| **Cold-launch "settled" steady-state** | **~5–8 s** |

10 s gives a generous buffer over the slowest legitimate path while excluding errors from user interaction. Tune in `src/lib/sentry.ts:COLD_LAUNCH_WINDOW_MS` if real-world data shows differently.

## Related

- `src/lib/sentry.ts` — `markColdLaunchStart()` + `markColdLaunchPhase()`
- `src/hooks/useAuthReady.ts` — calls `markColdLaunchPhase("auth-ready-resolved")` on the first `isReady=true` transition
- [`docs/ios-simulator-smoke.md`](./ios-simulator-smoke.md) — local pre-publish cold-launch smoke (audit #1)
