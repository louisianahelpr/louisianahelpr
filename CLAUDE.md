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

- **Never idle on a blocked git operation — resolve or abort within the run.**
  A scheduled routine that hits a blocked merge/push and just sits there
  produces zero signal: it never reports, never notifies, and the user does
  not manually check sessions. (`lh-deps-and-drift` hung 19 hours on a
  blocked `--admin` merge on 2026-08-28 with no completion, no notification,
  nothing.) If a git action is refused, apply the documented fallback
  immediately (e.g. commit direct to `main` per this file) and move on. If
  truly stuck after a couple of attempts, stop the run cleanly and let the
  next scheduled run pick it up — do not leave the session open and idle.
- **Migrations auto-deploy on merge to main** via `.github/workflows/db-deploy.yml`
  (`supabase db push`, also manually runnable via `gh workflow run db-deploy.yml`).
  No manual pushes, no side channels. Ship a graceful fallback for PGRST202
  "function not found" on brand-new RPCs (deploy lag window).
- **NEVER apply migrations to prod via MCP `apply_migration`** (records the
  wrong timestamp and poisons `schema_migrations` — cost a full ledger repair
  once already). `execute_sql` for read-only checks/test rows is fine. If ever unavoidable,
  reconcile with `supabase migration repair --status reverted/applied`.
- **Zero migration drift is the standing requirement.** `supabase migration
  list --linked` must show every version on both sides. `db-drift-detect.yml`
  runs nightly. For a deep audit, verify by object existence
  (`to_regclass`/`to_regprocedure`/`information_schema`).
- **Never hand-type a migration timestamp** — use `npm run migration:new --
  <slug>`; `src/test/migrationVersions.test.ts` fails CI on any collision.
- **Migrations must be replay-safe** — guard DDL against objects a later
  migration may define (`IF to_regprocedure(...) IS NOT NULL`).
- **Never drop the Supabase `error`.** In a React Query `queryFn` use
  `unwrap()` (`src/lib/supabaseResult.ts`); elsewhere check `error` explicitly.
- **A null `error` does NOT mean the write happened.** UPDATE/DELETE matching
  zero rows returns `{ data: [], error: null }` — the most common serious bug
  class here (escrow, bans, invites, admin actions). On any write touching
  money/trust/safety: add `.select("id")` and pass through `unwrapMutation()`
  (`src/lib/mutationResult.ts`). Skipping the guard is fine only when zero rows
  is a legitimate outcome — say so in a comment.
- **Realtime subscriptions:** every `postgres_changes` channel needs a
  server-side `filter` scoped to the user, and a unique name via
  `channelNonce()` (`src/lib/realtimeChannel.ts`) — reused names silently drop
  the second subscription.
- **Parallel lanes: stagger the gates.** Don't let concurrent sessions run
  `typecheck`/`vitest`/`eslint` simultaneously — serialize them. Worktrees
  belong under `$HOME` (e.g. `~/.lh-b-ws/tree`), never `/tmp`; commit
  uncommitted work early.
- **Commit directly to `main`** — no branch/PR ceremony needed. Locally, just
  run `npm run typecheck` (plus `npx vitest run` when touching tested code);
  lint/build/full-suite already run in CI (`husky pre-commit` +
  `.github/workflows/test.yml`) — don't re-run the full local gate unless you
  have specific reason to distrust CI (e.g. you changed build config itself).
  If commits ever start reaching prod red, check `gh workflow list --all` for
  `disabled_manually` before assuming the local gate is the only option.
  Still run the review agents (`code-reviewer`, `silent-failure-hunter`,
  `security-auditor`) against the working diff before committing money/auth/
  data-model changes, since there's no PR gate to catch it otherwise.
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
