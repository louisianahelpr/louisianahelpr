/**
 * Stripe Embedded Checkout inside our own sheet (in-app pay plan phase W). The ONE module that loads Stripe.js
 * (src/test/threeDSecureOnLargeCharges.test.ts holds that exact): the card form, 3D Secure challenges and wallets all
 * run inside Stripe's own iframe, so no code of ours confirms a payment. Loaded lazily by useCheckoutPage.
 */
import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Dialog, DialogContent, DialogDescription, DialogHero } from "@/components/ui/dialog";
import { report } from "@/lib/errorLogger";
import { ErrorState } from "@/components/ui/ErrorState";

/** One Stripe.js instance per publishable key (test accounts pay on the test key). */
const stripeByKey = new Map<string, ReturnType<typeof loadStripe>>();
function stripeFor(key: string): ReturnType<typeof loadStripe> {
  let s = stripeByKey.get(key);
  if (!s) {
    s = loadStripe(key);
    // A failed load is not cached: the next Pay tries again.
    s.catch(() => stripeByKey.delete(key));
    stripeByKey.set(key, s);
  }
  return s;
}

export default function EmbeddedCheckoutSheet({ clientSecret, publishableKey, onClose }: {
  clientSecret: string;
  publishableKey: string;
  onClose: () => void;
}) {
  // Bumped by "Try again": a failed load is already out of stripeByKey, so this loads Stripe.js afresh.
  const [attempt, setAttempt] = useState(0);
  const stripe = useMemo(() => stripeFor(publishableKey), [publishableKey, attempt]);
  const options = useMemo(() => ({ clientSecret }), [clientSecret]);
  // Stripe.js comes from js.stripe.com: a blocker, a network drop or a CSP refusal makes it reject (or resolve null).
  // Then the sheet says so instead of staying blank, and the failure is reported.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    stripe.then(
      (s) => {
        if (s) return;
        report(new Error("Stripe.js loaded as null"), { tags: { area: "embedded_checkout" } });
        if (live) setFailed(true);
      },
      (err: unknown) => {
        report(err, { tags: { area: "embedded_checkout" } });
        if (live) setFailed(true);
      },
    );
    return () => { live = false; };
  }, [stripe]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto" data-embedded-checkout="">
        <DialogHero title="Pay securely" />
        <DialogDescription>Your card is handled by Stripe. You stay on Louisiana Helpr.</DialogDescription>
        {failed ? (
          <ErrorState variant="inline" title="We couldn't load the payment form."
            body="You have not been charged." onRetry={() => { setFailed(false); setAttempt((a) => a + 1); }} />
        ) : (
          <div className="min-h-[420px]">
            <EmbeddedCheckoutProvider stripe={stripe} options={options}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
