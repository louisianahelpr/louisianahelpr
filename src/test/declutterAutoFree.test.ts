/**
 * Auto-free (Q2430, owner 2026-10-27; made a per-listing day count by OWN-FREE, 20261030030408): "If it doesn't
 * sell, make it free after __ days" -- Never (the default), 7, 14, 21 or 30. The price-drop sweep sets it Free
 * (Q2419 free rules, no setup fee); watchers get the Q2429 alert. Reads the NEWEST definitions (effectiveDefs,
 * any dollar-quote tag) and pins:
 *   - only a LIVE, priced listing of ANY sale mode whose seller chose a day count, live that many days or more
 *     (the haul-away's clock), re-checked under the item lock;
 *   - it becomes free exactly as a free listing is (price, current price and floor 0, no stop), its open
 *     offers close, the choice resets;
 *   - the evening sweep runs it; the choice is the seller's own listing only, and only 7, 14, 21 or 30.
 * Backend proof, nine planted defects each RED, NEW_MIGRATION=skip RED: src/test/pglite/declutterAutoFreeDays.pglite.mjs.
 *
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |      WHERE p.auto_free_days IS NOT NULL\n       AND i.status = 'live' |      WHERE i.status = 'live'
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |        AND COALESCE(i.live_at, i.submitted_at, i.created_at) + make_interval(days => p.auto_free_days) <= now() |        AND true
 * @mutate supabase/migrations/20261030154745_declutter_drop_stop_whole_dollar.sql |   v_n := v_n + public.declutter_auto_free_due();\n |
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |       AND NOT i.seller_hidden\n       AND i.current_price_cents > 0 |       AND NOT i.seller_hidden\n       AND i.sale_mode = 'offers'\n       AND i.current_price_cents > 0
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |       CONTINUE WHEN v_days IS NULL OR it.started + make_interval(days => v_days) > now(); |       CONTINUE WHEN v_days IS NULL;
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |   IF p_days IS NOT NULL AND p_days NOT IN (7, 14, 21, 30) THEN |   IF p_days IS NOT NULL AND p_days NOT IN (7, 12, 14, 21, 30) THEN
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("auto-free after the seller's day count (Q2430, OWN-FREE)", () => {
  const due = body("declutter_auto_free_due");

  it("the inventory read something", () => {
    expect(due.length).toBeGreaterThan(600);
    expect(body("declutter_set_auto_free_days").length).toBeGreaterThan(300);
    expect(body("declutter_set_auto_free").length).toBeGreaterThan(300);
  });

  it("only a live, priced listing of any sale mode with a day count chosen, that many days after it went live", () => {
    expect(due).toContain("WHERE p.auto_free_days IS NOT NULL AND i.status = 'live' AND NOT i.seller_hidden AND i.current_price_cents > 0 AND COALESCE(i.live_at, i.submitted_at, i.created_at) + make_interval(days => p.auto_free_days) <= now()");
    expect(due).not.toContain("sale_mode");
    expect(due).not.toContain("interval '12 days'");
  });

  it("the claim re-reads the day count under the lock", () => {
    expect(due).toContain("SELECT p.auto_free_days INTO v_days FROM public.declutter_item_private p WHERE p.item_id = it.id FOR UPDATE;");
    expect(due).toContain("CONTINUE WHEN v_days IS NULL OR it.started + make_interval(days => v_days) > now();");
  });

  it("it becomes free as a free listing is, its open offers close, the choice resets", () => {
    expect(due).toContain("SET floor_price_cents = 0, drop_stop_cents = NULL, auto_free_days = NULL");
    expect(due).toContain("SET price_cents = 0, current_price_cents = 0");
    expect(due).toMatch(/UPDATE public\.declutter_offers SET status = 'voided', closed_at = now\(\), updated_at = now\(\) WHERE item_id = it\.id AND status = 'open'/);
  });

  it("the evening sweep runs it, and the choice is the seller's own listing only, 7, 14, 21 or 30 days", () => {
    expect(body("declutter_price_drop_sweep")).toContain("v_n := v_n + public.declutter_auto_free_due();");
    for (const fn of ["declutter_set_auto_free_days", "declutter_set_auto_free"]) {
      const set = body(fn);
      expect(set).toContain("PERFORM public.require_feature('declutter');");
      expect(set).toContain("SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;");
    }
    expect(body("declutter_set_auto_free_days")).toContain("IF p_days IS NOT NULL AND p_days NOT IN (7, 14, 21, 30) THEN");
  });
});
