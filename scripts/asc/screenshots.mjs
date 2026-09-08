// Attach the App Store review screenshot to all twelve in-app purchases.
//
// This is the last thing keeping every product in MISSING_METADATA. It matters
// before submission, not just at it: StoreKit does not return a product that
// never reached Ready to Submit, so sandbox testing is blocked too.
//
// The image is scripts/asc/assets/review-screenshot.png, produced by
// e2e/happy-path/iap-review-screenshot.spec.ts — a real render of the
// Membership screen through the happy-path fixtures, showing the actual tier
// cards built from TIER_PERKS. That is what Apple is asking for: where the
// purchase appears in the app. It is committed rather than regenerated here so
// this script is deterministic and needs no browser in CI.
//
// UPLOAD IS A THREE-STEP HANDSHAKE, not a POST with a file:
//   1. RESERVE — declare fileName + fileSize; Apple replies with one or more
//      uploadOperations (method, url, headers, offset, length).
//   2. PUT the bytes to each operation's url, honouring offset/length. Apple
//      may split a file into several parts; assuming one is a latent bug that
//      only appears on a larger image.
//   3. COMMIT — PATCH uploaded:true with the file's MD5. Skip this and the
//      asset sits in a permanent UPLOAD_COMPLETE-but-unusable limbo.
//
// Idempotent: a product that already has a screenshot is skipped.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mintToken, asc, ascAll } from "./asc-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, "assets/review-screenshot.png");
const BUNDLE_ID = process.env.ASC_BUNDLE_ID || "com.Helpr";

const bytes = readFileSync(FILE);
const checksum = createHash("md5").update(bytes).digest("hex");
const fileName = "review-screenshot.png";
console.log(`image ${fileName}  ${bytes.length} bytes  md5=${checksum}\n`);

const token = mintToken();

/**
 * Is there a USABLE screenshot already? Returns the id to delete when there is
 * a broken one.
 *
 * "Has a screenshot" is not the same question as "is done". The first upload
 * attempt left all twelve assets in state FAILED
 * (IMAGE_INCORRECT_DIMENSIONS), and the plain existence check then reported
 * them as already handled and skipped every one — idempotency treating a broken
 * artifact as a finished one, which is worse than no check at all because it is
 * silent.
 */
async function existingScreenshot(relPath) {
  const r = await asc(relPath, { token }).catch(() => null);
  if (!r?.data) return { ok: false, staleId: null };
  const state = r.data.attributes?.assetDeliveryState?.state;
  if (state === "COMPLETE" || state === "UPLOAD_COMPLETE") return { ok: true, staleId: null };
  return { ok: false, staleId: r.data.id };
}

/** Run the reserve → upload → commit handshake for one reservation. */
async function uploadAsset(reservation, endpoint) {
  const ops = reservation.data.attributes.uploadOperations ?? [];
  if (!ops.length) throw new Error("Apple returned no uploadOperations");
  for (const op of ops) {
    const slice = bytes.subarray(op.offset ?? 0, (op.offset ?? 0) + (op.length ?? bytes.length));
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method ?? "PUT", headers, body: slice });
    if (!res.ok) throw new Error(`upload part failed: ${res.status} ${await res.text()}`);
  }
  await asc(`${endpoint}/${reservation.data.id}`, {
    method: "PATCH", token,
    body: { data: { type: reservation.data.type, id: reservation.data.id,
      attributes: { uploaded: true, sourceFileChecksum: checksum } } },
  });
}

const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`, token);
const appId = apps[0].id;

// ── Auto-renewable subscriptions ────────────────────────────────────────────
const groups = await ascAll(`/v1/apps/${appId}/subscriptionGroups?limit=200`, token);
for (const g of groups) {
  for (const sub of await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token)) {
    const pid = sub.attributes.productId;
    const { ok, staleId } = await existingScreenshot(`/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`);
    if (ok) { console.log(`= ${pid} already has a usable screenshot`); continue; }
    if (staleId) {
      await asc(`/v1/subscriptionAppStoreReviewScreenshots/${staleId}`, { method: "DELETE", token });
      console.log(`- ${pid} removed a failed screenshot`);
    }
    const reservation = await asc("/v1/subscriptionAppStoreReviewScreenshots", {
      method: "POST", token,
      body: { data: { type: "subscriptionAppStoreReviewScreenshots",
        attributes: { fileName, fileSize: bytes.length },
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } } } },
    });
    await uploadAsset(reservation, "/v1/subscriptionAppStoreReviewScreenshots");
    console.log(`+ ${pid} screenshot uploaded`);
  }
}

// ── Non-renewing one-time passes ────────────────────────────────────────────
for (const iap of await ascAll(`/v1/apps/${appId}/inAppPurchasesV2?limit=200`, token)) {
  const pid = iap.attributes.productId;
  const { ok, staleId } = await existingScreenshot(`/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`);
  if (ok) { console.log(`= ${pid} already has a usable screenshot`); continue; }
  if (staleId) {
    await asc(`/v1/inAppPurchaseAppStoreReviewScreenshots/${staleId}`, { method: "DELETE", token });
    console.log(`- ${pid} removed a failed screenshot`);
  }
  const reservation = await asc("/v1/inAppPurchaseAppStoreReviewScreenshots", {
    method: "POST", token,
    body: { data: { type: "inAppPurchaseAppStoreReviewScreenshots",
      attributes: { fileName, fileSize: bytes.length },
      relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iap.id } } } } },
  });
  await uploadAsset(reservation, "/v1/inAppPurchaseAppStoreReviewScreenshots");
  console.log(`+ ${pid} screenshot uploaded`);
}

console.log("\n--- done ---");
