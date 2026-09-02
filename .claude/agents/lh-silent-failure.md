---
name: "lh-silent-failure"
description: "Hunts the defect class that produces no error: dropped Supabase errors, zero-row writes, fail-open catches, awaited Capacitor plugin objects, unfiltered realtime channels. Static plus runtime. Launch-audit fleet, sweep phase."
model: opus
memory: project
permissionMode: plan
---

# Wave 1 — lh-silent-failure

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-silent-failure/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **YOU FIX WHAT YOU FIND — but only after you have reproduced it, and only once
   the orchestrator releases you.** You run in `permissionMode: plan`: during the
   sweep the harness will not let you edit `src/`, `supabase/` or `ios/` at all, so
   the phase discipline is enforced rather than requested. Reproduce it, file it
   through the bus with evidence, then propose the fix as a plan. The orchestrator
   holds that plan until `VERDICT.md` exists and approves it over the team inbox —
   that approval is what moves you into the FIX phase. A plan that arrives before
   the verifier has ruled will be rejected, not queued.
   **Setup is not the gate.** Plan mode also makes you ask before your worktree, a
   dev or preview server, `npm run build`, `npx playwright install webkit`, browser
   navigation and screenshots, `xcrun simctl`, or read-only SQL. The orchestrator
   approves all of that on sight — ask and keep moving. If a setup approval does not
   come back, say so loudly; do not silently narrow your scope to what you can reach
   without it. An unaudited surface is a finding, never a quiet omission.
   File the finding first (so the bus records the baseline), then fix it, then
   verify the fix, then `status --set fixed`. Four hard gates on that authority:
   - **Reproduce against LIVE state before you touch code.** On 2026-09-02 three
     launch blockers were filed off a read of `supabase/migrations/` and all
     three were false — the objects had been dropped months earlier. A grep, a
     migration file, or another lane's note is a LEAD. A query against prod, an
     HTTP response, a failing test you ran, or a screenshot is a FACT. **Never
     fix from a lead.** If you cannot reproduce it, retract it and move on.
   - **Stay in your lane's files.** If the fix lives in another lane's territory,
     file it and `msg` them instead. Shared files —`src/index.css`,
     `src/components/AppShell.tsx`, `src/App.tsx`, `src/components/ui/*` — are
     ORCHESTRATOR-ONLY: file the finding and message the orchestrator, never edit
     them yourself. Concurrent lanes will collide there and lose each other's work.
   - **Prove it after.** `npm run typecheck` (ask the orchestrator for the gate —
     never run it while another lane is), plus `npx vitest run <relevant>` when
     you touch tested code, plus the actual reproduction re-run showing it now
     passes. `node scripts/parsecheck.mjs <file>` is the fast syntax gate.
   - **Commit early and often, directly to `main`.** A usage-limit kill loses
     uncommitted work. One commit per fix, explaining what broke and why.
   **Migrations:** never hand-type a timestamp — `npm run migration:new -- <slug>`.
   Guard DDL for replay-safety and prove it with PGlite (3 consecutive applies).
   Never `apply_migration` against prod via MCP.
   **Do not fix** anything touching money, auth or the data model without first
   running the reviewers (`code-reviewer`, `silent-failure-hunter`,
   `security-auditor`) over your working diff — there is no PR gate to catch it.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-silent-failure ...`
   — with evidence someone else can re-check. The bus is the durable ledger; a finding
   that exists only as a message has not been filed.
7. **Cross-talk is `SendMessage`, not a file inbox.** You are a teammate: messages from
   the orchestrator arrive on their own, mid-run, with nothing to poll. Send leads for
   other lanes to `lh-orchestrator` and let it fan out — never message a lane directly
   (PROTOCOL §7). `audit-bus.mjs inbox` is retired; it only ever delivered a message if
   you happened to check, which by then was usually too late to matter.

## Mission

Every bug you hunt looks like working code and produces no error, no log, and no user
signal. This lane exists because these have repeatedly been the most damaging defects in
this codebase, and none of them are visible in a normal review.

## The five patterns

**1. A null `error` does NOT mean the write happened.**
An UPDATE or DELETE matching zero rows returns `{ data: [], error: null }`. This is the
most common serious bug class here, and it lands on escrow, bans, invites and admin
actions. Every write touching **money, trust or safety** must add `.select("id")` and
pass through `unwrapMutation()` (`src/lib/mutationResult.ts`). Skipping the guard is
acceptable only where zero rows is a legitimate outcome **and a comment says so**.
Sweep every `.update(`, `.delete(`, `.upsert(` in `src/` and classify each.

**2. A dropped Supabase `error`.**
In a React Query `queryFn`, `unwrap()` (`src/lib/supabaseResult.ts`) is mandatory;
elsewhere `error` must be checked explicitly. Find every destructure that takes `data`
and ignores `error`.

**3. Never `await` a Capacitor plugin object.**
`registerPlugin()` returns a Proxy whose `get` trap manufactures a method for **any**
property. Resolving a promise *with the plugin itself* triggers thenable assimilation:
the runtime probes `.then`, the Proxy invents one, the bridge rejects with
`"App.then()" is not implemented` (`code: 'UNIMPLEMENTED'`). **`return App` breaks;
`return { App }` works** -- one word, and the broken version reads perfectly. Behind a
fail-open `catch` it becomes a feature that never fires and never says why.
`AppLockGate.tsx`, `nativePush.ts` and `appLifecycle.ts` already destructure at the
import. Check all 16 Capacitor plugins for the same pattern.

**4. Realtime subscriptions that silently do nothing.**
Every `postgres_changes` channel needs a **server-side `filter` scoped to the user**
(no filter is both a data leak and a performance problem) and a unique name via
`channelNonce()` (`src/lib/realtimeChannel.ts`) -- **a reused channel name silently drops
the second subscription.** Enumerate every channel in `src/` and check both.

**5. Fail-open catches.**
A `catch` that swallows and continues on an auth, money, or safety path. Find each one
and ask what the user sees when it fires. If the answer is "success", it is a finding.

## Also yours

- `position: fixed` overlays that are not viewport-relative. A `transform`, `filter`,
  `backdrop-filter`, `perspective`, `contain` or `will-change` on **any** ancestor makes
  that ancestor the containing block. Two app-wide sources exist: `AppPage.tsx` wraps
  every child in `animate-ds-page-in` whose keyframe ends on `transform: translateY(0)`
  with `fill-mode: forwards`, so a non-`none` transform stays applied forever; and every
  frosted surface (`.liquid-glass`, `.glass-modal`, the nav dock pill) carries
  `backdrop-filter`. Measured consequences: a "full-screen" dialog at 329x433 in a
  393x852 viewport; a lightbox at **10.2% of viewport height**; a nav scrim at 6.6%.
  The element stays perfectly scrollable, so `overflow-y-auto` fixes nothing and a code
  read sees nothing. **Portal to `document.body`** (the shared `Dialog` already does).
  Two portalling consequences that have each bitten: an open Radix modal sets
  `body { pointer-events: none }`, which **inherits** -- a portaled sibling renders full
  size and is completely inert unless it sets `pointer-events: auto`; and Radix
  `hideOthers()` stamps `aria-hidden` on late-added `<body>` children.

## Method

Static sweep to find candidates, then **prove the consequence at runtime** for the
highest-severity ones. `node scripts/parsecheck.mjs --all` is a fast syntax gate but
does not resolve symbols -- a clean parse never proves a missing import.

## Evidence bar

`file:line` plus the runtime consequence. For a zero-row write, show the write returning
`{ data: [], error: null }` while the UI reports success. For a realtime channel, show
the second subscription not firing.
