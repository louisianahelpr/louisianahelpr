// Attach build ASC_BUILD to the editable iOS App Store version and submit it
// for App Review, released automatically once Apple approves (releaseType
// AFTER_APPROVAL: the owner's standing choice, automatic_release true).
//
// Run AFTER the metadata lane has uploaded the listing and screenshots
// (ios-metadata.yml), because a submitted version's listing is locked.
//
// Dry run unless the workflow's `apply` box is ticked (ASC_APPLY=1). Refuses
// when: the build is not VALID (still processing / failed), there is no
// editable version, a review submission is already open for this app, or the
// version has no screenshots for a required display type.
//
// Run: gh workflow run asc-iap.yml -f mode=release-submit -f build=<n> [-f apply=true]

import { mintToken, asc, ascAll } from "./asc-client.mjs";
import { APPLY, findApp, iosVersions } from "./release-lib.mjs";

const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY",
]);
// Apple requires a 6.9"/6.7" iPhone set and a 13" iPad set for a universal app.
const REQUIRED_SETS = [["APP_IPHONE_67", "APP_IPHONE_69"], ["APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_129", "APP_IPAD_13"]];

const fail = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(1); };

const buildNumber = (process.env.ASC_BUILD ?? "").trim();
if (!/^\d+$/.test(buildNumber)) fail("set the workflow's build input to the build number to submit");

const token = mintToken();
const app = await findApp(token);

const versions = await iosVersions(token, app.id);
const version = versions.find((v) => EDITABLE.has(v.attributes.appStoreState ?? v.attributes.appVersionState));
if (!version) fail(`no editable iOS version (states: ${versions.map((v) => `${v.attributes.versionString}=${v.attributes.appStoreState}`).join(", ")})`);
console.log(`version ${version.attributes.versionString} state=${version.attributes.appStoreState} releaseType=${version.attributes.releaseType}`);

const builds = await asc(`/v1/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&limit=5`, { token });
const build = (builds.data ?? [])[0];
if (!build) fail(`build ${buildNumber} not found`);
console.log(`build ${build.attributes.version} processing=${build.attributes.processingState} expired=${build.attributes.expired}`);
if (build.attributes.processingState !== "VALID" || build.attributes.expired) fail("build is not VALID yet");

const allSubs = await ascAll(`/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=50`, token);
const open = allSubs.filter((s) => ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(s.attributes.state));
if (open.length) fail(`a review submission is already open: ${open.map((s) => `${s.id} ${s.attributes.state}`).join(", ")}`);
// A rejected submission (UNRESOLVED_ISSUES) is RESUBMITTED, the API form of App
// Store Connect's "Resubmit to App Review": new build attached, its rejected
// items marked resolved, the same submission submitted again (11-11, Guideline 4).
const unresolved = allSubs.filter((s) => s.attributes.state === "UNRESOLVED_ISSUES");
if (unresolved.length > 1) fail(`more than one unresolved submission: ${unresolved.map((s) => s.id).join(", ")}`);
const rejectedSub = unresolved[0] ?? null;
if (rejectedSub) console.log(`resubmitting rejected review submission ${rejectedSub.id}`);

const locs = await ascAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`, token);
for (const l of locs) {
  const sets = await ascAll(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?limit=50`, token);
  const counts = {};
  for (const s of sets) counts[s.attributes.screenshotDisplayType] = (await ascAll(`/v1/appScreenshotSets/${s.id}/appScreenshots?limit=50`, token)).length;
  console.log(`  ${l.attributes.locale} supportUrl=${l.attributes.supportUrl} screenshots=${JSON.stringify(counts)}`);
  for (const alts of REQUIRED_SETS) {
    if (!alts.some((t) => counts[t] > 0)) fail(`${l.attributes.locale} has no screenshots for any of ${alts.join("/")}`);
  }
}

if (!APPLY) {
  console.log(`DRY RUN: would attach build ${buildNumber}, set releaseType AFTER_APPROVAL, and ${rejectedSub ? `resubmit ${rejectedSub.id}` : "submit for review"}`);
  process.exit(0);
}

await asc(`/v1/appStoreVersions/${version.id}/relationships/build`, {
  method: "PATCH", token, body: { data: { type: "builds", id: build.id } },
});
await asc(`/v1/appStoreVersions/${version.id}`, {
  method: "PATCH", token,
  body: { data: { type: "appStoreVersions", id: version.id, attributes: { releaseType: "AFTER_APPROVAL" } } },
});
console.log(`attached build ${buildNumber}; releaseType AFTER_APPROVAL`);

if (rejectedSub) {
  const rejectedItems = await ascAll(`/v1/reviewSubmissions/${rejectedSub.id}/items?limit=50`, token);
  for (const it of rejectedItems) {
    if (it.attributes?.state !== "REJECTED") continue;
    await asc(`/v1/reviewSubmissionItems/${it.id}`, {
      method: "PATCH", token,
      body: { data: { type: "reviewSubmissionItems", id: it.id, attributes: { resolved: true } } },
    });
    console.log(`  item ${it.id} marked resolved`);
  }
  await asc(`/v1/reviewSubmissions/${rejectedSub.id}`, {
    method: "PATCH", token,
    body: { data: { type: "reviewSubmissions", id: rejectedSub.id, attributes: { submitted: true } } },
  });
  const again = await asc(`/v1/reviewSubmissions/${rejectedSub.id}`, { token });
  console.log(`RESUBMITTED: review submission ${rejectedSub.id} state=${again.data.attributes.state}`);
  process.exit(0);
}

// Reuse a not-yet-submitted submission if one exists, else create one.
const drafts = (await ascAll(`/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=10`, token));
const sub = drafts[0] ?? (await asc("/v1/reviewSubmissions", {
  method: "POST", token,
  body: { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app.id } } } } },
})).data;
const items = await ascAll(`/v1/reviewSubmissions/${sub.id}/items?limit=50`, token);
if (!items.some((it) => it.relationships?.appStoreVersion?.data?.id === version.id)) {
  await asc("/v1/reviewSubmissionItems", {
    method: "POST", token,
    body: { data: { type: "reviewSubmissionItems", relationships: {
      reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } },
      appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
    } } },
  });
}
await asc(`/v1/reviewSubmissions/${sub.id}`, {
  method: "PATCH", token,
  body: { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } },
});
const after = await asc(`/v1/reviewSubmissions/${sub.id}`, { token });
console.log(`SUBMITTED: review submission ${sub.id} state=${after.data.attributes.state}`);
