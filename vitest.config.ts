import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { cpus } from "node:os";

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
    // Cap worker threads at HALF the cores (floor 2).
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
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: Number(process.env.VITEST_MAX_THREADS) ||
          Math.max(2, Math.floor(cpus().length / 2)),
        minThreads: 1,
      },
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
      VITE_SUPABASE_URL: "https://fncmgoasalhdgfwzhsqa.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
