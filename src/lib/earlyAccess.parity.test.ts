import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { earlyAccessDelayMs } from "./earlyAccess";

/**
 * The early-access delay now exists in TWO places: this module (the client
 * gate) and `get_open_jobs_for_map` in SQL (the enforcement point, since the
 * RPC is callable directly and the perk is paid for).
 *
 * They must agree exactly. If the SQL is stricter, map pins vanish when you
 * toggle to the list; if it's looser, the perk leaks. That inconsistency is
 * the exact class of bug migration 20260720120000 was written to fix, so it is
 * worth a guard rather than a comment.
 */
const SQL = readFileSync(
  // The LATEST migration that redefines get_open_jobs_for_map — the body that
  // is actually live. This used to point at 20260820001000, which three later
  // migrations had already superseded, so the guard was grading a dead file.
  resolve(__dirname, "../../supabase/migrations/20260829032507_remove_plus_tier_early_access.sql"),
  "utf8",
);

/** Minutes each tier shaves off the 20-minute base, as the SQL declares them. */
function sqlEarnedMinutes(): Record<string, number> {
  const earned: Record<string, number> = {};
  const eliteBusiness = SQL.match(/WHEN tier IN \('elite', 'business'\) THEN (\d+)/);
  const pro = SQL.match(/WHEN tier = 'pro' THEN (\d+)/);
  const basic = SQL.match(/WHEN tier = 'basic' THEN (\d+)/);
  expect(eliteBusiness, "elite/business branch missing from the SQL").not.toBeNull();
  expect(pro, "pro branch missing from the SQL").not.toBeNull();
  expect(basic, "basic branch missing from the SQL").not.toBeNull();
  earned.elite = Number(eliteBusiness![1]);
  earned.business = Number(eliteBusiness![1]);
  earned.pro = Number(pro![1]);
  earned.basic = Number(basic![1]);
  return earned;
}

describe("early-access delay — client/SQL parity", () => {
  it("uses the same 20-minute base on both sides", () => {
    expect(earlyAccessDelayMs(null)).toBe(20 * 60 * 1000);
    expect(SQL).toContain("make_interval(mins => 20 -");
  });

  it("shaves the same minutes off per tier", () => {
    const earned = sqlEarnedMinutes();
    for (const [tier, minutes] of Object.entries(earned)) {
      expect(earlyAccessDelayMs(tier), `tier "${tier}" disagrees`).toBe((20 - minutes) * 60 * 1000);
    }
  });

  it("treats an unknown or absent tier as free on both sides", () => {
    expect(earlyAccessDelayMs("gold-plated")).toBe(20 * 60 * 1000);
    expect(earlyAccessDelayMs(undefined)).toBe(20 * 60 * 1000);
    expect(SQL).toContain("ELSE 0");
  });

  it("treats a lapsed subscription as free server-side", () => {
    // useDashboardData gates on `subscription_expires_at > now()`; the RPC
    // must not hand the perk to someone whose plan ended.
    expect(SQL).toContain("subscription_expires_at <= now()");
  });
});
