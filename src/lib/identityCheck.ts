/**
 * Stripe Identity, the one ID check (owner 2026-10-30, replacing the removal of
 * 2026-10-23): a photo ID and a selfie, once per person. A poster when they post
 * a job. A Helpr when hired, or at the first payout if somehow skipped; they
 * cannot head out until verified. Never at sign-up or applying, on Home, in a
 * checklist or in Settings. Once verified, never again. Payout setup (Stripe
 * Connect) is a separate step and is never an ID check.
 *
 * THE ENFORCEMENT IS NOT HERE. It is the server: identity_is_verified (the one
 * rule, idv_status = 'verified'), the jobs triggers enforce_identity_before_post /
 * enforce_identity_before_start (migration 20261021081258), and the payout claim
 * (payout_waits_on_identity). This module only opens the one sheet that explains
 * and starts the check, from wherever the member meets the gate.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { identityCheckOn } from "@/lib/identityCheckSwitch";
import { supabase } from "@/integrations/supabase/client";
import { hasIdBadge } from "@/lib/awardGate";
import { report } from "@/lib/errorLogger";

/** Why the sheet opened: picks the first sentence, never the rule. */
export type IdentityCheckReason = "start" | "post" | "accept" | "buy" | "list" | "deliver" | "claim" | "general";

interface SheetState {
  open: boolean;
  reason: IdentityCheckReason;
}

let state: SheetState = { open: false, reason: "general" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open the one Identity sheet (mounted once, IdentityCheckHost). */
export function openIdentityCheck(reason: IdentityCheckReason = "general"): boolean {
  // ID check off (switch `identity_check`, owner 2026-10-23): nothing to open.
  // Returns false so a caller handling a server refusal falls through to its
  // own error message instead of stopping in silence (lh-silent-failure #1).
  if (!identityCheckOn()) return false;
  state = { open: true, reason };
  emit();
  return true;
}

export function closeIdentityCheck(): void {
  state = { ...state, open: false };
  emit();
}

export function useIdentityCheckSheet(): SheetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/**
 * Does this member still need the check? Stripe Identity verified (or an
 * approved ID) never does. A test account (is_seed) is the server's carve-out
 * (identity_check_exempt also requires test_accounts enrolment, which the
 * client cannot read; the server stays the authority either way).
 */
export function needsIdentityCheck(profile: { idv_status?: string | null; is_seed?: boolean | null } | null | undefined): boolean {
  if (!profile) return false;
  // ID check off (switch `identity_check`, owner 2026-10-23): nobody needs it.
  if (!identityCheckOn()) return false;
  if (profile.is_seed === true) return false;
  return !hasIdBadge(profile.idv_status);
}

/** The sheet's state, from profiles.idv_status (stripe-idv-webhook writes it). */
export type IdentityView = "start" | "continue" | "checking" | "with_team" | "failed" | "verified";

export function identityView(idvStatus: string | null | undefined): IdentityView {
  switch (idvStatus) {
    case "verified":
      return "verified";
    // A session was created and not submitted yet: the same session reopens free.
    case "pending":
      return "continue";
    case "processing":
      return "checking";
    // Stripe could not confirm it (requires_input / canceled land here): a person decides.
    case "manual_review":
      return "with_team";
    // Only a refused match (a previously removed account) is terminal.
    case "failed":
      return "failed";
    default:
      return "start";
  }
}

/**
 * A check "with our team" (manual_review) is STALE once it has waited 48 hours
 * with no admin decision (an admin decision moves idv_status off
 * manual_review, so still being in it IS "no decision"). Stale, the sheet leads
 * with a fresh Stripe check; under 48 h it still says "with our team" and
 * offers the fresh check second (owner report 2026-10-21). Either way the
 * server decides whether a restart may start (stripe-idv-start +
 * claim_idv_attempt).
 */
export const IDENTITY_REVIEW_STALE_MS = 48 * 60 * 60 * 1000;

export function identityReviewIsStale(since: string | null | undefined, now: number = Date.now()): boolean {
  if (!since) return false;
  const t = Date.parse(since);
  return Number.isFinite(t) && now - t > IDENTITY_REVIEW_STALE_MS;
}

/**
 * When the member's CURRENT manual review began: their newest idv_status ->
 * manual_review row in helper_verifications (written by the profiles history
 * trigger; RLS lets a member read their own), else `fallback` (the profile's
 * updated_at, which any profile edit moves, so it can only make the wait look
 * shorter). The server's idv_review_waiting_since() reads the same two.
 * Unreadable -> the fallback; a wrong "fresh" only reorders the two buttons.
 */
export async function readIdentityReviewSince(userId: string, fallback: string | null | undefined): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("helper_verifications")
      .select("changed_at")
      .eq("user_id", userId)
      .eq("field", "idv_status")
      .eq("new_value", "manual_review")
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.changed_at ?? fallback ?? null;
  } catch (e) {
    report(e, { severity: "warning", tags: { area: "identity", op: "readIdentityReviewSince" } });
    return fallback ?? null;
  }
}

/**
 * The server's refusal, recognised by its raised code (migration
 * 20261021081258), so a caller can open the sheet instead of a dead-end toast.
 */
export function identityRefusal(err: unknown): "post" | "start" | "buy" | "list" | "deliver" | "claim" | null {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  const m = typeof raw === "string" ? raw : "";
  if (/(^|[^a-z_])identity_required_to_post($|[^a-z_])/.test(m)) return "post";
  if (/(^|[^a-z_])identity_required_to_start($|[^a-z_])/.test(m)) return "start";
  // Declutter (owner 2026-10-22): the first purchase or the first listing (20261021202226).
  if (/(^|[^a-z_])identity_required_to_buy($|[^a-z_])/.test(m)) return "buy";
  if (/(^|[^a-z_])identity_required_to_list($|[^a-z_])/.test(m)) return "list";
  if (/(^|[^a-z_])identity_required_to_deliver($|[^a-z_])/.test(m)) return "deliver";
  if (/(^|[^a-z_])identity_required_to_claim($|[^a-z_])/.test(m)) return "claim";
  return null;
}

/**
 * The signed-in member's own `idv_status` and `is_seed`, for a job card that
 * has no profile of its own. Self-contained (no QueryClient), re-read whenever
 * the ID sheet opens or closes, and fails quiet to "unknown" (null): an
 * unreadable answer shows no prompt, and the server still holds the gate.
 */
export function useMyIdentityProfile(): { idv_status: string | null; is_seed: boolean | null } | null {
  const sheet = useIdentityCheckSheet();
  const [me, setMe] = useState<{ idv_status: string | null; is_seed: boolean | null } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) return;
        const { data, error } = await supabase.from("profiles").select("idv_status, is_seed").eq("user_id", uid).maybeSingle();
        if (error) throw error;
        if (live) setMe(data ?? null);
      } catch (e) {
        report(e, { severity: "warning", tags: { area: "identity", op: "useMyIdentityProfile" } });
      }
    })();
    return () => {
      live = false;
    };
  }, [sheet.open]);
  return me;
}

/**
 * Right after a Helpr's day-of confirm (owner 2026-10-21: confirm, THEN Stripe
 * Identity, then On the way): open the ID sheet if they still need it. Read
 * fresh; an unreadable answer opens nothing, and the server still refuses On the
 * way without it.
 */
export async function offerIdentityCheckAfterConfirm(): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { data, error } = await supabase.from("profiles").select("idv_status, is_seed").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (needsIdentityCheck(data)) openIdentityCheck("start");
  } catch (e) {
    report(e, { severity: "warning", tags: { area: "identity", op: "offerIdentityCheckAfterConfirm" } });
  }
}
