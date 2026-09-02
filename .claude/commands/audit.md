---
description: Ship-readiness launch audit — find & grade problems by severity, write docs/PRE_LAUNCH_AUDIT.md
argument-hint: "[optional scope, e.g. 'money path only' or 'phase 5 trust/safety']"
---

# Louisiana Helpr — Pre-Release Full-App Audit

You are auditing **Louisiana Helpr** for ship-readiness. This is a **Capacitor app**:
the entire UI/logic is **React 18 + TS + Vite in `src/`**, built to `dist/` and shipped
inside an iOS/Android shell; the same code runs as the web app at louisianahelpr.com.
Backend is **Supabase** (Postgres, RPCs, edge functions in `supabase/functions/`);
payments are **Stripe Connect (escrow)**. Do not audit for SwiftUI patterns — there are
none. Build target: App Store Connect v1.0.x, `appId: com.Helpr`.

**But `ios/App/App/AppDelegate.swift` is NOT out of scope, and "it's stock boilerplate"
is not a reason to skip it.** This file used to say there was no meaningful native code,
and that sentence is why push notifications were broken for the entire life of the
project without anyone looking: Capacitor's `PushNotificationsPlugin` observes
`.capacitorDidRegisterForRemoteNotifications`, that notification is *declared* by the
framework but **posted from nowhere**, and the host app must post it from
`didRegisterForRemoteNotificationsWithDeviceToken`. Stock boilerplate does not, so iOS
handed the app a valid APNs token on every launch and it was dropped on the floor —
unfillable `push_tokens`, no error, no log. If a native capability appears dead in a way
no amount of TypeScript explains, read the AppDelegate.

**Mission:** find anything that is a launch risk — broken, insecure, money-unsafe,
privacy-leaking, half-finished, or App-Store-gating — and **grade each finding by severity**.
This is a *grading* pass, not a redesign pass. (For per-screen design improvements toward a
unified system, that's the separate `/improve` command.)

$ARGUMENTS

## Method (non-negotiable)

- **Static review of the real shipping tree** (`src/` + `supabase/`), plus gate runs and
  **Supabase prod introspection** (verify objects actually exist in prod by object existence —
  `to_regclass`/`to_regprocedure`/`information_schema`, NOT by `schema_migrations.version`).
- **Every finding cites `file:line` from a real read.** No speculation. If you didn't read it,
  don't claim it.
- **Coverage honesty:** mark what you did NOT fully trace rather than padding. A smaller, honest
  audit beats a broad, hand-wavy one.
- Give every finding a stable ID `F-<AREA>-NN` (e.g. `F-MONEY-01`, `F-SEC-03`, `F-DISC-01`) and a
  severity: 🔴 Blocker · 🟠 High · 🟡 Medium · 🟢 Low/hardening. State the **fix** for each.

## Gates (run and record exit status)

```
npm run typecheck   # must exit 0
npm run lint        # must exit 0, 0 warnings
npm run build       # must exit 0
npx vitest run      # unit tests are NOT in CI — run locally
```
Note Playwright e2e status (required CI gate). Record the largest shipped JS chunks from the build.

## Phases

- **Phase 0 — Screen inventory.** Enumerate every routed page (`src/App.tsx`), redirect-only route,
  overlay/sheet/dialog, and Capacitor native surface. Tag persona (guest/customer/helper/business/
  family/admin/account-state) and shell archetype (fixed-shell `AppShell`/`PageScaffold` vs
  document-scroll vs overlay). Flag any unreachable/placeholder content (App-Store gate).
- **Phase 1 — Gates & build health** (above).
- **Phase 2 — Persona parity.** Every account can both post AND do jobs (app is never role-based) —
  confirm no accidental role-gating; confirm account-state screens (Pending/Denied/Banned) behave.
- **Phase 3 — Journeys.** Trace the core flows end to end: Signup → CompleteProfile → Dashboard/
  browse → PostJob → apply → accept → pay (Stripe escrow) → complete → release-payout → review.
- **Phase 4 — Security & RLS.** anon/authenticated grants; SECURITY DEFINER functions self-guard;
  no service-role key in the client bundle (publishable `VITE_*` keys are by-design, not a leak);
  search_path pinned on definer functions; no anon-executable mutations.
- **Phase 5 — Trust, Safety & moderation** (App-Store guideline 1.2): Report / Block / Dispute must
  be reachable and wired; off-platform-contact scanner gate; account deletion present.
- **Phase 6 — Money/escrow.** Idempotency on every payout path; no double-pay race; ledger rows;
  dispute payouts fail *closed* (never mark released on a failed Stripe transfer).
- **Phase 7 — Discovery & location privacy.** 🔴 bar: exact lat/lng of open jobs must NOT leak to
  anon. Verify coordinates are coarsened/absent on every public surface (RPCs, views, REST).
- **Phase 8 — SEO/discoverability** (web surface): sitemap covers all public pages; JSON-LD/geo-meta.
- **Phase 9 — Performance.** Bundle/chunk sizes, heavy deps, render hot paths.
- **Phase 10 — Cross-cutting.** Error handling (never drop the Supabase `error`), realtime channel
  scoping + nonce, loading/empty/error states, accessibility, type safety (`any` debt).
- **Phases 11–14 — App-Store gates & polish.** Account deletion, real-world-services/Stripe rules,
  server-side secrets, no placeholder/unreachable content, native-feel regressions.

## Output

Write the full report to **`docs/PRE_LAUNCH_AUDIT.md`**, structured as: Executive Summary with a
**readiness verdict** (GO / CONDITIONAL GO / NO-GO) and top risks in priority order; gate-status
table; Phase 0 screen inventory; severity-grouped consolidated findings (each with ID, `file:line`,
fix); scorecards (money-path + per-screen, 1–5); a prioritized punch list (must-fix-before-build /
quick wins / deferred); and an explicit **coverage-honesty** note on what was not fully traced.

## Repo rules that apply to this command (CLAUDE.md is the source of truth)

These two used to say the opposite of `CLAUDE.md`. `CLAUDE.md` wins — corrected here:

- **Commit directly to `main`.** No branch/PR ceremony. Run `npm run typecheck` locally (plus
  `npx vitest run` when touching tested code); lint/build/full-suite run in CI (`husky
  pre-commit` + `.github/workflows/test.yml`). Still run the review agents (`code-reviewer`,
  `silent-failure-hunter`, `security-auditor`) against the working diff before committing
  money/auth/data-model changes — there is no PR gate to catch it otherwise.
- **NEVER apply a migration to prod via MCP `apply_migration`.** It records the current time as
  `schema_migrations.version` instead of the file's prefix, which poisons the ledger and breaks
  automated deploys (it cost a full ledger repair once already). If a finding's fix needs a
  migration: create it with `npm run migration:new -- <slug>` (never hand-type a timestamp),
  keep it replay-safe (guard DDL against objects a later migration may define), and commit it —
  `.github/workflows/db-deploy.yml` runs `supabase db push --linked --include-all` on merge to
  `main`, and can be fired manually with `gh workflow run db-deploy.yml`. MCP `execute_sql` is
  fine for read-only introspection and for test-account rows. Never let prod lag the repo:
  `supabase migration list --linked` must show every version on both sides.

End commits with the required `Co-Authored-By` trailer from `CLAUDE.md`.
