/**
 * Lead decision 11-11 ~8:00 PM (migration 20261112022921): on an offer answering a Wanted post, the buyer's "Reserved for
 * you" notice from declutter_take_item names the seller again ("Sam S. accepted ..."), matching My Wanted
 * (declutter_my_wanted.seller_name). The block/ban hiding from 20261112010200 stays: across a block or a ban
 * (declutter_names_hidden) neither take_item notice names the other member. Replaces
 * declutterWantedReservedNoticeAnonymous.test.ts (the Wanted half of that rule was reversed).
 *
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterWantedReservedNoticeNamesSeller.pglite.mjs
 * (3x; 1 FAIL without the migration; 3 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |                CASE WHEN v_seller_anon THEN 'The seller'\n | CASE WHEN false THEN 'The seller'\n
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |     v_seller_anon := public.declutter_names_hidden(p_buyer, v_seller);\n |     v_seller_anon := false;\n
// @mutate supabase/migrations/20261112023602_declutter_reserved_notice_says_who_accepted.sql |        AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN\n |        THEN\n
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const take = blankSqlComments(defs.get("declutter_take_item")?.stmt ?? "").replace(/\s+/g, " ");

describe("take_item: the buyer's reserved notice names the seller unless a block or a ban hides them", () => {
  it("reads the newest definition (floor)", () => {
    expect(take.length).toBeGreaterThan(3000);
    expect(defs.get("declutter_take_item")?.file).toMatch(/20261112023602_declutter_reserved_notice_says_who_accepted\.sql$/);
  });

  it("only a block or a ban -> 'The seller' (a Wanted thread is named, as My Wanted shows it)", () => {
    expect(take).toContain("v_seller_anon := public.declutter_names_hidden(p_buyer, v_seller);");
    expect(take).not.toMatch(/v_seller_anon := \([^;]*wanted_id/);
    expect(take).toContain("CASE WHEN v_seller_anon THEN 'The seller' ELSE COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller') END");
    // The seller's name is read in exactly two places (offer accepted by the seller / by the buyer, 20261112023602),
    // each behind v_seller_anon.
    expect(take.match(/WHERE p\.user_id = v_seller\)/g)?.length).toBe(2);
    expect(take.match(/CASE WHEN v_seller_anon THEN/g)?.length).toBe(2);
  });

  it("the seller's notice: no buyer name on a Wanted thread or across a block or a ban", () => {
    expect(take).toContain("AND NOT public.declutter_names_hidden(p_buyer, v_seller) THEN SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer");
    expect(take).toContain("wo.wanted_id IS NOT NULL)) AND NOT public.declutter_names_hidden");
  });
});
