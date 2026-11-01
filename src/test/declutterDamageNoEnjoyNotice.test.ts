/**
 * "Damaged in delivery" never tells the buyer "Enjoy your item ... the sale is final" (lead 2026-10-28, on A2-14;
 * migration 20261028232338). The damage decision pays the seller through declutter_complete_handover, whose buyer
 * notice said the sale was final, right before "Refund on its way ... all of it is coming back".
 *
 * Reads the EFFECTIVE definitions: complete_handover skips its buyer notice only for the order named in the
 * transaction-local declutter.no_enjoy_notice; the damage decision names its own order right before that call;
 * and nothing else sets the setting (EXACT list). Proof: src/test/pglite/declutterDamageNoEnjoyNotice.pglite.mjs.
 */
// @mutate supabase/migrations/20261031184929_declutter_damage_notices_name_the_item.sql |   PERFORM set_config('declutter.no_enjoy_notice', o.id::text, true);\n | \n
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN |   IF p_by <> 'admin' THEN
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("damaged in delivery: no \"Enjoy your item ... final\" for a buyer who is refunded", () => {
  const ch = flat("declutter_complete_handover");
  const dmg = flat("declutter_admin_decide_delivery_damage");

  it("reads both definitions (floor)", () => {
    expect(ch.length).toBeGreaterThan(2000);
    expect(dmg.length).toBeGreaterThan(2000);
  });

  it("the handover skips its buyer notice only for the order the setting names", () => {
    expect(ch).toContain("IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',");
  });

  it("the damage decision names its order right before the handover, and clears it after", () => {
    expect(dmg).toContain("PERFORM set_config('declutter.no_enjoy_notice', o.id::text, true); v_hand := public.declutter_complete_handover(o.id, 'admin'); PERFORM set_config('declutter.no_enjoy_notice', '', true);");
  });

  it("nothing else sets declutter.no_enjoy_notice (exact)", () => {
    const setters = [...DEFS.keys()].filter((fn) => /set_config\('declutter\.no_enjoy_notice', [^']/.test(flat(fn))).sort();
    expect(setters).toEqual(["declutter_admin_decide_delivery_damage"]);
  });
});
