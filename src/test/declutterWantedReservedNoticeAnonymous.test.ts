/**
 * b1d review follow-up (migration 20261112010200): the buyer's "Reserved for you" notice from declutter_take_item does not
 * name the seller on an offer answering a Wanted post (Wanted stays anonymous until the deal), and across a block or a
 * ban (declutter_names_hidden) neither take_item notice names the other member.
 *
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterWantedReservedNoticeAnonymous.pglite.mjs
 * (3x; 9 FAIL without the migration; 3 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql |                CASE WHEN v_seller_anon THEN 'The seller'\n | CASE WHEN false THEN 'The seller'\n
// @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql |                      OR public.declutter_names_hidden(p_buyer, v_seller);\n |                      OR false;\n
// @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql |        AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN\n |        THEN\n
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const take = blankSqlComments(defs.get("declutter_take_item")?.stmt ?? "").replace(/\s+/g, " ");

describe("take_item: the buyer's reserved notice keeps a Wanted seller anonymous", () => {
  it("reads the newest definition (floor)", () => {
    expect(take.length).toBeGreaterThan(3000);
    expect(defs.get("declutter_take_item")?.file).toMatch(/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous\.sql$/);
  });

  it("Wanted thread, block or ban -> 'The seller'", () => {
    expect(take).toContain(
      "v_seller_anon := (p_offer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL)) OR public.declutter_names_hidden(p_buyer, v_seller);",
    );
    expect(take).toContain("CASE WHEN v_seller_anon THEN 'The seller' ELSE COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller') END,");
    // The seller's name is read in exactly one place, behind v_seller_anon.
    expect(take.match(/WHERE p\.user_id = v_seller\)/g)?.length).toBe(1);
  });

  it("the seller's notice: no buyer name across a block or a ban", () => {
    expect(take).toContain("AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer");
  });
});
