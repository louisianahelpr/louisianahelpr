/**
 * Shops audit 11-12 S052: each shop review row carries the buyer's short name ("First L.", as profile reviews), never
 * the reviewer's id. Reads the EFFECTIVE (newest) shops_shop_reviews; behaviour on a real database is
 * src/test/pglite/shopsReviewFirstName.pglite.mjs (3x; skip red; 5 of 6 planted defects red: the banned clause also sits in declutter_names_hidden; granting anon is an
 * equivalent mutant because the body refuses a caller with no uid).
 *
 * @mutate supabase/migrations/20261112201612_shops_review_first_name.sql | OR public.declutter_names_hidden(v_uid, x.reviewer_id) | OR false
 * @mutate supabase/migrations/20261112201612_shops_review_first_name.sql | AND rp.email_verified | AND true
 * @mutate supabase/migrations/20261112201612_shops_review_first_name.sql | r.created_at, r.reviewer_id FROM public.shop_reviews r | r.created_at, NULL::uuid AS reviewer_id FROM public.shop_reviews r
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("S052: shop reviews name the buyer as 'First L.'", () => {
  it("shops_shop_reviews returns reviewer_name from member_display_name and no reviewer id", () => {
    const b = flat("shops_shop_reviews");
    expect(b).toContain(
      "'reviewer_name', CASE WHEN x.reviewer_id IS NULL OR public.declutter_names_hidden(v_uid, x.reviewer_id) OR public.is_test_member(x.reviewer_id) THEN 'A neighbor' ELSE public.member_display_name(",
    );
    expect(b).toContain("AND rp.email_verified AND rp.ban_status IS DISTINCT FROM 'banned' AND rp.ban_status IS DISTINCT FROM 'temp_banned' AND rp.ban_status IS DISTINCT FROM 'permanently_banned' AND rp.anonymized_at IS NULL AND NOT public.declutter_member_out(rp.user_id) AND NOT COALESCE(public.member_under_18(rp.user_id), true)");
    expect(b).toContain("SELECT r.id, r.stars, r.comment, r.created_at, r.reviewer_id FROM public.shop_reviews r");
    expect(b).not.toMatch(/'reviewer_id'/);
    expect(b).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'");
  });
});
