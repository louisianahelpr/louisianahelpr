/**
 * Q2793 server half (20261118055433_shops_same_day_after_closing.sql, Shops launch pass 2, 2026-11-18): once the
 * shop's last closing time today has passed in Louisiana, shops_request_order refuses today (ready_date_too_soon),
 * the same rule the order sheet applies (src/lib/shops/orders.ts shopClosedForToday).
 *
 * Behaviour proof: src/test/pglite/shopsSameDayAfterClosing.pglite.mjs on a FIXED clock (12 PASS; NEW_MIGRATION=skip
 * 3 FAIL; planted `>=` for `>`, a dead `AND false`, and a dropped `p_ready_date = v_today` each RED, measured
 * 2026-11-18). This file keeps the newest bodies wired the same way.
 */
// @mutate supabase/migrations/20261118055433_shops_same_day_after_closing.sql |   IF p_ready_date = v_today AND public.shop_closed_for_today(s.id) THEN | IF false THEN
// @mutate supabase/migrations/20261118055433_shops_same_day_after_closing.sql |               AND h.closes_local > (now() AT TIME ZONE 'America/Chicago')::time); |               AND h.closes_local >= (now() AT TIME ZONE 'America/Chicago')::time);
// @mutate supabase/migrations/20261118055433_shops_same_day_after_closing.sql | REVOKE ALL ON FUNCTION public.shop_closed_for_today(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shop_closed_for_today(uuid) FROM anon;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

describe("Shops: a same-day order after closing waits for the next open day (Q2793)", () => {
  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("shops_request_order")).toBe(true);
    expect(DEFS.has("shop_closed_for_today")).toBe(true);
    expect(body("shops_request_order").length).toBeGreaterThan(3000);
  });

  it("shops_request_order refuses today once the shop has closed, after the lead-time check", () => {
    const req = body("shops_request_order");
    const gate = req.search(/IF\s+p_ready_date\s*=\s*v_today\s+AND\s+public\.shop_closed_for_today\(s\.id\)\s+THEN\s+RAISE\s+EXCEPTION\s+'ready_date_too_soon'/i);
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(req.search(/p_ready_date\s*<\s*v_today\s*\+\s*v_lead/i));
  });

  it("closed means today's hours exist and every window has closed, in Louisiana time", () => {
    const fn = body("shop_closed_for_today");
    expect(fn).toMatch(/now\(\)\s+AT\s+TIME\s+ZONE\s+'America\/Chicago'/i);
    expect(fn).toMatch(/AND\s+NOT\s+EXISTS\s*\([\s\S]*h\.closes_local\s*>\s*\(now\(\)\s+AT\s+TIME\s+ZONE\s+'America\/Chicago'\)::time\)/i);
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, "20261118055433_shops_same_day_after_closing.sql"), "utf8"));
    expect(mig).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.shop_closed_for_today\(uuid\)\s+FROM\s+PUBLIC,\s*anon;/i);
  });
});
