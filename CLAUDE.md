# Louisiana Helpr

## Stack — read this before any audit

Louisiana Helpr is a **Capacitor app**, not a native SwiftUI/UIKit app.
The entire UI, navigation, state, and business logic is **React 18 +
TypeScript + Vite** (in `src/`), built into `dist/` and shipped inside the
native iOS/Android shell. `capacitor.config.ts` bundles `dist/` into the
`.ipa`/`.apk` — it is a real, self-contained, App Store-distributed app
(App Store Connect, currently v1.0.x), just with a web UI layer.

There is **no meaningful native code**: `ios/App/App/AppDelegate.swift` is
stock Capacitor boilerplate. Do **not** audit for SwiftUI patterns
(`@State`, `@StateObject`, `@Observable`, Swift concurrency) — there are
none. Audit and improve the React/TypeScript code in `src/`; that *is* the
iOS app. Map any "native" concept to its React/Capacitor equivalent.

- **Backend:** Supabase — Postgres, RPCs, edge functions in `supabase/functions/`.
- **Payments:** Stripe Connect (escrow).
- **Native bridges:** Capacitor plugins (Haptics, Camera, Geolocation, Push,
  StatusBar, Keyboard, Social Login, Biometric auth, App Badge).
- **Checks:** `npm run typecheck` · `npm run lint` · `npm run build`.

This is a deliberate architecture — one codebase serves web + iOS + Android.
A SwiftUI rewrite is explicitly not the direction.

## Page layout — which shell to use

There is exactly **one** fixed-viewport primitive: `AppShell`
(`src/components/AppShell.tsx`). It owns the only implementation of the
100dvh lock, the internal scroll container, the safe-area top inset, and the
bottom-nav clearance. Never re-implement those — build on `AppShell`.

- **Fixed-shell pages** — the page locks to 100dvh, the bottom nav stays
  pinned, and scrolling happens in an internal container. Use `AppShell`
  directly (Profile, AccountPending), or `PageScaffold`
  (`src/components/ui/PageScaffold.tsx`) when you want its two-card layout
  (Dashboard, Activity, Messages list, guest dashboard). `PageScaffold` is a
  *thin wrapper over `AppShell`* — it adds only the title-card + bleeding
  panel, never its own viewport lock.
- **Document-scroll pages** — long-form / tall content that scrolls the
  document (legal, marketing, multi-step forms, Profile/Activity tab pages).
  Use a plain `min-h-screen bg-premium-page pb-safe-nav` wrapper (with
  `<PageHeader>` if a back-button header is needed). Do NOT use `AppShell`.
- The authoritative map of which routes do which lives in
  `DOCUMENT_SCROLL_ROUTES` in `src/hooks/useAppShellViewport.ts` — that hook
  toggles the `app-shell` class on `<html>`. A page's shell choice and its
  entry in that list must agree.

### Every page must FIT THE SCREEN — no dead gutters, no double insets

A page must fill the space it's given at every breakpoint: content centered in
the available area, no horizontal overflow, and **no empty rail-width gutter**
on the desktop website. This is a hard requirement, not a nicety — a page that
floats in a lopsided column with blank bands has failed the audit.

- **The desktop left-rail inset is applied in exactly ONE layer, globally.**
  Fixed-shell pages clear the rail via `.app-shell-frame { left: var(--desktop-sidebar-w) }`;
  non-app-shell **document-scroll pages** are inset by the global
  `html.web-desktop.desktop-rail:not(.app-shell) #root { padding-left: var(--desktop-sidebar-w) }`
  rule in `index.css`. A page must **never** re-inset itself (no per-page
  `paddingLeft: var(--desktop-sidebar-w)`, no `lg:pl-[248px]`, no extra flex
  spacer) — doing so pushes content right by a *second* rail width and knocks
  the centered column off-center (this was the PostJob bug: `#root` padded 248px
  AND the page padded 248px → form shoved to x≈496 with a dead 250px gutter).
  Rail clearance lives in the shared shell layer, period.
- After the single inset, the inner content column centers in the *post-rail*
  area (`mx-auto`), so its visual center is `(rail_width + viewport) / 2`, not
  the raw viewport center. Verify this: measure the column and confirm it's
  centered in the space to the right of the rail, not the whole window.
- **Proof of "fits" is mandatory and measured, not eyeballed.** For any page you
  touch, in Chrome at 1440 (rail present) AND 375 (no rail): assert
  `documentElement.scrollWidth <= clientWidth` (zero horizontal overflow), assert
  no element wider than the viewport, and confirm the primary content column is
  centered in the available area with no rail-width dead band. Screenshot both.

## Working rules

Each of these is a real, non-obvious gotcha that has cost real time — keep
this list tight; project-specific trivia belongs in code comments, not here.

- **Migrations auto-deploy on merge to main.** `.github/workflows/db-deploy.yml`
  runs `supabase db push` against prod whenever a commit touching
  `supabase/migrations/**` lands on main (also manually runnable via
  `gh workflow run db-deploy.yml`). The ONLY path to prod is a migration file
  merged to main — no manual pushes, no side channels. Still ship a graceful
  fallback for the PGRST202 "function not found" error when code calls a
  brand-new RPC: there's a short window between merge and deploy completing,
  and a red deploy widens it.
- **NEVER apply migrations to prod via MCP `apply_migration`.** MCP records the
  migration under its apply-time timestamp, not the filename version. That
  mismatch poisoned `schema_migrations` with 45 orphan versions and silently
  broke every automated deploy from 2026-06-16 until the ledger was repaired on
  2026-07-01. (MCP `execute_sql` for read-only checks and test-account rows is
  fine — the ban is on schema changes.) If an out-of-band apply is ever truly
  unavoidable, immediately reconcile with
  `supabase migration repair --status reverted/applied` so ledger versions
  match filenames exactly.
- **Zero migration drift remains the standing requirement — and it's cheap to
  check now.** `supabase migration list --linked` must show every version
  present on BOTH sides (ledger repaired 2026-07-01, so version strings are
  trustworthy again). The nightly `db-drift-detect.yml` opens a GitHub issue on
  schema drift. For a deep audit, verify by object existence
  (`to_regclass`/`to_regprocedure`/`information_schema`).
- **Never hand-type a migration timestamp.** `npm run migration:new -- <slug>`
  stamps the clock and refuses a version that already exists;
  `src/test/migrationVersions.test.ts` fails CI if any two versions collide
  (a collision fails `supabase db push` on `schema_migrations_pkey` and reds
  the prod deploy — it happened three times in one day).
- **Migrations must be replay-safe.** A from-scratch rebuild runs every
  migration in timestamp order. Guard DDL against objects that may not exist
  yet (`REVOKE`/`ALTER` on a function defined by a *later* migration →
  `IF to_regprocedure(...) IS NOT NULL`). An unguarded one aborts the rebuild
  and reds the Supabase Preview check on every migration PR.
- **Never drop the Supabase `error`.** `const { data } = await supabase...`
  silently swallows failures into a blank screen. In a React Query `queryFn`
  use `unwrap()` (`src/lib/supabaseResult.ts`); elsewhere check `error`.
- **A null `error` does NOT mean the write happened.** An UPDATE or DELETE that
  matches **zero rows** — RLS, a stale id, a `BEFORE UPDATE` trigger, or a guard
  predicate that no longer holds — returns `{ data: [], error: null }`, so
  `const { error } = await supabase.from(X).update(…)` sails down the success
  path over a row that never changed. That is the single most common serious bug
  found in this codebase (escrow releases, ban ladders, invite claims, admin
  queue resolutions). On any write that costs money, trust, or safety: add
  `.select("id")` and pass the result through `unwrapMutation()`
  (`src/lib/mutationResult.ts`), which throws + `report()`s a zero-row result and
  gives you human copy via `mutationErrorMessage()`. Leaving a write unguarded is
  fine ONLY when zero rows is a legitimate outcome (a conditional
  `.eq("status", "pending")` race) — say so in a comment.
- **Realtime subscriptions:** give every `postgres_changes` channel a
  server-side `filter` scoped to the user (an unfiltered `event: "*"`
  receives every platform-wide write), and a unique channel-name nonce via
  `channelNonce()` (`src/lib/realtimeChannel.ts`) — Supabase dedupes channels
  by name, so a reused name silently drops the second subscription.
- **Parallel lanes: stagger the gates, and never stage work in `/tmp`.** When
  several sessions/agents run at once, do NOT let them all run `npm run
  typecheck` / `vitest` / `eslint` simultaneously. Five concurrent `tsc -b`
  processes drove this machine to load average 28 on 2026-08-25; the dev server
  got slow enough that Playwright timed out mid-audit and the failure was
  briefly misread as an app bug. Gates are cheap to serialize and expensive to
  misdiagnose. Separately: a launchd job (`com.claudecode.cleanup`) runs
  hourly and used to `rm -rf /tmp/*` — it destroyed three agent worktrees
  holding ~100 uncommitted files. It has been fixed to age-gate and skip
  anything containing a `.git`, but worktrees still belong under `$HOME`
  (e.g. `~/.lh-b-ws/tree`), and uncommitted work should be committed early.
- **Commit directly to `main`.** No feature branch / PR ceremony is required —
  commit straight to `main`. The gate is still mandatory, but as of 2026-07-25
  most of it runs in CI, so locally you only need:

      npm run typecheck        # ~16s incremental; plus `npx vitest run` when
                               # touching tested code

  Everything else is already automated on the way out: **lint** runs on every
  commit via the husky `pre-commit` hook (`lint-staged` → `eslint --fix`), and
  **lint + typecheck + build + test** all run again in CI on every push to
  `main` via `.github/workflows/test.yml`. Running the full
  `typecheck && lint && build` locally costs ~3 minutes to re-prove what those
  two already prove — do it only when you have reason to distrust them (e.g.
  you changed the build config itself).

  Why this changed, and what to re-check if it ever regresses: this file used to
  say the local gate was the ONLY thing between a bad commit and prod, on the
  grounds that required checks don't run on a direct admin push. The premise was
  half right. `main` has branch protection (required Playwright/CodeQL/Vitest
  checks + PR) with `enforce_admins` FALSE, so a direct `git push origin main`
  does bypass the *merge* gate — but a workflow with `on: push: branches: [main]`
  still fires on that push. The real problem was that `test.yml` had been
  **disabled manually** and hadn't run since 2026-04-26, which is what made the
  local gate load-bearing. It was re-enabled (`gh workflow enable Test`) and
  verified running on a direct push. So: if commits start reaching prod red,
  check `gh workflow list --all` for `disabled_manually` BEFORE assuming the
  local gate is the only option — a disabled workflow looks identical to a
  missing one in the YAML.

  Since there's no PR, still run the review agents (`code-reviewer`,
  `silent-failure-hunter`, `security-auditor`) against the working diff before
  committing money/auth/data-model changes, so losing the PR gate doesn't lose
  the review.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

## Audit standard — invoke the `lh-audit` skill

The full Louisiana Helpr audit standard is in `.claude/skills/lh-audit/SKILL.md`
(three lenses: cohesion / product sense / trust; §1 method; §2 cross-cutting
principles; §3 per-screen dimension checklist; §4 severity tiers; §5
completeness bar; §6 review tooling). Extracted from this file 2026-07-07 so
CLAUDE.md stays under the perf-warning threshold; content is unchanged.

- **When to load it (auto):** any audit, improvement, or per-screen check —
  including `/audit`, `/improve`, or ad-hoc "look at this screen / page /
  route / component / dialog" requests. Invoke via the `Skill` tool
  (name: `lh-audit`).
- **How the user invokes it:** type `/lh-audit`, or say something like "run
  the LH audit" / "audit this page against the LH standard" — I'll notice
  and invoke it.
- **Once invoked:** treat the skill body as an extension of these project
  instructions. Every rule in it is mandatory, not advisory — the mandate,
  three lenses, and §1–§6 all still apply exactly as before.
