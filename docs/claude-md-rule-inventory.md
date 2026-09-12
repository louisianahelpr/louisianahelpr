# CLAUDE.md rule inventory

Proof that the 2026-09-12 rewrite of `CLAUDE.md` (570 lines → rules file) lost no rule.
Every distinct instruction in CLAUDE.md as of f26c6a7e2, including rules embedded
mid-story, is listed once. "Source" is the section and line range in the OLD file
(`git show f26c6a7e2:CLAUDE.md`); "New line" is where the rule now lives in CLAUDE.md.
Histories and evidence moved verbatim to `docs/lessons/CLAUDE-lessons.md`.

Rules inventoried: 135. Mapped: 135. Dropped: 0.

| # | Rule | Source (old CLAUDE.md) | New line |
|---|------|------------------------|----------|
| 1 | Treat the app as a Capacitor app, not native SwiftUI/UIKit | Stack :5 | 9 |
| 2 | All UI/state/logic lives in React 18 + TS + Vite in src/, bundled to dist/ into the ipa/apk | Stack :6-10 | 9 |
| 3 | Do not audit for SwiftUI patterns (@State, @StateObject, @Observable, Swift concurrency) | Stack :12-13 | 10 |
| 4 | Audit and improve src/; map native concepts to React/Capacitor equivalents | Stack :13-15 | 10 |
| 5 | AppDelegate.swift is in scope; 'stock boilerplate' is not a reason to skip it | Stack :17-18 | 11 |
| 6 | If a native capability is dead in a way TypeScript cannot explain, read the AppDelegate | Stack :39-41 | 11 |
| 7 | Do not go looking for the push-token AppDelegate bug again; it is fixed (AppDelegate.swift:139-151) | Stack :28-29 | 11 |
| 8 | Backend is Supabase (Postgres, RPCs, edge functions in supabase/functions/) | Stack :43 | 12 |
| 9 | Payments are Stripe Connect escrow | Stack :44 | 12 |
| 10 | Native bridges are the listed Capacitor plugins | Stack :45-46 | 12 |
| 11 | Checks are npm run typecheck / lint / build | Stack :47 | 13 |
| 12 | One codebase for web+iOS+Android is deliberate; no SwiftUI rewrite | Stack :49-50 | 10 |
| 13 | AppShell is the only fixed-viewport primitive; never re-implement 100dvh lock, internal scroll, safe-area top, nav clearance | Page layout :54-57 | 41 |
| 14 | Fixed-shell pages use AppShell directly (Profile) or PageScaffold (Dashboard, Activity, Messages list, guest dashboard) | Page layout :59-63 | 42 |
| 15 | PageScaffold is a thin wrapper over AppShell and never adds its own viewport lock | Page layout :63-65 | 42 |
| 16 | The four account-state screens use AuthShell's centered card, not AppShell | Page layout :65-69 | 43 |
| 17 | Document-scroll pages use min-h-screen bg-premium-page pb-safe-nav wrapper (+PageHeader); never AppShell | Page layout :70-73 | 44 |
| 18 | A page's shell choice must agree with DOCUMENT_SCROLL_ROUTES in useAppShellViewport.ts | Page layout :74-77 | 45 |
| 19 | Every page fits the screen at every breakpoint: centered, no horizontal overflow, no rail-width gutter | Fit the screen :81-84 | 46 |
| 20 | The desktop rail is on the RIGHT, inset in exactly one layer (.app-shell-frame right:, #root padding-right:) | Fit the screen :86-92 | 47 |
| 21 | The rail inset exists only while .side-panel-open (closed panel = no rail) | Fit the screen :93-95 | 47 |
| 22 | No rail for guests (.desktop-rail absent until signed in) | Fit the screen :101-104 | 47 |
| 23 | Trust the CSS declaration, never the prose/comment beside it | Fit the screen :97-101 | 48 |
| 24 | A page never re-insets itself (no per-page rail padding, lg:pr-[248px], spacer) | Fit the screen :106-111 | 49 |
| 25 | Measure centering against the post-rail area, not the whole window | Fit the screen :112-115 | 50 |
| 26 | Measure .app-shell-frame, not <main> | Fit the screen :115-117 | 50 |
| 27 | Proof of fit is mandatory and measured at 1440 and 375: scrollWidth<=clientWidth, no over-wide element, centered, screenshot both | Fit the screen :118-122 | 51 |
| 28 | Prevent, don't chase: every owner-reported bug ships with a class-wide CI check shown red on the original | Standing orders :126-128 | 16 |
| 29 | Gaps: tell the owner, then launch an agent (you pick model) to close it | Standing orders :129-130 | 17 |
| 30 | Browser work runs one agent at a time | Standing orders :131 | 18 |
| 31 | Browser work not done until someone LOOKED at screenshots of every failure plus a sample; scripts do exhaustive measuring | Standing orders :131-134 | 18 |
| 32 | Completeness is proven: inventory minus checked must be empty; every check shown able to fail | Standing orders :135-136 | 19 |
| 33 | Ping (osascript + sound) when an agent or chunk finishes | Standing orders :137 | 20 |
| 34 | The six efficiency changes in docs/OPEN.md 'Working forwards' are mandatory | Standing orders :138-141 | 21 |
| 35 | Fix the EXACT thing named; never guess element/look/scope; never touch adjacent things | Working rules :145-146 | 38 |
| 36 | If the ask is ambiguous, ask rather than pick an interpretation | Working rules :146-147 | 38 |
| 37 | Dead or no-op code you notice is a report, not a task | Working rules :147-148 | 39 |
| 38 | Count call sites before touching anything shared; report instead of changing | Working rules :149-151 | 39 |
| 39 | Never claim broken from a migration file, code read or agent summary; verify live first | Working rules :153-154 | 27 |
| 40 | Use pg_policies/pg_proc.proacl for authz, pg_get_functiondef for behaviour, rendered UI for visuals | Working rules :154-156 | 27 |
| 41 | Verify repo-wide: npm run typecheck + npx vitest run across the whole repo | Working rules :161-165 | 28 |
| 42 | Never hand back work you could have done; exhaust API, CLI, temp edge function, logs, browser | Working rules :167-169 | 35 |
| 43 | Manual owner steps only for credentials, payments, App Store, dashboard actions | Working rules :169-171 | 35 |
| 44 | Phone-sized web and native app are one surface; never diverge nav/layout on isNativePlatform() | Working rules :173-176 | 52 |
| 45 | A defect at 375 in a browser is a defect in the app | Working rules :175-176 | 52 |
| 46 | Never role-based: every account posts and does jobs, all features shown to everyone; never role-gate | Working rules :178-180 | 53 |
| 47 | Copy addressing only Helprs or only posters is a defect | Working rules :180-181 | 53 |
| 48 | Landing hero H1 and subhead are locked (font, colour, copy) without explicit instruction | Working rules :183-186 | 54 |
| 49 | Verify every visual change by an actual screenshot, and look at it before saying fixed | Working rules :188-192 | 24 |
| 50 | Look first, then measure; neither substitutes for the other | Working rules :205-208 | 25 |
| 51 | Eyeball applies to layout, spacing, colour, type, empty states, dark mode, every breakpoint; 375 above all | Working rules :210-212 | 24 |
| 52 | Screenshot before AND after | Working rules :212 | 24 |
| 53 | A fix is not done until its own number moves; re-measure every time | Working rules :214-215 | 26 |
| 54 | Never close a finding on a diff; re-run its repro and record new number beside old | Working rules :216-218 | 26 |
| 55 | Verify CSS claims against dist/assets/*.css after npm run build, not the dev server | Gotchas :249-264 | 30 |
| 56 | Fix minifier-collapsed backdrop-filter pairs with an @supports block | Gotchas :260-261 | 30 |
| 57 | Reduced transparency: opaque form of each surface's own colour per theme, not hsl(var(--background)) | Gotchas :266-270 | 59 |
| 58 | Don't trust vitest in a shared tree; varying findBy* timeouts are contention | Gotchas :272-281 | 29 |
| 59 | Before believing a suite failure, re-run in a clean detached worktree of origin/main with node_modules symlinked | Gotchas :283-287 | 29 |
| 60 | A/B rendering/platform-API findings in Playwright WebKit before declaring clean | Gotchas :289-302 | 31 |
| 61 | Never idle on a blocked git operation; apply fallback immediately | Gotchas :304-310 | 88 |
| 62 | If truly stuck after a couple of attempts, stop the run cleanly | Gotchas :310-312 | 88 |
| 63 | A green Actions tab does not mean the deploy ran (Vercel validates vercel.json itself) | Gotchas :313-317 | 32 |
| 64 | Never add explanation/comment keys to vercel.json; JSON.parse passing is not validation | Gotchas :318-324 | 79 |
| 65 | Put vercel.json rule explanations in the commit message or beside dependent code | Gotchas :326-327 | 79 |
| 66 | Always revoke by role name: FROM PUBLIC, anon | Gotchas :328-337 | 65 |
| 67 | Verify grants in pg_proc.proacl | Gotchas :338-339 | 65 |
| 68 | Read the red run itself; a later green db-deploy does not clear it | Gotchas :341-348 | 33 |
| 69 | Verify fixes by object state, never run colour | Gotchas :349-350 | 33 |
| 70 | Migrations auto-deploy on merge to main via db-deploy.yml; no manual pushes/side channels | Gotchas :353-355 | 67 |
| 71 | Ship a graceful PGRST202 fallback for brand-new RPCs | Gotchas :355-356 | 67 |
| 72 | There is no staging; one database, prod fncmgoasalhdgfwzhsqa | Gotchas :357 | 66 |
| 73 | If you want staging, write a test safe to run against prod instead | Gotchas :371-372 | 66 |
| 74 | Verify the linked Supabase ref before reading config or pushing | Gotchas :374-376 | 66 |
| 75 | Never apply migrations to prod via MCP apply_migration | Gotchas :377-378 | 68 |
| 76 | execute_sql is fine for read-only checks/test rows | Gotchas :379 | 68 |
| 77 | If unavoidable, reconcile with supabase migration repair | Gotchas :379-380 | 68 |
| 78 | Zero migration drift: migration list --linked shows every version both sides | Gotchas :381-383 | 69 |
| 79 | Deep audits verify by object existence (to_regclass/to_regprocedure/information_schema) | Gotchas :383-384 | 69 |
| 80 | Never hand-type a migration timestamp; use npm run migration:new | Gotchas :385-386 | 70 |
| 81 | Migrations must be replay-safe; guard DDL | Gotchas :387-388 | 71 |
| 82 | Execute migrations locally with PGlite instead of reviewing by eye | Gotchas :389-391 | 72 |
| 83 | Install PGlite outside the repo or --no-save; confirm package.json/lockfile clean | Gotchas :391-395 | 72 |
| 84 | Build a prod-shaped schema, run the migration verbatim, apply 3x for replay-safety | Gotchas :396-399 | 72 |
| 85 | Assume position: fixed is never viewport-relative inside a page | Gotchas :400-414 | 55 |
| 86 | Portal overlays to document.body | Gotchas :415-416 | 55 |
| 87 | Portaled sibling of an open Radix modal needs pointer-events: auto | Gotchas :417-420 | 56 |
| 88 | Guard your overlay against Radix hideOthers() aria-hidden | Gotchas :420-422 | 56 |
| 89 | Primary and selected controls wear btn-grad-primary | Gotchas :423-424 | 57 |
| 90 | Never use a Tailwind variant over btn-grad-primary; toggle in JS | Gotchas :427-430 | 57 |
| 91 | Never inline background shorthand over btn-grad-primary; use backgroundImage or don't | Gotchas :431-436 | 57 |
| 92 | Gloss tests assert computed background-image is a gradient, not the class | Gotchas :437-439 | 58 |
| 93 | Never rotate a shared credential silently | Gotchas :440 | 95 |
| 94 | Announce credential changes in transcript and docs/audit/launch-2026-09/inbox/ first | Gotchas :443-445 | 95 |
| 95 | Never change a credential another agent is mid-run on | Gotchas :445-446 | 95 |
| 96 | Never await/resolve with a Capacitor plugin object; destructure at import | Gotchas :447-458 | 78 |
| 97 | Never drop the Supabase error: unwrap() in queryFn, explicit check elsewhere | Gotchas :460-461 | 62 |
| 98 | Account deletion anonymises; never assume ownerless-job fields populated | Gotchas :462-468 | 73 |
| 99 | Never coalesce null to "" in a two-way comparison | Gotchas :469-471 | 74 |
| 100 | Never let a null throw inside a .filter() predicate | Gotchas :471-472 | 74 |
| 101 | Browse visibility (ownerless exclusion) belongs in the open_jobs_browse view, not the client | Gotchas :472-475 | 75 |
| 102 | A null error is not a write: .select('id') + unwrapMutation() on money/trust/safety writes | Gotchas :477-481 | 63 |
| 103 | Skip the zero-row guard only when zero rows is legitimate, with a comment | Gotchas :481-482 | 63 |
| 104 | Realtime channels need a user-scoped server filter | Gotchas :483-484 | 64 |
| 105 | Realtime channels need a unique channelNonce() name | Gotchas :484-486 | 64 |
| 106 | Use node scripts/parsecheck.mjs as the fast syntax gate after edits | Gotchas :487-490 | 34 |
| 107 | A clean parse never substitutes for npx tsc -b --noEmit | Gotchas :490-493 | 34 |
| 108 | Parallel lanes: serialize typecheck/vitest/eslint across sessions | Gotchas :494-495 | 93 |
| 109 | Worktrees under $HOME, never /tmp | Gotchas :495-496 | 94 |
| 110 | Commit uncommitted work early | Gotchas :496-497 | 94 |
| 111 | No fixed agent count; fan out as wide as work is disjoint by file | Gotchas :498-501 | 93 |
| 112 | The lead owns and runs the gate once alone; give agents parsecheck.mjs and say so in the brief | Gotchas :501-502 | 93 |
| 113 | Pass name: on spawns so they are addressable teammates | Gotchas :503-506 | 91 |
| 114 | Model is silent without model:; check ~/.claude/teams/session-*/config.json | Gotchas :507-510 | 91 |
| 115 | Plan-mode teammates are released by the lead approving the plan | Gotchas :510-512 | 91 |
| 116 | Fleet cross-talk is SendMessage to the orchestrator; lanes never message each other | Gotchas :512-513 | 92 |
| 117 | audit-bus msg/inbox is retired; findings go in the bus ledger, conversation over SendMessage | Gotchas :513-516 | 92 |
| 118 | You pick the model for every agent; never ask | Gotchas :517-521 | 89 |
| 119 | Pass model: explicitly on every spawn | Gotchas :521-522 | 89 |
| 120 | Model rule of thumb: opus for money/authz/guards, fable for visual/design sweeps, sonnet for mechanical, never haiku for believed answers | Gotchas :522-527 | 89 |
| 121 | Re-verification of untrusted prior work goes to a different model | Gotchas :527-528 | 90 |
| 122 | Commit directly to main, no branch/PR | Gotchas :529 | 83 |
| 123 | Locally run typecheck (+ vitest for tested code); CI covers lint/build/full suite | Gotchas :530-532 | 83 |
| 124 | Don't re-run the full local gate without specific reason to distrust CI | Gotchas :532-533 | 83 |
| 125 | If commits reach prod red, check gh workflow list --all for disabled_manually | Gotchas :534-535 | 84 |
| 126 | Review the diff before committing money/auth/data-model changes | Gotchas :536-537 | 85 |
| 127 | Use lh-silent-failure, lh-authz-rls, lh-money-escrow (or /code-review, /security-review); code-reviewer etc. do not exist | Gotchas :537-548 | 85 |
| 128 | Tell review agents REVIEW ONLY and to ignore their fleet preamble | Gotchas :545-547 | 85 |
| 129 | /code-review ultra is user-triggered and billed: recommend, never attempt | Gotchas :548-549 | 86 |
| 130 | End every commit message with the Co-Authored-By trailer | Gotchas :550-551 | 87 |
| 131 | The audit standard is .claude/skills/lh-audit/SKILL.md | Audit standard :555-559 | 98 |
| 132 | Load lh-audit automatically for any audit/improvement/per-screen check (incl /audit, /improve) | Audit standard :561-564 | 99 |
| 133 | User invokes it via /lh-audit or 'run the LH audit'; notice and invoke | Audit standard :565-567 | 100 |
| 134 | Once invoked, every rule in lh-audit is mandatory | Audit standard :568-570 | 101 |
| 135 | Keep the gotcha list tight; project trivia belongs in code comments | Gotchas intro :246-247 | 5 |

## Amended (not dropped)

- #130 commit trailer: the old text said `Claude Opus 5 (1M context)`; the session's current
  attribution is `Claude Opus 5`, so the rule keeps its meaning with the current string.
- #20 rail inset: the old `src/index.css:987/1188/1193` citations had drifted; the lessons file
  re-points them to :1326/:1570/:1562 (verified against the stylesheet).

## Added (not in the old file)

- "Never hand-roll a page skeleton" (UI), promoted from the owner's standing memory rule at the
  lead's request.

## Dropped

None. Every rule maps to a line above.
