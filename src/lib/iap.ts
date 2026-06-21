// Apple In-App Purchase client adapter (StoreKit 2 via cordova-plugin-purchase).
//
// App Store Guideline 3.1.1 requires digital subscriptions to be sold through
// Apple IAP inside the iOS app — Stripe checkout is web-only. On native iOS we
// route subscribe taps through StoreKit; on web we keep the existing Stripe
// flow (see SubscriptionTab).
//
// IMPORTANT — this adapter talks to the plugin through the `window.CdvPurchase`
// GLOBAL rather than importing the npm package. That keeps the web bundle free
// of a native-only dependency (nothing to resolve at build time) while the
// plugin's JS is injected into the iOS WebView by Capacitor's Cordova bridge at
// runtime. To activate it on device:
//   npm install cordova-plugin-purchase
//   npx cap sync ios
// and create the matching products in App Store Connect (see PRODUCT_IDS in
// supabase/functions/_shared/appleAppStore.ts — the ids must match exactly).

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Product id convention shared with the server map. (tier, cadence) -> id.
export type IapTier = "basic" | "pro" | "elite";
export type IapCadence = "monthly" | "annual" | "one_time";

export function productIdFor(tier: IapTier, cadence: IapCadence): string {
  const suffix = cadence === "one_time" ? "onetime" : cadence;
  return `com.helpr.${tier}.${suffix}`;
}

const ALL_PRODUCT_IDS: string[] = (["basic", "pro", "elite"] as IapTier[]).flatMap(
  (tier) =>
    (["monthly", "annual", "one_time"] as IapCadence[]).map((c) => productIdFor(tier, c)),
);

// Minimal shape of the slice of cordova-plugin-purchase (v13) we touch. Kept
// local so we don't need the package's types at build time.
interface CdvTransaction {
  transactionId?: string;
  finish: () => void;
}
interface CdvStore {
  initialized?: boolean;
  register: (products: Array<{ id: string; type: string; platform: string }>) => void;
  initialize: (platforms: string[]) => Promise<void>;
  update: () => Promise<void>;
  order: (productId: string) => Promise<{ isError?: boolean; message?: string } | void>;
  when: () => {
    approved: (cb: (tx: CdvTransaction) => void) => unknown;
    verified?: (cb: (receipt: { finish: () => void }) => void) => unknown;
  };
}
interface CdvPurchaseGlobal {
  store: CdvStore;
  ProductType: { PAID_SUBSCRIPTION: string; NON_RENEWING_SUBSCRIPTION: string };
  Platform: { APPLE_APPSTORE: string };
}

function getCdv(): CdvPurchaseGlobal | null {
  const g = (window as unknown as { CdvPurchase?: CdvPurchaseGlobal }).CdvPurchase;
  return g ?? null;
}

/** True only on a native iOS build that actually has the IAP plugin injected. */
export function isIapAvailable(): boolean {
  return Capacitor.getPlatform() === "ios" && getCdv() !== null;
}

let initialized = false;

/**
 * Register products and wire the approval handler exactly once. On `approved`
 * we hand the StoreKit transaction id to our edge function, which re-verifies
 * it against Apple and grants the tier; only then do we finish() the
 * transaction so StoreKit considers it consumed.
 */
async function ensureInitialized(): Promise<CdvPurchaseGlobal> {
  const cdv = getCdv();
  if (!cdv) throw new Error("In-app purchases are unavailable on this device.");
  if (initialized) return cdv;

  const { store, ProductType, Platform } = cdv;
  store.register(
    ALL_PRODUCT_IDS.map((id) => ({
      id,
      // Monthly/annual are auto-renewing; the *.onetime ids are non-renewing.
      type: id.endsWith(".onetime")
        ? ProductType.NON_RENEWING_SUBSCRIPTION
        : ProductType.PAID_SUBSCRIPTION,
      platform: Platform.APPLE_APPSTORE,
    })),
  );

  store.when().approved((tx) => {
    void (async () => {
      try {
        if (tx.transactionId) {
          await supabase.functions.invoke("verify-apple-iap", {
            body: { transactionId: tx.transactionId },
          });
        }
      } finally {
        // Always finish — leaving it open makes StoreKit re-deliver forever.
        tx.finish();
      }
    })();
  });

  await store.initialize([Platform.APPLE_APPSTORE]);
  initialized = true;
  return cdv;
}

/**
 * Kick off a native purchase for (tier, cadence). Resolves once StoreKit has
 * accepted the order; the server-side grant + local refresh happen via the
 * approval handler above, so callers should re-fetch the profile afterwards.
 */
export async function purchaseTier(tier: IapTier, cadence: IapCadence): Promise<void> {
  const cdv = await ensureInitialized();
  const result = await cdv.store.order(productIdFor(tier, cadence));
  if (result && "isError" in result && result.isError) {
    throw new Error(result.message || "Purchase failed");
  }
}
