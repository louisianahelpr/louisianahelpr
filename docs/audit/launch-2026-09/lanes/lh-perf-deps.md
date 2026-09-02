# lh-perf-deps — launch audit lane report

Worktree: `~/.lh-audit/lh-perf-deps` (forked `origin/main` @ b170609a, `git worktree add --detach`).
`npm ci` run clean in that worktree (not the shared main tree's stale `node_modules`).
`npm run build` run to inspect `dist/` for every claim below — no perf/bundle claim in this
report is from the dev server or from reading source alone.

Permission mode is `plan` for this sweep: no `src/`/`supabase/`/`ios/` edits were made.
Every finding below is filed and reproduced, **not yet fixed** — fixes are proposed inline,
pending orchestrator release into the FIX phase per PROTOCOL §1.

## Scope covered

- `.github/workflows/lighthouse.yml` + `.lighthouserc.json` (read first, per §6b)
- `.github/workflows/bundle-size.yml` (read first, per §6b)
- `vite.config.ts` build/manualChunks config
- `dist/` after a real `npm run build` (chunk sizes, `index.html` script/preload tags,
  static-import closure of the entry chunk)
- `src/App.tsx` lazy-route table (41 `lazy()` calls) vs. `src/pages/profile/ProfileTabPanels.tsx`
  (21 `lazy()` calls) — the today's-diff area called out by the orchestrator
- `BrowseMap` (Dashboard, `BrowseTasksFeed`, `DashboardGuest`) lazy-load wiring
- recharts usage (admin/profile/analytics charts) — confirmed all behind already-lazy routes
  (grep for `from "recharts"`: only `src/components/admin/KpiSparkline.tsx`,
  `src/components/admin/AdminAnalyticsCharts.tsx`, `src/components/profile/EarningsBreakdownCharts.tsx`,
  `src/components/analytics/AnalyticsCharts.tsx` — none imported by `App.tsx`)
- List virtualization: `VirtualList` (Jobs.tsx browse route, `ConversationList`),
  `VirtualizedJobList` (`BrowseTasksFeed`/Dashboard feed), `ActivitySectionedView`
  (Activity → Posted/Applied jobs)
- `useActivityData.ts` queries backing the Activity tabs
- `vercel.json` caching headers + live `curl` against `www.louisianahelpr.com` (Cache-Control,
  Brotli content-encoding)
- `npm audit`, `npm outdated`, `npm ls` dependency-path tracing (clean worktree)
- `npm run deadcode` (knip) and `npm run deadcode:functions`
- `JobTracking.tsx` geolocation polling + realtime channel cleanup (spot check, not exhaustive)
- `gh workflow list --all` + `gh run list` for both perf workflows, confirming neither is
  `disabled_manually` and both have real (non-crash-and-pass) recent runs

## Findings filed (bus IDs)

| ID | Severity | Surface | Claim |
|---|---|---|---|
| PD-001 | MEDIUM | CI: `bundle-size.yml` / `vite.config.ts` | Budget check measures only the 38KB entry chunk, not the true ~913KB raw / 292KB gzip critical-path JS, because `modulePreload.resolveDependencies: () => []` suppresses ALL modulepreload hints (not just dynamic-import branches, as its own comment claims), so `dist/index.html` has zero `<link rel=modulepreload>` for the grep to find. |
| PD-002 | MEDIUM | `/profile?tab=posted_jobs`, `?tab=applied_jobs` | `useActivityData.ts` fetches jobs/applications with no `.limit()`, and `ActivitySectionedView` renders them with a plain `.map()` — no virtualization, unlike the Dashboard feed and `/browse` (both virtualized). Currently low-impact (prod max 16 rows/user, verified via `execute_sql`), but unbounded. |
| PD-003 | LOW | `npm audit` | 6 vulnerabilities, all in build-time-only tooling (Capacitor CLI/xcode, tailwind/postcss, vite-plugin-pwa/workbox-build) — none reach the client bundle. 3 fixable non-breaking; the 4th (`uuid`) needs `--force` and bumps `@capacitor/cli` — reported only, per standing "don't bump deps this run" instruction. |
| PD-004 | LOW | `npm run deadcode` (knip) | 0 unused files/deps (clean), but 90 unused exports, 11 unused exported types, 31 duplicate default+named exports — quantified backlog, not a blocker. `deadcode:functions` clean (67 checked, 1 known-unreferenced, 0 new). |

## Verified clean (with evidence)

- **Lighthouse CI is real and enforced.** `.lighthouserc.json` thresholds (perf error@0.50,
  seo error@0.90) are measured against an actual 2026-08-31 prod run (0.63–0.79 perf), not
  guessed. `gh run list` shows genuine ~2–3 minute collection runs succeeding on real PRs
  (not the old 13–23s crash-and-pass pattern). Not `disabled_manually`.
- **Bundle-size workflow runs on every push to `main`** (`gh run list` shows recent
  successes on direct-to-main commits) — the `push:` trigger actually fires, per its own
  header's stated reason for existing. (Its *coverage*, not its execution, is PD-001.)
- **The 7 pages moved from routes to Profile tabs today stayed genuinely lazy.** `App.tsx`
  no longer imports `PetProfiles`/`WorkRecord`/`HomeHistory`/`HelprWrapped`/`StrSettings`/
  `HelperAnalytics`/`AutoTip` (confirmed by grep + a comment at `App.tsx:107-108` documenting
  the move); `ProfileTabPanels.tsx:39-45` lazy-imports all 7 and renders only the active tab
  (`tab === "x" && <Suspense>...`), never all seven mounted/hidden. `ls dist/assets | grep -iE
  "PetProfiles|WorkRecord|HomeHistory|StrSettings|AutoTip|HelprWrapped|HelperAnalytics"`
  returns exactly 7 `.js` + 7 `.js.map` pairs post-`npm run build` — no duplicates, no orphans.
- **`BrowseMap` (and the MapKit JS it pulls in) stays lazy** in all three call sites
  (`Dashboard.tsx:42`, `BrowseTasksFeed.tsx:38`, `DashboardGuest.tsx:18`) — confirmed absent
  from the entry chunk's static-import closure: a script walking `from"./X.js"` static
  imports recursively from `dist/assets/index-UyTT5DtS.js` enumerated 75 files/913KB, and
  `BrowseMap-*.js` is not among them.
  recharts (`BarChart`/`PieChart`/`CartesianChart`/`YAxis`) likewise only reachable from
  admin/profile/analytics chunks, never the entry.
- **Dashboard's unbounded feed and `/browse` ARE virtualized.** `VirtualizedJobList`
  (`@tanstack/react-virtual`, element-scroll variant) backs the Dashboard "everything else"
  feed; `VirtualList` (window-scroll variant) backs `Jobs.tsx` and message
  `ConversationList.tsx`. This is the correct pattern — the gap is Activity (PD-002), not
  these.
- **Caching headers are correct and live.** `vercel.json`: `/assets/(.*)` → `max-age=31536000,
  immutable`; root → `max-age=0, must-revalidate`. Verified against the LIVE site, not just
  config: `curl -sI https://www.louisianahelpr.com/` → `must-revalidate`;
  `curl -sI .../assets/index-BVHie6uZ.js` → `immutable`; `Accept-Encoding: br, gzip` →
  `content-encoding: br`.
- **`JobTracking.tsx` geolocation polling and its realtime channel both tear down.** Spot
  check only (not the full 77-site listener sweep, see gap below): the position poll uses
  `setInterval` + `clearInterval` in the effect's cleanup (`:675-677`), and the realtime
  channel closes via `sub.close()` (`:612`) — not a leak by inspection. Full mount/unmount-loop
  verification (listener-count-returns-to-baseline) was not run.

## UNVERIFIED — could not reach this pass, and why

- **Cold launch to first meaningful paint in the actual WKWebView.** Did not build/run the
  iOS Simulator this pass — budget was spent on the bundle/CI gap (PD-001) and the
  code-level virtualization/dependency sweep. Lighthouse's mobile-emulated numbers
  (0.63–0.79 perf, throttled Chrome) are the best available proxy but are NOT the same
  surface; they measure Chrome device emulation, not Capacitor/WKWebView cold start.
- **Full 77-site `addEventListener`/`setInterval`/realtime-channel leak sweep** (count from
  `grep -rn "addEventListener\|setInterval\|watchPosition" src/hooks src/components | wc -l`
  = 77). Only `JobTracking.tsx` was spot-checked. The other ~76 sites were not individually
  verified with a mount/unmount loop — this is a real gap, not a claim of cleanliness.
- **Main-thread blocking from large API payloads** (`get_ranked_open_jobs`, admin queues,
  analytics) — grepped for call sites but did not profile actual parse time against a
  large seeded dataset (frame-drop measurement during navigation/list render).
- **On-device memory growth at 500+ items.** Prod currently has no user near that scale
  (max 16 posted jobs/customer: `select customer_id, count(*) from jobs group by customer_id
order by count(*) desc limit 5` against prod `fncmgoasalhdgfwzhsqa`, 2026-09-02) — PD-002
documents the structural gap, but
  a live 500-row render-and-watch-heap test was not run, since there's no way to seed that
  volume safely under "test accounts only" without polluting prod data at meaningful scale.

## Out-of-scope conclusions

- **FlatList/LazyVStack** — explicitly out of scope per PROTOCOL §6 (React, not React
  Native). Checked `VirtualList`/`VirtualizedJobList` as the real analogue instead.
- **Dependency version bumps** — reported (npm outdated, PD-003) but not applied, per the
  orchestrator's standing constraint for this run.

## What I fixed

**Nothing yet.** This lane ran in `permissionMode: plan` for the sweep phase, which blocks
`src/`/`supabase/`/`ios/` edits by design (per the orchestrator's brief and PROTOCOL §1).
Both real findings (PD-001, PD-002) are proposed as plans below, held pending
`VERDICT.md` + orchestrator release into the FIX phase:

- **PD-001 fix plan:** either (a) narrow `resolveDependencies` to only return `[]` for
  dynamic-import hosts (preserving modulepreload for the entry's own static graph, matching
  what the comment already claims should happen), or (b) if the current behavior is actually
  intentional (e.g. deliberately deferring even entry-graph preloads), fix `bundle-size.yml`'s
  grep to walk the static-import closure instead of relying on `index.html` tags — either
  change is a build-config/CI-only edit, no product risk. Given the file lives in
  `vite.config.ts`, which is not on the orchestrator-only shared-files list but is
  build-critical, I'd propose option (b) as lower-risk (CI script edit only) unless the
  orchestrator wants the build-config change.
- **PD-002 fix plan:** add a defensive `.limit(200)` to both queries in `useActivityData.ts`
  (`:140`, `:324`) as the low-risk immediate mitigation (no UX change today, since no user is
  near that count); flag full virtualization of `ActivitySectionedView` via the existing
  `VirtualList` primitive as a follow-up, since it's a larger, riskier change to a
  collapsible/accordion component touched by several other lanes' tests.

PD-003 and PD-004 are report-only by design (dependency bumps and export cleanup are both
out of this run's authorized scope).
