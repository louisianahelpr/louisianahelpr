// Shared lookups for the release-* App Store Connect scripts.

import { asc, ascAll } from "./asc-client.mjs";

export const BUNDLE_ID = process.env.ASC_BUNDLE_ID || "com.Helpr";

/** Writes happen only when the workflow's `apply` box was ticked. */
export const APPLY = process.env.ASC_APPLY === "1";

export async function findApp(token) {
  const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=200`, token);
  if (!apps.length) throw new Error(`No app found for bundleId ${BUNDLE_ID}`);
  return apps[0];
}

export async function iosVersions(token, appId) {
  return ascAll(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=50`, token);
}

/** The age rating declaration hangs off the app's appInfo that is not yet live. */
export async function ageRatingDeclaration(token, appId) {
  const infos = await ascAll(`/v1/apps/${appId}/appInfos?limit=10`, token);
  // Prefer the editable appInfo (state other than READY_FOR_DISTRIBUTION).
  const ordered = [...infos].sort((a, b) => {
    const live = (x) => /READY_FOR_(SALE|DISTRIBUTION)/.test(x.attributes?.state ?? x.attributes?.appStoreState ?? "");
    return Number(live(a)) - Number(live(b));
  });
  for (const info of ordered) {
    const r = await asc(`/v1/appInfos/${info.id}/ageRatingDeclaration`, { token }).catch(() => null);
    if (r?.data) return r.data;
  }
  return null;
}
