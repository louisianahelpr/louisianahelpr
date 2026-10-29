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
 * @mutate supabase/migrations/20261029224749_declutter_porch_places.sql |   IF v_items = 0 THEN\n    RAISE EXCEPTION 'free_order' |   IF false THEN\n    RAISE EXCEPTION 'free_order'
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |   IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN |   IF false THEN
 * @mutate supabase/migrations/20261029224749_declutter_porch_places.sql |   IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN |   IF p_handover IS NULL THEN
 * @mutate supabase/migrations/20261028232338_declutter_damage_no_enjoy_notice.sql |   IF o.paid_with = 'free' THEN\n    PERFORM public.declutter_notify(o.seller_id | IF false THEN\n    PERFORM public.declutter_notify(o.seller_id
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |   IF v_item.o_price_cents = 0 THEN | IF false THEN
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |     IF NEW.current_price_cents = 0 THEN | IF false THEN
 * @mutate src/components/declutter/DeclutterItemView.tsx | (free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} />) | <OfferPanel item={it} userId={user.id} />
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
    expect(newestFunction("declutter_take_item").file).toContain("20261028171944_declutter_notice_copy.sql");
    // declutter_checkout_free: restated by #26 (20261028204431, its notice line), #37 (20261028223036, its seller link)
    // and the ways the giver ticked (20261028235247_declutter_handover_choices.sql: handover_not_offered).
    // Then D-NEW14 porch places (20261029224749: porch_place_needed and the frozen place, insertion only).
    expect(newestFunction("declutter_checkout_free").file).toContain("20261029224749_declutter_porch_places.sql");
    // declutter_complete_handover: restated by A3-8 (20261028210552) with only its notice lines naming the item
    // and #37 (20261028223036_declutter_notice_links_open_the_right_tab.sql, the seller's link); the free branch's no-payout rule is asserted below.
    // 20261028232338: then the damage path's "Enjoy your item" skip (the free branch is untouched).
    expect(newestFunction("declutter_complete_handover").file).toContain("20261028232338_declutter_damage_no_enjoy_notice.sql");
    const names = ["declutter_claim_free", "declutter_free_rules",
      "declutter_buy_now", "declutter_close_paid_order",
      "declutter_create_item", "declutter_update_draft", "declutter_orders_fee_rule_f1", "payout_setup_hire_allowed",
      "declutter_setup_fee_before_list"];
    for (const n of names) expect(newestFunction(n).file, n).toContain(FILE);
    expect(names.length).toBeGreaterThan(8);
  });

  it("listing a free item never charges the one-time setup fee; a paid listing still does (owner 2026-10-27)", () => {
    const gate = code("declutter_setup_fee_before_list");
    const freeAt = gate.indexOf("IF NEW.current_price_cents = 0 THEN RETURN NEW; END IF;");
    expect(freeAt).toBeGreaterThan(0);
    expect(freeAt).toBeLessThan(gate.indexOf("IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN RAISE EXCEPTION 'setup_fee_required_to_list'"));
  });

  it("claims are free, held 48 hours like a purchase, at most 3 at a time; a free item is never bought", () => {
    const claim = code("declutter_claim_free");
    expect(claim).toContain("PERFORM public.require_feature('declutter')");
    expect(claim).toContain("pg_advisory_xact_lock(hashtextextended('declutter_free_claims:' || v_uid::text, 0))");
    expect(claim).toContain("IF v_open >= (public.declutter_free_rules() ->> 'max_open_claims')::integer THEN");
    expect(claim).toContain("RETURN public.declutter_take_item(p_item_id, v_uid, 0, 'buy', NULL)");
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

  it("the screens: Free on every price, Get it free instead of Buy or offer, a free cart without a payment page", () => {
    expect(itemPriceLabel(0)).toBe("Free");
    expect(itemPriceLabel(4050)).toBe("$40.50");
    const view = read("src/components/declutter/DeclutterItemView.tsx");
    expect(view).toContain("(free ? <FreeClaimPanel item={it} /> : <OfferPanel item={it} userId={user.id} />)");
    expect(view).toContain("{!free && <PriceHint");
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
