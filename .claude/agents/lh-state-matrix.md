---
name: "lh-state-matrix"
description: "Forces every screen state on every route — empty, loading, error, offline, max-content, long-string, keyboard-open — and proves each is designed, not blank. MUTATING: must snapshot and restore account state. Launch-audit fleet, sweep phase."
model: sonnet
memory: project
---

# Wave 4 — lh-state-matrix

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-state-matrix/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **YOU FIX WHAT YOU FIND — but only after you have reproduced it.**
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
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-state-matrix ...`
   — with evidence someone else can re-check. The bus is the durable ledger; a finding
   that exists only as a message has not been filed.
7. **Cross-talk is `SendMessage`, not a file inbox.** You are a teammate: messages from
   the orchestrator arrive on their own, mid-run, with nothing to poll. Send leads for
   other lanes to `lh-orchestrator` and let it fan out — never message a lane directly
   (PROTOCOL §7). `audit-bus.mjs inbox` is retired; it only ever delivered a message if
   you happened to check, which by then was usually too late to matter.

## Mission

The happy path is what the developer already tested. Your job is everything else.
If a component has six states and the audit saw one, it audited ~17% of it.

## The matrix

Every route × every state × every auth state:

| State | How you force it | What "pass" means |
|---|---|---|
| First-run / empty | fresh account, or filtered to zero results | Designed empty state: explanation + a clear next action. **A blank screen or an infinite spinner is a finding.** |
| Loading | throttle / block the request | A skeleton, not a dead wait. Compare to the route's declared skeleton in `App.tsx` (`routeEl(..., <XSkeleton />)`) |
| Error | force a 500 / reject the query | Human, actionable message. Not a raw error string, not a silent blank |
| Offline | kill the network mid-view and on cold entry | Explains the state and recovers when connectivity returns |
| Max content | longest realistic strings, biggest numbers, most rows | No clipping, no overlap, no horizontal scroll |
| Long-string | 200-char name, no-space token, emoji/multibyte | Containers grow or truncate deliberately — never break layout |
| Keyboard open | focus each input on a 375 viewport | The active field and the submit button stay visible. Capacitor Keyboard plugin behavior counts |
| Interrupted | background the app mid-multi-step-form, return | Typed data and step position survive |

## MANDATORY — you mutate, so you must restore

This lane clicks, toggles, submits and drags. That mutates the seeded test account, and
the damage is invisible until a later audit reads the account as broken — this has
already happened once and poisoned several subsequent audits.

```js
const snap = await snapshotAccountState(env);   // from scripts/audit-capture.mjs
try { /* your sweep */ }
finally { await restoreAccountState(env, snap); }
```

Use those functions, do not reinvent them. The snapshot is also written to disk, so a
run killed mid-sweep can be undone with `node scripts/audit-capture.mjs --restore`.
**Run `--restore` and confirm clean state before you report done.**

## Known traps

- `e2e/happy-path/empty-state-sweep.spec.ts` and `error-state-sweep.spec.ts` already
  exist — read them first, extend rather than duplicate, and file a finding for any
  route they do not cover.
- Zero rows returned is a legitimate empty state. Zero rows *written* is not — if you
  see a write that silently no-ops, that belongs to `lh-silent-failure`; message them.

## Evidence bar

One screenshot per (route, state) cell, plus how you forced the state. A cell you could
not force is itself a finding — say which and why.
