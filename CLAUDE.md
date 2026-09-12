# Louisiana Helpr

Rules only. Each [L] link goes to that rule's history in
[docs/lessons/CLAUDE-lessons.md](docs/lessons/CLAUDE-lessons.md). Proof no rule was lost:
`docs/claude-md-rule-inventory.md`. Keep this file under 200 lines (checked); new war
stories go in the lessons file, never here.

## Stack
- **Capacitor app, not SwiftUI/UIKit.** All UI, navigation, state and logic is React 18 + TypeScript + Vite in `src/`, built to `dist/` and bundled into the `.ipa`/`.apk` by `capacitor.config.ts`. It is a real App Store app (v1.0.x) with a web UI layer.
- Do not audit for SwiftUI patterns (`@State`, `@StateObject`, `@Observable`, Swift concurrency); audit `src/` and map native concepts to React/Capacitor. One codebase serves web + iOS + Android; a SwiftUI rewrite is not the direction.
- **`AppDelegate.swift` IS in scope; "stock boilerplate" is no reason to skip it.** If a native capability is dead in a way no TypeScript explains, read the AppDelegate. The push-token bug is FIXED (`AppDelegate.swift:139-151`); do not hunt it again. [L](docs/lessons/CLAUDE-lessons.md#appdelegate)
- Backend: Supabase (Postgres, RPCs, edge functions in `supabase/functions/`). Payments: Stripe Connect escrow. Native bridges: Capacitor plugins (Haptics, Camera, Geolocation, Push, StatusBar, Keyboard, Social Login, Biometric auth, App Badge).
- Checks: `npm run typecheck` · `npm run lint` · `npm run build`.

## How we work — owner standing orders (2026-09-12). Do not make the owner repeat these.
- **Prevent, don't chase.** Every owner-reported bug ships with a CI check for its whole CLASS, built from the app's own inventory, shown red on the original bug. A fix without its check is not done.
- **Gaps:** when you notice one, tell the owner what it is, then launch an agent (you pick the model) to close it. No permission needed beyond telling them.
- **Browser work runs one agent at a time.** Nothing that needs the browser is done until someone has LOOKED at screenshots: every failure, plus a sample. Scripts do the exhaustive pressing and measuring; screenshots are not taken of everything.
- **Completeness is proven, not claimed:** inventory from source, minus what was checked, must be empty, and every check must be shown able to fail.
- **`docs/OPEN.md` is the only open-work list.** Anything open from a handoff, the audit bus or an agent report gets a line there; nowhere else counts.
- **Ping** (osascript + sound) when an agent or chunk finishes.
- **The six efficiency changes** are all mandatory, tracked in `docs/OPEN.md` under "Working forwards": lint for root-cause patterns, changed-screen checks before push, owner reports become failing tests first, one open-work list, automatic browser lock + per-worktree ports, nightly WebKit + real backend.

## Verification
- **LOOK AT IT.** Verify every visual change (layout, spacing, colour, type, empty states, dark mode, every breakpoint that matters, 375 above all) by an actual screenshot of the actual screen, before AND after, and look at it before saying fixed. [L](docs/lessons/CLAUDE-lessons.md#look-at-it)
- **Look first, then measure.** The screenshot says what is wrong, the measurement says the number moved; neither substitutes for the other. [L](docs/lessons/CLAUDE-lessons.md#look-at-it)
- **A fix is not done until its own number moves.** Re-run the finding's own repro and record the new number beside the old; never close a finding on a diff. [L](docs/lessons/CLAUDE-lessons.md#remeasure)
- **Verify live before claiming broken.** Never from a migration file, code read or another agent's summary: check `pg_policies`/`pg_proc.proacl` (authz), `pg_get_functiondef` (behaviour), the rendered UI (visual). [L](docs/lessons/CLAUDE-lessons.md#verify-live)
- **Gate repo-wide:** `npm run typecheck` plus `npx vitest run` across the whole repo, never just touched files; the parity, registry-drift and fixture-vs-schema guards live elsewhere. [L](docs/lessons/CLAUDE-lessons.md#repo-wide)
- **Distrust `vitest run` in a shared tree.** A changing set of `findBy*` timeouts under parallel load is contention; before believing it, re-run in `git worktree add --detach <path> origin/main` with `node_modules` symlinked. [L](docs/lessons/CLAUDE-lessons.md#vitest-shared-tree)
- **Verify any CSS claim against `dist/assets/*.css` after `npm run build`, never the dev server**; the minifier collapses `backdrop-filter`/`-webkit-backdrop-filter`, so use an `@supports` block. [L](docs/lessons/CLAUDE-lessons.md#css-minifier)
- **A/B rendering and platform-API findings in WebKit** (`npx playwright install webkit`) before calling them clean; Chromium checks cannot see WKWebView bugs. [L](docs/lessons/CLAUDE-lessons.md#webkit)
- **Green CI is not a deploy.** Vercel validates `vercel.json` on its own side before building, so a green Actions run can mean prod never updated. [L](docs/lessons/CLAUDE-lessons.md#vercel-json)
- **Read a red run itself** (`gh run view <id> --log-failed`); a later green db-deploy does not re-lint it. Verify by object state (`pg_proc.proacl`, `to_regprocedure`), never run colour. [L](docs/lessons/CLAUDE-lessons.md#revoke-anon)
- **`node scripts/parsecheck.mjs <file>` (or `--all`)** is the fast syntax gate after every edit when typecheck is busy or forbidden; it cannot see missing imports, so it never replaces `npx tsc -b --noEmit`. [L](docs/lessons/CLAUDE-lessons.md#parsecheck)
- **Never hand back work you could have done.** Exhaust API, CLI, a temporary edge function, logs, browser; manual owner steps only for credentials, payments, App Store and dashboard actions. [L](docs/lessons/CLAUDE-lessons.md#never-hand-back)

## UI
- **Fix the EXACT thing named.** Never guess the element, look or scope; never touch what sits next to it; if the ask is ambiguous, ask instead of picking. [L](docs/lessons/CLAUDE-lessons.md#exact-thing)
- **Dead or no-op code you notice is a REPORT, not a task.** Count call sites before touching anything shared; say what you found instead of changing it. [L](docs/lessons/CLAUDE-lessons.md#exact-thing)
- **Never hand-roll a page skeleton:** build on the shared primitive (`AppShell`, `PageScaffold`, `AppPage`); add a prop rather than fork one.
- **`AppShell` (`src/components/AppShell.tsx`) is the ONLY fixed-viewport primitive** (100dvh lock, internal scroll, safe-area top inset, bottom-nav clearance). Never re-implement those. [L](docs/lessons/CLAUDE-lessons.md#shells)
- Fixed-shell pages: `AppShell` directly (Profile) or `PageScaffold` (`src/components/ui/PageScaffold.tsx`: title-card + bleeding panel, no viewport lock of its own) for Dashboard, Activity, Messages list, guest dashboard.
- The four account-state screens (SignupPending, AccountPending, AccountDenied, AccountBanned) use `AuthShell`'s centered card, not `AppShell`.
- Document-scroll pages (legal, marketing, multi-step forms, Profile/Activity tab pages): plain `min-h-screen bg-premium-page pb-safe-nav` wrapper, plus `<PageHeader>` for a back button. Never `AppShell`.
- A page's shell choice must agree with its entry in `DOCUMENT_SCROLL_ROUTES` (`src/hooks/useAppShellViewport.ts`, which toggles `app-shell` on `<html>`).
- **Every page fits the screen** at every breakpoint: centered in the available area, zero horizontal overflow, no rail-width dead gutter. [L](docs/lessons/CLAUDE-lessons.md#fit-the-screen)
- **The desktop rail is on the RIGHT, inset in ONE shared layer:** `right: var(--desktop-sidebar-w)` on `.app-shell-frame` and `padding-right: var(--desktop-sidebar-w)` on `#root` (248px), only while `.side-panel-open` and only when signed in. [L](docs/lessons/CLAUDE-lessons.md#rail-inset)
- **Trust the CSS declaration, never the comment beside it.** [L](docs/lessons/CLAUDE-lessons.md#rail-inset)
- **A page never re-insets itself** (no per-page rail-width padding, no `lg:pr-[248px]`, no spacer flex child). [L](docs/lessons/CLAUDE-lessons.md#rail-inset)
- Measure centering against the post-rail area, and measure `.app-shell-frame`, NOT `<main>` (a full-width scroll wrapper).
- **Proof of fit for any page touched:** at 1440 and 375, assert `documentElement.scrollWidth <= clientWidth`, no element wider than the viewport, column centered with no dead band; screenshot both.
- **Phone web == native app: ONE surface.** Never branch nav or layout on `Capacitor.isNativePlatform()` (genuine native capability only). A defect at 375 in a browser is an app defect.
- **Never role-based.** Every account posts and does jobs; every feature shows to everyone. Role bleed is not a bug, role-gating is never the fix, and copy addressing only Helprs or only posters is a defect.
- **The landing hero is LOCKED:** H1 "Louisiana's Local Job Partner." (Bodoni Moda) and subhead "Hire a Helpr or find local work..." — font, colour and copy are off-limits without an explicit instruction naming them.
- **Portal overlays to `document.body`.** `position: fixed` inside a page is never viewport-relative (any ancestor transform/filter/`backdrop-filter`). [L](docs/lessons/CLAUDE-lessons.md#fixed-containing-block)
- A portaled sibling of an open Radix modal needs `pointer-events: auto`, and must not end up `aria-hidden` via `hideOthers()`. [L](docs/lessons/CLAUDE-lessons.md#fixed-containing-block)
- **Primary and selected controls wear `btn-grad-primary`.** Never put a Tailwind variant over it (compiles to nothing; toggle in JS); never an inline `background` shorthand over it (use `backgroundImage`, or better nothing). [L](docs/lessons/CLAUDE-lessons.md#gloss)
- **Gloss tests assert the computed `background-image` is a real gradient**, never the class name. [L](docs/lessons/CLAUDE-lessons.md#gloss)
- **Reduced transparency = opaque form of each surface's OWN colour, per theme**, never a blanket `hsl(var(--background))`. [L](docs/lessons/CLAUDE-lessons.md#css-minifier)

## Data and money
- **Never drop the Supabase `error`:** `unwrap()` (`src/lib/supabaseResult.ts`) in a React Query `queryFn`; check `error` explicitly elsewhere.
- **A null `error` is not a write.** On money/trust/safety writes add `.select("id")` and `unwrapMutation()` (`src/lib/mutationResult.ts`); skip only when zero rows is legitimate, and say so in a comment. [L](docs/lessons/CLAUDE-lessons.md#zero-row-writes)
- **Realtime:** every `postgres_changes` channel needs a server-side user-scoped `filter` and a unique name via `channelNonce()` (`src/lib/realtimeChannel.ts`).
- **Revoke by role name: `FROM PUBLIC, anon`.** `FROM PUBLIC` alone leaves anon's explicit grant; verify in `pg_proc.proacl`. [L](docs/lessons/CLAUDE-lessons.md#revoke-anon)
- **There is no staging: one database, prod `fncmgoasalhdgfwzhsqa`.** Wanting staging means writing a test safe to run against prod. Still verify the linked ref before reading config or pushing. [L](docs/lessons/CLAUDE-lessons.md#no-staging)
- **Migrations auto-deploy on merge to main** via `.github/workflows/db-deploy.yml` (manual: `gh workflow run db-deploy.yml`). No manual pushes, no side channels; ship a graceful PGRST202 fallback for brand-new RPCs.
- **NEVER apply migrations to prod via MCP `apply_migration`** (wrong timestamp, poisons `schema_migrations`). `execute_sql` for read-only checks/test rows is fine; if ever unavoidable, reconcile with `supabase migration repair --status reverted/applied`. [L](docs/lessons/CLAUDE-lessons.md#apply-migration)
- **Zero migration drift:** `supabase migration list --linked` shows every version on both sides (`db-drift-detect.yml` nightly); deep audits verify by object existence (`to_regclass`/`to_regprocedure`/`information_schema`).
- **Never hand-type a migration timestamp:** use `npm run migration:new -- <slug>` (`src/test/migrationVersions.test.ts` fails CI on collisions).
- **Migrations must be replay-safe:** guard DDL against objects a later migration may define (`IF to_regprocedure(...) IS NOT NULL`).
- **Execute migrations locally with PGlite** (`@electric-sql/pglite`, outside the repo or `npm i --no-save`; confirm `git status package.json package-lock.json` clean): prod-shaped schema, run verbatim, apply 3× for replay-safety. [L](docs/lessons/CLAUDE-lessons.md#pglite)
- **A job can outlive its poster.** Deletion anonymises: `customer_id`, `location`, coordinates, `reviewer_id`, `opener_id` nullable, `status` preserved. Never assume them populated. [L](docs/lessons/CLAUDE-lessons.md#ownerless-jobs)
- Never coalesce a null to `""` in a two-way comparison, and never let a null throw inside a `.filter()` predicate. [L](docs/lessons/CLAUDE-lessons.md#ownerless-jobs)
- Browse visibility (incl. excluding ownerless jobs) belongs in the `open_jobs_browse` view, not the client.

## Platform gotchas
- **Never `await` or resolve a promise with a Capacitor plugin object** (thenable assimilation = silent no-op). Destructure: `const { App } = await import("@capacitor/app")`. [L](docs/lessons/CLAUDE-lessons.md#capacitor-await)
- **Never add explanation keys to `vercel.json`** (every entry is `additionalProperties: false`; `JSON.parse` passing is not validation). Explain in the commit message or beside dependent code; `scripts/check-vercel-config.mjs` guards pre-commit. [L](docs/lessons/CLAUDE-lessons.md#vercel-json)
- WebKit, minifier, fixed-position and gloss rules live under Verification and UI above.

## Process
- **Commit directly to `main`**, no branch/PR. Locally run `npm run typecheck` (+ `npx vitest run` for tested code); CI runs lint/build/full suite. Re-run the full local gate only with specific reason to distrust CI. [L](docs/lessons/CLAUDE-lessons.md#commit-main)
- If commits start reaching prod red, check `gh workflow list --all` for `disabled_manually` before assuming the local gate is the only option.
- **Review money/auth/data-model diffs before committing** with `lh-silent-failure`, `lh-authz-rls`, `lh-money-escrow` (tell them REVIEW ONLY, ignore their fleet preamble), or `/code-review` / `/security-review`. `code-reviewer`, `silent-failure-hunter`, `security-auditor` do NOT exist. [L](docs/lessons/CLAUDE-lessons.md#commit-main)
- `/code-review ultra` is user-triggered and billed: recommend it, never attempt it.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never idle on a blocked git operation.** Apply the documented fallback (commit direct to main) at once; if still stuck after a couple of attempts, stop the run cleanly. [L](docs/lessons/CLAUDE-lessons.md#git-idle)
- **YOU pick every agent's model; never ask.** Pass `model:` on every spawn: money/authz/data-model/guard chains → `opus`; exhaustive visual driving and design judgement → `fable`; mechanical specced edits → `sonnet`; never `haiku` for an answer that will be believed. [L](docs/lessons/CLAUDE-lessons.md#pick-models)
- Re-verification of untrusted prior work goes to a DIFFERENT model than produced it.
- **Agent teams is ON.** Pass `name:` or the spawn is not an addressable teammate; the model is silent without `model:` (read `~/.claude/teams/session-*/config.json`); `permissionMode: plan` teammates are released by the lead approving the plan. [L](docs/lessons/CLAUDE-lessons.md#agent-teams)
- Fleet cross-talk is `SendMessage` to the orchestrator; lanes never message each other. Findings go in the `audit-bus.mjs` ledger (`file`/`status`/`dupe`/`list`/`rollup`); its `msg`/`inbox` channel is retired.
- **Fan out as wide as work is disjoint by file** (no fixed agent count). Serialize `typecheck`/`vitest`/`eslint` across sessions; the lead runs the gate once, alone, and tells agents to use `parsecheck.mjs` instead. [L](docs/lessons/CLAUDE-lessons.md#parallel-lanes)
- Worktrees live under `$HOME` (e.g. `~/.lh-b-ws/tree`), never `/tmp`; commit uncommitted work early.
- **Never rotate a shared credential silently.** Say so in the transcript and `docs/audit/launch-2026-09/inbox/` first; never change one another agent is mid-run on. [L](docs/lessons/CLAUDE-lessons.md#credentials)

## Audit standard — the `lh-audit` skill
- The full standard is `.claude/skills/lh-audit/SKILL.md` (three lenses; §1 method, §2 principles, §3 per-screen checklist, §4 severity, §5 completeness, §6 tooling).
- Load it automatically (Skill tool, `lh-audit`) for any audit, improvement or per-screen check, including `/audit`, `/improve`, or "look at this screen/page/route/component/dialog".
- The user invokes it with `/lh-audit`, or "run the LH audit" / "audit this page against the LH standard".
- Once invoked, every rule in it (mandate, three lenses, §1–§6) is mandatory, an extension of this file.
