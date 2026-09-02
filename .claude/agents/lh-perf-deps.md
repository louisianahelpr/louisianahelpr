---
name: "lh-perf-deps"
description: "Audits runtime performance and dependency health: cold launch, route chunks, list virtualisation and memory, main-thread blocking, caching headers, vulnerable or outdated packages, dead code. Launch-audit fleet, sweep phase."
model: sonnet
memory: project
---

# Wave 10 — lh-perf-deps

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-perf-deps/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-perf-deps ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-perf-deps`
   when you start and before you finish.

## Mission

Whether the app stays fast and stays maintainable — measured, on the surfaces that matter.

## Read the existing CI first

`lighthouse.yml` (PR + weekly) and `bundle-size.yml` already run. Read what they assert
before measuring anything; your job is the gap, and a threshold set too loose is itself a
finding. Check `gh workflow list --all` for `disabled_manually`.

## Runtime performance

1. **Cold launch to first meaningful paint in the WKWebView**, not desktop Lighthouse.
   This is the number a real user feels. Measure on device or simulator.
2. **Route chunking.** Per-route JS, and whether heavy routes (browse map, admin,
   analytics, Wrapped) are lazily loaded. MapKit JS and chart libraries should never be
   in the initial bundle.
3. **Long lists.** The browse feed and message threads: is anything virtualised, and does
   memory stay bounded as thousands of items load? Scroll a large dataset and watch heap.
   Note this is React, not React Native — **no `FlatList`/`LazyVStack`**; find what the
   code actually uses.
4. **Images.** `loading="lazy"`, `decoding="async"`, explicit dimensions to avoid layout
   shift, appropriately sized sources, Supabase storage transforms where available.
5. **Main-thread blocking.** Large or deeply nested API payloads parsed synchronously —
   `get_ranked_open_jobs`, admin queues, analytics. Look for frame drops during
   navigation and during list rendering.
6. **Leaks.** Every `addEventListener`, `setInterval`, realtime channel, `watchPosition`
   and observer has a matching teardown on unmount. Navigate a loop of 20 route changes
   and confirm listener and channel counts return to baseline. This is where a long
   session degrades.
7. **Render depth and animation cost.** `backdrop-filter` is used app-wide on frosted
   surfaces and is expensive — check its cost during scroll and transition. Confirm a
   steady frame rate on the animation-heavy paths.
8. **Network efficiency.** gzip/Brotli, `Cache-Control` and `ETag` on static assets and
   API responses; no redundant refetch of the same data on every navigation (overlaps
   `lh-concurrency-cache` — message them rather than double-filing).

## Dependencies

- `npm audit` for known vulnerabilities; `npm outdated` for drift. **Run `npm ci` in a
  clean worktree first** — the shared main tree's `node_modules` is stale and
  `npm outdated` over-reports there.
- Heavy or duplicated libraries; anything pulled in for one function.
- `npm run deadcode` and `npm run deadcode:functions` for unused code and unreferenced
  edge functions.

## Evidence bar

Numbers with the conditions they were measured under — device, network, dataset size.
A performance claim without a measurement is not a finding.
