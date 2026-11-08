/**
 * The item page's trust signals (owner 11-07, after reviewing Vinted): "Listed 3 min ago" beside the condition, and
 * the seller's badges, each from real data with an honest threshold and NO badge when the data is thin:
 *   - "Lists often": 5 or more of the seller's listings are for sale now (this one and 4+ in "More from this seller").
 *   - "On-time handovers": 5+ handovers in the last year and no standing missed-handover strike
 *     (declutter_seller_on_time_handovers, 20261107235110: one boolean, never counts).
 *   - "Active N min ago": the seller signed in within the last 24 hours (get_user_last_active reads sign-ins only,
 *     so an older sign-in says nothing about when they were last here: no badge, never "Last seen 3 weeks ago").
 * The rating stays where it already is, the stars on the seller card (only when the seller has reviews).
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/** Listings for sale (this one included) from which "Lists often" shows. */
const LISTS_OFTEN_FROM = 5;
/** How recent a sign-in must be to say "Active ...". */
const ACTIVE_WITHIN_MS = 24 * 60 * 60 * 1000;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "3 min ago", "2 h ago" or "5 days ago"; null for no date, a bad date or a date in the future past a minute. */
function ago(iso: string | Date | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < -MIN) return null;
  if (ms < MIN) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  const days = Math.floor(ms / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  return null;
}

/** "Listed 3 min ago" from the item's live_at; null when it has no live date or listed over two months back. */
export function listedAgo(liveAt: string | null | undefined, now: Date = new Date()): string | null {
  const a = ago(liveAt, now);
  return a ? `Listed ${a}` : null;
}

/** "Active 20 min ago" for a sign-in in the last 24 hours, else null (thin data: no badge). */
export function activeAgo(lastSignIn: string | null | undefined, now: Date = new Date()): string | null {
  if (!lastSignIn) return null;
  const t = new Date(lastSignIn).getTime();
  if (Number.isNaN(t) || now.getTime() - t > ACTIVE_WITHIN_MS) return null;
  const a = ago(lastSignIn, now);
  return a ? `Active ${a}` : null;
}

export type SellerBadge = { key: "lists_often" | "on_time" | "active"; label: string };

/** The badges to show, in order; an empty list when nothing clears its bar. */
export function sellerBadges(s: { othersForSale: number | null; onTime: boolean | null; lastSignIn: string | null; now?: Date }): SellerBadge[] {
  const out: SellerBadge[] = [];
  if (s.othersForSale !== null && s.othersForSale + 1 >= LISTS_OFTEN_FROM) out.push({ key: "lists_often", label: "Lists often" });
  if (s.onTime === true) out.push({ key: "on_time", label: "On-time handovers" });
  const active = activeAgo(s.lastSignIn, s.now ?? new Date());
  if (active) out.push({ key: "active", label: active });
  return out;
}

/** declutter_seller_on_time_handovers; null before it is deployed (no badge, never a wrong one). */
export async function fetchOnTimeHandovers(sellerId: string): Promise<boolean | null> {
  const res = await supabase.rpc("declutter_seller_on_time_handovers", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_seller_on_time_handovers")) return null;
  if (res.error) throw res.error;
  return res.data === true;
}

/** The seller's newest sign-in (get_user_last_active, members only); null when none is on file. */
export async function fetchLastSignIn(sellerId: string): Promise<string | null> {
  const res = await supabase.rpc("get_user_last_active", { user_ids: [sellerId] });
  if (res.error) throw res.error;
  return (res.data ?? [])[0]?.last_active_at ?? null;
}
