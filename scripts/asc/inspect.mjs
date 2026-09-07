// What locale does this app actually require, and what else can Apple tell us?
//
// Every field I know of is populated on the eight subscriptions and they remain
// MISSING_METADATA. One assumption has gone unchecked the whole time: that
// en-US is the right locale. A subscription localization must exist in the
// app's PRIMARY locale — if this app's primary is anything else, en-US alone
// satisfies nothing and Apple reports exactly what it has been reporting.
import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token);
const app = apps[0];
console.log("APP attributes:");
console.log(JSON.stringify(app.attributes, null, 1));

// The app's own localizations — the set a subscription is expected to match.
try {
  const infos = await ascAll(`/v1/apps/${app.id}/appInfos?limit=10`, token);
  for (const info of infos) {
    const locs = await ascAll(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`, token);
    console.log(`\nappInfo ${info.id} localizations: ${locs.map((l) => l.attributes.locale).join(", ") || "NONE"}`);
  }
} catch (e) {
  console.log("appInfos: " + String(e.message).slice(0, 160));
}

// And the subscription's, for the direct comparison.
const groups = await ascAll(`/v1/apps/${app.id}/subscriptionGroups?limit=10`, token);
const subs = await ascAll(`/v1/subscriptionGroups/${groups[0].id}/subscriptions?limit=200`, token);
const sub = subs.find((s) => s.attributes.productId === "com.helpr.plus.monthly") ?? subs[0];
const slocs = await ascAll(`/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=50`, token);
console.log(`\nsubscription ${sub.attributes.productId} localizations: ${slocs.map((l) => l.attributes.locale).join(", ")}`);
const glocs = await ascAll(`/v1/subscriptionGroups/${groups[0].id}/subscriptionGroupLocalizations?limit=50`, token);
console.log(`group localizations: ${glocs.map((l) => l.attributes.locale).join(", ")}`);
