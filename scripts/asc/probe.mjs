// Read-only reconnaissance of the App Store Connect IAP surface.
//
// Deliberately separate from the create step and run first. Creating in-app
// purchases is account state that is fiddly to clean up by hand, so it is worth
// one read-only pass to establish: do the credentials work at all, which app is
// this, does a subscription group already exist, and which of the twelve
// products are already there. Guessing any of those and then writing is how you
// end up with half a product catalogue and no clear way back.

import { mintToken, asc, ascAll } from "./asc-client.mjs";

const BUNDLE_ID = process.env.ASC_BUNDLE_ID || "com.Helpr";

const token = mintToken();
console.log("✓ token minted\n");

const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=200`, token);
if (!apps.length) {
  console.error(`No app found for bundleId ${BUNDLE_ID}. Apps visible to this key:`);
  for (const a of await ascAll("/v1/apps?limit=200", token)) {
    console.error(`   ${a.attributes.bundleId}  ${a.attributes.name}  (${a.id})`);
  }
  process.exit(1);
}
const app = apps[0];
console.log(`APP  ${app.attributes.name}  ${app.attributes.bundleId}  id=${app.id}\n`);

// ── Auto-renewable subscriptions live inside groups ─────────────────────────
const groups = await ascAll(`/v1/apps/${app.id}/subscriptionGroups?limit=200`, token);
console.log(`SUBSCRIPTION GROUPS: ${groups.length}`);
for (const g of groups) {
  console.log(`  • ${g.attributes.referenceName}  (${g.id})`);
  const subs = await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token);
  for (const s of subs) {
    const a = s.attributes;
    const locs = await ascAll(`/v1/subscriptions/${s.id}/subscriptionLocalizations?limit=50`, token);
    const prices = await ascAll(`/v1/subscriptions/${s.id}/prices?limit=50`, token).catch(() => []);
    const avail = await asc(`/v1/subscriptions/${s.id}/subscriptionAvailability`, { token })
      .then((r) => !!r?.data?.id).catch(() => false);
    console.log(`      ${a.productId}  ${a.subscriptionPeriod}  level=${a.groupLevel}  state=${a.state}`);
    const shot = await asc(`/v1/subscriptions/${s.id}/appStoreReviewScreenshot`, { token })
      .then((r) => (r?.data ? `${r.data.attributes?.assetDeliveryState?.state ?? "present"}` : "NONE"))
      .catch(() => "NONE");
    console.log(`         loc=${locs.map((l) => l.attributes.locale).join(",") || "NONE"}  prices=${prices.length}  available=${avail}  reviewScreenshot=${shot}`);
  }
  if (!subs.length) console.log("      (empty)");
}
if (!groups.length) console.log("  (none — one must be created before any auto-renewable subscription)");

// ── One-time passes are plain in-app purchases, not subscriptions ────────────
const iaps = await ascAll(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`, token);
console.log(`\nNON-SUBSCRIPTION IAPs: ${iaps.length}`);
for (const p of iaps) {
  const a = p.attributes;
  const ilocs = await ascAll(`/v2/inAppPurchases/${p.id}/inAppPurchaseLocalizations?limit=50`, token).catch(() => []);
  const sched = await asc(`/v2/inAppPurchases/${p.id}/iapPriceSchedule`, { token })
    .then((r) => !!r?.data?.id).catch(() => false);
  console.log(`  • ${a.productId}  ${a.inAppPurchaseType}  state=${a.state}`);
  const ishot = await asc(`/v2/inAppPurchases/${p.id}/appStoreReviewScreenshot`, { token })
    .then((r) => (r?.data ? `${r.data.attributes?.assetDeliveryState?.state ?? "present"}` : "NONE"))
    .catch(() => "NONE");
  console.log(`       loc=${ilocs.map((l) => l.attributes.locale).join(",") || "NONE"}  priceSchedule=${sched}  reviewScreenshot=${ishot}`);
}
if (!iaps.length) console.log("  (none)");

// ── The agreement gate ──────────────────────────────────────────────────────
// Nothing can be SOLD until the Paid Applications agreement is active. It is a
// legal acceptance by the account holder and there is no API to accept it, so
// this only reports.
try {
  const agreements = await ascAll("/v1/agreements?limit=200", token);
  console.log(`\nAGREEMENTS: ${agreements.length}`);
  for (const ag of agreements) {
    console.log(`  • ${JSON.stringify(ag.attributes)}`);
  }
} catch (e) {
  console.log(`\nAGREEMENTS: not readable with this key (${e.status ?? "?"}) — check App Store Connect → Business manually.`);
}

console.log("\n--- probe complete, nothing was written ---");
