# Louisiana Helpr

## Stack — read this before any audit

Louisiana Helpr is a **Capacitor app**, not a native SwiftUI/UIKit app.
The entire UI, navigation, state, and business logic is **React 18 +
TypeScript + Vite** (in `src/`), built into `dist/` and shipped inside the
native iOS/Android shell. `capacitor.config.ts` bundles `dist/` into the
`.ipa`/`.apk` — it is a real, self-contained, App Store-distributed app
(App Store Connect, currently v1.0.x), just with a web UI layer.

Do **not** audit for SwiftUI patterns (`@State`, `@StateObject`,
`@Observable`, Swift concurrency) — there are none. Audit and improve the
React/TypeScript code in `src/`; that *is* the iOS app. Map any "native"
concept to its React/Capacitor equivalent.

**But `AppDelegate.swift` is NOT out of scope, and "it's stock boilerplate"
is not a reason to skip it.** This file used to say there was no meaningful
native code, and that sentence is why push notifications were broken for the
entire life of the project without anyone looking: Capacitor's
`PushNotificationsPlugin` observes `.capacitorDidRegisterForRemoteNotifications`,
that notification is *declared* by the framework but **posted from nowhere**,
and the host app must post it from
`didRegisterForRemoteNotificationsWithDeviceToken`. Stock boilerplate does
not, so iOS handed the app a valid APNs token on every launch and it was
dropped on the floor — unfillable `push_tokens`, no error, no log.

**That specific bug is FIXED — verified 2026-09-02, do not go looking for it
again.** `AppDelegate.swift:127-140` posts both
`.capacitorDidRegisterForRemoteNotifications` and
`.capacitorDidFailToRegisterForRemoteNotifications`, confirmed against the
plugin's own source
(`node_modules/@capacitor/push-notifications/ios/Sources/PushNotificationsPlugin/PushNotificationsPlugin.swift:38-46`)
as the exact two names it observes, with `appDelegateRegistrationCalled`
gating the delivered-notification APIs. `UNNotificationCategory` registration
is present and matches `category.ts`. The history stays here because the
LESSON generalises and the bug does not: a framework can declare a
notification, observe it, and post it from nowhere — leaving the host app
silently responsible for a link nothing warns you about. **If a native
capability appears dead in a way no amount of TypeScript explains, read the
AppDelegate.**

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
  directly (Profile), or `PageScaffold`
  (`src/components/ui/PageScaffold.tsx`) when you want its two-card layout
  (Dashboard, Activity, Messages list, guest dashboard). `PageScaffold` is a
  *thin wrapper over `AppShell`* — it adds only the title-card + bleeding
  panel, never its own viewport lock. The four account-state screens
  (SignupPending, AccountPending, AccountDenied, AccountBanned) are the
  exception: they use `AuthShell`'s centered-card treatment, not `AppShell`
  (`AccountPending.tsx:9`, `:212`, and the comment at `:208` explaining the
  unification). This line used to name AccountPending as an `AppShell` page.
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

- **The desktop rail is on the RIGHT, and its inset is applied in exactly ONE
  layer.** This entry said LEFT until 2026-09-02, and named two rules that do
  not exist: `.app-shell-frame { left: … }` and `#root { padding-left: … }`.
  Grep the stylesheet — the only two rail insets in the entire file are
  `right: var(--desktop-sidebar-w)` on `.app-shell-frame` (`src/index.css:918`)
  and `padding-right: var(--desktop-sidebar-w)` on `#root`
  (`src/index.css:1111`). There is no `left:` or `padding-left:` rail inset
  anywhere. `--desktop-sidebar-w` is 248px. Both rules are additionally gated on
  `.side-panel-open`, so the inset exists only while the panel is open — a
  closed panel is not a narrower rail, it is no rail.

  Two things to know before trusting this paragraph OR the code around it.
  `index.css`'s own comment above the `#root` rule still describes the rail as
  "pinned at the viewport's left edge" while the declaration under it pads
  RIGHT; the comment is stale, the declaration is authoritative. And `.desktop-rail`
  is not present for a guest at all — measured at 1440 on `/`, `/legal` and
  `/browse`, `<html>` carries only `web-desktop side-panel-open`, so none of
  this fires until you are signed in.

  A page must **never** re-inset itself (no per-page `paddingRight`/`paddingLeft`
  of the rail width, no `lg:pr-[248px]`, no extra flex spacer) — doing so insets
  by a *second* rail width and knocks the centered column off-center. That was
  the PostJob bug, in its original left-rail form: `#root` padded 248px AND the
  page padded 248px → form shoved to x≈496 with a dead 250px gutter. Rail
  clearance lives in the shared shell layer, period.
- After the single inset, the inner content column centers in the *post-rail*
  area (`mx-auto`), so its visual center is offset from the raw viewport center
  by half the rail. Verify by measuring the column against the space beside the
  rail, not against the whole window — and measure `.app-shell-frame`, NOT
  `<main>`: `<main>` is a full-width scroll wrapper, and reading it instead is
  how a lane first "measured" the rail on the wrong edge.
- **Proof of "fits" is mandatory and measured, not eyeballed.** For any page you
  touch, in Chrome at 1440 (rail present) AND 375 (no rail): assert
  `documentElement.scrollWidth <= clientWidth` (zero horizontal overflow), assert
  no element wider than the viewport, and confirm the primary content column is
  centered in the available area with no rail-width dead band. Screenshot both.

## Working rules

Each of these is a real, non-obvious gotcha that has cost real time — keep
this list tight; project-specific trivia belongs in code comments, not here.

- **A CSS result measured on the dev server is not a result — the minifier
  can delete half your rule.** Vite's CSS minifier treats `backdrop-filter`
  and `-webkit-backdrop-filter` as one property declared twice and keeps only
  the LAST. A `prefers-reduced-transparency` rule that killed the blur
  everywhere in dev shipped as the `-webkit-` half alone, which means
  **Chromium `blur(40px)`, WebKit `none`** — so Reduce Transparency users got
  the full 40px frost on the web, and it measured clean on device because
  WebKit aliases the two. A lane reported "18 frosted elements → 0"; that
  number came from a dev server and was false in the bundle.

  This is the mirror of the WebKit rule below: there, Chromium cannot see a
  WebKit bug; here, the dev server cannot see a Chromium one. Fix is an
  `@supports` block the minifier cannot collapse. **Verify any CSS claim
  against `dist/assets/*.css` after `npm run build`, not against the dev
  server** — and count HITS, not lines:

      grep -o "backdrop-filter:none" dist/assets/*.css | wc -l          # 14
      grep -o -- "-webkit-backdrop-filter:none" dist/assets/*.css | wc -l  # 8

  This line used to say `grep -c` was "the whole check, and it distinguishes
  the two states in one command." It cannot. **The minified bundle is ONE
  LINE**, and `grep -c` counts matching LINES — so it returns `1` whether the
  file holds one occurrence or fourteen, in both the broken state and the fixed
  one. A check that returns the same number either way reads exactly like a
  check that passed, which is the failure mode this whole rule exists to warn
  about. Found by the verifier, 2026-09-03; the fix itself was intact, only the
  evidence was empty. The asymmetry above (14 vs 8) is the real signal.

  Related, same lane: setting every glass class to `hsl(var(--background))`
  does not remove transparency, it removes the MATERIAL. `.liquid-glass` is
  already opaque white in light mode, so the blanket repainted every card
  canvas-coloured and a user asking for less transparency lost the boundary
  between card and page. Opaque form of each surface's OWN colour, per theme.

- **`vitest run` is NOT trustworthy while several agents share this tree —
  gate against a clean worktree.** Under parallel-lane load the full suite
  fails a VARYING set of 1–22 tests that every one of them passes in
  isolation; observed 2026-09-02 with 7–8 lanes running. The tell is the
  shape, not the count: the failing set changes between consecutive runs,
  the failures are `findBy*` timeouts rather than assertion mismatches, and
  slow I/O-bound specs are hit hardest (`popupShellInventory` took 23.6s to
  time out while scanning ~1200 files). Two separate lanes independently
  reported `adminJobsNotifications.test.tsx` as broken; it passes 5/5 alone.
  Chasing one of these as a real regression costs an hour and finds nothing.

  Before believing a suite failure: `git worktree add --detach <path>
  origin/main`, symlink `node_modules`, and run it there. That also removes
  the other half of the problem — a dirty shared tree means you are testing
  everyone's half-finished work, not yours. This is how the E2E lane got a
  trustworthy 101/101 when the shared tree was red.

- **Chromium cannot see WebKit-only bugs — `npx playwright install webkit`
  and A/B there.** The app ships in a WKWebView, and the classes of defect
  that only appear in WebKit are invisible to every Chromium-based check we
  run (Playwright default, the Chrome extension, jsdom). Found this way on
  2026-09-01: `font: -apple-system-body` — the one CSS hook that reports the
  OS text size — resolves to **13px** in real WebKit, because that is macOS's
  system body size and macOS has no Dynamic Type. Divided by the iOS default
  of 17 that is 0.765, so `--user-text-scale` clamped to 0.85 and every
  desktop Safari user got the whole app ~15% smaller than designed. A/B'd
  against the running dev server: `0.85` without the fix, `1` with it.
  Chromium drops the declaration entirely and reports a clean `1` either way,
  which is exactly why it survived a full audit. Playwright's `webkit` build
  costs one 77MB download and runs headless — use it before declaring a
  rendering or platform-API finding clean.

- **Never idle on a blocked git operation — resolve or abort within the run.**
  A scheduled routine that hits a blocked merge/push and just sits there
  produces zero signal: it never reports, never notifies, and the user does
  not manually check sessions. (`lh-deps-and-drift` hung 19 hours on a
  blocked `--admin` merge on 2026-08-28 with no completion, no notification,
  nothing.) If a git action is refused, apply the documented fallback
  immediately (e.g. commit direct to `main` per this file) and move on. If
  truly stuck after a couple of attempts, stop the run cleanly and let the
  next scheduled run pick it up — do not leave the session open and idle.
- **A green Actions tab does NOT mean the deploy ran. `vercel.json` has taken
  production down three times.** Vercel validates that file against its schema
  **on its own side, before the build**, independently of GitHub Actions. An
  invalid file therefore produces a fully green CI run, no build log to look
  at, and production silently continuing to serve the previous bundle. Every
  entry in `redirects`/`headers`/`rewrites` is `additionalProperties: false`,
  and all three outages were the same instinct: JSON has no comments, so
  someone explained a rule with an extra key (`comment` in `headers[1]` →
  cea0055f; `//`, `//why`, `//requires`, `//status` in `redirects[0]` →
  e926b307). **The trap is that `JSON.parse` succeeding feels like
  validation** — every author had "checked" the file and it passed while
  invalid. `scripts/check-vercel-config.mjs` now blocks this pre-commit via
  lint-staged (offline by design; a hook that needs the network is a hook
  people bypass). Put rule explanations in the commit message or beside the
  code that depends on them, never in that file.
- **Migrations auto-deploy on merge to main** via `.github/workflows/db-deploy.yml`
  (`supabase db push`, also manually runnable via `gh workflow run db-deploy.yml`).
  No manual pushes, no side channels. Ship a graceful fallback for PGRST202
  "function not found" on brand-new RPCs (deploy lag window).
- **Check which project the CLI is linked to before trusting it.**
  `supabase/.temp/project-ref` currently points at **staging**
  (`okpxtpfvwtmbuxugqsws`), not prod (`fncmgoasalhdgfwzhsqa`). A secrets
  listing through the CLI today nearly produced the false conclusion that
  APNs was unconfigured, because it was reading the wrong project. Verify the
  ref before reading config or pushing anything.
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
- **You CAN execute a migration locally without Docker — use PGlite.**
  "No local Postgres" has repeatedly meant migrations shipped reviewed-by-eye
  only. `@electric-sql/pglite` is real Postgres compiled to WASM: install it
  **outside the repo** (a scratch dir — do not add it to `package.json`), or
  `npm i --no-save @electric-sql/pglite` when the probe has to live in the
  repo to resolve its imports — verify `git status package.json
  package-lock.json` comes back clean afterwards either way.
  Build a prod-shaped schema, and run the migration verbatim. This is how the
  PIF-restore migration got 22 assertions including a proven-idempotent
  second run and a unique-violation race, none of which a read could have
  established. Apply the file 3× consecutively to prove replay-safety.
- **`position: fixed` inside a page is NOT relative to the viewport —
  assume it never is.** A `transform`, `filter`, `backdrop-filter`,
  `perspective`, `contain` or `will-change` on ANY ancestor makes that
  ancestor the containing block for `fixed` descendants. Two independent
  sources of this exist app-wide: `AppPage.tsx` wraps every child in
  `animate-ds-page-in`, whose keyframe ends on `transform: translateY(0)`
  with `animation-fill-mode: forwards`, so a non-`none` transform stays
  applied forever; and — the bigger one — **every frosted surface**
  (`.liquid-glass`, `.glass-modal`, the nav dock pill) carries
  `backdrop-filter`. So a hand-rolled `fixed inset-0` overlay sizes itself to
  whatever panel it happens to sit in. Measured: a "full-screen" dialog at
  329×433 in a 393×852 viewport; a photo lightbox opened inside
  JobDetailDialog at **10.2% of viewport height**; the nav quick-menu scrim
  at 6.6%, so tapping anywhere above the dock did nothing. In every case the
  element stays perfectly scrollable, so `overflow-y-auto` "fixes" nothing
  and the real defect is invisible to a code read. **Portal overlays to
  `document.body`** (the shared `Dialog` already does).
  Two consequences of portalling that have each bitten once: an open Radix
  modal sets `body { pointer-events: none }`, which **inherits** — a portaled
  sibling renders at full size and is completely inert unless it sets
  `pointer-events: auto`; and Radix's `hideOthers()` stamps `aria-hidden` on
  late-added `<body>` children, so guard against your own overlay becoming
  `role="dialog" aria-modal="true" aria-hidden="true"`.
- **Two silent ways to lose the gloss. Both shipped.** The rule is that
  primary and selected controls wear `btn-grad-primary`; these defeat it with
  no error and no warning, and in both cases the class is still on the element
  so the class list looks correct.
  1. **A Tailwind variant over a hand-written class compiles to NOTHING.**
     `data-[state=checked]:btn-grad-primary` emits no CSS — variants only
     compose over utilities Tailwind generates, and `.btn-grad-primary` lives
     in `index.css`. Toggle these in JS instead.
  2. **An inline `background` SHORTHAND resets `background-image`.** A
     `style={{ background: "linear-gradient(...)" }}` on a `<Button>` that
     already has `btn-grad-primary` wins, and the gradient you get is the
     hand-painted one. This is how the job-sheet CTA and its apply-step twin
     stayed flat. Use `backgroundImage` if you must override, or better,
     don't.
  **Therefore: when asserting gloss in a test, read the computed
  `background-image` and check it is a real gradient.** Asserting the class
  name passes on a flat control, which is why this kept coming back.
- **Never `await` a Capacitor plugin object — assimilation makes it a silent
  no-op.** `registerPlugin()` returns a Proxy whose `get` trap manufactures a
  method for ANY property, which is how it forwards unknown calls to native.
  So resolving a promise *with the plugin itself* triggers thenable
  assimilation: the runtime probes `.then`, the Proxy invents one, the runtime
  calls it, and the bridge rejects with `"App.then()" is not implemented`
  (`code: 'UNIMPLEMENTED'`). The difference is one word — `return App` breaks,
  `return { App }` works — and the broken version reads perfectly. Behind a
  fail-open `catch` it produces a feature that never fires and never says why.
  Destructure at the import: `const { App } = await import("@capacitor/app")`,
  which is what `AppLockGate.tsx`, `nativePush.ts` and `appLifecycle.ts`
  already do. It surfaced only because the test runner reports unhandled
  rejections.
- **Never drop the Supabase `error`.** In a React Query `queryFn` use
  `unwrap()` (`src/lib/supabaseResult.ts`); elsewhere check `error` explicitly.
- **A job can outlive the person who posted it.** Account deletion ANONYMISES
  rather than deletes (`20260901033011`): `jobs.customer_id`, `jobs.location`,
  `latitude`, `longitude`, `reviews.reviewer_id` and `disputes.opener_id` are
  all nullable in prod, `description` becomes `'[removed at account deletion]'`,
  and **`status` is deliberately preserved** — so an `open` job stays `open`
  with no owner. Never assume those are populated; `regenerate types → 25 type
  errors in 17 files` was one afternoon (SI-012). Two traps worth keeping:
  coalescing a null to `""` is NOT neutral in a two-way comparison
  (`userLocation.includes("")` is true for every string, so an address-less job
  matched *every* nearby search), and a null inside a `.filter()` predicate
  throws and empties the WHOLE list rather than dropping one row. Ownerless
  jobs are excluded from discovery in the `open_jobs_browse` view — that view,
  not the client, is where browse visibility belongs, because the feed and the
  count both read it. Apple REQUIRES in-app account deletion, so this path
  will be exercised.
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
- **`node scripts/parsecheck.mjs <file>` (or `--all`) is the fast syntax
  gate.** Seconds, no contention — use it after every edit when the real
  typecheck is busy or forbidden. It catches the `{/* … */}`-between-JSX-
  attributes break that `tsc --noEmit -p tsconfig.json` misses. It does
  **not** resolve symbols, so it cannot see a missing import: `icon={Lock}`
  with no lucide import parses clean and silently binds the DOM global
  `Lock`. A clean parse is never a substitute for `npx tsc -b --noEmit`.
- **Parallel lanes: stagger the gates.** Don't let concurrent sessions run
  `typecheck`/`vitest`/`eslint` simultaneously — serialize them. Worktrees
  belong under `$HOME` (e.g. `~/.lh-b-ws/tree`), never `/tmp`; commit
  uncommitted work early.
  **There is no fixed agent count** (the old "≤2–3" cap was lifted 2026-09-02).
  Fan out as wide as the work is genuinely *disjoint by file* — the binding
  limit is the shared gate, not a number, and everyone queues behind one
  compile anyway. The lead owns the gate and runs it once, alone; give agents
  `node scripts/parsecheck.mjs` instead and say so explicitly in their brief.
- **Agent teams is ON** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in
  `~/.claude/settings.json`). Three things are easy to get wrong: a spawn
  becomes an addressable **teammate** only if you pass `name:` — without it
  there is no `ListAgents` row and no way to message or plan-approve it; the
  **model comes from the agent definition silently** unless you pass `model:`,
  and you can only see what it actually got by reading
  `~/.claude/teams/session-*/config.json` afterwards (a research agent
  defaulted to haiku and returned a self-contradictory answer); and a teammate
  on `permissionMode: plan` is released by the **lead approving its plan** over
  the team inbox. Fleet cross-talk is `SendMessage` to the orchestrator, which
  fans out — lanes never message each other (`PROTOCOL.md` §7). The
  `audit-bus.mjs` `msg`/`inbox` file channel is retired; `file`/`status`/
  `dupe`/`list`/`rollup` remain the findings ledger. **Findings go in the bus,
  conversation goes over `SendMessage`.**
- **Commit directly to `main`** — no branch/PR ceremony needed. Locally, just
  run `npm run typecheck` (plus `npx vitest run` when touching tested code);
  lint/build/full-suite already run in CI (`husky pre-commit` +
  `.github/workflows/test.yml`) — don't re-run the full local gate unless you
  have specific reason to distrust CI (e.g. you changed build config itself).
  If commits ever start reaching prod red, check `gh workflow list --all` for
  `disabled_manually` before assuming the local gate is the only option.
  Still review the working diff before committing money/auth/data-model
  changes, since there's no PR gate to catch it otherwise. **The agents this
  line used to name — `code-reviewer`, `silent-failure-hunter`,
  `security-auditor` — DO NOT EXIST**, and haven't for long enough that the
  rule was quietly unfollowable: the instruction reads as satisfiable, the
  spawn fails, and the review gets skipped. Use what is actually installed:
  `lh-silent-failure` (dropped errors, zero-row writes, fail-open catches),
  `lh-authz-rls` (RLS, IDOR, SECURITY DEFINER, view/policy changes) and
  `lh-money-escrow` (anything touching escrow, payouts or price). Tell them
  **REVIEW ONLY — do not fix, do not edit, report findings** and to ignore
  their own worktree/audit-bus/PROTOCOL preamble, which is written for a fleet
  sweep, not a targeted diff review. The `/code-review` and `/security-review`
  skills are the other option. `/code-review ultra` is user-triggered and
  billed — you cannot launch it; recommend it, don't attempt it.
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

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
