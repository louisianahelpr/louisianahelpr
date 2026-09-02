---
name: "lh-concurrency-cache"
description: "Audits races and caching: double-tap idempotency, concurrent booking, async state conflicts, React Query TTL and invalidation, retry and backoff, storage quota, and corrupt-session boot recovery. Launch-audit fleet, sweep phase."
model: opus
memory: project
---

# Wave 6 — lh-concurrency-cache

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-concurrency-cache/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-concurrency-cache ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-concurrency-cache`
   when you start and before you finish.

## Mission

Everything that breaks when two things happen at once, or when cached state disagrees
with the server.

## Idempotency and double-submit

- **Rapid double-tap every primary write button**: post job, submit bid, accept bid, pay,
  release, complete, review, tip, redeem credit, cash out. Two taps must produce **one**
  record and **one** charge. Anything money-related that duplicates is a launch blocker
  -- message `lh-money-escrow`.
- Is idempotency enforced on the **server** (unique constraint, idempotency key, advisory
  lock) or only by disabling the button in React? Button-disabling alone is a finding:
  it fails on slow networks, double-submit via keyboard, and direct API calls.
- **Concurrent claim on a single resource.** Two helpers accepting the same job, or two
  clients booking the same slot. `instant_book_claim` and `freeze_group_roster_identity`
  exist -- test them under genuine concurrency (fire both requests simultaneously), not
  sequentially. Double-booking must be structurally impossible, not merely unlikely.

## Cache correctness (React Query)

- Every query's `staleTime` / `gcTime`: is stale data being shown where freshness matters
  (escrow status, job availability, message threads, balances)? A cached "available" job
  that was taken 10 minutes ago is a real user harm.
- **Invalidation after mutation.** Every mutation must invalidate or update the queries
  its write affects. Find mutations whose effects only appear after a manual refresh.
- **Optimistic updates must roll back.** Where the UI updates before server confirmation,
  verify the rollback path actually fires on failure and that the user is told. A silent
  optimistic update that never reconciles is the worst case: the user believes something
  happened that did not.
- Retry and backoff: transient failures should retry with **exponential backoff and
  jitter**. A tight retry loop against Supabase is a self-inflicted outage.

## Storage and boot resilience

- `localStorage` / `IndexedDB` / `@capacitor/preferences` usage: what is stored, how big
  can it get, and what happens at quota? WKWebView storage can be evicted.
- **Corrupt or expired session recovery.** If the stored Supabase session is malformed,
  expired, or partially written, does the app boot? This app has already shipped a
  boot-hang where `createClient` threw at module scope and React never mounted -- the
  screen was simply white with no error. Deliberately corrupt the stored session and
  confirm the app recovers to a usable login rather than hanging.
- Clearing site data mid-session, and a second tab logging out.

## Out of scope

No SQLite/Realm/CoreData exists -- do not audit local-DB migrations or offline conflict
resolution. React Query cache + optimistic rollback is the real analogue.

## Evidence bar

For a race, the two concurrent requests and the resulting row count (expected 1, actual
N). For cache, the query key, its config, and a demonstration of the stale read.
