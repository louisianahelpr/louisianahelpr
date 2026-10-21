/**
 * Stripe Identity, the one ID check (owner, 2026-10-21): a photo ID and a
 * selfie, required before a member's first accepted job, first posted job, and
 * before a Helpr heads out. Payout setup (Stripe Connect) is a separate step and
 * is never an ID check.
 *
 * THE ENFORCEMENT IS NOT HERE. It is the server: identity_is_verified (the one
 * rule, idv_status = 'verified'), helper_accept_missing for accepts, and the
 * jobs triggers enforce_identity_before_post / enforce_identity_before_start
 * (migration 20261021081258). This module only opens the one sheet that
 * explains and starts the check, from wherever the member meets the gate.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hasIdBadge } from "@/lib/awardGate";
import { report } from "@/lib/errorLogger";

/** Why the sheet opened: picks the first sentence, never the rule. */
export type IdentityCheckReason = "start" | "post" | "accept" | "general";

interface SheetState {
  open: boolean;
  reason: IdentityCheckReason;
}

let state: SheetState = { open: false, reason: "general" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open the one Identity sheet (mounted once, IdentityCheckHost). */
export function openIdentityCheck(reason: IdentityCheckReason = "general"): void {
  state = { open: true, reason };
  emit();
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
 * The server's refusal, recognised by its raised code (migration
 * 20261021081258), so a caller can open the sheet instead of a dead-end toast.
 */
export function identityRefusal(err: unknown): "post" | "start" | null {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  const m = typeof raw === "string" ? raw : "";
  if (/(^|[^a-z_])identity_required_to_post($|[^a-z_])/.test(m)) return "post";
  if (/(^|[^a-z_])identity_required_to_start($|[^a-z_])/.test(m)) return "start";
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
