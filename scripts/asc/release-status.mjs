// Read-only: where the iOS app stands in App Store Connect, for a release.
//
// Prints every app store version with its state and attached build, every
// review submission and what is in it, the latest builds, the age rating
// declaration as Apple stores it (so the 2.3.6 "In-App Controls" answer can be
// read rather than guessed), the support URL each version localization carries
// (1.5), the screenshot sets per display type (2.3.3), and the state of every
// in-app purchase product. Writes nothing.
//
// Run: gh workflow run asc-iap.yml -f mode=release-status

import { mintToken, asc, ascAll } from "./asc-client.mjs";
import { findApp, iosVersions, ageRatingDeclaration } from "./release-lib.mjs";

const token = mintToken();
const app = await findApp(token);
console.log(`APP  ${app.attributes.name}  ${app.attributes.bundleId}  id=${app.id}\n`);

console.log("APP STORE VERSIONS (iOS)");
for (const v of await iosVersions(token, app.id)) {
  const a = v.attributes;
  const build = await asc(`/v1/appStoreVersions/${v.id}/build`, { token }).then((r) => r?.data).catch(() => null);
  console.log(`  ${a.versionString}  state=${a.appStoreState ?? a.appVersionState}  releaseType=${a.releaseType}  created=${a.createdDate}  id=${v.id}`);
  console.log(`     build=${build ? `${build.attributes.version} (${build.attributes.processingState})` : "none"}`);
  const locs = await ascAll(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`, token).catch(() => []);
  for (const l of locs) {
    console.log(`     ${l.attributes.locale}: supportUrl=${l.attributes.supportUrl}  marketingUrl=${l.attributes.marketingUrl}`);
    const sets = await ascAll(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?limit=50`, token).catch(() => []);
    for (const s of sets) {
      const shots = await ascAll(`/v1/appScreenshotSets/${s.id}/appScreenshots?limit=50`, token).catch(() => []);
      const dims = shots.map((x) => `${x.attributes.imageAsset?.width}x${x.attributes.imageAsset?.height}`);
      console.log(`       screenshots ${s.attributes.screenshotDisplayType}: ${shots.length} [${[...new Set(dims)].join(", ")}]`);
    }
  }
}

console.log("\nREVIEW SUBMISSIONS (iOS)");
const subs = await ascAll(`/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=50`, token).catch((e) => {
  console.log(`  not readable: ${e.message}`);
  return [];
});
for (const s of subs) {
  const a = s.attributes;
  console.log(`  id=${s.id}  state=${a.state}  submitted=${a.submittedDate ?? "-"}`);
  const items = await ascAll(`/v1/reviewSubmissions/${s.id}/items?limit=50`, token).catch(() => []);
  for (const it of items) {
    const rel = Object.entries(it.relationships ?? {})
      .filter(([, r]) => r?.data)
      .map(([k, r]) => `${k}=${r.data.id}`)
      .join(" ");
    console.log(`     item ${it.id} state=${it.attributes?.state} ${rel}`);
  }
}

console.log("\nLATEST BUILDS");
const builds = await asc(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=8`, { token });
for (const b of builds.data ?? []) {
  const a = b.attributes;
  console.log(`  ${a.version}  ${a.processingState}  uploaded=${a.uploadedDate}  expired=${a.expired}`);
}

console.log("\nAGE RATING DECLARATION");
const decl = await ageRatingDeclaration(token, app.id);
if (decl) {
  console.log(`  id=${decl.id}`);
  for (const [k, v] of Object.entries(decl.attributes ?? {})) console.log(`    ${k} = ${JSON.stringify(v)}`);
} else {
  console.log("  none found");
}

console.log("\nIN-APP PURCHASES");
const iaps = await ascAll(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`, token).catch(() => []);
for (const p of iaps) console.log(`  ${p.attributes.productId}  ${p.attributes.inAppPurchaseType}  state=${p.attributes.state}`);
const groups = await ascAll(`/v1/apps/${app.id}/subscriptionGroups?limit=50`, token).catch(() => []);
for (const g of groups) {
  for (const s of await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token).catch(() => [])) {
    console.log(`  ${s.attributes.productId}  subscription  state=${s.attributes.state}`);
  }
}

console.log("\n--- release-status complete, nothing was written ---");
