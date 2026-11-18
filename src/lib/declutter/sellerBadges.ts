/**
 * The item page's trust signals (owner 11-07, after reviewing Vinted): "Listed 3 min ago" beside the condition, and
 * the seller's badges, each from real data with an honest threshold and NO badge when the data is thin:
 *   - "Lists often": 5 or more of the seller's listings are for sale now (this one and 4+ in "More from this seller").
 *   - "On-time handovers": 5+ handovers in the last year and no standing missed-handover strike
 *     (declutter_seller_on_time_handovers, 20261107235110: one boolean, never counts).
 *   - "Active today": the seller signed in today (get_user_last_active answers a coarse band, never a time, and no
 *     band for a seller the viewer has a block with or who is suspended: 20261108001932). "this_week" shows no badge:
 *     a sign-in is not a visit, so an older one says nothing, never "Last seen 3 weeks ago".
 * The rating stays where it already is, the stars on the seller card (only when the seller has reviews).
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";
import { bandMap, type ActiveBand } from "@/lib/activeBand";
import { wordInLang } from "@/lib/i18n/inLang";

/** Listings for sale (this one included) from which "Lists often" shows. */
const LISTS_OFTEN_FROM = 5;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "3 min ago", "2 h ago" or "5 days ago" (Spanish for a Spanish reader, design audit r2 #35); null for
 * no date, a bad date or a date in the future past a minute. */
function ago(iso: string | Date | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < -MIN) return null;
  if (ms < MIN) return wordInLang("ip.ago.now", "just now");
  if (ms < HOUR) { const n = Math.floor(ms / MIN); return wordInLang("ip.ago.min", `${n} min ago`, { n }); }
  if (ms < DAY) { const n = Math.floor(ms / HOUR); return wordInLang("ip.ago.h", `${n} h ago`, { n }); }
  const days = Math.floor(ms / DAY);
  if (days === 1) return wordInLang("ip.ago.yesterday", "yesterday");
  if (days < 7) return wordInLang("ip.ago.days", `${days} days ago`, { n: days });
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return wordInLang("ip.ago.week", "1 week ago");
  if (weeks < 9) return wordInLang("ip.ago.weeks", `${weeks} weeks ago`, { n: weeks });
  return null;
}

/** "Listed 3 min ago" from the item's live_at; null when it has no live date or listed over two months back. */
export function listedAgo(liveAt: string | null | undefined, now: Date = new Date()): string | null {
  const a = ago(liveAt, now);
  return a ? wordInLang("ip.listed", `Listed ${a}`, { when: a }) : null;
}

/** "Active today" for the "today" band, else null (an older or unknown band is thin data: no badge). */
export function activeToday(band: ActiveBand | null | undefined): string | null {
  return band === "today" ? wordInLang("ip.badge.active", "Active today") : null;
}

export type SellerBadge = { key: "lists_often" | "on_time" | "active"; label: string };

/** The badges to show, in order; an empty list when nothing clears its bar. */
export function sellerBadges(s: { othersForSale: number | null; onTime: boolean | null; activeBand: ActiveBand | null }): SellerBadge[] {
  const out: SellerBadge[] = [];
  if (s.othersForSale !== null && s.othersForSale + 1 >= LISTS_OFTEN_FROM) out.push({ key: "lists_often", label: wordInLang("ip.badge.listsOften", "Lists often") });
  if (s.onTime === true) out.push({ key: "on_time", label: wordInLang("ip.badge.onTime", "On-time handovers") });
  const active = activeToday(s.activeBand);
  if (active) out.push({ key: "active", label: active });
  return out;
}

/** declutter_seller_on_time_handovers; null before it is deployed (no badge, never a wrong one). */
export async function fetchOnTimeHandovers(sellerId: string): Promise<boolean | null> {
  const res = await supabase.rpc("declutter_seller_on_time_handovers", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_seller_on_time_handovers")) return null;
  return unwrap(res) === true;
}

/** The seller's activity band (get_user_last_active, members only); null when the server gave none. */
export async function fetchActiveBand(sellerId: string): Promise<ActiveBand | null> {
  const res = await supabase.rpc("get_user_last_active", { user_ids: [sellerId] });
  return bandMap(unwrap(res)).get(sellerId) ?? null;
}
