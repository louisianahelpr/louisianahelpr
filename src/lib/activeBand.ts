/**
 * "Active today" / "Active this week" from get_user_last_active (restated 20261108001932, lead 11-07): the server
 * answers a coarse band per user, never a sign-in time, and gives no row for a user with no sign-in in the last
 * 7 days, one the caller has a block with, a suspended or removed user, or a hidden test user. At most 200 ids per
 * call (more raises too_many_ids), so fetchActiveBands asks in pages of 200.
 */
import { supabase } from "@/integrations/supabase/client";

export type ActiveBand = "today" | "this_week";

/** The server's cap on ids per call. */
export const ACTIVE_BAND_MAX_IDS = 200;

function parseActiveBand(v: unknown): ActiveBand | null {
  return v === "today" || v === "this_week" ? v : null;
}

/** The words shown for a band; null shows nothing. */
export function activeBandLabel(band: ActiveBand | null | undefined): "Active today" | "Active this week" | null {
  if (band === "today") return "Active today";
  if (band === "this_week") return "Active this week";
  return null;
}

type BandRow = { user_id: string | null; active_band: string | null };

/** Rows from one or more get_user_last_active calls as user id -> band (unknown bands dropped). */
export function bandMap(rows: readonly BandRow[] | null | undefined): Map<string, ActiveBand> {
  const out = new Map<string, ActiveBand>();
  for (const r of rows ?? []) {
    const band = parseActiveBand(r?.active_band);
    if (r?.user_id && band) out.set(r.user_id, band);
  }
  return out;
}

/** Bands for any number of users, 200 per call; the first error comes back with whatever pages did answer. */
export async function fetchActiveBands(userIds: readonly string[]): Promise<{ bands: Map<string, ActiveBand>; error: unknown }> {
  const ids = [...new Set(userIds)];
  const pages: string[][] = [];
  for (let i = 0; i < ids.length; i += ACTIVE_BAND_MAX_IDS) pages.push(ids.slice(i, i + ACTIVE_BAND_MAX_IDS));
  const results = await Promise.all(pages.map((page) => supabase.rpc("get_user_last_active", { user_ids: page })));
  const rows: BandRow[] = [];
  let error: unknown = null;
  for (const r of results) {
    if (r.error) error ??= r.error;
    else rows.push(...((r.data ?? []) as BandRow[]));
  }
  return { bands: bandMap(rows), error };
}
