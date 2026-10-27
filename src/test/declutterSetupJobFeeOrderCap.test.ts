/**
 * Q1937 (owner 2026-10-21: "CAPPED AT THE ORDER TOTAL"; Add a Helpr launches 2026-10-28): the card-fee
 * debt a Declutter order's linked setup jobs put on the seller is capped at the order total, summed over
 * every job linked to that order. Before: capped per job only (prod md5 b90402b6..., 2026-10-27).
 *
 * Reads the EFFECTIVE definition (effectiveDefs replays every migration, including the
 * pg_get_functiondef + regexp_replace rewrites this fix uses) and pins the per-order cap, the order-row
 * lock before the sum, and that the per-job cap stays.
 * Backend proof: src/test/pglite/declutterSetupJobFeeOrderCap.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261027174633_declutter_setup_job_fee_debt_order_cap.sql |   v_fee := least(v_fee, greatest(COALESCE(v_order_total, 0) - v_billed, 0)); |   v_fee := v_fee;
 * @mutate supabase/migrations/20261027174633_declutter_setup_job_fee_debt_order_cap.sql |    WHERE y.order_id = v_order_id AND y.job_id <> p_job_id; |    WHERE y.job_id = p_job_id;
 * @mutate supabase/migrations/20261027174633_declutter_setup_job_fee_debt_order_cap.sql |    WHERE o.id = (SELECT x0.order_id FROM public.declutter_order_jobs x0 WHERE x0.job_id = p_job_id)\n   FOR UPDATE; |    WHERE o.id = (SELECT x0.order_id FROM public.declutter_order_jobs x0 WHERE x0.job_id = p_job_id);
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = () => blankSqlComments(DEFS.get("declutter_setup_job_fee_debt")?.stmt ?? "").replace(/\s+/g, " ");

describe("Add a Helpr: the seller's setup-job card-fee debt is capped per ORDER (Q1937)", () => {
  it("the inventory read the function", () => {
    expect(body().length).toBeGreaterThan(500);
    expect(DEFS.size).toBeGreaterThan(500);
  });

  it("the order row is locked before the per-order sum is read", () => {
    const b = body();
    const lock = b.search(/FROM public\.declutter_orders o WHERE o\.id = \(SELECT x0\.order_id FROM public\.declutter_order_jobs x0 WHERE x0\.job_id = p_job_id\) FOR UPDATE;/);
    const sum = b.search(/sum\(y\.seller_fee_billed_cents\)/);
    expect(lock).toBeGreaterThan(0);
    expect(sum).toBeGreaterThan(lock);
  });

  it("what the order's OTHER jobs were billed is subtracted from the order total, never below 0", () => {
    const b = body();
    expect(b).toMatch(/WHERE y\.order_id = v_order_id AND y\.job_id <> p_job_id;/);
    expect(b).toMatch(/v_fee := least\(v_fee, greatest\(COALESCE\(v_order_total, 0\) - v_billed, 0\)\);/);
  });

  it("the per-job cap stays, and comes first", () => {
    const b = body();
    const perJob = b.indexOf("v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));");
    expect(perJob).toBeGreaterThan(0);
    expect(b.indexOf("v_fee := least(v_fee, greatest(")).toBeGreaterThan(perJob);
  });
});
