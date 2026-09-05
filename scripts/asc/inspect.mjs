// Compare a WORKING product against a stuck one.
//
// The four non-renewing passes are READY_TO_SUBMIT; the eight auto-renewable
// subscriptions are MISSING_METADATA with every field I know of populated, and
// a no-op write did not recompute them — so they are genuinely incomplete, not
// stale. Apple never names the absent field, and four guesses have each found a
// real gap without finishing the job.
//
// So stop guessing and diff. Print both objects and every to-one relationship
// in full (no `limit` param — Apple 400s on that for a to-one), and look for
// what the working one has that the stuck one does not.
import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const appId = (await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token))[0].id;

const show = async (label, path) => {
  try {
    const r = await asc(path, { token });
    const d = r?.data;
    const body = Array.isArray(d)
      ? `${d.length} item(s): ` + JSON.stringify(d.map((x) => x.attributes)).slice(0, 500)
      : JSON.stringify(d?.attributes ?? d, null, 1)?.slice(0, 500);
    console.log(`   ${label}: ${body}`);
  } catch (e) {
    console.log(`   ${label}: ERROR ${e.status ?? ""} ${String(e.message).slice(0, 140)}`);
  }
};

// ── The stuck subscription ──────────────────────────────────────────────────
const groups = await ascAll(`/v1/apps/${appId}/subscriptionGroups?limit=10`, token);
const subs = await ascAll(`/v1/subscriptionGroups/${groups[0].id}/subscriptions?limit=200`, token);
const sub = subs.find((s) => s.attributes.productId === "com.helpr.plus.monthly") ?? subs[0];
console.log(`### SUBSCRIPTION ${sub.attributes.productId} — ${sub.attributes.state}`);
console.log(JSON.stringify(sub.attributes, null, 1));
await show("availability", `/v1/subscriptions/${sub.id}/subscriptionAvailability`);
await show("availableTerritories", `/v1/subscriptionAvailabilities/${sub.id}/availableTerritories`);
await show("prices", `/v1/subscriptions/${sub.id}/prices?limit=10`);
await show("localizations", `/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=10`);
await show("reviewScreenshot", `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`);

// ── The working one-time pass ───────────────────────────────────────────────
const iaps = await ascAll(`/v1/apps/${appId}/inAppPurchasesV2?limit=200`, token);
const iap = iaps.find((p) => p.attributes.productId === "com.helpr.plus.onetime") ?? iaps[0];
console.log(`\n### IAP ${iap.attributes.productId} — ${iap.attributes.state}`);
console.log(JSON.stringify(iap.attributes, null, 1));
await show("availability", `/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`);
await show("priceSchedule", `/v2/inAppPurchases/${iap.id}/iapPriceSchedule`);
await show("localizations", `/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations?limit=10`);
await show("reviewScreenshot", `/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`);
