/**
 * The seller's "Cancel sale" words (audit 1028 part 2, D2-16 and D2-10; migration 20261029225235).
 *
 * D2-16: declutter_seller_cancel_sale only ever ends an UNPAID sale (a paid line raises sale_already_paid), yet it
 * told the buyer "If you already paid, every cent comes back to your card". It now says "Nothing was charged."
 * D2-10: the strike said "after accepting it" on a Buy now, where the seller accepted nothing; the words now follow
 * the cart line's source. The confirm sheet says the listing comes down too (relist it from History).
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterSellerCancelWords.pglite.mjs (3x; 4 FAIL without the migration).
 */
// @mutate supabase/migrations/20261029225235_declutter_seller_cancel_words.sql | Nothing was charged.', v_item.title) | If you already paid, every cent comes back to your card.', v_item.title)
// @mutate supabase/migrations/20261029225235_declutter_seller_cancel_words.sql |     CASE WHEN v_line.source = 'offer' |     CASE WHEN true
// @mutate src/components/declutter/DeclutterSalesWaiting.tsx | Your listing comes down too; relist it from History. |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const def = DEFS.get("declutter_seller_cancel_sale");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
const sheet = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterSalesWaiting.tsx"), "utf8")).replace(/\s+/g, " ");

describe("Declutter seller cancel: the words match what happened", () => {
  it("reads the newest definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(1500);
    expect(def?.file).toMatch(/20261029225235_declutter_seller_cancel_words\.sql$/);
  });

  it("D2-16: the cancel refuses a paid sale, so the buyer is told nothing was charged", () => {
    expect(flat).toContain("IF v_line.status = 'paid' THEN RAISE EXCEPTION 'sale_already_paid'");
    expect(flat).toContain(`format('The seller cancelled the sale of "%s". Nothing was charged.', v_item.title)`);
    expect(flat).not.toMatch(/already paid, every cent/);
  });

  it("D2-10: \"after accepting it\" only when the seller accepted an offer", () => {
    expect(flat).toContain(
      `CASE WHEN v_line.source = 'offer' THEN format('You cancelled the sale of "%s" after accepting it.', v_item.title) ` +
      `ELSE format('You cancelled the sale of "%s".', v_item.title) END, v_line.id);`,
    );
  });

  it("D2-10: the confirm sheet says the listing comes down too", () => {
    expect(sheet).toContain("Your listing comes down too; relist it from History.");
  });
});
