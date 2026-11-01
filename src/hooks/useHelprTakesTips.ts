/**
 * Can this Helpr receive a tip right now? Decided UP FRONT, from the same
 * server fact the hire row's Select reads ("payout setup not finished yet",
 * ApplicantHireRow): get_safe_profiles.is_payout_ready
 * (stripe_account_id IS NOT NULL AND stripe_payouts_enabled).
 *
 * Audit 2026-10-28 part 4, F29: the tip was offered three times (the 5-star
 * prompt, "Tip <name>" on the Done card, the tip sheet with its amounts) and
 * refused only at the last tap, when create-payment answered 400 "This Helpr
 * hasn't set up their payout account yet and cannot receive tips". Every tip
 * surface now asks this first and, when the answer is no, offers no tip and
 * says so in one line (tipsNotReadyLine).
 *
 * Owner 2026-10-30: tips are blocked until the Helpr has verified their ID, so
 * while the ID check is on for this member (identity_check) an unverified Helpr
 * answers false too, and the line says why (is_id_verified, the same safe
 * profile read). create-payment, auto-tip-charge and declutter-checkout enforce it.
 *
 * Returns false only when the server SAID not ready. Loading, a read error or
 * no row is null ("unknown"): the surface keeps offering the tip and
 * create-payment stays the backstop, so an outage never hides a tip that
 * would have worked.
 *
 * A plain effect with a per-Helpr cache, not React Query: the Posted card's
 * face reads it, and that card renders in places (and tests) with no
 * QueryClientProvider above it.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { pickRequestedProfile } from "@/lib/safeProfiles";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";

const CACHE_MS = 60_000;
type TipAnswer = { payoutReady: boolean; idVerified: boolean } | null;
const cache = new Map<string, { at: number; value: Promise<TipAnswer> }>();

function readTakesTips(helperId: string): Promise<TipAnswer> {
  const hit = cache.get(helperId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = (async () => {
    const { data, error } = await supabase.rpc("get_safe_profiles", { user_ids: [helperId] });
    if (error) {
      // Unknown, not "no": the tip stays offered and create-payment decides.
      report(error, { severity: "warning", tags: { source: "useHelprTakesTips" } });
      cache.delete(helperId);
      return null;
    }
    const row = pickRequestedProfile(data as { user_id: string; is_payout_ready: boolean | null; is_id_verified?: boolean | null }[] | null, helperId);
    return row ? { payoutReady: row.is_payout_ready === true, idVerified: row.is_id_verified === true } : null;
  })();
  cache.set(helperId, { at: Date.now(), value });
  return value;
}

/** Test seam: forget every cached answer. */
export function __resetHelprTakesTipsCache() {
  cache.clear();
}

function useTipAnswer(helperId: string | null | undefined, enabled: boolean): TipAnswer {
  const [answer, setAnswer] = useState<{ id: string; value: TipAnswer } | null>(null);
  useEffect(() => {
    if (!enabled || !helperId) return;
    let live = true;
    readTakesTips(helperId).then(
      (value) => { if (live) setAnswer({ id: helperId, value }); },
      (err: unknown) => {
        // Unknown on a thrown read too (offline): the tip stays offered.
        report(err, { severity: "warning", tags: { source: "useHelprTakesTips" } });
        cache.delete(helperId);
      },
    );
    return () => { live = false; };
  }, [helperId, enabled]);
  return enabled && helperId && answer?.id === helperId ? answer.value : null;
}

export function useHelprTakesTips(helperId: string | null | undefined, enabled = true): boolean | null {
  const a = useTipAnswer(helperId, enabled);
  const idCheckOn = useIdentityCheckOnStore();
  if (!a) return null;
  return a.payoutReady && (!idCheckOn || a.idVerified);
}

/** True when the ID check is on and this Helpr has not verified: the tip waits on that, whatever their payout setup says. */
export function useTipWaitsOnId(helperId: string | null | undefined, enabled = true): boolean {
  const idCheckOn = useIdentityCheckOnStore();
  // No read at all while the switch is off.
  const a = useTipAnswer(helperId, enabled && idCheckOn);
  return idCheckOn && a !== null && !a.idVerified;
}

/**
 * The one honest line a tip surface shows instead of the tip, when the Helpr can't receive one yet. It is shown BEFORE
 * any tip is tried, under a paid job, so it never says "Nothing was charged" (L27 JA-F1, 11-01: a completed poster read
 * that as the job itself not being charged). The server's refusal of a tip actually tried keeps its own words.
 */
export function tipsNotReadyLine(name: string | null | undefined, waitsOnId = false): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  // Audit 11-01 JA-61: this shows before any tip is tried, so it says when tips open, not "Nothing was charged".
  if (waitsOnId) return `Tips open once ${first || "this Helpr"} finishes verifying.`;
  return `${first || "This Helpr"} hasn't finished payout setup yet, so a tip can't reach them. You can tip once they do.`;
}
