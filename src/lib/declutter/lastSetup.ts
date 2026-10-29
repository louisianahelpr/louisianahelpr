/**
 * "Remember my setup" (owner 2026-10-29: "ai should always be doing most of the work for declutter
 * listing"): a NEW listing starts from the seller's most recent listing's setup.
 *
 * What is per LISTING, and so copied from the last one: the ways buyers can get it
 * (declutter_items.handovers), the area buyers see (area_label), the private pickup address and its
 * point (declutter_seller_item_private, the seller's own row only), and the price-drop step
 * (drop_pct; 0 = drops off). What is already per SELLER, and so needs nothing here: the pickup times
 * (declutter_pickup_windows, keyed by seller_id, loaded by the sell form) and porch days (read from
 * those windows). "Free on day 12" is per listing but the sell form has no control for it (Manage
 * listing only), so it is not copied: the seller would have no way to see or change it here.
 *
 * Reads only; nothing is saved until the seller saves the listing.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type { SellerHandover } from "@/lib/declutter/api";
import { fetchMyItemPrivate } from "@/lib/declutter/api";
import { DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";

export interface LastSetup {
  itemId: string;
  /** Empty when the last listing was free (a free item is porch pickup only, not the seller's own choice). */
  ways: SellerHandover[];
  areaLabel: string;
  pickup: { address: string; lat: number; lng: number } | null;
  /** The last listing's drop step, or null when drops were off, it was free, or the step is not one we offer. */
  dropPct: number | null;
}

const WAYS: readonly SellerHandover[] = ["porch", "seller_delivery", "meetup", "delivery"];

/** The seller's most recent listing that went past draft, as a setup to start from; null when there is none. */
export async function fetchLastSetup(userId: string): Promise<LastSetup | null> {
  const r = await supabase
    .from("declutter_items")
    .select("id, area_label, handovers, drop_pct, price_cents")
    .eq("seller_id", userId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A column not on this database yet (handovers / drop_pct): start blank, as before.
  if (r.error?.code === "42703") return null;
  const row = unwrap(r) as { id: string; area_label: string | null; handovers: string[] | null; drop_pct: number | null; price_cents: number } | null;
  if (!row) return null;
  const free = row.price_cents === 0;
  const priv = await fetchMyItemPrivate(row.id);
  const lat = Number(priv?.pickup_lat);
  const lng = Number(priv?.pickup_lng);
  const pct = Number(row.drop_pct);
  return {
    itemId: row.id,
    ways: free ? [] : (row.handovers ?? []).filter((w): w is SellerHandover => (WAYS as readonly string[]).includes(w)),
    areaLabel: (row.area_label ?? "").trim(),
    pickup: priv?.pickup_address && Number.isFinite(lat) && Number.isFinite(lng) ? { address: priv.pickup_address, lat, lng } : null,
    dropPct: !free && (DROP_PCT_CHOICES as readonly number[]).includes(pct) ? pct : null,
  };
}
