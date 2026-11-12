/**
 * Copy bug (migration 20261112023602): when the BUYER accepts the seller's price (a counter, or any Wanted reply),
 * declutter_take_item no longer tells the buyer "<Seller> accepted your offer". The buyer reads "You accepted Sam S.'s
 * $35.00 price ...", the seller "Ann S. accepted your $35.00 price ...". Who accepted comes from the offer's 'accept'
 * event, written by the caller just before take_item.
 *
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterReservedNoticeSaysWhoAccepted.pglite.mjs
 * (3x; 8 FAIL without the migration; 3 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |       CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN\n        format('You accepted |       CASE WHEN false THEN\n        format('You accepted
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |       CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN\n        format('%s accepted your %s price |       CASE WHEN false THEN\n        format('%s accepted your %s price
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |        WHERE e.offer_id = p_offer_id AND e.action = 'accept' ORDER BY |        WHERE e.offer_id = p_offer_id AND e.action = 'offer' ORDER BY
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const take = blankSqlComments(defs.get("declutter_take_item")?.stmt ?? "").replace(/\s+/g, " ");

describe("take_item: each side reads who accepted", () => {
  it("reads the newest definition (floor)", () => {
    expect(take.length).toBeGreaterThan(3000);
    expect(defs.get("declutter_take_item")?.file).toMatch(/20261112023602_declutter_reserved_notice_says_who_accepted\.sql$/);
  });

  it("who accepted comes from the offer's accept event", () => {
    expect(take).toContain("SELECT e.actor_side INTO v_accepted_by FROM public.declutter_offer_events e WHERE e.offer_id = p_offer_id AND e.action = 'accept' ORDER BY e.created_at DESC LIMIT 1;");
  });

  it("the buyer who accepted reads 'You accepted ...'; the seller reads '<buyer> accepted your price'", () => {
    expect(take).toContain("CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN format('You accepted %s %s price for \"%s\".");
    expect(take).toContain("CASE WHEN p_offer_id IS NOT NULL AND v_accepted_by = 'buyer' THEN format('%s accepted your %s price for \"%s\". They have 24 hours to check out and pay.");
    expect(take).toContain("CASE WHEN v_seller_anon THEN 'the seller''s'");
  });
});
