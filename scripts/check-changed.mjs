#!/usr/bin/env node
/**
 * `npm run check:changed` — run the visual sweep's gates on ONLY the screens
 * this change touches, before pushing (working-forwards change 2, 2026-09-12).
 * Screens are chosen by scripts/changed-routes.mjs. Phone-light variant only,
 * so it stays in minutes; CI still runs the full matrix.
 *
 * Exit 0 with a note when no route is touched. LH_SKIP_CHANGED_CHECK=1 skips
 * — and every skip is logged to docs/audit/prepush-skips.log (owner,
 * 2026-09-12: an invisible skip is how this gate stops meaning anything).
 * LH_SKIP_REASON is REQUIRED alongside the skip flag; skipping without one
 * fails the push instead of silently passing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_LOG = join(REPO_ROOT, "docs", "audit", "prepush-skips.log");

function logSkip(reason) {
  let sha = "unknown";
  let branch = "unknown";
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // best-effort — still log the skip even if git metadata can't be read
  }
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // same as above
  }
  const line = `${new Date().toISOString()} | branch=${branch} | sha=${sha} | reason=${reason}\n`;
  mkdirSync(dirname(SKIP_LOG), { recursive: true });
  appendFileSync(SKIP_LOG, line);
}

if (process.env.LH_SKIP_CHANGED_CHECK === "1") {
  const reason = (process.env.LH_SKIP_REASON || "").trim();
  if (!reason) {
    console.error(
      "[check:changed] LH_SKIP_CHANGED_CHECK=1 requires LH_SKIP_REASON=\"...\" — a silent skip is not allowed.",
    );
    process.exit(1);
  }
  logSkip(reason);
  console.log(`[check:changed] skipped (LH_SKIP_CHANGED_CHECK=1) — reason: ${reason}`);
  process.exit(0);
}
const { routes, changed, global } = JSON.parse(
  execFileSync("node", ["scripts/changed-routes.mjs", "--json", ...process.argv.slice(2)], { encoding: "utf8" }),
);
if (!routes.length) {
  console.log(`[check:changed] ${changed.length} src file(s) changed, no route renders them — nothing to sweep.`);
  process.exit(0);
}
console.log(`[check:changed] sweeping ${global ? "EVERY route (a global file changed)" : routes.join(", ")}`);
// PROD SESSIONS REQUIRED (owner, 2026-09-12: no mocks, ever). The a11y-prod
// sweep signs in as the shared test accounts; with no session source it cannot
// sweep an authed screen, so that is a hard failure, never a pass. Mirrors
// sessionsAvailable() in e2e/journeys/fixtures.ts.
const hasCreds = (role) => process.env[`PLAYWRIGHT_${role}_EMAIL`] && process.env[`PLAYWRIGHT_${role}_PASSWORD`];
if (!(hasCreds("POSTER") && hasCreds("HELPER")) && !existsSync(join(REPO_ROOT, ".env"))) {
  console.error(
    "[check:changed] FAIL: prod test sessions are not available. Set PLAYWRIGHT_POSTER_EMAIL/_PASSWORD and " +
      "PLAYWRIGHT_HELPER_EMAIL/_PASSWORD, or provide .env (service role) so scripts/test-signin-link.mjs can mint them. " +
      'To bypass knowingly: LH_SKIP_CHANGED_CHECK=1 LH_SKIP_REASON="...".',
  );
  process.exit(1);
}

// LOCAL CODE, PROD BACKEND. playwright.config.ts's webServer (PLAYWRIGHT_WEB_SERVER=1)
// builds THIS checkout and serves it with `vite preview` on the per-worktree
// HAPPY_PATH_PORT; the build reads VITE_SUPABASE_* from .env, i.e. prod. The
// a11y-prod project is pointed at that server instead of the deployed site.
// The browser lock is taken by the config's globalSetup (e2e/browserLock.ts).
// A server already on the port would be REUSED and may be an older build, so an
// occupied port fails the push instead.
const port = process.env.HAPPY_PATH_PORT || defaultPort();
const baseURL = `http://127.0.0.1:${port}`;
const busy = await fetch(baseURL, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
if (busy) {
  console.error(`[check:changed] FAIL: ${baseURL} is already serving (possibly a stale build). Stop it: kill $(lsof -ti:${port})`);
  process.exit(1);
}
const r = spawnSync("npx", ["playwright", "test", "--project=a11y-prod"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SWEEP_VARIANTS: "phone-light",
    PLAYWRIGHT_WEB_SERVER: "1",
    HAPPY_PATH_PORT: port,
    HAPPY_PATH_BASE_URL: baseURL,
    PLAYWRIGHT_BASE_URL: baseURL,
    SWEEP_OUTPUT_DIR: process.env.SWEEP_OUTPUT_DIR || join(REPO_ROOT, "test-results", "check-changed"),
    ...(global ? {} : { SWEEP_ROUTES: routes.join(",") }),
  },
});
if (r.status !== 0) console.error(`[check:changed] FAIL: the a11y-prod sweep of the changed routes exited ${r.status}.`);
process.exit(r.status ?? 1);

/** Same derivation as defaultHappyPathPort() in playwright.config.ts. */
function defaultPort() {
  if (REPO_ROOT.endsWith("/louisianahelpr")) return "4173";
  let h = 0;
  for (const ch of REPO_ROOT) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(4200 + (h % 700));
}
