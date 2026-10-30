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

/** Open the one-time fee page; it brings the member back to their Declutter listings. */
async function payAccountSetupFee(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke("pay-onboarding-fee", {
      body: { native: isNativePlatform, return_to: "declutter_selling" },
    });
    if (error) throw await functionInvokeError(error);
    if (data?.alreadyPaid) {
      toast.success("Your setup fee is already paid. Publish your listing again.");
      return;
    }
    if (typeof data?.url !== "string") throw new Error("The payment page did not open. Try again.");
    await openExternalUrl(data.url);
  } catch (err) {
    report(err, { tags: { source: "declutter.payAccountSetupFee" } });
    toast.error(userFacingError(err, "We couldn't open the payment page. Try again."));
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
