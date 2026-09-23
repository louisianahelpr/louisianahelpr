import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { cpus } from "node:os";

/**
 * `*.tz.test.{ts,tsx}` — specs that switch the DEVICE timezone mid-run
 * (`process.env.TZ = ...`) to prove a render is the same in every zone.
 * Node only re-reads TZ on assignment in a process's MAIN thread; inside a
 * worker_thread the assignment is silently ignored and every "zone" is the
 * runner's. So these run in the `forks` pool, where each test file is a child
 * process's main thread. Each such spec also asserts the switch took effect,
 * so moving one back under `threads` fails loudly instead of passing vacuously.
 */
const TZ_SWEEP_SPECS = "src/**/*.tz.test.{ts,tsx}";

export default defineConfig({
  plugins: [react()],
  // NOT node_modules/.vite (the default). Vitest clears its dep-optimizer
  // cache on start, and sharing the directory with the dev server means
  // every `vitest run` deletes the RUNNING server's optimized deps — every
  // cold lazy route then 504s ("Outdated Optimize Dep") until the server
  // re-optimizes, which users see as app-wide "Update ready" / "Try again"
  // screens. Cost a full overnight audit sweep before it was traced.
  cacheDir: "node_modules/.vitest",
  test: {
    environment: "jsdom",
    // Cap worker threads at 2 (was half the cores). Each jsdom worker holds a
    // few hundred MB; on the owner's 8 GB Mac, three lanes each running 4
    // workers pushed the machine into GBs of swap (2026-09-14). CI's 4-core
    // runners already landed on 2, so CI is unchanged.
    //
    // Vitest defaults to one worker per core. That is the right number when
    // vitest is the only thing running, and the wrong number here: parallel
    // agent lanes routinely have a dozen `tsc -b` processes going, and a full
    // run on an 8-core box at load average 60 reported 11 failures that ALL
    // passed in isolation — jsdom renders and the edge-function harness's
    // per-test transform simply could not finish inside `waitFor`'s 1s poll
    // window or the 5s test timeout.
    //
    // A suite that goes red because the machine was busy teaches people to
    // ignore red. Capping threads makes a loaded machine degrade in SPEED
    // instead. Deliberately NOT raising testTimeout/waitFor timeouts — that
    // would paper over genuine hangs, which is the failure mode we still want
    // to see. Override with VITEST_MAX_THREADS when you know the box is idle.
    //
    // 2026-09-19: these were nested under `poolOptions.threads` until today,
    // which Vitest 4 REMOVED — it prints "`test.poolOptions` was removed in
    // Vitest 4" and ignores the block. So the cap above was DEAD CONFIG and
    // this 8-core box has been running 8 jsdom workers, which is precisely the
    // condition the paragraph above describes. Top-level is the v4 home.
    pool: "threads",
    maxThreads: Number(process.env.VITEST_MAX_THREADS) ||
      Math.min(2, Math.max(1, Math.floor(cpus().length / 2))),
    minThreads: 1,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/gateLockGlobalSetup.ts"],
    // `include` lives on each project below, NOT here: `extends: true` MERGES
    // arrays, so a root include would put the whole suite in both projects.
    // Vitest's default is 5s, which this suite outgrew. Nothing here is
    // genuinely slow — the failures were all the same shape: a spec that does
    // `await import("./Component")` and renders it, on a machine that is also
    // building something else. Transform + import of a real component tree is
    // easily seconds under load, so BrowseMap, AdminUserDetailDialog and
    // stripe-webhook would each time out and then pass alone, which is the
    // signature of a starved runner rather than a slow test.
    //
    // That shape of red is worse than useless: it trains everyone to re-run
    // instead of reading the failure, and a real regression hides in the noise.
    // 20s is far below anything a human waits on (the whole suite is ~30s) and
    // far above the transform cliff.
    //
    // If a test needs MORE than this, it is doing too much — give that one a
    // per-test timeout rather than raising the global again.
    testTimeout: 20_000,
    // Same reasoning for setup/teardown: beforeAll that seeds a fake DB or
    // mounts a provider tree hits the same contention.
    hookTimeout: 20_000,
    // Publishable Vite vars for the Supabase client constructed at import time.
    // Previously read from a committed .env (now untracked, F-SEC-01); test.env
    // populates import.meta.env directly so createClient() doesn't throw.
    // Publishable/anon keys only — safe to expose (they ship in the bundle).
    env: {
      VITE_SUPABASE_PROJECT_ID: "fncmgoasalhdgfwzhsqa",
      // NOT prod (Q55a). Until 2026-09-23 this was the prod URL, and every spec
      // that rendered a data-loading component unmocked sent real requests
      // (~4,190/day `uuid: "user-1"` errors in the prod Postgres logs).
      // `.invalid` is reserved (RFC 2606) and never resolves, so even with the
      // guard bypassed a unit test cannot reach any database. The guard
      // (src/test/prodNetworkGuard.ts) refuses this host and *.supabase.co.
      VITE_SUPABASE_URL: "https://unit-test.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.{test,spec}.{ts,tsx}"], exclude: [...configDefaults.exclude, TZ_SWEEP_SPECS] },
      },
      { extends: true, test: { name: "tz-sweep", include: [TZ_SWEEP_SPECS], pool: "forks" } },
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
