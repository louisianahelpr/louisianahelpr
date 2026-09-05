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
    const has = await asc(`/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`, { token })
      .then((r) => !!r?.data?.id).catch(() => false);
    if (has) { console.log(`= ${pid} already has a screenshot`); continue; }
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
  const has = await asc(`/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`, { token })
    .then((r) => !!r?.data?.id).catch(() => false);
  if (has) { console.log(`= ${pid} already has a screenshot`); continue; }
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
