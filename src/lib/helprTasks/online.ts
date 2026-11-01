/**
 * "Go online for deliveries" (Q2440, owner-approved 2026-10-27): while online, a new Declutter
 * delivery near the Helpr is offered to them at once (bell + push). The rules are SQL's
 * (20261027203030): who may go online, the auto-off, the ~1 km point, who is offered what.
 * Kept out of ./api so the header pill does not pull the whole delivery module.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { loadModule } from "@/lib/loadModule";

export interface OnlineStatus {
  online_until: string | null;
  radius_miles: number;
}

/** The caller's own row (RLS: own row only); null when they never went online. */
export async function fetchOnlineStatus(userId: string): Promise<OnlineStatus | null> {
  const row = unwrap(await supabase.from("helpr_delivery_online").select("online_until, radius_miles").eq("user_id", userId).maybeSingle());
  return (row ?? null) as OnlineStatus | null;
}

/** Online now (the auto-off is a time, so "online" is read against the clock). */
export function isOnline(s: OnlineStatus | null | undefined, now = Date.now()): boolean {
  return !!s?.online_until && new Date(s.online_until).getTime() > now;
}

/**
 * Go online for `hours` (1 to 12), near the shared position when the Helpr shared one on this screen,
 * else their saved area; or go offline. A refusal throws with the server's code and plain words.
 */
export async function setOnline(on: boolean, opts: { hours?: number; radiusMiles?: number; where?: { lat: number; lng: number } | null } = {}): Promise<void> {
  // nullable-arg: p_hours / p_radius_miles NULL = the defaults (4 h, 15 mi); p_lat/p_lng NULL = the saved area.
  const { error } = await supabase.rpc("helpr_go_online", {
    p_on: on,
    p_hours: (opts.hours ?? null) as number,
    p_lat: (opts.where?.lat ?? null) as number,
    p_lng: (opts.where?.lng ?? null) as number,
    p_radius_miles: (opts.radiusMiles ?? null) as number,
  });
  if (error) {
    const e = new Error(error.message) as Error & { userMessage?: string };
    // The refusal words load only on a refusal (B79): DesktopTopNav's online pill runs this file beside every
    // signed-in page, and a static import of ./errorCopy pulled Declutter's first-screen chunk in with it.
    // A failed load still throws the server's error, just without the plain words.
    const copy = await loadModule(() => import("./errorCopy")).catch(() => null);
    const words = copy?.rpcErrorMessage("helpr_go_online", error) ?? null;
    if (words) e.userMessage = words;
    throw e;
  }
}
