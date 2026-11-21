/**
 * A check that reports error_logs rows as REAL people's errors skips a test robot's rows (signed out included).
 *
 * 2026-11-21, 20:40-20:41 UTC: three "We couldn't load this profile." rows on www /u/neighbor-33 (release 2c6ea0f865)
 * read as a signed-out visitor's and were swept as a production error. MEASURED: the visitor was a local Playwright
 * audit (HeadlessChrome, the owner's network). Its request rewriter turned the page's public_profile_by_handle POST
 * into a GET (prod edge logs: 200 both times) and fulfilled it with `access-control-allow-origin: http://127.0.0.1:5300`
 * while the page was on https://www.louisianahelpr.com, so the browser's CORS check threw it away and the app showed
 * its error state as designed. The same read as anon from www's own origin answers 200 with the www origin. Every one
 * of the six rows carries tags.automated = true (errorLogger.ts tags every navigator.webdriver session, guard
 * errorLogsTagAutomatedBrowsers), and the user-error-screen alert's user_error_screen_is_real already skips them; the
 * prod-errors check counted every non-seed row, so a robot's guest rows read as a real guest's.
 *
 * The class: every repo check whose SQL reads public.error_logs and excludes test accounts (`is_seed`) to report real
 * users also excludes `tags ->> 'automated' = 'true'`. The inventory comes from the scripts and workflows themselves.
 */
// @mutate scripts/prod-errors-check.mjs |  AND coalesce(e.tags ->> 'automated', '') <> 'true'"; | ";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankHashComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const DIRS = ["scripts", "scripts/lib", "scripts/ci", ".github/workflows"];

/** Files whose code (comments blanked) reads public.error_logs AND leaves out test accounts with is_seed. */
function realUserReaders(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  for (const dir of DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!/\.(mjs|js|ts|yml|yaml|sh|sql)$/.test(name)) continue;
      const file = `${dir}/${name}`;
      const raw = readFileSync(join(ROOT, file), "utf8");
      const code = /\.(ya?ml|sh)$/.test(name) ? blankHashComments(raw) : /\.sql$/.test(name) ? blankSqlComments(raw) : blankComments(raw);
      if (/\b(from|join)\s+(public\.)?error_logs\b/i.test(code) && /\bis_seed\b/.test(code)) out.push({ file, code });
    }
  }
  return out;
}

const ROBOT_FILTER = /coalesce\s*\(\s*(\w+\.)?tags\s*->>\s*'automated'\s*,\s*''\s*\)\s*<>\s*'true'/i;

describe("real-user error checks skip a test robot's rows", () => {
  const readers = realUserReaders();

  it("finds the readers (inventory floor)", () => {
    expect(readers.map((r) => r.file)).toContain("scripts/prod-errors-check.mjs");
    expect(readers.length).toBeGreaterThan(0);
  });

  it.each(readers.map((r) => [r.file, r.code] as const))("%s excludes tags.automated rows", (_file, code) => {
    expect(code).toMatch(ROBOT_FILTER);
  });

  it("prod-errors-check applies the robot filter in the real-user clause, not only in the drill", () => {
    const code = blankComments(readFileSync(join(ROOT, "scripts/prod-errors-check.mjs"), "utf8"));
    const clause = /const seedClause = INCLUDE_SEED\s*\?\s*"true"\s*:\s*"([^"]*)"/.exec(code)?.[1] ?? "";
    expect(clause).toMatch(/is_seed/);
    expect(clause).toMatch(ROBOT_FILTER);
  });
});
