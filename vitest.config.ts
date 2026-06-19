import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
