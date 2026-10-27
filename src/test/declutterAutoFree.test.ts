/**
 * Q2430 (owner 2026-10-27): "If it hasn't sold by day 12, make it free" -- the price-drop sweep sets it
 * Free (Q2419 free rules, no setup fee), one last chance before the 14-day haul-away; watchers get the
 * Q2429 alert. Reads the NEWEST definitions (effectiveDefs, any dollar-quote tag) and pins:
 *   - only a LIVE, priced, offers listing the seller switched on, live 12 days or more (the haul-away's clock);
 *   - it becomes free exactly as a free listing is (price, current price and floor 0, no stop), its open
 *     offers close, the switch resets;
 *   - the evening sweep runs it; the switch is the seller's own listing only.
 * Backend proof, six planted defects each RED: src/test/pglite/declutterAutoFree.pglite.mjs.
 *
 * @mutate supabase/migrations/20261027205327_declutter_auto_free_day12.sql |      WHERE p.auto_free_day12\n       AND i.status = 'live' |      WHERE i.status = 'live'
 * @mutate supabase/migrations/20261027205327_declutter_auto_free_day12.sql |        AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '12 days' <= now() |        AND true
 * @mutate supabase/migrations/20261027205327_declutter_auto_free_day12.sql |   v_n := v_n + public.declutter_auto_free_due();\n |
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("auto-free on day 12 (Q2430)", () => {
  const due = body("declutter_auto_free_due");

  it("the inventory read something", () => {
    expect(due.length).toBeGreaterThan(600);
    expect(body("declutter_set_auto_free").length).toBeGreaterThan(300);
  });

  it("only a live, priced, offers listing the seller switched on, 12 days or more after it went live", () => {
    expect(due).toContain("WHERE p.auto_free_day12 AND i.status = 'live' AND NOT i.seller_hidden AND i.sale_mode = 'offers' AND i.current_price_cents > 0 AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '12 days' <= now()");
  });

  it("it becomes free as a free listing is, its open offers close, the switch resets", () => {
    expect(due).toContain("SET floor_price_cents = 0, drop_stop_cents = NULL, auto_free_day12 = false");
    expect(due).toContain("SET price_cents = 0, current_price_cents = 0");
    expect(due).toMatch(/UPDATE public\.declutter_offers SET status = 'voided', closed_at = now\(\), updated_at = now\(\) WHERE item_id = it\.id AND status = 'open'/);
  });

  it("the evening sweep runs it, and the switch is the seller's own listing only", () => {
    expect(body("declutter_price_drop_sweep")).toContain("v_n := v_n + public.declutter_auto_free_due();");
    const set = body("declutter_set_auto_free");
    expect(set).toContain("PERFORM public.require_feature('declutter');");
    expect(set).toContain("SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;");
  });
});
