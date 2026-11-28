/**
 * Opens whichever payment page the server answered with (src/lib/payments/checkoutPage.ts): Stripe's hosted page
 * through openExternalUrl (the app's in-app browser sheet; a navigation on the web), or, on the website, Stripe's
 * Embedded Checkout inside our own sheet. Render `sheet` once in the component; call `open(page, onClose)` where the
 * code called openExternalUrl(url, onClose) before.
 *
 * `onClose` keeps openExternalUrl's meaning: "the buyer is back, refetch", never "paid" (the webhook is the only
 * source of truth). A completed embedded payment does not close the sheet: Stripe sends the tab to the session's
 * return_url, the same page the hosted flow lands on.
 */
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { loadModule } from "@/lib/loadModule";
import type { CheckoutPage } from "@/lib/payments/checkoutPage";

// Lazy: Stripe.js and React Stripe load only when an embedded page opens (vite.config.ts names the chunk "stripe";
// scripts/check-deferred-vendors.mjs keeps it off every page's boot).
const EmbeddedCheckoutSheet = lazy(() => import("./EmbeddedCheckoutSheet"));
const loadSheet = () => loadModule(() => import("./EmbeddedCheckoutSheet"));

type EmbeddedPage = Extract<CheckoutPage, { kind: "embedded" }>;

export function useCheckoutPage(): { open: (page: CheckoutPage, onClose?: () => void) => Promise<void>; sheet: ReactNode } {
  const [embedded, setEmbedded] = useState<{ page: EmbeddedPage; onClose?: () => void } | null>(null);
  const open = useCallback(async (page: CheckoutPage, onClose?: () => void) => {
    if (page.kind === "hosted") {
      await openExternalUrl(page.url, onClose);
      return;
    }
    // The chunk is fetched BEFORE the sheet mounts, so a failed download (offline, a deploy replaced the chunk) rejects
    // here, into the caller's own catch (its error toast, Pay pressable again), instead of throwing inside Suspense.
    // null: a stale chunk's recovery reload is already on its way (loadModule), so nothing opens.
    if (!(await loadSheet())) return;
    setEmbedded({ page, onClose });
  }, []);
  const sheet = embedded ? (
    <Suspense fallback={null}>
      <EmbeddedCheckoutSheet
        clientSecret={embedded.page.clientSecret}
        publishableKey={embedded.page.publishableKey}
        onClose={() => {
          setEmbedded(null);
          embedded.onClose?.();
        }}
      />
    </Suspense>
  ) : null;
  return { open, sheet };
}
