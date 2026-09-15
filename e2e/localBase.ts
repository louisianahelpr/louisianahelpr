/**
 * The frontend every real-backend spec drives when it builds its own URLs:
 * this checkout's `vite preview`, the same default as playwright.config.ts's
 * HAPPY_PATH_BASE_URL (the config writes HAPPY_PATH_PORT back into the env the
 * workers inherit). Never the deployed site: test page loads cost Vercel edge
 * requests and paused the project on 2026-09-14
 * (src/test/noTestTrafficOnVercel.test.ts). PLAYWRIGHT_BASE_URL still wins.
 */
export const LOCAL_BASE_URL = (
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.HAPPY_PATH_BASE_URL ||
  `http://127.0.0.1:${process.env.HAPPY_PATH_PORT || "4173"}`
).replace(/\/$/, "");
