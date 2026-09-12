#!/usr/bin/env node
/**
 * `npm run check:changed` — run the visual sweep's gates on ONLY the screens
 * this change touches, before pushing (working-forwards change 2, 2026-09-12).
 * Screens are chosen by scripts/changed-routes.mjs. Phone-light variant only,
 * so it stays in minutes; CI still runs the full matrix.
 *
 * Exit 0 with a note when no route is touched. LH_SKIP_CHANGED_CHECK=1 skips.
 */
import { execFileSync, spawnSync } from "node:child_process";

if (process.env.LH_SKIP_CHANGED_CHECK === "1") {
  console.log("[check:changed] skipped (LH_SKIP_CHANGED_CHECK=1)");
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
