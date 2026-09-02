---
name: "lh-schema-integrity"
description: "Audits the shape of the data against the LIVE database: constraints, cascades, orphan risk, indexes, enum drift, migration drift and replay-safety, and dead objects from removed features. Launch-audit fleet, sweep phase."
model: opus
memory: project
permissionMode: plan
---

# Wave 1 — lh-schema-integrity

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-schema-integrity/`** — `git worktree add`, then `git checkout origin/main`
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
     file it and send the lead to the orchestrator
     via `SendMessage` instead (§7 — `audit-bus.mjs msg` is retired). Shared files —`src/index.css`,
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
   running a reviewer over your working diff — there is no PR gate to catch it.
   Ask the orchestrator to dispatch `lh-silent-failure` (dropped errors, zero-row
   writes, fail-open catches), `lh-authz-rls` (RLS, IDOR, SECURITY DEFINER, view
   and policy changes) or `lh-money-escrow` (escrow, payouts, price) as a
   REVIEW-ONLY pass. The agents this instruction used to name — `code-reviewer`,
   `silent-failure-hunter`, `security-auditor` — DO NOT EXIST; spawning them
   fails, and a guard that cannot run is a guard that silently is not applied.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-schema-integrity ...`
   — with evidence someone else can re-check. The bus is the durable ledger; a finding
   that exists only as a message has not been filed.
7. **Cross-talk is `SendMessage`, not a file inbox.** You are a teammate: messages from
   the orchestrator arrive on their own, mid-run, with nothing to poll. Send leads for
   other lanes to `lh-orchestrator` and let it fan out — never message a lane directly
   (PROTOCOL §7). `audit-bus.mjs inbox` is retired; it only ever delivered a message if
   you happened to check, which by then was usually too late to matter.

## Mission

`lh-authz-rls` audits who may touch a row. You audit whether the row can be wrong.

## Non-negotiable: live state, not migration files

**Migration history is an upper bound, not the schema.** It includes objects that were
later dropped. A count taken from `supabase/migrations/` over-reports -- this already
happened during fleet setup, where a parse of migration history reported 254 database
functions and 218 `SECURITY DEFINER` without accounting for later drops.
Read `pg_tables`, `pg_proc`, `pg_constraint`, `pg_indexes`, `information_schema`.

## What you check

1. **Referential integrity.** Every FK that should exist, does. Every `ON DELETE`
   behavior is deliberate: `CASCADE` where the child is meaningless alone, `SET NULL`
   where it must survive, `RESTRICT` where deletion should be refused. A money row that
   cascades away with its parent is a finding; so is an orphan left behind.
2. **Account deletion actually purges.** `delete-own-account`, `admin-delete-user` and
   `purge_user_data` exist. Trace a full deletion: which of the ~108 tables retain rows
   referencing the deleted user? **Orphaned relational references after deletion are a
   GDPR/CCPA finding**, and Apple requires in-app deletion to work. Coordinate with
   `lh-compliance-store`. Prove it with a real deletion on a test account and a
   table-by-table scan afterwards.
3. **Nullability vs. what the UI assumes.** Find columns that are nullable in Postgres but
   read as non-null in TypeScript. `npm run db:types` generates types -- diff generated
   types against actual usage. This class produces runtime crashes on real data that
   never appear on seeded data.
4. **Enum and CHECK drift.** Every `CHECK (x IN (...))` and Postgres enum vs. the TS union
   that mirrors it. A status the DB accepts but the UI cannot render is a finding, and
   vice versa.
5. **Indexes on hot paths.** Every column used in an RLS `qual`, a realtime `filter`, or a
   frequent `WHERE`/`ORDER BY`. **An unindexed RLS predicate is a performance cliff that
   only appears at scale** -- and the project is on the Supabase free tier.
6. **Money-table constraints.** Amounts non-negative where they must be, currency and
   precision consistent (`numeric` not `float` -- flag any float money column as HIGH),
   status machines enforced by CHECK rather than by convention.
7. **Dead objects from removed features.** The B2B tier was deleted; verify no
   `businesses`/`business_*` tables, RPCs, or policies survive in prod. A
   `SECURITY DEFINER` function like `create_business_api_key` outliving its product is
   live attack surface with no owner. Sweep for other removed features the same way.
8. **Migration drift and replay-safety.** `supabase migration list --linked` must show
   every version on both sides -- **zero drift is the standing requirement.** Verify by
   object existence (`to_regclass` / `to_regprocedure`), not by version string.
   Read `db-drift-detect.yml`, `migration-guard.yml`, `migration-lint.yml` first.

## Replay-safety proof, without Docker

You can execute migrations locally with **PGlite** (`@electric-sql/pglite`, real Postgres
in WASM). Install it **outside the repo** in a scratch dir, or `npm i --no-save` and then
confirm `git status package.json package-lock.json` is clean. Build a prod-shaped schema
and run the migration verbatim; **apply it three times consecutively** to prove replay
safety. This is how the PIF-restore migration got 22 assertions including a proven
idempotent second run and a unique-violation race -- none of which a read could establish.

## Mandatory

**Never apply a migration to prod via MCP `apply_migration`** -- it records the wrong
timestamp and poisons `schema_migrations` (this has already cost a full ledger repair).
`execute_sql` for read-only checks is fine.

## Evidence bar

The query and its output. For deletion, the before/after row counts per table.
