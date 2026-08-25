import { supabase } from "@/integrations/supabase/client";

/**
 * Operator kill-switches, read from `platform_settings.feature_flags`.
 *
 * There is exactly ONE today, and the shape of it is deliberate.
 *
 * WHY THE FLAG IS NAMED FOR THE EXCEPTION
 * `idv_requirement_paused` reads backwards from how a flag is usually written
 * ("…_enabled"). That is the whole safety property. An "enabled" flag has to be
 * present and true for the feature to work, so every way of failing to read it
 * — key absent, RPC not deployed yet, network down, typo in the key — turns the
 * feature OFF. For a compliance gate that is exactly the wrong direction: a
 * dropped fetch would silently stop requiring identity verification and nobody
 * would notice, because nothing visibly breaks when a gate stops gating.
 *
 * Naming it for the exception inverts that. Absent, unreadable, or false all
 * mean "IDV is required" — the safe state — and the only way to lift the gate
 * is a deliberate write by an admin. It also means this shipped without needing
 * the stored values corrected first: the key does not exist yet, so the gate
 * keeps behaving exactly as it did before this file existed.
 *
 * This replaced five toggles (subscriptions/referrals/AI/boosts/IDV) that wrote
 * to the same column and were read by nothing at all. Four were deleted rather
 * than wired: they gate features the app owns end to end, which already fail
 * gracefully on their own, so their switch value was speculative. IDV is the
 * one worth keeping, because it gates an EXTERNAL dependency — if Stripe
 * Identity has an outage, every helper is blocked from posting and accepting at
 * once, and this is a native app that cannot be hot-fixed inside App Review.
 *
 * Cached briefly because the gate sites are inside submit handlers, where an
 * extra round-trip is felt directly. The TTL is short so lifting the gate
 * during an incident takes effect in about a minute rather than needing a
 * reload.
 */

const TTL_MS = 60_000;

let cached: { value: boolean; at: number } | null = null;
/** In-flight request, so a double-tap does not fire two reads. */
let inFlight: Promise<boolean> | null = null;

/** Drop the cache — used by tests, and after an admin saves the flag. */
export function resetFeatureFlagCache() {
  cached = null;
  inFlight = null;
}

/**
 * True only when an admin has explicitly paused the identity-verification
 * requirement. Fails CLOSED: any error, missing row, or missing key returns
 * false, which means IDV stays required.
 */
export async function isIdvRequirementPaused(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_public_platform_settings");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      // `feature_flags` arrives only once migration 20260826070000 has
      // deployed. Until then the column is simply absent, which lands on the
      // safe answer without a special case.
      const flags = (row as { feature_flags?: Record<string, unknown> } | null)?.feature_flags;
      const value = flags?.idv_requirement_paused === true;
      cached = { value, at: Date.now() };
      return value;
    } catch {
      // Deliberately quiet and deliberately false. A failed read must never be
      // the thing that lifts a compliance gate, and this runs on a hot path
      // where a toast would be noise the user cannot act on.
      cached = { value: false, at: Date.now() };
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
