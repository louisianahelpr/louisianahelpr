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

/**
 * The OTHER stale-bundle failure — the one `staleBundleMessage` is structurally
 * unable to see.
 *
 * `staleBundleMessage` compares the served entry hash to the one on disk, once,
 * before the run. That catches a server which was ALREADY serving old code. It
 * cannot catch a `dist/` that is rebuilt UNDERNEATH a run that started clean,
 * and on this machine that is the common case: several lanes share one
 * checkout, and `vite build` empties `outDir`.
 *
 * What happens then, measured 2026-09-22 (2 failures in 18 throttled runs):
 *
 *   1. another lane runs `npm run build`; `dist/` is emptied and refilled
 *   2. the live `vite preview` starts answering 404 for the hashed chunks the
 *      ALREADY-LOADED index.html names — ten in one run (app-shared-*,
 *      react-vendor-*, lucide-*, AppShell-*, PageScaffold-*, ...)
 *   3. the failed module preload raises `vite:preloadError`, so
 *      `src/lib/chunkReload.ts` does its job and fires
 *      `location.replace(href + "&_v=<now>")`
 *   4. that recovery navigation 404s TOO, because index.html is itself
 *      momentarily absent mid-build
 *   5. the document is now permanently blank — `document.body.textContent`
 *      is `""`. The app never mounts.
 *
 * Whatever locator runs next eats a full 30s timeout and reports something like
 * "row not found". It reads exactly like a flaky product defect, and it is not
 * one: a whole lane went looking at inbox row layout and `inboxDefault.ts`
 * before the blank document was noticed.
 *
 * WHY THE HASH COMPARISON CANNOT BE REUSED HERE. Re-running it per test would
 * not help: once the rebuild FINISHES, disk and server agree again, so the
 * hashes match and the check passes — while the page loaded before the rebuild
 * stays dead. The mismatch is transient; the damage is not.
 *
 * So this keys on the SYMPTOM, which is unambiguous and survives: chunks under
 * `/assets/` returned 404, and/or the app performed its own `?_v=` recovery
 * navigation. Both are things that simply do not happen against a stable
 * server.
 *
 * Deliberately NOT a hard failure on its own — it only ever explains a test
 * that ALREADY failed. Calling a passing test failed because a chunk 404'd
 * would be inventing a defect, and this exists to stop exactly that.
 */
export function rebuiltUnderUsMessage(evidence: {
  lostChunks: string[];
  recoveries: string[];
}): string | null {
  const { lostChunks, recoveries } = evidence;
  if (lostChunks.length === 0 && recoveries.length === 0) return null;

  const show = (xs: string[], n: number) =>
    xs.slice(0, n).map((x) => "    " + x).concat(xs.length > n ? [`    … and ${xs.length - n} more`] : []);

  return [
    "",
    "THIS FAILURE IS ALMOST CERTAINLY NOT A PRODUCT DEFECT.",
    "",
    "`dist/` was rebuilt while this run was using it, so the page under test",
    "lost the chunks its index.html names and never mounted. Whatever assertion",
    "failed above was looking at a BLANK DOCUMENT.",
    "",
    ...(lostChunks.length
      ? ["  chunks that 404'd:", ...show(lostChunks, 6), ""]
      : []),
    ...(recoveries.length
      ? [
          "  the app's own stale-deploy recovery fired (src/lib/chunkReload.ts),",
          "  and that navigation 404'd as well because index.html was missing:",
          ...show(recoveries, 3),
          "",
        ]
      : []),
    "`vite build` empties outDir, so any lane running `npm run build` in this",
    "checkout does this to every other lane's live preview. assertFreshBundle()",
    "cannot catch it: it runs once per worker and proves only that the bundle",
    "was fresh when the worker STARTED.",
    "",
    "Before believing anything above: re-run with your own port and a checkout",
    "no building lane shares.",
    "",
  ].join("\n");
}
