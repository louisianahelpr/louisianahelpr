# lh-browse-discovery — lane report

Scope: geospatial radius/parish matching, filters, sort, pagination, feed
completeness, and the browse map, across the four browse surfaces
(`open_jobs_browse` view, `get_ranked_open_jobs`, `get_open_jobs_for_map`,
`get_public_open_jobs`) and their client consumers (`/dashboard`, `/browse`,
`/jobs`, `BrowseMap.tsx`).

Worktree: `~/.lh-audit/lh-browse-discovery`, forked from `origin/main`
(b170609a). Verified against LIVE prod (`fncmgoasalhdgfwzhsqa`) via
`execute_sql`, not migration files, per protocol. Local dev server run
against the same prod DB for real Playwright reproductions.

## Coverage

- **Ownership gate** (today's `20260902152714` + `20260902161042` migrations).
  Artifact: `select proname, pg_get_functiondef(...) like '%customer_id IS NOT
  NULL%' ...` against prod (fncmgoasalhdgfwzhsqa) returned `true` for all
  three RPCs (`get_ranked_open_jobs`, `get_open_jobs_for_map`,
  `get_public_open_jobs`) plus the view. No ownerless open job exists in prod
  right now (`select count(*) from jobs where status='open' and
  customer_id is null` → 0 rows) to reproduce the visibility difference
  end-to-end, so this is a definition-match, not a before/after row diff. Not
  a new finding — another lane/commit already closed this; recorded here as
  coverage.
- **`miles_between` / `haversineMiles`**. Artifact: `select
  miles_between(29.9511,-90.0715,30.4515,-91.1871)` against prod → `75.0557`
  miles for New Orleans↔Baton Rouge, the correct straight-line distance;
  same haversine formula (3958.8mi radius) in `src/lib/geo.ts`.
- **Parish matching** (`get_parish_for_zip`, `louisiana_zip_parishes`,
  `enforce_parish_limit`). Artifact: `select count(*) from
  louisiana_zip_parishes` → 252 rows / 64 parishes against prod; `select *
  from profiles where zip_code='70528' and parish is null` → 1 row (a real
  prod profile, not a seed row). Degrades to `NULL`, not a crash, but with
  zero user-facing feedback in `ProfileEditForm.tsx:220-223`. Filed BD-003.
- **Four-surface parity**. Artifact: same `pg_get_functiondef` query as above
  shows `/jobs` (`get_ranked_open_jobs`) and `/browse`
  (`open_jobs_browse` view) apply identical status / payment_status /
  ownership / early-access / seed-visibility `WHERE` predicates, reproduced
  verbatim between the two definitions. One still-live, deliberate divergence:
  `get_public_open_jobs` has no `payment_status` gate (called out and left
  alone in `20260902161042`'s own header) — out of my lane to re-open, not
  re-filed.
- **Guest job preview**. Artifact: Playwright against
  `http://localhost:5184/jobs?job=<id>` and `/browse?job=<id>` (dev server on
  prod DB) → `[role="dialog"]` renders with title/price/"Sign up to apply" on
  both. `/jobs/:id` (path form) is broken for every guest entry point that
  generates it — filed as BD-001, the headline finding (repro detail there).
- **Pagination**. Artifact: `select id from get_ranked_open_jobs(4,0)` on
  prod → `[891a13fc…, 34ccf004…, 5eed0829…002, 5eed0829…014]`; then `update
  jobs set boost_expires_at=now()+interval '1 hour' where id='5eed0829…016'`;
  then `select id from get_ranked_open_jobs(4,4)` → first row
  `5eed0829…014`, a duplicate of page 1's last row. Reverted
  (`boost_expires_at=null`) and confirmed reverted. Filed BD-004, fixed with
  a client-side `dedupeById` in `useOpenJobsFeed.ts` and `useDashboardData.ts`.
- **Filters**. Artifact: `src/hooks/useDashboardFilters.ts` — every predicate
  is a short-circuit `if (...) return false` (AND-composition, not OR); the
  "Nearby" string-fallback guards `jobLoc.length > 0` before the substring
  match (the CLAUDE.md `''.includes('')` trap does NOT apply here — checked
  the exact line). Looks already fixed by a prior pass; verified clean by
  code read, not re-filed.
- **Sort**: `smart` preserves server rank order (no client re-sort — nothing
  to destabilize); the other four options use `Array.prototype.sort`
  (stable in all supported engines) with pure numeric/date comparators.
  Clean.
- **Map radius filter**: the map RPC coarsens coordinates to 2 decimals for
  address privacy, but the client radius filter compares against those SAME
  rounded coords, introducing up to ~0.4mi of live-measured error near a
  filter boundary. Filed BD-002 (LOW — a side effect of a deliberate privacy
  tradeoff, fixable by moving the radius comparison server-side against
  precise coords while still returning only rounded ones).
- **Address masking** (`mask_job_location`): correct for the app's normal
  "street, city, state zip" format. Found one live row with a malformed
  doubled-zip location string where the regex leaves a partial zip in the
  "masked" output — not currently exploitable (the row is `status=completed`,
  `is_seed=true`, so it's outside every public feed's `status='open'` filter)
  but it's a real robustness gap in a privacy-sensitive function. Filed
  BD-005 (LOW).
- **Location permission denied**: `useUserLocation.ts` has explicit
  denied/error states; `useDashboardFilters.ts`'s "Nearby" filter falls back
  to a no-op (keeps every job) rather than emptying the feed when
  `userLoc.status !== "ready"`. Verified clean by code read (denial path is
  simple and well-isolated; didn't additionally drive it through the sim
  given time budget — see Unverified).
- **URL/filter-state persistence**: `/jobs` (Jobs.tsx) uses
  `useSearchParamMirror` correctly (the WebKit-throttle-safe mirror).
  `/dashboard` and `/browse` do NOT sync filter state to the URL at all — it
  lives in plain `useState`, only hydrated once from the URL on mount. This
  is not the WebKit-crash pattern (no rapid-fire `replaceState` — the only
  `setSearchParams` calls on those two pages are one-shot, on dialog-close /
  boost-toast-dismiss, not per-keystroke), so I did not file it as a defect;
  flagging it here as a judgment call. It does mean deep-linking a *filtered*
  `/dashboard` or `/browse` URL beyond the very first load doesn't work,
  unlike `/jobs` — noted but not filed, borderline product-sense item.

## Findings filed (bus: `docs/audit/launch-2026-09/findings.jsonl`)

| id | sev | blocker | what |
|---|---|---|---|
| BD-001 | HIGH | yes | `/jobs/:id` (ShareJobButton, PaymentSuccess share, `/j/:id` short link) is signed-in-only as of today's commit `c94209a0`, and its own stated mitigation is factually wrong (claims a guest bounces through `/signup`; actually bounces to `/login`, whose "Create an Account" link drops the redirect). Every shared/deep-linked job now dead-ends a guest at a bare login form with zero preview. Fix identified and verified locally (strip the `<ProtectedRoute>` wrap in `App.tsx:285` — JobDetail.tsx already has the correct dead code behind it), but `App.tsx` is orchestrator-only — relayed to team-lead, not fixed by me. |
| BD-002 | LOW | no | Map radius filter compares against privacy-rounded (2-decimal) coordinates, introducing up to ~0.4mi live-measured error at a filter boundary. |
| BD-003 | MEDIUM | no | `louisiana_zip_parishes` covers only 252 of ~600+ real LA ZIPs; a real prod profile (zip 70528) silently loses the parish-match ranking boost with no UI feedback. |
| BD-004 | MEDIUM | no | Offset pagination over a live-mutating rank duplicates cards across pages (live-reproduced via a boost, then reverted). **Fixed** — `dedupeById` helper added to `src/lib/utils.ts`, wired into `useOpenJobsFeed.ts` and `useDashboardData.ts`. Awaiting the typecheck gate from team-lead before committing. |
| BD-005 | LOW | no | `mask_job_location`'s zip-stripping regex only removes ONE well-formed trailing zip; a malformed/doubled-zip location leaks a partial zip through the "masked" address. Not currently exploitable (only affected row is non-public), but the function itself isn't robust. |

## What I fixed

- **BD-004**: `src/lib/utils.ts` (new `dedupeById` export), `src/hooks/useDashboardData.ts`,
  `src/pages/jobs/useOpenJobsFeed.ts`. `node scripts/parsecheck.mjs` clean on
  all three. **Not yet committed** — requested the typecheck gate from
  team-lead to avoid colliding with another lane's run; will commit once
  granted (or on the next lane resumption if the sweep ends first).
- Everything else in my findings needs either an App.tsx edit (orchestrator
  territory, BD-001) or a migration (BD-002, BD-003, BD-005 all touch
  `SECURITY DEFINER` SQL functions / a data table — queued for owner review
  per the standing constraint on payments/auth/data-model changes, not fixed
  directly).

## UNVERIFIED / not driven this pass

- iOS Simulator / WKWebView pass for the browse map and filter sheet — did
  not launch the simulator this pass (time budget went to the live-DB
  reproductions above, which surfaced the highest-value findings). Chrome +
  live Playwright only.
- `saved_searches` / `notify_saved_searches_on_new_job` matching a manual
  search exactly — read the schema, did not drive an end-to-end save →
  notify → compare cycle.
- Location-permission-denied UI states not visually driven in-browser
  (verified by code read only, per above).
- Pagination beyond 2 pages / "several hundred results" edge — prod currently
  has only 14 open jobs, so the large-N pagination case could not be driven
  live without seeding a large synthetic dataset; the drift bug (BD-004) was
  proven with the smaller live set instead, which was sufficient to reproduce
  the underlying mechanism.

## Method note for future runs

Prod dev server (`npx vite`, `.env` copied into the worktree) points at the
SAME Supabase project (`fncmgoasalhdgfwzhsqa`) the MCP `execute_sql` calls
hit — so a live SQL mutation (e.g. temporarily boosting a job, or stripping
a route guard in a local, uncommitted `App.tsx` edit) can be reproduced in an
actual rendered browser via a throwaway Playwright script in the worktree
root, then reverted before anything is committed. This is how BD-001 and
BD-004 got real execution evidence instead of a code-only claim.
