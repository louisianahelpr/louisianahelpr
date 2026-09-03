/**
 * The stale-bundle decision, as pure functions.
 *
 * It lives under src/ rather than beside its caller in e2e/ for one reason:
 * tsconfig.app.json does not include e2e/, so a vitest spec importing from
 * there fails with TS6307 and the guard would have shipped untested. The
 * caller is `e2e/happy-path/assertFreshBundle.ts`; the tests are in
 * `src/test/staleBundleGuard.test.ts`.
 */
export const entryOf = (html: string) =>
  /<script[^>]+src="\/?(assets\/index-[A-Za-z0-9_-]+\.js)"/.exec(html)?.[1];

/**
 * The decision, as a pure function, so it can be tested for BOTH outcomes
 * without standing up two servers.
 *
 * Proving a guard fires is the whole point of writing one, and proving THIS one
 * fires end-to-end turned out to be surprisingly hard: `vite preview` reads
 * from disk per request, so a same-worktree rebuild can never produce the
 * mismatch, and `PLAYWRIGHT_BASE_URL` only redirects the chromium project, so
 * pointing the happy-path suite at a foreign server does not work either. Two
 * attempts at an end-to-end proof produced a PASS and would have been reported
 * as "the guard works". Testing the decision directly is the honest version.
 *
 * Returns the failure message, or null when the pair is fine.
 */
export function staleBundleMessage(
  baseURL: string,
  servedHtml: string | undefined,
  diskHtml: string | undefined,
): string | null {
  if (!diskHtml) return null;              // nothing built locally to compare
  const want = entryOf(diskHtml);
  if (!want) return null;                  // dev-style index, no hashed entry
  if (servedHtml === undefined) return null; // unreachable: the runner's problem
  const served = entryOf(servedHtml);
  if (!served || served === want) return null;
  return [
    "",
    "The server at " + baseURL + " is serving a STALE bundle.",
    "",
    "  serving : " + served,
    "  on disk : " + want,
    "",
    "Every assertion in this suite would describe code you are not running.",
    "Playwright only builds when PLAYWRIGHT_WEB_SERVER=1; otherwise it adopts",
    "whatever already listens on that port — including another worktree's",
    "preview, which is how this actually happens on a machine running several",
    "sessions at once.",
    "",
    "Fix it with either:",
    "  npm run test:e2e:happy            (builds and serves for you)",
    "  kill $(lsof -ti:4173) && npm run build && npx vite preview --port 4173",
    "",
  ].join("\n");
}
