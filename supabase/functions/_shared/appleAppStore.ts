// Apple In-App Purchase (StoreKit 2) server-side validation.
//
// Adapted from the unmerged `feat/apple-iap` branch (50efe839c, 2026-06-21),
// whose core design is right and is kept: the client sends ONLY a
// transactionId, and we re-fetch the authoritative transaction from Apple's
// App Store Server API over TLS using an App Store Connect API key. Because
// that response arrives over an authenticated TLS channel directly from
// Apple, decoding its JWS payload is safe without re-verifying the
// certificate chain ourselves.
//
// That re-fetch IS the trust boundary. A tampered client cannot grant itself a
// tier it did not pay for, and the same trick hardens the webhook: App Store
// Server Notifications arrive as an unauthenticated POST, so rather than trust
// the posted body we re-pull the transaction by id.
//
// TWO DELIBERATE CHANGES FROM THE BRANCH VERSION:
//
//  1. It imported `jose` from esm.sh to mint the ES256 bearer. This repo
//     already signs ES256 for APNs in _shared/jwt.ts, so we use that instead —
//     one less third-party dependency in the money path, and the same code path
//     push notifications already exercise in production.
//
//  2. The product map is DERIVED and CHECKED against the app's tier list rather
//     than hand-maintained. See PRODUCT_TIER_MAP below. The branch hard-coded
//     nine ids; adding a fourth tier would have silently left it unsellable on
//     iOS, which is the same shape as the Stripe placeholder bug that killed
//     the Plus tier (a registry that cannot fail for a missing member).
//
// Required edge-function secrets (`supabase secrets set`):
//   APPLE_IAP_ISSUER_ID    App Store Connect API key issuer id (UUID)
//   APPLE_IAP_KEY_ID       the .p8 key's Key ID
//   APPLE_IAP_PRIVATE_KEY  the .p8 contents (PEM, BEGIN/END lines included)
//   APPLE_IAP_BUNDLE_ID    the app bundle id
//   APPLE_IAP_ENVIRONMENT  "production" | "sandbox" (optional; we probe both)

import type { ProTierKey, ProBillingCycle } from "./proTiers.ts";

/**
 * Read a Deno env var without naming the `Deno` global at module scope.
 *
 * Same shape as proTiers.ts, and for the same reason: vitest imports this file
 * directly to test the product registry and the entitlement maths, and a bare
 * `Deno.env` reference (or a module-scope `./jwt.ts` import) drags the file
 * outside tsconfig.app.json and fails the build with TS2304/TS6307. Outside
 * Deno this returns undefined, which readAppleConfig then reports as
 * "not configured" rather than crashing an unrelated test.
 */
const readEnv = (key: string): string | undefined => {
  const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
  return d?.env?.get?.(key);
};

const PROD_BASE = "https://api.storekit.itunes.apple.com";
const SANDBOX_BASE = "https://api.storekit-sandbox.itunes.apple.com";

/** The paid tiers sellable through Apple. Mirrors ProTierKey exactly. */
export const APPLE_TIERS: readonly ProTierKey[] = ["basic", "pro", "elite"] as const;
export const APPLE_CYCLES: readonly ProBillingCycle[] = ["monthly", "annual", "one_time"] as const;

/**
 * The App Store Connect product identifier for a tier + cycle.
 *
 * Deriving these from a formula rather than listing them means a new tier
 * cannot be half-added: `appleProductId("plus", "monthly")` is well-formed the
 * moment "plus" exists in ProTierKey, and the accompanying test walks
 * ProTierKey × ProBillingCycle to assert every combination round-trips. A
 * hand-written map can only be checked against itself, which is exactly how
 * the Stripe side shipped `price_TODO_LIVE_PLUS_*` to a live storefront.
 *
 * These strings MUST match the products created in App Store Connect. The
 * cycle segment is spelled `onetime` (not `one_time`) because Apple product
 * ids conventionally avoid underscores; the mapping is total and reversible,
 * which the test also asserts.
 */
export function appleProductId(tier: ProTierKey, cycle: ProBillingCycle): string {
  const suffix = cycle === "one_time" ? "onetime" : cycle;
  return `com.helpr.${tier}.${suffix}`;
}

export interface ProductMeta {
  tier: ProTierKey;
  cadence: ProBillingCycle;
  /** "auto" = auto-renewable subscription; "once" = non-renewing fixed window. */
  kind: "auto" | "once";
}

/** productId → meta, built from the tier list so it cannot drift from it. */
export const PRODUCT_TIER_MAP: Record<string, ProductMeta> = Object.fromEntries(
  APPLE_TIERS.flatMap((tier) =>
    APPLE_CYCLES.map((cadence) => [
      appleProductId(tier, cadence),
      { tier, cadence, kind: cadence === "one_time" ? "once" : "auto" } as ProductMeta,
    ]),
  ),
);

export const PRODUCT_IDS = Object.keys(PRODUCT_TIER_MAP);

/** Apple's StoreKit 2 JWSTransactionDecodedPayload — the fields we use. */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  /** ms epoch; present for auto-renewable subscriptions. */
  expiresDate?: number;
  /** ms epoch; set when Apple refunds or revokes the purchase. */
  revocationDate?: number;
  type?: string;
  purchaseDate?: number;
}

/**
 * Decode a JWS compact token's payload WITHOUT signature checking.
 *
 * Safe ONLY for a token we just received over authenticated TLS from Apple's
 * own API. Never call this on a token that arrived in a webhook body — re-pull
 * the transaction from the API by id instead, which is what the notifications
 * handler does.
 */
export function decodeJwsPayload<T = unknown>(jws: string): T {
  const segments = jws.split(".");
  if (segments.length !== 3) throw new Error("Malformed JWS");
  const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  // atob rejects an unpadded string in some runtimes; base64url drops padding.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as T;
}

interface AppleConfig {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  preferSandbox: boolean;
}

export function readAppleConfig(): AppleConfig {
  const issuerId = readEnv("APPLE_IAP_ISSUER_ID");
  const keyId = readEnv("APPLE_IAP_KEY_ID");
  const privateKeyPem = readEnv("APPLE_IAP_PRIVATE_KEY");
  const bundleId = readEnv("APPLE_IAP_BUNDLE_ID");
  if (!issuerId || !keyId || !privateKeyPem || !bundleId) {
    throw new Error(
      "Apple IAP not configured: set APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, " +
        "APPLE_IAP_PRIVATE_KEY, APPLE_IAP_BUNDLE_ID",
    );
  }
  return {
    issuerId,
    keyId,
    privateKeyPem,
    bundleId,
    preferSandbox: readEnv("APPLE_IAP_ENVIRONMENT") === "sandbox",
  };
}

/**
 * Mint the short-lived ES256 bearer the App Store Server API requires.
 * Apple caps `exp` at 60 minutes out; 20 is plenty for a single request and
 * limits the blast radius if one ever leaks into a log.
 */
async function mintBearer(cfg: AppleConfig): Promise<string> {
  // Imported HERE rather than at module scope so this file stays importable
  // from vitest — see readEnv above. Only the network path needs it.
  const { signEs256Jwt } = await import("./jwt.ts");
  return await signEs256Jwt({
    keyId: cfg.keyId,
    issuer: cfg.issuerId,
    p8Pem: cfg.privateKeyPem,
    optionalClaims: {
      aud: "appstoreconnect-v1",
      bid: cfg.bundleId,
      exp: Math.floor(Date.now() / 1000) + 20 * 60,
    },
  });
}

/**
 * Fetch the authoritative transaction for `transactionId` straight from Apple.
 *
 * Probes production then sandbox (or the reverse when APPLE_IAP_ENVIRONMENT
 * says sandbox). This is Apple's own recommendation: the client cannot tell us
 * reliably which environment it hit, and a TestFlight build talks to sandbox
 * while the same binary in the App Store talks to production.
 */
export async function fetchAppleTransaction(
  transactionId: string,
): Promise<AppleTransaction> {
  const cfg = readAppleConfig();
  const bearer = await mintBearer(cfg);
  const bases = cfg.preferSandbox ? [SANDBOX_BASE, PROD_BASE] : [PROD_BASE, SANDBOX_BASE];

  let lastStatus = 0;
  for (const base of bases) {
    const res = await fetch(
      `${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (res.ok) {
      const { signedTransactionInfo } = await res.json();
      const tx = decodeJwsPayload<AppleTransaction>(signedTransactionInfo);
      // A transaction from ANOTHER app is not evidence of anything here.
      if (tx.bundleId !== cfg.bundleId) {
        throw new Error("Transaction bundleId mismatch");
      }
      return tx;
    }
    lastStatus = res.status;
    // 404 in one environment means "try the other". Anything else is terminal —
    // a 401 in production is a bad key, and retrying it against sandbox would
    // turn a clear auth failure into a confusing "not found".
    if (res.status !== 404) break;
  }
  throw new Error(`App Store Server API lookup failed (status ${lastStatus})`);
}

/** Resolve a product id to its tier, or null when it isn't one of ours. */
export function resolveProduct(productId: string): ProductMeta | null {
  return PRODUCT_TIER_MAP[productId] ?? null;
}

/**
 * The `subscription_expires_at` a transaction grants.
 *   auto-renewable → Apple's expiresDate (renewals push it forward by webhook)
 *   one-time perk   → one year from purchase, matching the web one-time pass
 * Returns null when the purchase has been revoked or refunded.
 */
export function computeExpiry(tx: AppleTransaction, meta: ProductMeta): string | null {
  if (tx.revocationDate) return null;
  if (meta.kind === "auto") {
    return tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
  }
  const base = tx.purchaseDate ?? Date.now();
  return new Date(base + 365 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Is this transaction currently entitling anything?
 *
 * Separated from computeExpiry because the webhook needs the same question
 * answered for an event that may be a refund, an expiry, or a renewal, and
 * "expiry is null" alone conflates "revoked" with "one-time with no date".
 */
export function isEntitled(tx: AppleTransaction, meta: ProductMeta, now = Date.now()): boolean {
  if (tx.revocationDate) return false;
  const expiry = computeExpiry(tx, meta);
  if (!expiry) return false;
  return new Date(expiry).getTime() > now;
}
