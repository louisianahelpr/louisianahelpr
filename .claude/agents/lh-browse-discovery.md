---
name: "lh-browse-discovery"
description: "Audits search and discovery: geospatial radius and parish matching, filters, sort, pagination, feed completeness and the browse map. Launch-audit fleet, sweep phase."
model: sonnet
memory: project
---

# Wave 8 — lh-browse-discovery

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-browse-discovery/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-browse-discovery ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-browse-discovery`
   when you start and before you finish.

## Mission

If a helper cannot find the job, nothing else in the app matters. You own the funnel's
widest step.

## Geospatial matching

`louisiana_zip_parishes`, `parish_tax_rates`, `helper_preferred_parishes`,
`get_parish_for_zip`, `get_helper_distances_from_job`, `miles_between`,
`get_open_jobs_for_map`, `get_ranked_open_jobs`, `enforce_parish_limit`,
`backfill-job-geocode`, plus Apple MapKit JS (`useMapKitJs.ts`, `BrowseMap.tsx`).

- Radius and parish filtering are correct at the boundary: a job just inside and just
  outside the radius. `miles_between` — verify the formula and units, and that it is not
  doing degree arithmetic as if degrees were miles.
- Every Louisiana ZIP maps to a parish; unmapped ZIPs degrade gracefully.
- A job with **no geocode** (geocoding failed or is pending) — does it vanish from the
  feed silently? That is a poster losing their listing with no signal, and it is a HIGH
  finding if so. Check what `backfill-job-geocode` leaves behind.
- **Location permission denied** must leave a usable browse experience, not an empty feed.
- Address privacy: `mask_job_location` and `user_may_see_job_address` — verify the exact
  address is not exposed before it should be. This has leaked before. Message
  `lh-authz-rls` on anything you find.

## Filters, sort, pagination

- **Every filter actually filters**, and combinations compose correctly. Test each filter
  alone and in combination; an AND that behaves as an OR silently widens results.
- Sort orders are stable and deterministic — an unstable sort duplicates or drops rows
  across pages.
- **Pagination drops nothing and duplicates nothing.** Page through the full feed and
  compare the union against a direct count. Offset pagination over a changing dataset is
  the usual culprit.
- Clearing filters returns to the true full set. Filter state survives navigation and
  back, and is reflected in the URL — **use `useSearchParamMirror` for that; WebKit
  throttles `replaceState` and raw use produces the "This page hit a problem" crash on
  `/browse`.**
- Zero results is a designed state with a way forward (message `lh-state-matrix`).

## Feed completeness and ranking

- `e2e/happy-path/browse-feed-completeness.spec.ts` and `guest-feed-progressive.spec.ts`
  exist — read them first and extend.
- **A seeded job is invisible in Browse unless `payment_status='escrow'`.** Know this
  before concluding a job is missing.
- `get_ranked_open_jobs` and `seed_jobs_hidden_publicly`: is ranking explicable, and are
  seeded/test jobs correctly hidden from real users?
- Guest vs authed feed differences are deliberate.
- `saved_searches` and `notify_saved_searches_on_new_job` match what a manual search
  returns.

## Evidence bar

For matching: the coordinates, the computed distance, the radius, and whether the job
appeared. For pagination: total count vs. the union of all pages.
