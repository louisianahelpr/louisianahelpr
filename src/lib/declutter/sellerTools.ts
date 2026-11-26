/**
 * Declutter top 5 (owner 11-19, "Do all 5", after docs Declutter-vs-Vinted-Depop-1119): the seller's tools that sit
 * after posting. Posting itself is unchanged (photos, title, description, price, category, condition).
 *
 * #1 One-tap offer to savers (20261120010630): the seller sends one private offer to everyone who saved a live listing,
 * once per item per 24 hours. The thread it starts is an ordinary offer that waits on the buyer (declutter_offers,
 * counter_count 0), so the buyer answers it with the offer card's Accept / Counter / Decline.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { declutterErrorMessage } from "./errors";
import { fetchSaveCounts } from "./saveCounts";

/** The discounts the sheet offers, in percent. The server takes 5 to 50. */
export const SAVER_OFFER_PERCENTS = [10, 15, 20] as const;
/** One send per item per this many hours (the server's rule, declutter_send_saver_offer). */
const SAVER_OFFER_EVERY_HOURS = 24;

/** The offer price for `percent` off `priceCents`, rounded to the cent: the server's own sum (round(price * (100 - pct) / 100)). */
export function saverOfferCents(priceCents: number, percent: number): number {
  return Math.round((priceCents * (100 - percent)) / 100);
}

/**
 * Whether a percent can be sent for this listing: below today's price, at least $1, at least half the price, and not
 * below the seller's own lowest price when one is set. The server checks the same and is the authority.
 */
export function saverOfferAllowed(priceCents: number, percent: number, floorCents: number | null): boolean {
  const cents = saverOfferCents(priceCents, percent);
  if (priceCents < 200 || cents < 100 || cents >= priceCents || cents * 2 < priceCents) return false;
  return floorCents === null || cents >= floorCents;
}

interface SaverOfferSent {
  sent: number;
  amount_cents: number;
  next_at: string;
}

export async function sendSaverOffer(itemId: string, percent: number): Promise<SaverOfferSent> {
  // nullable-arg: p_amount_cents is NULL because this sends a percent, never a price (the server takes exactly one).
  const res = await supabase.rpc("declutter_send_saver_offer", { p_item_id: itemId, p_percent_off: percent, p_amount_cents: null as unknown as number });
  if (res.error) {
    // The server's own words name the lowest price (below_your_lowest); every other refusal has its table line.
    throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_send_saver_offer", res.error) ?? declutterErrorMessage(res.error) });
  }
  return res.data as unknown as SaverOfferSent;
}

/** The seller's sends in the last 24 hours, newest per item: item id -> when it was sent and to how many. */
async function fetchRecentSaverOffers(sellerId: string): Promise<Map<string, { at: string; sent: number }>> {
  const since = new Date(Date.now() - SAVER_OFFER_EVERY_HOURS * 3600_000).toISOString();
  const res = await supabase
    .from("declutter_saver_offer_sends")
    .select("item_id, created_at, sent_count")
    .eq("seller_id", sellerId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  // Before the migration reaches prod the table is missing: no sends, so every row still offers the button.
  if (res.error && /declutter_saver_offer_sends/.test(res.error.message ?? "")) return new Map();
  const out = new Map<string, { at: string; sent: number }>();
  for (const r of unwrap(res) ?? []) if (!out.has(r.item_id)) out.set(r.item_id, { at: r.created_at, sent: r.sent_count });
  return out;
}

/**
 * Owner 2026-11-25 (Depop-style, 20261126002822): "Auto-offer new savers". While on for a listing, each member who saves
 * it gets one private offer at this percent off at once (the server's declutter_watchlist trigger). NULL turns it off.
 */
export async function setAutoLikerOffer(itemId: string, percent: number | null): Promise<{ percent_off: number; amount_cents: number } | null> {
  // nullable-arg: p_percent_off NULL is the server's "turn it off".
  const res = await supabase.rpc("declutter_set_auto_liker_offer", { p_item_id: itemId, p_percent_off: percent as unknown as number });
  if (res.error) {
    throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_set_auto_liker_offer", res.error) ?? declutterErrorMessage(res.error) });
  }
  return res.data as unknown as { percent_off: number; amount_cents: number } | null;
}

/** The seller's "Auto-offer new savers" rules: item id -> percent off. */
async function fetchAutoLikerOffers(sellerId: string): Promise<Map<string, number>> {
  const res = await supabase.from("declutter_auto_liker_offers").select("item_id, percent_off").eq("seller_id", sellerId);
  // Before the migration reaches prod the table is missing: no rules, so every row shows the switch off.
  if (res.error && /declutter_auto_liker_offers/.test(res.error.message ?? "")) return new Map();
  return new Map((unwrap(res) ?? []).map((r) => [r.item_id, r.percent_off]));
}

/** Selling's one read for the offer-to-savers line: save counts, last sends and the auto-offer rules. */
export async function fetchSaverOfferState(sellerId: string, itemIds: string[]): Promise<{ saves: Map<string, number> | null; sends: Map<string, { at: string; sent: number }>; auto: Map<string, number> }> {
  const [saves, sends, auto] = await Promise.all([fetchSaveCounts(itemIds), fetchRecentSaverOffers(sellerId), fetchAutoLikerOffers(sellerId)]);
  return { saves, sends, auto };
}

/**
 * Whether an offer card is the seller's offer to savers: a thread that waits on the buyer with no counter yet. A buyer's
 * own offer waits on the seller; a seller's counter or Wanted reply has counter_count >= 1.
 */
export function isSaverOffer(o: { my_side: string; awaiting: string; counter_count: number; from_wanted?: boolean | null }): boolean {
  return o.my_side === "buyer" && o.awaiting === "buyer" && o.counter_count === 0 && o.from_wanted !== true;
}

/**
 * #2 Selling home (20261120012050): the seller's to-do counts and the last 7 days next to the 7 before. Offers to
 * answer and sales to hand over come from Selling's own to-do read (useDeclutterTodo), not from here.
 */
export interface WeekNumbers {
  sales: number;
  earnings_cents: number;
  views: number;
  saves: number;
}
export interface SellingHome {
  week: WeekNumbers;
  last_week: WeekNumbers;
  todo: { to_relist: number; price_drops: number; savers_to_offer: number };
  live_count: number;
  live_value_cents: number;
}

/** null before the read reaches prod (PGRST202): Selling then simply draws no home card. */
export async function fetchSellingHome(): Promise<SellingHome | null> {
  const res = await supabase.rpc("declutter_selling_home");
  if (res.error && isMissingRpcNamed(res.error, "declutter_selling_home")) return null;
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_selling_home", res.error) ?? undefined });
  return res.data as unknown as SellingHome;
}

/**
 * How this week compares with last week, honestly: "up" / "down" with a whole percent when last week had any, "new"
 * when last week had none and this week has some, "same" otherwise (never a made-up percent from zero).
 */
export function weekChange(now: number, last: number): { dir: "up" | "down" | "same" | "new"; pct: number } {
  if (now === last) return { dir: "same", pct: 0 };
  if (last === 0) return { dir: "new", pct: 0 };
  const pct = Math.round((Math.abs(now - last) / last) * 100);
  return { dir: now > last ? "up" : "down", pct };
}

/**
 * #4 Shop-wide sale (20261120014036): X% off every live listing for a date range. While it runs each listing's price IS
 * the sale price, so the cards' struck-through listed price, offers, Buy and checkout need nothing of their own. It
 * ends by itself and puts prices back (not a price the seller changed during the sale).
 */
export const SHOP_SALE_PERCENTS = [10, 15, 20, 25, 30] as const;

export interface ShopSale {
  id: string;
  percent_off: number;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "on";
}

/** The seller's sale that is set or running, or null. Before the table exists (not deployed) there is none. */
export async function fetchMyShopSale(sellerId: string): Promise<ShopSale | null> {
  const res = await supabase
    .from("declutter_shop_sales")
    .select("id, percent_off, starts_at, ends_at, status")
    .eq("seller_id", sellerId)
    .in("status", ["scheduled", "on"])
    .maybeSingle();
  if (res.error && /declutter_shop_sales/.test(res.error.message ?? "")) return null;
  return (unwrap(res) ?? null) as ShopSale | null;
}

export async function startShopSale(percent: number, startsAt: Date, endsAt: Date): Promise<string> {
  const res = await supabase.rpc("declutter_start_shop_sale", { p_percent_off: percent, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString() });
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_start_shop_sale", res.error) ?? declutterErrorMessage(res.error) });
  return res.data as string;
}

export async function endShopSale(): Promise<string> {
  const res = await supabase.rpc("declutter_end_shop_sale");
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_end_shop_sale", res.error) ?? declutterErrorMessage(res.error) });
  return res.data as string;
}

/**
 * #5 Bulk actions (20261120015456): Discount is one call; Pause, Put back on sale and Mark sold are the one-listing
 * RPCs, run once per ticked listing by the screen. Returns how many prices changed.
 */
export const BULK_PERCENTS = [10, 15, 20, 25] as const;

export async function bulkDiscount(itemIds: string[], percent: number): Promise<number> {
  const res = await supabase.rpc("declutter_bulk_discount", { p_item_ids: itemIds, p_percent_off: percent });
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_bulk_discount", res.error) ?? declutterErrorMessage(res.error) });
  return res.data as number;
}

/** #5 Away mode (20261120015456): the seller's own away row, or null. */
export async function fetchMyAway(sellerId: string): Promise<{ back_on: string } | null> {
  const res = await supabase.from("declutter_seller_away").select("back_on").eq("seller_id", sellerId).maybeSingle();
  if (res.error && /declutter_seller_away/.test(res.error.message ?? "")) return null;
  return (unwrap(res) ?? null) as { back_on: string } | null;
}

/** The public page's "Away until": a Louisiana date (YYYY-MM-DD), or null when the seller is not away (or not deployed). */
export async function fetchSellerAwayUntil(sellerId: string): Promise<string | null> {
  const res = await supabase.rpc("declutter_seller_away_until", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_seller_away_until")) return null;
  return (unwrap(res) ?? null) as string | null;
}

/** `backOn` is a calendar date (YYYY-MM-DD), the day the listings come back. */
export async function goAway(backOn: string): Promise<number> {
  const res = await supabase.rpc("declutter_go_away", { p_back_on: backOn });
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_go_away", res.error) ?? declutterErrorMessage(res.error) });
  return res.data as number;
}

export async function comeBack(): Promise<number> {
  const res = await supabase.rpc("declutter_come_back");
  if (res.error) throw Object.assign(new Error(res.error.message), { userMessage: rpcErrorMessage("declutter_come_back", res.error) ?? declutterErrorMessage(res.error) });
  return res.data as number;
}

/** A calendar date `days` from today, as YYYY-MM-DD in local time. */
export function dateInDays(days: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Mon, Nov 30" for a YYYY-MM-DD date, read as that calendar day (never shifted by time zone). */
export function calendarDayWords(ymd: string, lang: "en" | "es" = "en"): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Review 11-19 #5: the end the sheet sends. Normally 11:59 PM on the last day; never less than a day after the start (a
 * late-night "now" start still runs a full day) and never more than 14 days (the server allows 14 days and 2 hours).
 */
export function saleEnd(from: Date, days: number): Date {
  const end = saleEndOfDay(from, days - 1).getTime();
  const min = from.getTime() + 24 * 3600_000;
  const max = from.getTime() + 14 * 24 * 3600_000;
  return new Date(Math.min(Math.max(end, min), max));
}

/** 11:59 PM local time `days` days after `from` (0 = tonight): a sale "through Sunday" runs to Sunday night. */
export function saleEndOfDay(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d;
}
