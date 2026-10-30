/**
 * A giver who cancels a FREE claim gets no strike, and the item goes back up (owner 2026-10-30 pop-up answer:
 * "no strike for a giver who cancels a free claim"; migration 20261030132149, Builder 100).
 *
 * declutter_seller_cancel_sale gave a strike for ANY unpaid line. Now its free branch (line price_cents = 0)
 * returns the unchanged strike count without ever calling declutter_give_strike, puts the item back live (or takes
 * it down when the seller is out of Declutter), and tells the person who claimed it. A paid line keeps its strike.
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterFreeClaimCancelNoStrike.pglite.mjs (3x; 8 FAIL without the migration).
 */
// @mutate supabase/migrations/20261030132149_declutter_free_claim_cancel_no_strike.sql |   IF v_line.price_cents = 0 THEN |   IF v_line.price_cents = -1 THEN
// @mutate supabase/migrations/20261030132149_declutter_free_claim_cancel_no_strike.sql |     RETURN public.declutter_active_strike_count(v_uid); |     RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id, 'x', v_line.id);
// @mutate supabase/migrations/20261030132149_declutter_free_claim_cancel_no_strike.sql |       UPDATE public.declutter_items SET status = 'live', updated_at = now() |       UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
// @mutate supabase/migrations/20261030132149_declutter_free_claim_cancel_no_strike.sql | , so it went back up. Nothing was charged | . Nothing was charged
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const def = DEFS.get("declutter_seller_cancel_sale");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

/** The free branch: from its IF to the RETURN that ends it. */
function freeBranch(): string {
  const start = flat.indexOf("IF v_line.price_cents = 0 THEN");
  if (start < 0) return "";
  const ret = flat.indexOf("RETURN ", start);
  return ret < 0 ? "" : flat.slice(start, flat.indexOf(";", ret) + 1);
}

describe("Declutter: cancelling a free claim gives no strike and puts it back up", () => {
  it("reads the newest definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(2500);
    expect(def?.file).toMatch(/20261030132149_declutter_free_claim_cancel_no_strike\.sql$/);
  });

  it("a free line returns before any strike, with the unchanged count", () => {
    const branch = freeBranch();
    expect(branch.length).toBeGreaterThan(300);
    expect(branch).not.toContain("declutter_give_strike");
    expect(branch).toMatch(/RETURN public\.declutter_active_strike_count\(v_uid\);$/);
    // The free branch sits after the paid-line refusal and before the paid strike.
    expect(flat.indexOf("RAISE EXCEPTION 'sale_already_paid'")).toBeLessThan(flat.indexOf("IF v_line.price_cents = 0 THEN"));
    expect(flat.indexOf("IF v_line.price_cents = 0 THEN")).toBeLessThan(flat.indexOf("RETURN public.declutter_give_strike("));
  });

  it("the item goes back up unless the giver is out, and the claimer is told", () => {
    const branch = freeBranch();
    expect(branch).toContain("IF public.declutter_seller_out(v_uid) THEN UPDATE public.declutter_items SET status = 'withdrawn'");
    expect(branch).toContain("ELSE UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id AND status = 'reserved';");
    expect(branch).toContain(`format('The giver cancelled your claim on "%s", so it went back up. Nothing was charged and you get no strike.', v_item.title)`);
  });

  it("a paid line still takes the strike", () => {
    const after = flat.slice(flat.indexOf(freeBranch()) + freeBranch().length);
    expect(after).toContain("RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,");
    expect(after).toContain("UPDATE public.declutter_items SET status = 'withdrawn'");
  });
});
