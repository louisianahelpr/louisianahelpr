/**
 * Q2419 The Declutter Free section (lead decisions 2026-10-27, for the launch on 2026-10-28).
 *
 * A seller lists an item free ($0 price and floor: no offers, drops or price hint); a buyer claims it
 * with "Get it free" (no card, 48 hours, at most 3 open free claims); an all-free cart never opens a
 * payment page (no buyer's fee, no setup fee, no payout row, no payout-setup prompt) and is picked up
 * only (porch or the giver's door); a mixed cart checks out as usual with the fee on the paid lines.
 * A free claim is never money owed, so it never opens payout setup.
 *
 * Behaviour: src/test/pglite/declutterFreeSection.pglite.mjs (67 PASS with 20261027170717 applied 3x
 * on prod's bodies; the migration absent, it fails at once; with the payout_setup_hire_allowed free line
 * planted out, "the giver may NOT open a payout account" FAILs). This guard pins the newest definitions
 * and the screens that carry it.
 *
 * @mutate supabase/migrations/20261031164337_declutter_door_pickup_uses_places.sql |   IF v_items = 0 THEN\n    RAISE EXCEPTION 'free_order' |   IF false THEN\n    RAISE EXCEPTION 'free_order'
 * @mutate supabase/migrations/20261030064021_declutter_free_requests.sql |   IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN |   IF false THEN
 * @mutate supabase/migrations/20261031211922_free_claim_fee_then_id_restated.sql |   IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN |   IF p_handover IS NULL THEN
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   IF o.paid_with = 'free' THEN\n    PERFORM public.declutter_notify(o.seller_id | IF false THEN\n    PERFORM public.declutter_notify(o.seller_id
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |   IF v_item.o_price_cents = 0 THEN | IF false THEN
 * @mutate supabase/migrations/20261031214749_seller_setup_fee_from_payout_restated.sql |     IF NEW.current_price_cents = 0 THEN | IF false THEN
 * @mutate src/components/declutter/DeclutterItemView.tsx | (free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} askSignal={offerAsk} />) | <OfferPanel item={it} userId={user.id} askSignal={offerAsk} />
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |               {allFree ? ( |               {false ? (
 * @mutate src/lib/declutter/distance.ts |   return cents === 0 ? "Free" : formatPrice(cents); |   return formatPrice(cents);
 * @mutate src/lib/declutter/browseFilters.ts |     if (f.freeOnly && item.current_price_cents !== 0) return false; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { NO_FILTERS, applyBrowseFilters, browseStateFromParams } from "@/lib/declutter/browseFilters";

const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");
const FILE = "20261027170717";

describe("the Declutter Free section", () => {
  it("reads the newest definitions (floor)", () => {
    // declutter_start_checkout: restated again by Q2425 (20261027204500) with the free_order rule kept (asserted below).
    // declutter_take_item: restated by the notice copy (20261028171944) with the free claim kept (asserted below).
    // DA-12 (20261030063015): then the free claim notice without the strike threat (free claim kept); DB-5
    // (20261030064929): then the Buy now notice without it (free claim kept).
    expect(newestFunction("declutter_take_item").file).toContain("20261030064929_declutter_buy_now_no_strike.sql");
    // declutter_checkout_free: restated by #26 (20261028204431, its notice line), #37 (20261028223036, its seller link)
    // and the ways the giver ticked (20261028235247_declutter_handover_choices.sql: handover_not_offered).
    // Then D-NEW14 porch places (20261030164712: porch_place_needed and the frozen place, insertion only).
    // Then LEAD-PLACE-TIMES (20261031164337: a door pickup reads the place too, one condition).
    // Then LEAD-B49-REBUILD (20261031211922: the free-claim gate, restated from 20261031164337).
    expect(newestFunction("declutter_checkout_free").file).toContain("20261031211922_free_claim_fee_then_id_restated.sql");
    // declutter_complete_handover: restated by A3-8 (20261028210552) with only its notice lines naming the item
    // and #37 (20261028223036_declutter_notice_links_open_the_right_tab.sql, the seller's link); the free branch's no-payout rule is asserted below.
    // 20261028232338: then the damage path's "Enjoy your item" skip (the free branch is untouched).
    // Then LEAD-B49-REBUILD (20261031214749: the seller's setup-fee notice line, restated from 20261028232338).
    // Then BUY-36 (20261031231150: B49's body plus the buyer-collects case, reconciled in train 6).
    expect(newestFunction("declutter_complete_handover").file).toContain("20261031231150_helpr_delivery_cant_finish.sql");
    // declutter_claim_free: the Free change (20261030064021, Q2487) made it ask through declutter_request_free (asserted below).
    expect(newestFunction("declutter_claim_free").file).toContain("20261030064021_declutter_free_requests.sql");
    // declutter_close_paid_order: LEAD-ADMIN-HELPR-FAULT (20261101000817) restated its effective body plus the
    // helpr_fault refund (train 6); the free branch below still reads that newest definition.
    expect(newestFunction("declutter_close_paid_order").file).toContain("20261101000817_declutter_admin_helpr_fault.sql");
    const names = ["declutter_free_rules",
      "declutter_buy_now",
      "declutter_update_draft", "payout_setup_hire_allowed"];
    for (const n of names) expect(newestFunction(n).file, n).toContain(FILE);
    expect(names.length).toBeGreaterThan(3);
    // declutter_setup_fee_before_list: LEAD-B49-REBUILD (20261031214749) restated it from 20261027170717 with one early
    // return while the ID check is on (the fee then comes out of the payout); the free rule is asserted below.
    expect(newestFunction("declutter_setup_fee_before_list").file).toContain("20261031214749_seller_setup_fee_from_payout_restated.sql");
    // declutter_create_item: LEAD-POST-SLOW (20261031160546) moved its body into declutter_create_item_with_id (the app
    // picks the id so photos upload before Post); the wrapper keeps its gates. The free rule moved with the body.
    expect(newestFunction("declutter_create_item").file).toContain("20261031160546_declutter_create_item_with_id.sql");
    expect(newestFunction("declutter_create_item_with_id").file).toContain("20261031160546_declutter_create_item_with_id.sql");
    expect(code("declutter_create_item")).toContain("RETURN public.declutter_create_item_with_id(");
    expect(code("declutter_create_item_with_id")).toContain("IF p_price_cents = 0 THEN");
    // declutter_orders_fee_rule_f1: restated by shipping S2 (20261030000030_shipping_s2_ship_handover.sql: 'ship' -> 'f1_ship') with the free rule kept.
    expect(newestFunction("declutter_orders_fee_rule_f1").file).toContain("20261030000030_shipping_s2_ship_handover.sql");
    expect(code("declutter_orders_fee_rule_f1")).toContain("NEW.fee_rule := CASE WHEN NEW.paid_with = 'free' THEN 'free'");
  });

  it("listing a free item never charges the one-time setup fee; a paid listing still does (owner 2026-10-27)", () => {
    const gate = code("declutter_setup_fee_before_list");
    const freeAt = gate.indexOf("IF NEW.current_price_cents = 0 THEN RETURN NEW; END IF;");
    expect(freeAt).toBeGreaterThan(0);
    expect(freeAt).toBeLessThan(gate.indexOf("IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN RAISE EXCEPTION 'setup_fee_required_to_list'"));
  });

  it("free items are asked for (nothing charged), at most 3 at a time; the picked person gets the 48 hours; a free item is never bought", () => {
    // The Free change (Q2487): the old claim asks; the ask keeps the claim's gates and cap; only the giver's pick reserves.
    expect(code("declutter_claim_free")).toContain("RETURN public.declutter_request_free(p_item_id)");
    const ask = code("declutter_request_free");
    expect(ask).toContain("PERFORM public.require_feature('declutter')");
    expect(ask).toContain("pg_advisory_xact_lock(hashtextextended('declutter_free_claims:' || v_uid::text, 0))");
    expect(ask).toContain("IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN");
    expect(code("declutter_pick_free_request")).toContain("public.declutter_take_item(v_item.id, v_req.requester_id, 0, 'buy', NULL)");
    expect(code("declutter_free_rules")).toContain("'max_open_claims', 3");
    expect(code("declutter_buy_now")).toContain("IF v_item.o_price_cents = 0 THEN RAISE EXCEPTION 'free_item_claim_it'");
  });

  it("an all-free cart never opens a payment page and is picked up only; no payout for a free order", () => {
    expect(code("declutter_start_checkout")).toContain("IF v_items = 0 THEN RAISE EXCEPTION 'free_order'");
    const free = code("declutter_checkout_free");
    expect(free).toContain("IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN");
    expect(free).toContain("VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')");
    expect(free).not.toMatch(/SET [^;]*stripe_(checkout_session|payment_intent)_id/);
    const done = code("declutter_complete_handover");
    const freeAt = done.indexOf("IF o.paid_with = 'free' THEN");
    expect(freeAt).toBeGreaterThan(0);
    expect(freeAt).toBeLessThan(done.indexOf("INSERT INTO public.declutter_payouts"));
    expect(code("payout_setup_hire_allowed")).toContain("AND o.paid_with <> 'free'");
  });

  it("the screens: Free on every price, Ask for it instead of Buy or offer, a free cart without a payment page", () => {
    expect(itemPriceLabel(0)).toBe("Free");
    expect(itemPriceLabel(4050)).toBe("$40.50");
    const view = read("src/components/declutter/DeclutterItemView.tsx");
    expect(view).toContain("(free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} askSignal={offerAsk} />)");
    expect(view).toContain("{!free && user && <PriceHint");
    const cart = read("src/components/declutter/DeclutterTradeViews.tsx");
    expect(cart).toContain("const allFree = lines.every((l) => l.price_cents === 0);");
    expect(cart).toContain("{allFree ? ( <FreeCheckoutForSeller");
    const freeUi = read("src/components/declutter/DeclutterFreeClaim.tsx");
    expect(freeUi).toContain('(porchOk ? (["porch", "pickup_home"] as FreeHandover[]) : (["pickup_home"] as FreeHandover[])).filter((h) => wayAllowed(ways, h))');
    expect(freeUi).not.toMatch(/delivery"|seller_delivery/);
    // The sell flow's state and server calls (a new listing's one screen and a draft's steps share them).
    const sell = read("src/components/declutter/useSellFlowState.ts");
    expect(sell).toContain("priceCents: form.free ? 0 : dollarsToCents(form.price)!");
  });

  it("Browse's Free chip keeps only free items, and /declutter?free=1 opens with it on", () => {
    const row = (id: string, cents: number) => ({
      item: { id, title: id, status: "live", category: "other", condition_stars: 3, current_price_cents: cents, porch_ok: true,
        live_at: null, created_at: "2026-10-27T00:00:00Z" },
      miles: null,
    });
    const kept = applyBrowseFilters([row("free", 0), row("paid", 2000)], { ...NO_FILTERS, freeOnly: true }, "", undefined);
    expect(kept.map((r) => r.item.id)).toEqual(["free"]);
    expect(browseStateFromParams(new URLSearchParams("free=1")).filters.freeOnly).toBe(true);
  });
});
