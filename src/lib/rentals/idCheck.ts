/**
 * The paid Stripe Identity check (photo ID + selfie) a landlord buys from
 * Homes' "Verify your ID" pill (owner 2026-10-19: "BOTH WAYS, BUT THEY HAVE TO
 * PAY FOR THEIR OWN ID"). Both steps go through `stripe-idv-start`:
 *
 *   "checkout" — Stripe Checkout for the check's cost plus its card fee
 *                (supabase/functions/_shared/idvFee.ts). Returns its URL, or
 *                says a paid check is already waiting / the ID is verified.
 *   "start"    — only after the webhook has confirmed that payment: the
 *                hosted Stripe Identity page for the paid check (the same
 *                session again while it was never submitted).
 *
 * Its own module, not api.ts: Rentals' screen tests stub api.ts whole, and this
 * is the one call whose request body they must see.
 */
import { supabase } from "@/integrations/supabase/client";
import { functionErrorBody } from "@/lib/supabaseResult";
import { isNativePlatform } from "@/lib/nativeInit";

export type IdCheckStep =
  /** Open this Stripe page (Checkout, or the hosted ID check). */
  | { kind: "open"; url: string }
  /** Already ID-verified: nothing to pay or do. */
  | { kind: "verified" }
  /** The check was submitted and Stripe is still deciding. */
  | { kind: "processing" }
  /** A paid check is already waiting: start it instead of paying again. */
  | { kind: "paid" }
  /** No paid check yet: pay first. */
  | { kind: "needs_fee"; feeCents: number | null };

const FALLBACK = "Couldn't open the ID check. Try again in a moment.";

async function call(action: "checkout" | "start"): Promise<IdCheckStep> {
  const { data, error } = await supabase.functions.invoke("stripe-idv-start", {
    body: { action, native: isNativePlatform },
  });
  if (error) {
    // The SDK's own message is "non-2xx"; the reason and the flags are in the body.
    const body = await functionErrorBody(error);
    if (body?.needsIdvFee === true) {
      return { kind: "needs_fee", feeCents: typeof body.feeCents === "number" ? body.feeCents : null };
    }
    const words = typeof body?.error === "string" && body.error.trim() ? body.error : FALLBACK;
    throw new Error(words);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.alreadyVerified === true) return { kind: "verified" };
  if (d.processing === true) return { kind: "processing" };
  if (d.paid === true) return { kind: "paid" };
  if (typeof d.url === "string" && d.url.startsWith("https://")) return { kind: "open", url: d.url };
  if (typeof d.error === "string" && d.error.trim()) throw new Error(d.error);
  throw new Error(FALLBACK);
}

/** Step 1: Stripe Checkout for the ID check's cost (card or Link). */
export const payForIdCheck = () => call("checkout");

/** Step 2 (after the payment is confirmed): the hosted Stripe Identity page. */
export const startIdCheck = () => call("start");
