/* TEMPORARY config for the top-bar probe. Uses the installed Chrome channel
   instead of the headless shell, and points at the already-running dev server.
   Deleted once the before/after comparison is done. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/happy-path",
  timeout: 900_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    viewport: { width: 375, height: 812 },
    isMobile: false,
    hasTouch: true,
    baseURL: process.env.HAPPY_PATH_BASE_URL || "http://localhost:8080",
    serviceWorkers: "block",
  },
  projects: [{ name: "happy-path" }],
});
