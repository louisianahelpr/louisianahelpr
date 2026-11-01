/**
 * Both "Offer expired" notices name the item (notifications audit E2-7; migration 20261030152217).
 *
 * The bug: declutter_deadline_sweep wrote "The seller did not answer your offer" with no hint which offer, for a member
 * who can have several open. Reads the EFFECTIVE sweep; the backend proof on a real database is
 * src/test/pglite/declutterOfferExpiredNamesItem.pglite.mjs (3x; red without the migration and on its planted defects).
 */
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id,\n      (SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title | RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id,\n      NULL::text AS title
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | format('The seller did not answer your offer on "%s" within 48 hours, so it closed. Nothing was charged.', r.title) | 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | format('You did not answer the counteroffer on "%s" within 48 hours, so it closed.', r.title) | 'You did not answer the counteroffer within 48 hours, so it closed.'
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | format('You did not answer an offer on "%s" within 48 hours, so it closed.', r.title) | 'You did not answer an offer within 48 hours, so it closed.'
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | format('The buyer did not answer your counteroffer on "%s" within 48 hours, so it closed.', r.title) | 'The buyer did not answer your counteroffer within 48 hours, so it closed.'
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const sweep = blankSqlComments(effectiveDefs(resolve(__dirname, "../../supabase/migrations")).get("declutter_deadline_sweep")?.stmt ?? "");
const offerLoop = sweep.slice(sweep.indexOf("UPDATE public.declutter_offers o"), sweep.indexOf("UPDATE public.declutter_cart_items c"));

describe("Offer expired notices name the item", () => {
  it("reads the sweep's offer loop", () => {
    expect(offerLoop.length).toBeGreaterThan(400);
    expect(offerLoop.match(/'Offer expired'/g)?.length).toBe(2);
  });
  it("the offer loop returns the item's title", () => {
    expect(offerLoop).toContain("SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id");
  });
  it.each([
    "The seller did not answer your offer on \"%s\" within 48 hours",
    "You did not answer the counteroffer on \"%s\" within 48 hours",
    "You did not answer an offer on \"%s\" within 48 hours",
    "The buyer did not answer your counteroffer on \"%s\" within 48 hours",
  ])("formats the title into: %s", (words) => {
    expect(offerLoop).toContain(`format('${words}`);
  });
  it("an offer whose item row is gone never reads as a blank", () => {
    expect(offerLoop.match(/CASE WHEN r\.title IS NULL THEN/g)?.length).toBe(2);
  });
});
