/**
 * BUY-11 (buying audit 10-30 #11): a seller's change to condition, size or the ways to get an item was a "small" edit
 * that told nobody, so a buyer's offer could stand on a 5-star item now listed at 1 star, a size (delivery price) that
 * changed, or a porch pickup that was taken away. Only title, description and category told offer holders.
 *
 * Reads the NEWEST declutter_edit_listing (effectiveDefs replays every migration, any dollar-quote tag) and pins: the
 * three facts are compared against the stored row; on a small edit with any of them changed, every open-offer buyer
 * gets "Listing updated" naming what changed, before the item is returned live; the big edit's notice is unchanged.
 * Backend proof: src/test/pglite/declutterEditTellsOfferHolders.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031083708_declutter_edit_tells_offer_holders_what_matters.sql |     CASE WHEN v_item.condition_stars IS DISTINCT FROM p_condition_stars THEN 'condition' END, |     NULL,
 * @mutate supabase/migrations/20261031083708_declutter_edit_tells_offer_holders_what_matters.sql |     CASE WHEN v_item.handovers IS DISTINCT FROM v_ways THEN 'ways to get it' END], NULL); |     NULL], NULL);
 * @mutate supabase/migrations/20261031083708_declutter_edit_tells_offer_holders_what_matters.sql |     IF cardinality(v_changed) > 0 THEN |     IF false THEN
 * @mutate supabase/migrations/20261031083708_declutter_edit_tells_offer_holders_what_matters.sql |          WHERE o.item_id = p_item_id AND o.status = 'open'\n      LOOP\n        PERFORM | WHERE o.item_id = p_item_id\n      LOOP\n        PERFORM
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const fn = blankSqlComments(DEFS.get("declutter_edit_listing")?.stmt ?? "").replace(/\s+/g, " ");

describe("Offer holders are told when condition, size or ways change (BUY-11)", () => {
  it("reads the newest definition (floor)", () => {
    expect(fn.length).toBeGreaterThan(2000);
    expect(fn).toContain("CREATE OR REPLACE FUNCTION public.declutter_edit_listing(");
  });

  it("each of the three facts is compared with the stored row", () => {
    expect(fn).toContain("CASE WHEN v_item.condition_stars IS DISTINCT FROM p_condition_stars THEN 'condition' END");
    expect(fn).toContain("CASE WHEN v_item.delivery_size IS DISTINCT FROM p_delivery_size THEN 'size' END");
    expect(fn).toContain("CASE WHEN v_item.handovers IS DISTINCT FROM v_ways THEN 'ways to get it' END");
  });

  it("a small edit that changed any of them tells every open-offer buyer, then stays live", () => {
    const small = fn.slice(fn.indexOf("IF NOT v_big THEN"), fn.indexOf("RETURN 'live';"));
    expect(small).toContain("IF cardinality(v_changed) > 0 THEN");
    expect(small).toContain("WHERE o.item_id = p_item_id AND o.status = 'open' LOOP");
    expect(small).toMatch(/declutter_notify\(r\.buyer_id, 'declutter_offers', 'Listing updated', format\('The seller changed the %s on "%s"\. Check it before your offer is answered\.'/);
    expect(small).toContain("'/declutter/item/' || p_item_id::text");
  });

  it("the big edit's notice and re-check are unchanged", () => {
    expect(fn).toContain("format('The seller updated \"%s\". Check it before your offer is answered.', v_title)");
    expect(fn).toContain("SET status = 'pending_review', submitted_at = now(), updated_at = now()");
  });
});
