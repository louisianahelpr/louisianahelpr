import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
