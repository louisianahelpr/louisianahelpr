/**
 * Declutter trades slice 1 (owner 10-31, lead plan 11-06): item-for-item trade offers, server side.
 * Behaviour (real Postgres): src/test/pglite/declutterTrades.pglite.mjs (43 PASS; NEW_MIGRATION=skip and 3 planted
 * defects red). This guard pins, on the NEWEST definition of each function (any dollar tag, comments blanked), the
 * authz and hold lines that proof exercises, so a later restatement cannot quietly drop one.
 *
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   IF NOT v_want.accepts_trades THEN |   IF false THEN
 * @mutate supabase/migrations/20261111201159_trade_offer_notice_leads_with_no_money.sql |   PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');\n  SELECT * INTO v_ok |   PERFORM 1;\n  SELECT * INTO v_ok
 * @mutate supabase/migrations/20261110205345_push_titles_fit_lock_screen.sql |   PERFORM set_config('declutter.bundle_take', 'on', true);\n  v_buyer_line := public.declutter_take_item( |   PERFORM 1;\n  v_buyer_line := public.declutter_take_item(
 * @mutate supabase/migrations/20261110205345_push_titles_fit_lock_screen.sql |   IF (p_action = 'withdraw') <> (s.buyer_id = v_uid) THEN |   IF false THEN
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   AFTER UPDATE OF status, seller_hidden, current_price_cents ON public.declutter_items |   AFTER UPDATE OF price_cents ON public.declutter_items
 * @mutate supabase/migrations/20261106184913_declutter_trades_handover.sql | GRANT EXECUTE ON FUNCTION public.declutter_swap_sweep() TO service_role; | GRANT EXECUTE ON FUNCTION public.declutter_swap_sweep() TO authenticated;
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql |   v_out := v_out \|\| jsonb_build_object('declutter_swap_offers', | v_out := v_out; PERFORM ('declutter_swap_offers',
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FNS = [
  "declutter_set_trade_rules", "declutter_void_swaps", "declutter_items_void_swaps", "declutter_swap_items_ok",
  "declutter_offer_swap", "declutter_respond_swap", "declutter_swap_sweep",
];

const body = (name: string): string => {
  const def = effectiveDefs(DIR).get(name);
  expect(def, `${name} is gone`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};

/** Every migration's SQL, comments blanked, oldest first. */
const allSql = (): string => migrationFiles(DIR).map((f) => blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"))).join("\n");

describe("Declutter trades (slice 1, server)", () => {
  it("all seven functions exist", () => {
    const defs = effectiveDefs(DIR);
    expect(FNS.filter((f) => defs.has(f)).length).toBeGreaterThan(6);
  });

  it("an offer needs the buyer's ID check, the seller's switch on, and the buyer's own live listing", () => {
    expect(body("declutter_offer_swap")).toMatch(/PERFORM\s+public\.declutter_identity_gate\(v_uid,\s*'identity_required_to_buy'\)/i);
    expect(body("declutter_offer_swap")).toMatch(/PERFORM\s+public\.require_feature\('declutter'\)/i);
    const ok = body("declutter_swap_items_ok");
    expect(ok).toMatch(/IF\s+NOT\s+v_want\.accepts_trades\s+THEN/i);
    expect(ok).toMatch(/v_give\.seller_id\s+IS\s+DISTINCT\s+FROM\s+p_buyer/i);
    expect(ok).toMatch(/v_want\.current_price_cents\s*=\s*0\s+OR\s+v_give\.current_price_cents\s*=\s*0/i);
  });

  it("only the buyer withdraws, only the seller answers, and accept holds both items without free-claim notices", () => {
    const b = body("declutter_respond_swap");
    expect(b).toMatch(/IF\s+\(p_action\s*=\s*'withdraw'\)\s*<>\s*\(s\.buyer_id\s*=\s*v_uid\)\s+THEN/i);
    expect(b).toMatch(/set_config\('declutter\.bundle_take',\s*'on',\s*true\)/i);
    expect(b).toMatch(/declutter_take_item\(s\.item_id,\s*s\.buyer_id,\s*0,/i);
    expect(b).toMatch(/declutter_take_item\(s\.offered_item_id,\s*s\.seller_id,\s*0,/i);
  });

  it("a listing that leaves the market or is hidden voids the open trades naming it", () => {
    // Trades fixes (20261108195151) widened it to current_price_cents (an item made free closes its trades).
    expect(allSql()).toMatch(/AFTER UPDATE OF status, seller_hidden, current_price_cents ON public\.declutter_items\s+FOR EACH ROW EXECUTE FUNCTION public\.declutter_items_void_swaps\(\)/i);
  });

  it("anon executes none of them; the sweep and the helpers are service_role only", () => {
    const sql = allSql();
    for (const f of FNS) expect(sql, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`, "i"));
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_swap_sweep\(\) TO service_role;/);
    for (const f of ["declutter_swap_sweep", "declutter_void_swaps", "declutter_swap_items_ok"]) {
      expect(sql, f).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO [^;]*authenticated`, "i"));
    }
  });

  it("Download My Data carries every trade the member is a side of", () => {
    expect(body("export_my_data")).toMatch(/jsonb_build_object\('declutter_swap_offers',[\s\S]*?WHERE\s+t\.buyer_id\s*=\s*v_uid\s+OR\s+t\.seller_id\s*=\s*v_uid/i);
  });
});
