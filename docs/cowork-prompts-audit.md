# Cowork prompts — full app polish audit (2026-05-28)

Three independent prompts you can paste into separate cowork sessions to run
in parallel. Each is self-contained — read the briefing, do the work, open
a PR (or write a report-only doc, where called out). All three can run
simultaneously; they touch different files.

## Background context (paste at the top of every cowork session)

The repo is a Capacitor app (React 18 + TypeScript + Vite, bundled into an
iOS/Android shell). **The entire UI is in `src/` as web code** — there is
no meaningful Swift. Map every "native" concept to its React/Capacitor
equivalent. The dev server is `npm run dev`; the iOS build is
`npm run build:ios && npx cap sync ios && ...`. Project rules:
`CLAUDE.md` at repo root. Page-layout primitives + the AppShell vs
PageScaffold vs document-scroll convention are documented there.

Existing CI runs `npm run typecheck && npm run lint && npm run build` plus
a Supabase migration smoke. **All three must pass** before opening a PR.

The branch rule: never commit to `main` directly. Open a PR from a fresh
branch off `origin/main`. End every commit message with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## ===PROMPT 1 START=== — Visual polish + copy audit (open PR)

Paste this whole block as a single message into a fresh cowork session.

```
You are doing a visual polish + copy audit pass on a production iOS app
(Louisiana Helpr) that's a Capacitor wrapper around a React/TypeScript
SPA. The entire UI is in src/. There are roughly 30 user-reachable
routes. Your job is to read every page component, find polish bugs that
ship to real users, and open ONE PR with ALL the mechanical fixes plus
a markdown report listing the larger findings that need product
judgment.

## Scope

Files to read (every one):
- src/App.tsx (route inventory)
- Every component in src/pages/
- src/components/dashboard/* (the most-visited surface)
- src/components/auth/* (signup, login, social-login)
- src/components/profile/* (tabs, settings)
- src/components/ui/EmptyState.tsx + ErrorState.tsx + PageScaffold.tsx + AppShell.tsx (shared primitives)

For each page, look for:

1. **Copy bugs**: typos, vagueness, dated language, blame-shifting error
   copy ("check your connection" when the failure is server-side),
   placeholder text that should be real ("you@example.com" is fine,
   "John Doe" in a live UI is not), inconsistent capitalization (Sign In
   vs Sign in), and prompts that don't match the actual outcome.

2. **State gaps**: any data-fetch path that has loading, success but
   missing error or empty state (or vice versa). Specifically check
   that error states are recoverable (Try-again button, not just a
   message) and empty states tell the user what to do next.

3. **Typography drift**: serif vs sans inconsistency where the design
   system clearly wants one or the other. Tailwind brand tokens (e.g.
   `text-burnt-sienna`) silently fail — they must be written as
   `text-[hsl(var(--burnt-sienna))]`. This is a documented gotcha in
   CLAUDE.md. Grep for `text-burnt-sienna`, `text-olivewood`, `bg-parchment`,
   `from-parchment`, etc. and flag every one.

4. **iOS safe-area issues**: any page that uses `min-h-screen` instead
   of going through `AppShell` or `PageScaffold` will spill behind the
   home-indicator. The authoritative list of document-scroll routes is
   `DOCUMENT_SCROLL_ROUTES` in `src/hooks/useAppShellViewport.ts` — a
   page's wrapper choice and its entry there must agree.

5. **Accessibility**: missing `aria-label` on icon-only buttons (the
   pattern is `<button aria-label="...">`); insufficient color contrast
   on the brand-tinted text; no `htmlFor`/`id` pairing on form labels.

6. **Dead links / unhandled clicks**: `<Link to="/something">` where
   `/something` is not declared in src/App.tsx routes (it'll 404).

## Deliverable

ONE pull request titled `polish(audit): mechanical fixes from 2026-05-28
visual audit pass`. The PR must contain:

A. **Mechanical fixes** (commit them):
   - Copy edits (typos, wording, capitalization consistency)
   - Tailwind brand-token bugs (every `text-burnt-sienna` →
     `text-[hsl(var(--burnt-sienna))]` etc.)
   - Missing aria-label on icon-only buttons
   - `htmlFor`/`id` pairing on form labels
   - Dead-link cleanups

B. **`docs/audit-findings-2026-05-28.md`** (also in the PR): a report of
   findings that need product judgment. Group by page. For each finding,
   write: file:line · what's wrong · why it matters · recommended fix.
   Cap the report at ~400 lines — be selective; surface the things that
   would move real-user satisfaction, not nitpicks.

## Constraints

- Make the PR PR-able: `npm run typecheck && npm run lint && npm run build`
  must pass.
- Each commit small and self-contained (one concern per commit).
- DO NOT change product behavior. No new features. No refactors. No copy
  changes that change meaning, only ones that fix accuracy or polish.
- DO NOT touch `supabase/migrations/`, `ios/`, `android/`, or
  `capacitor.config.ts`.
- DO NOT modify `CLAUDE.md` or any agent-instruction files.
- DO NOT add new dependencies.

Open the PR against `main`. Title: `polish(audit): mechanical fixes from
2026-05-28 visual audit pass`. Description: `## Summary` (3-5 bullets of
what categories of fix landed) + `## Test plan` (checklist). End with
the standard Co-Authored-By line.

Branch name: `polish/audit-2026-05-28`.
```

===PROMPT 1 END===

---

## ===PROMPT 2 START=== — RLS / grant audit (report only, no PR)

```
You're doing a backend security + permission audit on a Supabase Postgres
schema. Two recent regressions (PR #355, PR #358) restored EXECUTE on
functions that RLS policies depend on — has_role(), is_business_member(),
mask_job_location(). The root cause in both: the originating CREATE
FUNCTION migrations never wrote an explicit GRANT and relied on the
default PUBLIC EXECUTE that a Supabase advisor pass later stripped.

This is a systemic pattern, not a one-off. Your job is to find every
remaining function in the same trap before it surfaces as a user-facing
error.

## Method

1. For every `.sql` in `supabase/migrations/`, grep for CREATE [OR
   REPLACE] FUNCTION definitions in the `public` schema. Build a list.

2. For each function, check whether the same migration file (or any
   later migration) issues an explicit `GRANT EXECUTE ... ON FUNCTION
   public.<name>(...) TO authenticated` (or anon, where appropriate).

3. Cross-reference each function against:
   a. Whether it's invoked inside an RLS policy's USING / WITH CHECK
      expression (grep RLS policy bodies across migrations).
   b. Whether it's referenced inside a VIEW's SELECT projection.
   c. Whether it's called directly by client code (grep
      `supabase.rpc("<name>"` and `supabase.from(<table>)` if the table
      has RLS that invokes it).

4. For each function that is BOTH invoked from an RLS path AND lacks
   an explicit GRANT, flag it as a latent regression risk.

## Deliverable

ONE report file: `docs/rls-grant-audit-2026-05-28.md`. No PR, no SQL —
just the report. Structure:

# RLS / grant audit — 2026-05-28

## Summary
- N functions inspected total
- M functions invoked from RLS policies
- K functions lacking explicit GRANT (the risk surface)

## Latent regression risks (priority order)
For each at-risk function:
- function name + signature
- file:line of CREATE
- which RLS policies / views invoke it
- which client code paths touch those tables
- one-line proposed GRANT statement (replay-safe via to_regprocedure)
- severity guess (high / medium / low based on user-reach)

## Bulk fix recommendation
Single migration containing all the proposed GRANTs, replay-safe via
to_regprocedure guards (mirror the style of
supabase/migrations/20260528154945_grant_execute_has_role_to_authenticated.sql).

DO NOT write the migration itself — just propose its body so the human
reviewer can sanity-check it before it lands.

## Constraints

- DO NOT modify code, migrations, or settings.
- DO NOT push or commit.
- Read-only audit. Open NO PR. Just the report file.
- Keep the report under 600 lines. Prioritize signal over completeness;
  if there are 30 functions and 5 are high-risk, lead with the 5.
```

===PROMPT 2 END===

---

## ===PROMPT 3 START=== — Sentry / error-logging audit (report only)

```
You're doing an observability audit. Production has Sentry + PostHog
wired in src/lib/sentry.ts and src/lib/posthog.ts, with breadcrumbs from
src/hooks/useAuthReady.ts (auth-ready-resolved phase markers).

We just shipped two database-side regressions (PR #355 and PR #358 —
missing GRANTs on RLS helper functions) that bricked every signed-in
user's dashboard. Neither was caught by an alert. Your job is to find
gaps in the observability that let this slip.

## Method

1. Read src/lib/sentry.ts, src/lib/posthog.ts, src/lib/errorLogger.ts,
   src/hooks/useAuthReady.ts.

2. Read every `report(...)` call site (grep `report(` across src/ —
   exclude test files). For each, ask: would this error have surfaced
   in Sentry with a clear title? Would it have triggered an alert?

3. Read the dashboard data fetch path: src/hooks/useDashboardData.ts.
   Note where errors are caught vs. rethrown vs. swallowed.

4. Look at supabase Postgres-error handling pattern: every
   `supabase.from(...).select(...)` and `supabase.rpc(...)`. The
   project rule (CLAUDE.md): never drop the Supabase error. In a
   React Query queryFn use unwrap() from src/lib/supabaseResult.ts.
   Flag every call site that returns destructured `data` without
   checking `error`.

## Deliverable

ONE report file: `docs/observability-audit-2026-05-28.md`. Structure:

# Observability audit — 2026-05-28

## What we have today
Inventory of breadcrumbs, error-report call sites, current Sentry alerts.

## What we'd want to know within 5 minutes of breaking
Specific scenarios (sign-in bounce, dashboard error, payment failure,
push-token loss, etc.) and what signal would fire.

## Gaps
For each gap:
- scenario that would not alert
- where in code to add the signal
- proposed Sentry alert / PostHog funnel to wire

## Top 5 recommended changes (priority order)
Each: a one-paragraph proposal with code-location pointers. Be specific
enough that the next engineer can implement without re-deriving the
context.

## Constraints

- DO NOT modify code, migrations, or settings.
- DO NOT push or commit.
- Read-only audit. Open NO PR. Just the report file.
- Cap report at 500 lines.
```

===PROMPT 3 END===

---

## Parallel runs

These three prompts touch disjoint surfaces:

- Prompt 1 → `src/`, opens a polish PR
- Prompt 2 → `supabase/migrations/`, writes a doc
- Prompt 3 → `src/lib/*` + `src/hooks/*` observability code, writes a doc

So you can run all three concurrently. Wait for all three to land their
artifacts (one PR + two docs) before doing the review pass.
