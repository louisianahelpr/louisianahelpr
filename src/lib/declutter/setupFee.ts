import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { functionInvokeError } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Q2352 (owner 2026-10-23, #3557 answer 1): a member who has not paid the
 * one-time account setup fee pays it BY CARD at their first Declutter listing,
 * right after the ID check. The server refuses the listing with
 * `setup_fee_required_to_list` (20261026154738, declutter_setup_fee_before_list);
 * the app then offers the existing one-time fee page (pay-onboarding-fee), which
 * the stripe-webhook settles with the same one-winner claim every other path
 * uses. A member who already paid it (for Jobs or a Declutter purchase) is never
 * asked: the server answers alreadyPaid and nothing is charged.
 */
export function setupFeeRefusal(err: unknown): boolean {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof raw === "string" && /(^|[^a-z_])setup_fee_required_to_list($|[^a-z_])/.test(raw);
}

/**
 * Open the one-time fee page; it brings the member back to their Declutter listings.
 * "already_paid": the server says nothing is owed (a profile read can lag the webhook), so the caller re-reads it.
 */
export async function payAccountSetupFee(returnTo: "declutter_selling" | "declutter_free_claim" = "declutter_selling"): Promise<"already_paid" | "opened" | "failed"> {
  try {
    const { data, error } = await supabase.functions.invoke("pay-onboarding-fee", {
      body: { native: isNativePlatform, return_to: returnTo },
    });
    if (error) throw await functionInvokeError(error);
    if (data?.alreadyPaid) {
      toast.success(returnTo === "declutter_free_claim" ? "Your setup fee is already paid." : "Your setup fee is already paid. Publish your listing again.");
      return "already_paid";
    }
    if (typeof data?.url !== "string") throw new Error("The payment page did not open. Try again.");
    await openExternalUrl(data.url);
    return "opened";
  } catch (err) {
    report(err, { tags: { source: "declutter.payAccountSetupFee" } });
    toast.error(userFacingError(err, "We couldn't open the payment page. Try again."));
    return "failed";
  }
}

/** One prompt, whatever screen the refused listing came from. */
export function promptAccountSetupFee(): void {
  toast("One-time account setup fee", {
    id: "declutter-setup-fee",
    description: "Your first listing needs it. It's charged once per account, and never again if you already paid it for Jobs.",
    action: { label: "Pay it", onClick: () => void payAccountSetupFee() },
    duration: 20_000,
  });
}

/**
 * A first free claim (owner 2026-10-30): the server refuses until the one-time fee is paid, then until the ID is verified
 * (declutter_free_claim_gate). The first opens the one short screen (FreeClaimFirstTime), the second the ID sheet.
 */
export function freeClaimFeeRefusal(err: unknown): boolean {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof raw === "string" && /(^|[^a-z_])setup_fee_required_to_claim($|[^a-z_])/.test(raw);
}

/** Either step of the first claim: its own screen answers it, so the caller shows no error message as well. */
export function freeClaimGateRefusal(err: unknown): boolean {
  if (freeClaimFeeRefusal(err)) return true;
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof raw === "string" && /(^|[^a-z_])identity_required_to_claim($|[^a-z_])/.test(raw);
}

let firstTimeOpen = false;
const firstTimeListeners = new Set<() => void>();
const setFirstTime = (next: boolean) => {
  if (next === firstTimeOpen) return;
  firstTimeOpen = next;
  firstTimeListeners.forEach((l) => l());
};
export const openFreeClaimFirstTime = (): void => setFirstTime(true);
export const closeFreeClaimFirstTime = (): void => setFirstTime(false);
export const isFreeClaimFirstTimeOpen = (): boolean => firstTimeOpen;
export function subscribeFreeClaimFirstTime(l: () => void): () => void {
  firstTimeListeners.add(l);
  return () => firstTimeListeners.delete(l);
}
