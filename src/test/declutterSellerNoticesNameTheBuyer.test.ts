/**
 * F356 follow-up part 2 (owner 11-11 "everywhere", migration 20261112004748): the seller's bundle-request, offer-expired
 * and take_item ("Someone claimed" / "Someone's buying") notices name the buyer as first name + last initial through
 * member_display_name; the old words without a name; a Wanted thread stays anonymous.
 *
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/declutterSellerNoticesNameTheBuyer.pglite.mjs (3x;
 * 6 FAIL without the migration).
 */
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql | CASE WHEN o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id)\n           THEN (SELECT | CASE WHEN NOT public.declutter_names_hidden(o.buyer_id, o.seller_id)\n           THEN (SELECT
// @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql |     IF p_offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL) THEN |     IF true THEN
// @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql |           COALESCE(v_buyer, 'A buyer'), cardinality(v_ids) |           v_buyer, cardinality(v_ids)
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const FILE = /20261112004748_declutter_seller_notices_name_the_buyer\.sql$/;

describe("F356 follow-up part 2: more seller notices name the buyer", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of ["declutter_request_bundle", "declutter_deadline_sweep", "declutter_take_item"]) {
      expect(flat(fn).length).toBeGreaterThan(2000);
    }
    expect(defs.get("declutter_request_bundle")?.file).toMatch(FILE);
    expect(defs.get("declutter_take_item")?.file).toMatch(FILE);
    // Restated with the block/ban rule (20261112010100).
    expect(defs.get("declutter_deadline_sweep")?.file).toMatch(/20261112010100_declutter_names_hidden_across_block_or_ban\.sql$/);
  });

  it("bundle request", () => {
    const b = flat("declutter_request_bundle");
    expect(b).toContain("SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;");
    expect(b).toContain("format('%s wants %s of your items ($%s in all). Accept all or pick some within 48 hours.', COALESCE(v_buyer, 'A buyer'),");
  });

  it("offer expired: named, never on a Wanted thread", () => {
    const s = flat("declutter_deadline_sweep");
    expect(s).toContain("CASE WHEN o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN (SELECT public.member_display_name(bp.full_name, NULL) FROM public.profiles bp WHERE bp.user_id = o.buyer_id) END AS buyer_name");
    expect(s).toContain(`format('You did not answer %s''s offer on "%s" within 48 hours, so it closed.', r.buyer_name, r.title)`);
    expect(s).toContain(`format('%s did not answer your counteroffer on "%s" within 48 hours, so it closed.', COALESCE(r.buyer_name, 'The buyer'), r.title)`);
  });

  it("take_item: claimed and buying, never on a Wanted thread, titles unchanged", () => {
    const t = flat("declutter_take_item");
    expect(t).toContain("IF p_offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL) THEN SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer");
    expect(t).toContain(`THEN format('%s claimed "%s". They have 48 hours to choose a pickup.', v_buyer, v_title)`);
    expect(t).toContain("COALESCE(v_buyer, 'Someone'), v_title, v_price)");
    expect(t).toContain("v_title, COALESCE(v_buyer, 'the buyer'), v_price)");
    expect(t.match(/'Someone''s buying your item'/g)?.length).toBe(2);
    expect(t).toContain("'Someone claimed your free item'");
  });
});
