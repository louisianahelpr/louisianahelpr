/**
 * Q1351 (lh-authz-rls review of Q1318): CSP violation reports have their OWN
 * per-minute budget in throttle_client_error_log, so a bad CSP deploy that
 * every visitor trips cannot spend the 300/min guest budget that
 * ErrorBoundary / BootWatchdog crash rows need.
 *
 * Static half (here): the NEWEST throttle_client_error_log in the migrations
 * caps tags.source = 'csp' rows on their own, the all-guests count excludes
 * them, and error_log_throttle_drops admits the 'csp' drop kind.
 * Behaviour (real Postgres): src/test/pglite/cspThrottleOwnCap.pglite.mjs
 * (7 PASS on the fix; 4 FAIL with NEW_MIGRATION=skip, the live definition).
 *
 * @mutate supabase/migrations/20261007122241_csp_reports_own_throttle_cap.sql |              AND coalesce(e.tags ->> 'source', '') <> 'csp'\n | \n
 * @mutate supabase/migrations/20261007122241_csp_reports_own_throttle_cap.sql |       IF v_is_csp THEN | IF false THEN
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const defs = effectiveDefs(DIR);
const body = blankSqlComments(defs.get("throttle_client_error_log")?.stmt ?? defs.get("public.throttle_client_error_log")?.stmt ?? "");

describe("Q1351: CSP reports spend their own error_logs budget", () => {
  it("inventory: the effective throttle_client_error_log is found (floor)", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(body).toMatch(/v_guest_cap/);
  });

  it("csp rows have their own cap and drop kind; the all-guests count excludes them", () => {
    expect(body).toMatch(/v_is_csp\s*:=\s*coalesce\(NEW\.tags\s*->>\s*'source',\s*''\)\s*=\s*'csp'/);
    expect(body).toMatch(/IF v_is_csp THEN[\s\S]*?e\.tags\s*->>\s*'source'\s*=\s*'csp'[\s\S]*?record_error_log_throttle_drop\('csp'\)/);
    expect(body).toMatch(/coalesce\(e\.tags\s*->>\s*'source',\s*''\)\s*<>\s*'csp'[\s\S]*?LIMIT v_guest_cap/);
  });

  it("the newest drop_kind CHECK admits 'csp'", () => {
    const checks = migrationFiles(DIR)
      .map((f) => blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8")))
      .flatMap((sql) => [...sql.matchAll(/ADD CONSTRAINT error_log_throttle_drops_drop_kind_check\s+CHECK\s*\(([^;]*)\);/gi)].map((m) => m[1]));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[checks.length - 1]).toMatch(/'csp'/);
  });
});
