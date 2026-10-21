// Cancel the iOS review submission that is waiting for (or in) App Review.
//
// Dry run unless the workflow's `apply` box is ticked (ASC_APPLY=1). Cancelling
// is what App Store Connect's "Cancel Submission" button does: the version goes
// back to an editable state, keeps its metadata, and a new build can be
// attached. It never deletes a build.
//
// Optional ASC_CANCEL_BUILD=<build number>: refuse unless the version in the
// submission carries exactly that build (so a stale run cannot cancel a newer
// submission).
//
// Run: gh workflow run asc-iap.yml -f mode=release-cancel [-f apply=true]

import { mintToken, asc, ascAll } from "./asc-client.mjs";
import { APPLY, findApp } from "./release-lib.mjs";

const token = mintToken();
const app = await findApp(token);
const expectBuild = (process.env.ASC_CANCEL_BUILD ?? "").trim();

const open = (await ascAll(`/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=50`, token))
  .filter((s) => ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES", "READY_FOR_REVIEW"].includes(s.attributes.state));

if (!open.length) {
  console.log("No open iOS review submission. Nothing to cancel.");
  process.exit(0);
}

let failed = false;
for (const s of open) {
  const items = await ascAll(`/v1/reviewSubmissions/${s.id}/items?limit=50`, token).catch(() => []);
  const versionIds = items.map((it) => it.relationships?.appStoreVersion?.data?.id).filter(Boolean);
  const builds = [];
  for (const vid of versionIds) {
    const v = await asc(`/v1/appStoreVersions/${vid}?include=build`, { token });
    const b = (v.included ?? []).find((x) => x.type === "builds");
    builds.push(`${v.data.attributes.versionString} build ${b?.attributes?.version ?? "none"}`);
  }
  console.log(`submission ${s.id} state=${s.attributes.state} submitted=${s.attributes.submittedDate ?? "-"} -> ${builds.join(", ") || "no version item"}`);
  if (expectBuild && !builds.some((x) => x.endsWith(`build ${expectBuild}`))) {
    console.log(`  REFUSED: ASC_CANCEL_BUILD=${expectBuild} is not in this submission`);
    failed = true;
    continue;
  }
  if (!APPLY) {
    console.log("  DRY RUN: would cancel (tick apply to do it)");
    continue;
  }
  await asc(`/v1/reviewSubmissions/${s.id}`, {
    method: "PATCH",
    token,
    body: { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } },
  });
  const after = await asc(`/v1/reviewSubmissions/${s.id}`, { token });
  console.log(`  CANCEL sent; state now ${after.data.attributes.state}`);
}
process.exit(failed ? 1 : 0);
