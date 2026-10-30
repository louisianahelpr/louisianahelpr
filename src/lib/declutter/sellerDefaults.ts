/**
 * A seller's remembered Declutter listing choices (owner request via the lead, 2026-10-30), on the account so they
 * follow the seller across phone and computer: public.declutter_seller_defaults, migration 20261030144112, one row
 * per member under row-level security (own row only).
 *
 * The ONE client helper for it: the sell form reads it to pre-fill a NEW listing and saves it when a listing is
 * posted; the Declutter settings page (Builder 101) reads and edits the same record. No row = SELLER_DEFAULTS.
 * Until the migration is on prod (table missing) reads give the defaults and saves do nothing.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SellerHandover } from "@/lib/declutter/api";

export interface SellerDefaults {
  /** "Keep it up until it sells". */
  keepUp: boolean;
  /** "Lower the price if it doesn't sell?". */
  drops: boolean;
  /** How much each evening: one of DROP_PCT_CHOICES (5, 10, 15, 20). */
  dropPct: number;
  /** The lowest price as a percent of the asking price, 10-95 (pre-fills "Lowest you'll take"). */
  floorPct: number;
  /** "If it doesn't sell, make it free after" days (7, 14, 21, 30), or null for never. */
  freeAfterDays: number | null;
  /** The ways buyers can get it, at least one. */
  handovers: SellerHandover[];
}

/** No saved row: keep it up ON, drops ON at 5% a night down to half the price, never free, porch pickup. */
export const SELLER_DEFAULTS: SellerDefaults = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"] };

interface Row {
  keep_up: boolean;
  drops: boolean;
  drop_pct: number;
  floor_pct: number;
  free_after_days: number | null;
  handovers: string[];
}

const COLUMNS = "keep_up, drops, drop_pct, floor_pct, free_after_days, handovers";
const WAYS: readonly SellerHandover[] = ["porch", "seller_delivery", "meetup", "delivery"];

/** The table is not in the generated types until it is on prod (check-types-fresh compares against the live schema). */
 
const table = () => (supabase as any).from("declutter_seller_defaults");

/** Table not on this database yet (PostgREST's "not in the schema cache" or Postgres' undefined table). */
const notDeployed = (code: string | undefined) => code === "PGRST205" || code === "42P01";

function fromRow(r: Row): SellerDefaults {
  const ways = (r.handovers ?? []).filter((w): w is SellerHandover => (WAYS as readonly string[]).includes(w));
  return {
    keepUp: r.keep_up,
    drops: r.drops,
    dropPct: r.drop_pct,
    floorPct: r.floor_pct,
    freeAfterDays: r.free_after_days,
    handovers: ways.length > 0 ? ways : SELLER_DEFAULTS.handovers,
  };
}

/** The member's saved choices, or null when they have none saved yet (then use SELLER_DEFAULTS). */
export async function fetchSellerDefaults(userId: string): Promise<SellerDefaults | null> {
  const { data, error } = await table().select(COLUMNS).eq("member_id", userId).maybeSingle();
  if (error) {
    if (notDeployed(error.code)) return null;
    throw error;
  }
  return data ? fromRow(data as Row) : null;
}

/** Save the member's choices (their own row; insert or update). Returns false when the table is not deployed yet. */
export async function saveSellerDefaults(userId: string, d: SellerDefaults): Promise<boolean> {
  const { error } = await table().upsert(
    {
      member_id: userId,
      keep_up: d.keepUp,
      drops: d.drops,
      drop_pct: d.dropPct,
      floor_pct: Math.min(95, Math.max(10, Math.round(d.floorPct))),
      free_after_days: d.freeAfterDays,
      handovers: d.handovers.length > 0 ? d.handovers : SELLER_DEFAULTS.handovers,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id" },
  ).select("member_id");
  if (error) {
    if (notDeployed(error.code)) return false;
    throw error;
  }
  return true;
}

/** The lowest price a percent gives for an asking price, in whole dollars ("" when there is no usable price). */
export function floorFromPct(priceDollars: string, floorPct: number): string {
  const p = Number(priceDollars);
  if (!Number.isFinite(p) || p < 2) return "";
  return String(Math.min(Math.floor(p) - 1, Math.max(1, Math.round((p * floorPct) / 100))));
}

/** The percent a typed lowest price is of the asking price, for saving; null when either is not usable. */
export function pctFromFloor(priceDollars: string, floorDollars: string): number | null {
  const p = Number(priceDollars);
  const f = Number(floorDollars);
  if (!Number.isFinite(p) || !Number.isFinite(f) || p <= 0 || f <= 0 || f >= p) return null;
  return Math.min(95, Math.max(10, Math.round((f / p) * 100)));
}
