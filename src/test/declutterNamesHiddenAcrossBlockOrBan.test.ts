/**
 * b1d review follow-up (migration 20261112010100): once either side blocks the other, or either member is banned, the
 * seller's offer and trade cards and the new offer notices (respond_offer, the deadline sweep) no longer name the other
 * member. One rule, public.declutter_names_hidden(a, b): a user_blocks row either way, or an active ban on either.
 *
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/declutterNamesHiddenAcrossBlockOrBan.pglite.mjs
 * (3x; 15 FAIL without the migration; 8 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql |                      OR (b.blocker_id = p_b AND b.blocked_id = p_a))\n | )\n
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql |                     AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')\n |                     AND false\n
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql |                AND NOT public.declutter_names_hidden(o.seller_id, o.buyer_id)\n | 
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql | SELECT s.id, CASE WHEN NOT public.declutter_names_hidden(s.buyer_id, s.seller_id) | SELECT s.id, CASE WHEN true
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql | GRANT EXECUTE ON FUNCTION public.declutter_names_hidden(uuid, uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.declutter_names_hidden(uuid, uuid) TO authenticated, service_role;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const defs = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const THIS = "20261112010100_declutter_names_hidden_across_block_or_ban.sql";
const mig = blankSqlComments(readFileSync(resolve(MIG, THIS), "utf8")).replace(/\s+/g, " ");
const CALL = "public.declutter_names_hidden(";

describe("Declutter names hidden across a block or a ban", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of ["declutter_my_offers", "declutter_my_trade_buyer_names", "declutter_respond_offer", "declutter_deadline_sweep", "declutter_names_hidden"]) {
      expect(flat(fn).length).toBeGreaterThan(300);
    }
    expect(flat("declutter_deadline_sweep").length).toBeGreaterThan(5000);
  });

  it("the rule: a block either way, or an active ban on either side", () => {
    const h = flat("declutter_names_hidden");
    expect(h).toContain("(b.blocker_id = p_a AND b.blocked_id = p_b) OR (b.blocker_id = p_b AND b.blocked_id = p_a)");
    expect(h).toContain("p.user_id IN (p_a, p_b) AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')");
    expect(h).toContain("OR p.auto_suspended_until > now()");
    expect(h).not.toMatch(/SECURITY DEFINER/i);
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_names_hidden(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.declutter_names_hidden(uuid, uuid) TO service_role;");
  });

  it("every card and notice that names the other member asks it", () => {
    expect(flat("declutter_my_offers")).toContain("AND bp.user_id IS NOT NULL AND NOT public.declutter_names_hidden(o.seller_id, o.buyer_id) THEN public.member_display_name(bp.full_name) END");
    expect(flat("declutter_my_trade_buyer_names")).toContain("CASE WHEN NOT public.declutter_names_hidden(s.buyer_id, s.seller_id) THEN public.member_display_name(bp.full_name, NULL) END::text");
    expect(flat("declutter_respond_offer")).toContain("IF o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer");
    expect(flat("declutter_deadline_sweep")).toContain("CASE WHEN o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN (SELECT public.member_display_name(bp.full_name, NULL)");
    for (const fn of ["declutter_my_offers", "declutter_my_trade_buyer_names", "declutter_respond_offer", "declutter_deadline_sweep"]) {
      expect(flat(fn).split(CALL).length - 1).toBe(1);
    }
  });
});
