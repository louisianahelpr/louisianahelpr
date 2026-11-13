/**
 * b1e/b1f review follow-up (migration 20261112052501): no name across a block or a ban (declutter_names_hidden) in
 * declutter_my_wanted (a reply's seller_name -> "A neighbor"), declutter_listed_for_me (helpr_first_name -> '', the card
 * says "Your Helpr") and the shop's view of a buyer in shops_my_talks / shops_talk_view ("A shopper").
 * declutter_wanted_browse needs no change: a banned poster's row is dropped by declutter_member_out (same ban clause).
 *
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/namesHiddenWantedListedShopTalk.pglite.mjs
 * (3x; 8 FAIL without the migration; 5 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112052501_names_hidden_wanted_listed_shop_talk.sql | 'seller_name', CASE WHEN public.declutter_names_hidden(v_uid, o.seller_id) THEN | 'seller_name', CASE WHEN false THEN
// @mutate supabase/migrations/20261112052501_names_hidden_wanted_listed_shop_talk.sql | CASE WHEN public.declutter_names_hidden(l.seller_id, l.helpr_id) THEN '' | CASE WHEN false THEN ''
// @mutate supabase/migrations/20261112052501_names_hidden_wanted_listed_shop_talk.sql |                     WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'\n                    ELSE |                     WHEN false THEN 'A shopper'\n                    ELSE
// @mutate supabase/migrations/20261112223654_shops_check_sweep_request_talk.sql |                         WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'\n                        ELSE |                         WHEN false THEN 'A shopper'\n                        ELSE
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = /20261112052501_names_hidden_wanted_listed_shop_talk\.sql$/;

describe("no name across a block or a ban: My Wanted, Listed for you, Shops chat", () => {
  it("reads the newest definitions (floor)", () => {
    // shops_talk_view was restated by S2-018/S2-026 (20261112223654: the closed-chat flag); the name rule below still reads it.
    const NEWER: Record<string, RegExp> = { shops_talk_view: /20261112223654_shops_check_sweep_request_talk\.sql$/ };
    for (const fn of ["declutter_my_wanted", "declutter_listed_for_me", "shops_my_talks", "shops_talk_view"]) {
      expect(defs.get(fn)?.file, fn).toMatch(NEWER[fn] ?? MIG);
      expect(body(fn).length, fn).toBeGreaterThan(600);
    }
  });

  it("My Wanted: a reply's seller name only behind declutter_names_hidden; a blocked seller's reply still left out", () => {
    const fn = body("declutter_my_wanted");
    expect(fn).toContain("'seller_name', CASE WHEN public.declutter_names_hidden(v_uid, o.seller_id) THEN 'A neighbor' ELSE public.member_display_name(sp.full_name) END,");
    expect(fn.match(/member_display_name\(/g)?.length).toBe(1);
    expect(fn).toContain("AND NOT public.are_users_blocked(v_uid, o.seller_id)");
  });

  it("Listed for you: the Helpr's first name only behind declutter_names_hidden", () => {
    const fn = body("declutter_listed_for_me");
    expect(fn).toContain("CASE WHEN public.declutter_names_hidden(l.seller_id, l.helpr_id) THEN '' ELSE split_part(COALESCE(p.full_name, ''), ' ', 1) END");
    expect(fn.match(/full_name/g)?.length).toBe(1);
  });

  it("Shops chat: the shop sees the buyer's first name only behind declutter_names_hidden", () => {
    for (const name of ["shops_my_talks", "shops_talk_view"]) {
      const fn = body(name);
      expect(fn, name).toMatch(/THEN s\.name WHEN public\.declutter_names_hidden\(s\.owner_id, t\.buyer_id\) THEN 'A shopper' ELSE COALESCE\(NULLIF\(split_part\(btrim\(\(SELECT p\.full_name/);
      expect(fn.match(/full_name/g)?.length, name).toBe(1);
    }
  });
});
