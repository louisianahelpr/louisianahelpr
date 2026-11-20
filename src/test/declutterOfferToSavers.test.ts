/**
 * Declutter top 5 #1 (owner 11-19, "Do all 5"): one-tap offer to the people who saved a listing.
 *
 * Behaviour on a real database: src/test/pglite/declutterOfferToSavers.pglite.mjs (28 PASS applied 3x;
 * NEW_MIGRATION=skip RED; a planted body without the block check 6 FAIL). This file pins the rules that matter in the
 * NEWEST definition, so a later restatement cannot drop them silently, and the client's sums and card label.
 *
 * @mutate supabase/migrations/20261120010630_declutter_offer_to_savers.sql |        AND NOT public.are_users_blocked(w.user_id, v_uid)\n |
 * @mutate supabase/migrations/20261120010630_declutter_offer_to_savers.sql |   IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN | IF false THEN
 * @mutate supabase/migrations/20261120010630_declutter_offer_to_savers.sql |        AND (NOT v_test_seller\n | AND (true\n
 * @mutate supabase/migrations/20261120010630_declutter_offer_to_savers.sql |   IF v_floor IS NOT NULL AND v_amount < v_floor THEN | IF false THEN
 * @mutate src/lib/declutter/sellerTools.ts |   return o.my_side === "buyer" && o.awaiting === "buyer" && o.counter_count === 0 && o.from_wanted !== true; |   return o.my_side === "buyer" && o.awaiting === "buyer";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";
import { isSaverOffer, saverOfferAllowed, saverOfferCents, SAVER_OFFER_PERCENTS } from "@/lib/declutter/sellerTools";

const FILE = "supabase/migrations/20261120010630_declutter_offer_to_savers.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("Declutter top 5 #1: offer to savers (server)", () => {
  const b = flat(newestFunction("declutter_send_saver_offer").body);

  it("reads the newest definition (this migration)", () => {
    expect(newestFunction("declutter_send_saver_offer").file).toContain("20261120010630");
  });

  it("only the seller's own live visible listing, by a member who is not banned", () => {
    for (const part of [
      "PERFORM public.require_feature('declutter');",
      "IF public.is_caller_banned() THEN",
      "v_uid := public.declutter_assert_member(true);",
      "WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;",
      "IF v_item.status <> 'live' OR v_item.seller_hidden THEN",
    ]) expect(b, part).toContain(part);
  });

  it("the price: below today's, at least $1 and half, never below the seller's lowest; one send per item per 24 hours", () => {
    for (const part of [
      "IF v_amount < 100 OR v_amount >= v_item.current_price_cents THEN",
      "IF v_amount * 2 < v_item.current_price_cents THEN",
      "IF v_floor IS NOT NULL AND v_amount < v_floor THEN",
      "IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN",
    ]) expect(b, part).toContain(part);
  });

  it("who gets it: savers without an open offer, no block, still in Declutter; test data only to test people", () => {
    for (const part of [
      "FROM public.declutter_watchlist w",
      "AND w.user_id <> v_uid",
      "WHERE o.item_id = p_item_id AND o.buyer_id = w.user_id AND o.status = 'open')",
      "AND NOT public.are_users_blocked(w.user_id, v_uid)",
      "AND NOT public.declutter_member_out(w.user_id)",
      "AND public.feature_enabled_for_user('declutter', w.user_id)",
      "AND (NOT v_test_seller OR COALESCE(wp.is_seed, false) OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = w.user_id))",
      "LIMIT 200",
    ]) expect(b, part).toContain(part);
    expect(b).toContain("v_test_seller := v_item.is_seed OR COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = v_uid), false) OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v_uid);");
  });

  it("each saver's thread waits on them as an ordinary offer, and the notice is the Offers kind (their switches)", () => {
    expect(b).toContain("VALUES (p_item_id, r.user_id, v_uid, v_amount, 'buyer', now() + interval '48 hours', 0, v_send)");
    expect(b).toContain("VALUES (v_offer, 'seller', 'offer', v_amount);");
    expect(b).toContain("PERFORM public.declutter_notice_ref(v_offer);");
    expect(b).toContain("PERFORM public.declutter_notify(r.user_id, 'declutter_offers', 'Offer on an item you saved',");
  });

  it("grants: members only; the send log is RLS, seller reads own, unconfirmed-email gate attached", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_send_saver_offer(uuid, integer, integer) FROM PUBLIC, anon;");
    expect(sql).toContain("ALTER TABLE public.declutter_saver_offer_sends ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("USING (seller_id = (SELECT auth.uid()));");
    expect(sql).toContain("PERFORM public.attach_unconfirmed_email_gate();");
  });
});

describe("Declutter top 5 #1: offer to savers (client)", () => {
  it("the sheet's price is the server's sum", () => {
    expect(SAVER_OFFER_PERCENTS).toEqual([10, 15, 20]);
    expect(saverOfferCents(2000, 15)).toBe(1700);
    expect(saverOfferCents(1999, 10)).toBe(1799);
    expect(saverOfferAllowed(2000, 15, null)).toBe(true);
    expect(saverOfferAllowed(2000, 15, 1800)).toBe(false); // below the seller's lowest
    expect(saverOfferAllowed(150, 10, null)).toBe(false); // too cheap to discount
  });

  it("the buyer's card names only a seller-started, unanswered thread as the seller's offer", () => {
    expect(isSaverOffer({ my_side: "buyer", awaiting: "buyer", counter_count: 0, from_wanted: false })).toBe(true);
    expect(isSaverOffer({ my_side: "buyer", awaiting: "buyer", counter_count: 1, from_wanted: false })).toBe(false); // a counter
    expect(isSaverOffer({ my_side: "buyer", awaiting: "buyer", counter_count: 1, from_wanted: true })).toBe(false); // Wanted reply
    expect(isSaverOffer({ my_side: "buyer", awaiting: "seller", counter_count: 0, from_wanted: false })).toBe(false); // their own offer
    expect(isSaverOffer({ my_side: "seller", awaiting: "buyer", counter_count: 0, from_wanted: false })).toBe(false);
  });
});
