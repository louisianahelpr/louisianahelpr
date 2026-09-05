// Dump ONE subscription completely, to find what MISSING_METADATA means here.
//
// The four non-renewing passes reached READY_TO_SUBMIT the moment availability
// was set. The eight auto-renewable subscriptions have availability too and did
// not move, so the remaining requirement is specific to subscriptions and is
// not one I have guessed correctly yet. Apple never says which field is absent,
// so print everything and look.
import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token);
const groups = await ascAll(`/v1/apps/${apps[0].id}/subscriptionGroups?limit=10`, token);
const subs = await ascAll(`/v1/subscriptionGroups/${groups[0].id}/subscriptions?limit=200`, token);
const sub = subs.find((s) => s.attributes.productId === "com.helpr.plus.monthly") ?? subs[0];

console.log("=== attributes ===");
console.log(JSON.stringify(sub.attributes, null, 2));

for (const rel of [
  "subscriptionLocalizations", "prices", "subscriptionAvailability",
  "appStoreReviewScreenshot", "introductoryOffers", "promotionalOffers",
  "subscriptionPeriod", "pricePoints",
]) {
  try {
    const r = await asc(`/v1/subscriptions/${sub.id}/${rel}?limit=5`, { token });
    const d = r?.data;
    const n = Array.isArray(d) ? d.length : d ? 1 : 0;
    const sample = Array.isArray(d) ? d[0]?.attributes : d?.attributes;
    console.log(`\n--- ${rel}: ${n} ---`);
    if (sample) console.log(JSON.stringify(sample, null, 2).slice(0, 400));
  } catch (e) {
    console.log(`\n--- ${rel}: ERROR ${e.status ?? ""} ${String(e.message).slice(0, 120)}`);
  }
}
