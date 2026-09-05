// Apple In-App Purchase client adapter (StoreKit 2 via cordova-plugin-purchase).
//
// App Store guideline 3.1.1 requires digital subscriptions to sell through
// Apple inside the iOS app; Stripe checkout stays web-only. SubscriptionTab
// branches on isIapAvailable().
//
// This adapter talks to the plugin through the `window.CdvPurchase` GLOBAL
// rather than importing the npm package, which is what keeps the web bundle
// free of a native-only dependency — there is nothing to resolve at build time,
// and the plugin's JS is injected into the iOS WebView by Capacitor's Cordova
// bridge at runtime. To activate on device:
//
//   npm install cordova-plugin-purchase && npx cap sync ios
//
// plus the matching products in App Store Connect. The ids must match
// _shared/appleAppStore.ts exactly; iapParity.test.ts asserts they do.
//
// ── Adapted from the unmerged feat/apple-iap branch, with one real fix ──────
//
// The branch finished the StoreKit transaction in a `finally`:
//
//     try { await supabase.functions.invoke("verify-apple-iap", …) }
//     finally { tx.finish() }
//
// finish() tells StoreKit the purchase has been delivered, and StoreKit then
// stops re-delivering it. So a verification that failed for ANY reason — the
// network dropped, the function 500'd, the device backgrounded mid-call —
// consumed the transaction anyway and the grant was lost permanently. The
// member paid Apple and had no receipt left to retry with.
//
// That redelivery is the entire safety net for a failed server call: StoreKit
// re-presents an unfinished transaction on the next launch, forever, until it
// is finished. So we finish ONLY on a confirmed grant.
//
// The same code also ignored the invoke result. `supabase.functions.invoke`
// RESOLVES with `{ data, error }` on a failed function rather than throwing, so
// the try/catch it relied on never fired — the failure was invisible as well as
// unrecoverable.

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export type IapTier = "basic" | "pro" | "elite";
export type IapCadence = "monthly" | "annual" | "one_time";

/**
 * Client mirror of `appleProductId` in
 * supabase/functions/_shared/appleAppStore.ts.
 *
 * Duplicated rather than imported: that module is Deno-side and carries the
 * App Store Server API fetch path, which has no business in the web bundle.
 * src/test/appleIap.test.ts asserts the two agree for every tier and cycle, so
 * they cannot drift — the same client-mirror-plus-parity-test shape the Stripe
 * price map already uses.
 */
export function productIdFor(tier: IapTier, cadence: IapCadence): string {
  const suffix = cadence === "one_time" ? "onetime" : cadence;
  return `com.helpr.${tier}.${suffix}`;
}

export const IAP_TIERS: IapTier[] = ["basic", "pro", "elite"];
export const IAP_CADENCES: IapCadence[] = ["monthly", "annual", "one_time"];

const ALL_PRODUCT_IDS: string[] = IAP_TIERS.flatMap((tier) =>
  IAP_CADENCES.map((c) => productIdFor(tier, c)),
);

// Minimal shape of the slice of cordova-plugin-purchase (v13) we touch, kept
// local so the package's types are not a build-time requirement.
interface CdvTransaction {
  transactionId?: string;
  finish: () => void;
}
interface CdvStore {
  register: (products: Array<{ id: string; type: string; platform: string }>) => void;
  initialize: (platforms: string[]) => Promise<void>;
  restorePurchases: () => Promise<unknown>;
  order: (productId: string) => Promise<{ isError?: boolean; message?: string } | void>;
  when: () => {
    approved: (cb: (tx: CdvTransaction) => void) => unknown;
  };
}
interface CdvPurchaseGlobal {
  store: CdvStore;
  ProductType: { PAID_SUBSCRIPTION: string; NON_RENEWING_SUBSCRIPTION: string };
  Platform: { APPLE_APPSTORE: string };
}

function getCdv(): CdvPurchaseGlobal | null {
  return (window as unknown as { CdvPurchase?: CdvPurchaseGlobal }).CdvPurchase ?? null;
}

/** True only on a native iOS build that actually has the IAP plugin injected. */
export function isIapAvailable(): boolean {
  return Capacitor.getPlatform() === "ios" && getCdv() !== null;
}

let initialized = false;

/**
 * Hand a StoreKit transaction to the server, which re-verifies it against
 * Apple and grants the tier. Returns whether the grant is confirmed.
 *
 * `invoke` resolves with `{ error }` rather than throwing when the function
 * fails, so the error is read explicitly — and a thrown network error is caught
 * too, because both mean the same thing here: not confirmed, do not finish.
 */
async function confirmGrant(transactionId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("verify-apple-iap", {
      body: { transactionId },
    });
    if (error) {
      report(error, { tags: { source: "iap.verify" } });
      return false;
    }
    // The function answers { tier, expires_at }. A 200 with no tier means it
    // did not grant, and finishing on that would discard the receipt.
    return !!(data as { tier?: string } | null)?.tier;
  } catch (e) {
    report(e, { tags: { source: "iap.verify.throw" } });
    return false;
  }
}

/**
 * Register products and wire the approval handler exactly once.
 *
 * `initialized` is set only after initialize() resolves, so a failed attempt
 * can be retried rather than leaving the adapter permanently half-set-up.
 */
async function ensureInitialized(): Promise<CdvPurchaseGlobal> {
  const cdv = getCdv();
  if (!cdv) throw new Error("In-app purchases are unavailable on this device.");
  if (initialized) return cdv;

  const { store, ProductType, Platform } = cdv;
  store.register(
    ALL_PRODUCT_IDS.map((id) => ({
      id,
      // Monthly/annual auto-renew; the *.onetime ids are non-renewing.
      type: id.endsWith(".onetime")
        ? ProductType.NON_RENEWING_SUBSCRIPTION
        : ProductType.PAID_SUBSCRIPTION,
      platform: Platform.APPLE_APPSTORE,
    })),
  );

  // Fires for a fresh purchase AND for every unfinished transaction StoreKit
  // re-presents — which is what makes a failed verification recoverable, and
  // what makes Restore Purchases work through the same path.
  store.when().approved((tx) => {
    void (async () => {
      if (!tx.transactionId) return;
      const granted = await confirmGrant(tx.transactionId);
      if (granted) {
        // ONLY here. See the header: finishing an unverified transaction
        // discards the buyer's only receipt.
        tx.finish();
      }
      // Not granted: leave it unfinished. StoreKit re-presents it on the next
      // launch and we try again, indefinitely.
    })();
  });

  await store.initialize([Platform.APPLE_APPSTORE]);
  initialized = true;
  return cdv;
}

/** Thrown when the pre-purchase gate refuses. Carries copy fit to show a user. */
export class IapBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IapBlockedError";
  }
}

/**
 * Ask the server whether this person may buy through Apple at all.
 *
 * The rule is one place — subscription_purchase_eligibility() — so the iOS
 * sheet, the web storefront and create-pro-checkout cannot disagree about who
 * is allowed to buy. Checking BEFORE the sheet opens is the whole point: once
 * Apple has taken the money, refusing is strictly worse than allowing, because
 * the member is then charged and unentitled.
 */
export async function assertMayPurchase(): Promise<void> {
  // Cast: the RPC is newer than the last types regeneration.
  const { data, error } = await (supabase.rpc as never as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>)(
    "subscription_purchase_eligibility",
    { p_platform: "apple" },
  );
  if (error) {
    // Fail CLOSED, matching create-pro-checkout: a purchase we cannot prove is
    // allowed is exactly the one that double-charges, and a wrongly-blocked
    // purchase costs a retry while a wrongly-allowed one costs a refund.
    report(error, { tags: { source: "iap.eligibility" } });
    throw new IapBlockedError(
      "We couldn't confirm your membership status. Please try again in a moment.",
    );
  }
  const verdict = data as { allowed?: boolean; reason?: string } | null;
  if (verdict && verdict.allowed === false) {
    throw new IapBlockedError(verdict.reason ?? "You already have an active membership.");
  }
}

/**
 * Kick off a native purchase. Resolves once StoreKit has accepted the order;
 * the grant lands through the approval handler, so callers should refetch the
 * profile afterwards.
 */
export async function purchaseTier(tier: IapTier, cadence: IapCadence): Promise<void> {
  await assertMayPurchase();
  const cdv = await ensureInitialized();
  const result = await cdv.store.order(productIdFor(tier, cadence));
  if (result && "isError" in result && result.isError) {
    throw new Error(result.message || "Purchase failed");
  }
}

/**
 * Restore Purchases. Apple REQUIRES this control to exist for any app selling
 * non-consumables or subscriptions — an app without one is rejected at review.
 *
 * Deliberately does NOT go through assertMayPurchase: restoring is not buying,
 * it charges nothing, and someone who already owns a subscription is exactly
 * who needs it.
 */
export async function restorePurchases(): Promise<void> {
  const cdv = await ensureInitialized();
  await cdv.store.restorePurchases();
}

/** Test seam: reset the once-only initialisation. */
export function __resetIapForTests(): void {
  initialized = false;
}
