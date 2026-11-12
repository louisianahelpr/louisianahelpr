/**
 * Whole-app audit 11-10 F359m (migration 20261111191033): when the buyer said no to the seller's counter, the seller's
 * notice read "Your offer on ... was declined. Nothing was charged." The seller made no offer and is never charged. The
 * seller now reads "The buyer said no to your $X price on "<title>". Your listing is still up." (the last sentence only
 * while the item is live); a seller declining the buyer's offer still tells the buyer the old words.
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterSellerCounterDeclinedWords.pglite.mjs (3x; 3 FAIL without the migration).
 */
// @mutate supabase/migrations/20261112003050_declutter_offer_notices_name_the_buyer.sql |       CASE WHEN v_side = 'buyer'\n        THEN | CASE WHEN false\n        THEN
// @mutate supabase/migrations/20261112003050_declutter_offer_notices_name_the_buyer.sql | CASE WHEN v_item.status = 'live' THEN ' Your listing is still up.' ELSE '' END | ' Your listing is still up.'
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const def = effectiveDefs(resolve(__dirname, "../../supabase/migrations")).get("declutter_respond_offer");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

describe("F359m: the seller's words when the buyer says no to their price", () => {
  it("reads the newest definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(3000);
    // 20261112003050 (F356 follow-up) restates it with the buyer's name; the words below are unchanged in shape.
    expect(def?.file).toMatch(/20261112003050_declutter_offer_notices_name_the_buyer\.sql$/);
  });

  it("a buyer's no tells the seller what happened; a seller's no keeps the buyer's words", () => {
    const decline = flat.slice(flat.indexOf("IF p_action = 'decline' THEN"), flat.indexOf("RETURN 'declined';"));
    expect(decline.length).toBeGreaterThan(200);
    // F356 follow-up (20261112003050): "Ann S. said no ...", "The buyer" when there is no name or on a Wanted reply.
    expect(decline).toContain("CASE WHEN v_side = 'buyer' THEN format('%s said no to your $%s price on \"%s\".%s', COALESCE(v_buyer, 'The buyer'),");
    expect(decline).toContain("CASE WHEN v_item.status = 'live' THEN ' Your listing is still up.' ELSE '' END");
    expect(decline).toContain(`ELSE format('Your offer on "%s" was declined. Nothing was charged.', v_item.title) END`);
    // The title (and so the notice type) is unchanged.
    expect(decline).toContain("PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',");
  });
});
