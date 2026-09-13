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
import { appendFileSync, mkdirSync } from "node:fs";
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
const r = spawnSync("npx", ["playwright", "test", "--project=happy-path", "visual-audit-sweep"], {
  stdio: "inherit",
  env: {
    ...process.env,
    RUN_VISUAL_SWEEP: "1",
    SWEEP_VARIANTS: "phone-light",
    PLAYWRIGHT_WEB_SERVER: "1",
    ...(global ? {} : { SWEEP_ROUTES: routes.join(",") }),
  },
});
process.exit(r.status ?? 1);
