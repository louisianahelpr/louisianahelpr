// Shared helpers for Apple In-App Purchase (StoreKit 2) server-side validation.
//
// DIY verification strategy (no RevenueCat):
//   The client purchases via StoreKit 2 and sends us only a `transactionId`.
//   We never trust the client's word for *what* was bought — instead we call
//   Apple's App Store Server API over TLS, authenticated with an App Store
//   Connect API key, and read the authoritative signed transaction straight
//   from Apple. Because that response arrives over an authenticated TLS
//   channel directly from Apple's servers, decoding its JWS payload is safe
//   without re-verifying the certificate chain ourselves.
//
//   The same trick hardens the webhook: App Store Server Notifications arrive
//   as an unauthenticated POST, so rather than trust the posted body we re-pull
//   the authoritative transaction from the App Store Server API by id. See
//   apple-app-store-notifications/index.ts.
//
// Required edge-function secrets (set via `supabase secrets set`):
//   APPLE_IAP_ISSUER_ID    — App Store Connect API key issuer id (UUID)
//   APPLE_IAP_KEY_ID       — the .p8 key's Key ID
//   APPLE_IAP_PRIVATE_KEY  — the .p8 contents (PEM, including BEGIN/END lines)
//   APPLE_IAP_BUNDLE_ID    — app bundle id (com.Helpr)
//   APPLE_IAP_ENVIRONMENT  — "production" | "sandbox" (optional; we auto-fall
//                            back to sandbox when production returns 404)

import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

const PROD_BASE = "https://api.storekit.itunes.apple.com";
const SANDBOX_BASE = "https://api.storekit-sandbox.itunes.apple.com";

// ---------------------------------------------------------------------------
// Product → subscription tier mapping.
//
// These product identifiers must match the In-App Purchase products created in
// App Store Connect EXACTLY. The convention below mirrors the web tiers
// (basic / pro / elite) across the three billing cadences the app already
// offers (monthly, annual, one-time). `kind: "auto"` = auto-renewable
// subscription (Apple drives renewal); `kind: "once"` = a non-renewing perk
// that grants the tier for a fixed window.
// ---------------------------------------------------------------------------
export type Tier = "basic" | "pro" | "elite";
type Cadence = "monthly" | "annual" | "one_time";

interface ProductMeta {
  tier: Tier;
  cadence: Cadence;
  kind: "auto" | "once";
}

export const PRODUCT_TIER_MAP: Record<string, ProductMeta> = {
  "com.helpr.basic.monthly": { tier: "basic", cadence: "monthly", kind: "auto" },
  "com.helpr.pro.monthly": { tier: "pro", cadence: "monthly", kind: "auto" },
  "com.helpr.elite.monthly": { tier: "elite", cadence: "monthly", kind: "auto" },
  "com.helpr.basic.annual": { tier: "basic", cadence: "annual", kind: "auto" },
  "com.helpr.pro.annual": { tier: "pro", cadence: "annual", kind: "auto" },
  "com.helpr.elite.annual": { tier: "elite", cadence: "annual", kind: "auto" },
  "com.helpr.basic.onetime": { tier: "basic", cadence: "one_time", kind: "once" },
  "com.helpr.pro.onetime": { tier: "pro", cadence: "one_time", kind: "once" },
  "com.helpr.elite.onetime": { tier: "elite", cadence: "one_time", kind: "once" },
};

export const PRODUCT_IDS = Object.keys(PRODUCT_TIER_MAP);

/** Apple's StoreKit 2 JWSTransactionDecodedPayload (the fields we use). */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  /** ms epoch; present for auto-renewable subscriptions. */
  expiresDate?: number;
  /** ms epoch; set when Apple refunds/revokes the purchase. */
  revocationDate?: number;
  type?: string;
  purchaseDate?: number;
}

/** Decode a JWS compact token's payload segment WITHOUT signature checking. */
export function decodeJwsPayload<T = unknown>(jws: string): T {
  const segments = jws.split(".");
  if (segments.length !== 3) throw new Error("Malformed JWS");
  const json = atob(segments[1].replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as T;
}

interface AppleConfig {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  preferSandbox: boolean;
}

function readConfig(): AppleConfig {
  const issuerId = Deno.env.get("APPLE_IAP_ISSUER_ID");
  const keyId = Deno.env.get("APPLE_IAP_KEY_ID");
  const privateKeyPem = Deno.env.get("APPLE_IAP_PRIVATE_KEY");
  const bundleId = Deno.env.get("APPLE_IAP_BUNDLE_ID");
  if (!issuerId || !keyId || !privateKeyPem || !bundleId) {
    throw new Error(
      "Apple IAP not configured: set APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY, APPLE_IAP_BUNDLE_ID",
    );
  }
  return {
    issuerId,
    keyId,
    privateKeyPem,
    bundleId,
    preferSandbox: Deno.env.get("APPLE_IAP_ENVIRONMENT") === "sandbox",
  };
}

/**
 * Mint the short-lived ES256 bearer JWT the App Store Server API requires.
 * Apple caps `exp` at 60 minutes out; we use 20.
 */
async function mintBearer(cfg: AppleConfig): Promise<string> {
  const key = await importPKCS8(cfg.privateKeyPem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ bid: cfg.bundleId })
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })
    .setIssuer(cfg.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 20 * 60)
    .setAudience("appstoreconnect-v1")
    .sign(key);
}

/**
 * Fetch the authoritative transaction for `transactionId` straight from Apple.
 * Tries production first, falls back to sandbox on 404 (and vice-versa when the
 * environment is explicitly sandbox) — the standard cross-env probe Apple
 * recommends, since the client can't reliably tell us which it hit.
 */
export async function fetchAppleTransaction(
  transactionId: string,
): Promise<AppleTransaction> {
  const cfg = readConfig();
  const bearer = await mintBearer(cfg);
  const bases = cfg.preferSandbox
    ? [SANDBOX_BASE, PROD_BASE]
    : [PROD_BASE, SANDBOX_BASE];

  let lastStatus = 0;
  for (const base of bases) {
    const res = await fetch(
      `${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (res.ok) {
      const { signedTransactionInfo } = await res.json();
      const tx = decodeJwsPayload<AppleTransaction>(signedTransactionInfo);
      if (tx.bundleId !== cfg.bundleId) {
        throw new Error("Transaction bundleId mismatch");
      }
      return tx;
    }
    lastStatus = res.status;
    // 404 in one environment → try the other; any other error is terminal.
    if (res.status !== 404) break;
  }
  throw new Error(`App Store Server API lookup failed (status ${lastStatus})`);
}

/**
 * Resolve a product id to its tier, or null if it isn't one of ours.
 */
export function resolveProduct(productId: string): ProductMeta | null {
  return PRODUCT_TIER_MAP[productId] ?? null;
}

/**
 * Compute the `subscription_expires_at` ISO string a transaction grants.
 *   - auto-renewable: Apple's expiresDate (renewals push it forward via webhook)
 *   - one-time perk:  one year from purchase (matches the web one-time pass)
 * Returns null when the purchase is revoked/refunded.
 */
export function computeExpiry(tx: AppleTransaction, meta: ProductMeta): string | null {
  if (tx.revocationDate) return null;
  if (meta.kind === "auto") {
    return tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
  }
  const base = tx.purchaseDate ?? Date.now();
  return new Date(base + 365 * 24 * 60 * 60 * 1000).toISOString();
}
