/**
 * Owner 2026-11-25 ("they can do auto offers like depop"): Auto-offer new savers.
 *
 * Behaviour on a real database: src/test/pglite/declutterAutoOfferNewSavers.pglite.mjs (46 PASS applied 3x;
 * NEW_MIGRATION=skip RED; a planted body without the once-per-saver, block and test-data checks 5 FAIL; without the
 * seller-out check 1+ FAIL; with the save-protecting EXCEPTION narrowed 2 FAIL). This file pins
 * the rules that matter in the NEWEST definitions, so a later restatement cannot drop them silently, and the Selling
 * row that turns it on.
 *
 * @mutate supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql | (o.status = 'open' OR o.auto_liker) | o.status = 'open'
 * @mutate supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql |   IF public.are_users_blocked(NEW.user_id, v_item.seller_id)\n | IF false\n
 * @mutate supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql |   IF v_floor IS NOT NULL AND v_amount < v_floor THEN\n    RETURN NEW; |   IF false THEN\n    RETURN NEW;
 * @mutate src/components/declutter/SaverOffer.tsx |   if (saves < 1) return auto; |   if (saves < 1) return null;
 * @mutate supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql |      OR public.declutter_seller_out(v_item.seller_id)\n |
 * @mutate supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql |   EXCEPTION WHEN OTHERS THEN | EXCEPTION WHEN division_by_zero THEN
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const calls: [string, number | null][] = [];
vi.mock("@/lib/declutter/sellerTools", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerTools")>()),
  setAutoLikerOffer: async (id: string, pct: number | null) => { calls.push([id, pct]); return pct === null ? null : { percent_off: pct, amount_cents: 1800 }; },
}));

import { SaverOfferLine } from "@/components/declutter/SaverOffer";

const FILE = "supabase/migrations/20261126002822_declutter_auto_offer_new_likers.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("Auto-offer new savers (server)", () => {
  const set = flat(newestFunction("declutter_set_auto_liker_offer").body);
  const trg = flat(newestFunction("declutter_auto_offer_new_saver").body);

  it("reads the newest definitions (this migration)", () => {
    expect(newestFunction("declutter_set_auto_liker_offer").file).toContain("20261126002822");
    expect(newestFunction("declutter_auto_offer_new_saver").file).toContain("20261126002822");
  });

  it("the setter: the seller's own listing, a member not banned, 5..50%, the saver-offer price rules", () => {
    for (const part of [
      "PERFORM public.require_feature('declutter');",
      "IF public.is_caller_banned() THEN",
      "v_uid := public.declutter_assert_member(true);",
      "IF p_percent_off IS NOT NULL AND (p_percent_off < 5 OR p_percent_off > 50) THEN",
      "WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;",
      "IF v_amount < 100 OR v_amount >= v_item.current_price_cents THEN",
      "IF v_amount * 2 < v_item.current_price_cents THEN",
      "IF v_floor IS NOT NULL AND v_amount < v_floor THEN",
    ]) expect(set, part).toContain(part);
  });

  it("the save trigger: live visible listing, never the seller, once per saver per item, no block, in Declutter, test data to test people", () => {
    for (const part of [
      "IF NOT FOUND OR v_item.status <> 'live' OR v_item.seller_hidden OR NEW.user_id = v_item.seller_id THEN",
      "IF v_floor IS NOT NULL AND v_amount < v_floor THEN",
      "AND (o.status = 'open' OR o.auto_liker)) THEN",
      "IF public.are_users_blocked(NEW.user_id, v_item.seller_id) OR public.declutter_seller_out(v_item.seller_id) OR public.declutter_member_out(NEW.user_id) OR NOT public.feature_enabled_for_user('declutter', NEW.user_id) THEN",
      // The save always stands: the send is a sub-block whose errors undo only the offer.
      "EXCEPTION WHEN OTHERS THEN RAISE WARNING 'declutter_auto_offer_new_saver: item % saver %: %', NEW.item_id, NEW.user_id, SQLERRM; END; RETURN NEW;",
      "IF v_test_seller AND NOT COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = NEW.user_id), false) AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = NEW.user_id) THEN",
      "VALUES (NEW.item_id, NEW.user_id, v_item.seller_id, v_amount, 'buyer', now() + interval '48 hours', 0, true)",
      "PERFORM public.declutter_notice_ref(v_offer);",
      "PERFORM public.declutter_notify(NEW.user_id, 'declutter_offers', 'Offer on an item you saved',",
    ]) expect(trg, part).toContain(part);
  });

  it("grants: setter members only; trigger function not callable; the rule table is RLS, seller reads own", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_set_auto_liker_offer(uuid, integer) FROM PUBLIC, anon;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_auto_offer_new_saver() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("ALTER TABLE public.declutter_auto_liker_offers ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_auto_liker_offers FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("AFTER INSERT ON public.declutter_watchlist FOR EACH ROW EXECUTE FUNCTION public.declutter_auto_offer_new_saver();");
  });
});

const ITEM = {
  id: "i1", seller_id: "me", status: "live", title: "Lamp", description: "", category: "home", condition_stars: 4, delivery_size: "small",
  price_cents: 2000, current_price_cents: 2000, area_label: "Mid City", area_lat: 30.4, area_lng: -91.1, created_at: "2026-11-25", live_at: "2026-11-25",
  porch_ok: false, accepts_offers: true,
} as unknown as Parameters<typeof SaverOfferLine>[0]["item"];

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => { cleanup(); calls.length = 0; });

describe("Auto-offer new savers (Selling row)", () => {
  it("shows on a live priced listing nobody saved yet, and Turn on sends the chosen percent", async () => {
    wrap(<SaverOfferLine item={ITEM} saves={0} lastSend={undefined} autoPct={null} />);
    expect(screen.getByText("Auto-offer new savers: off.")).toBeTruthy();
    // Inventory floor: the row and its button rendered.
    expect(document.querySelectorAll("[data-auto-liker-offer]").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    const sheet = (await waitFor(() => { const el = document.querySelector("[data-confirm-sheet='declutter-auto-liker-offer']"); expect(el).not.toBeNull(); return el as HTMLElement; }));
    expect(sheet.textContent).toMatch(/They see \$18(\.00)? /);
    fireEvent.click(sheet.querySelector("[data-auto-liker-offer-pct='15']") as HTMLElement);
    const confirm = Array.from(sheet.querySelectorAll("button")).find((b) => b.textContent === "Turn on") as HTMLElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toEqual([["i1", 15]]));
  });

  it("says the percent while on, and Turn off sends NULL", async () => {
    wrap(<SaverOfferLine item={ITEM} saves={2} lastSend={undefined} autoPct={15} />);
    expect(screen.getByText("Auto-offer new savers: 15% off.")).toBeTruthy();
    expect(screen.getByText("2 people saved this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const sheet = (await waitFor(() => { const el = document.querySelector("[data-confirm-sheet='declutter-auto-liker-offer']"); expect(el).not.toBeNull(); return el as HTMLElement; }));
    fireEvent.click(sheet.querySelector("[data-auto-liker-offer-off]") as HTMLElement);
    await waitFor(() => expect(calls).toEqual([["i1", null]]));
  });

  it("a free or sold listing shows nothing", () => {
    wrap(<SaverOfferLine item={{ ...ITEM, current_price_cents: 0 }} saves={0} lastSend={undefined} autoPct={null} />);
    wrap(<SaverOfferLine item={{ ...ITEM, status: "sold" }} saves={0} lastSend={undefined} autoPct={null} />);
    expect(document.querySelectorAll("[data-auto-liker-offer]")).toHaveLength(0);
  });
});
