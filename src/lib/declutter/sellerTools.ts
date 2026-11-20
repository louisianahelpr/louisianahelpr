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
  // The generated Args type has no null (Postgres arguments are all nullable): a percent, never a price, from here.
  const res = await supabase.rpc("declutter_send_saver_offer", { p_item_id: itemId, p_percent_off: percent, p_amount_cents: null as unknown as number });
  if (res.error) {
    // The server's own words name the lowest price (below_your_lowest); every other refusal has its table line.
    throw Object.assign(new Error(res.error.message), { userMessage: declutterErrorMessage(res.error) });
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

/** Selling's one read for the offer-to-savers line: save counts for the seller's live priced listings and their last sends. */
export async function fetchSaverOfferState(sellerId: string, itemIds: string[]): Promise<{ saves: Map<string, number> | null; sends: Map<string, { at: string; sent: number }> }> {
  const [saves, sends] = await Promise.all([fetchSaveCounts(itemIds), fetchRecentSaverOffers(sellerId)]);
  return { saves, sends };
}

/**
 * Whether an offer card is the seller's offer to savers: a thread that waits on the buyer with no counter yet. A buyer's
 * own offer waits on the seller; a seller's counter or Wanted reply has counter_count >= 1.
 */
export function isSaverOffer(o: { my_side: string; awaiting: string; counter_count: number; from_wanted?: boolean | null }): boolean {
  return o.my_side === "buyer" && o.awaiting === "buyer" && o.counter_count === 0 && o.from_wanted !== true;
}
