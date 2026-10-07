/**
 * Pure half of `npm run launch:appstore` (Q1289): read the repo's App Store
 * state and judge it against what Apple answers. No network here, so
 * src/test/appStoreLive.test.ts can grade it.
 */

/** `apple_id: "6754470134"` from fastlane/ios_app_metadata.yml. */
export function readAppleId(metadataYml) {
  return metadataYml.match(/^\s*apple_id:\s*"?(\d{6,12})"?\s*$/m)?.[1] ?? null;
}

/** `bundle_id: "com.Helpr"` from fastlane/ios_app_metadata.yml. */
export function readBundleId(metadataYml) {
  return metadataYml.match(/^\s*bundle_id:\s*"?([\w.-]+)"?\s*$/m)?.[1] ?? null;
}

/** What src/lib/appStore.ts and index.html say today. */
export function readRepoState(appStoreTs, indexHtml) {
  const url = appStoreTs.match(/export const APP_STORE_URL\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const live = appStoreTs.match(/export const APP_STORE_LISTING_LIVE(?::\s*boolean)?\s*=\s*(true|false)/)?.[1];
  const noComments = indexHtml.replace(/<!--[\s\S]*?-->/g, "");
  const banner = noComments.match(/<meta\s+name="apple-itunes-app"\s+content="app-id=(\d+)/)?.[1] ?? null;
  return {
    url,
    urlId: url?.match(/\/id(\d+)/)?.[1] ?? null,
    listingLive: live === "true" ? true : live === "false" ? false : null,
    bannerId: banner,
  };
}

/**
 * @param {{ appleId: string|null, bundleId: string|null,
 *           repo: ReturnType<typeof readRepoState>,
 *           page: { status: number } | null,
 *           lookup: { resultCount: number, results: { bundleId?: string, trackId?: number }[] } | null }} s
 * @returns {{ verdict: "not-live"|"flip-now"|"live-and-shipped"|"inconsistent", problems: string[], steps: string[] }}
 */
export function judgeAppStore(s) {
  const problems = [];
  const { appleId, bundleId, repo } = s;
  if (!appleId) problems.push("fastlane/ios_app_metadata.yml has no apple_id");
  if (appleId && repo.urlId && repo.urlId !== appleId) {
    problems.push(`APP_STORE_URL names id${repo.urlId} but App Store Connect's apple_id is ${appleId}`);
  }
  if (repo.bannerId && appleId && repo.bannerId !== appleId) {
    problems.push(`index.html Smart App Banner names app-id=${repo.bannerId}, not ${appleId}`);
  }
  if (repo.listingLive === null) problems.push("src/lib/appStore.ts: APP_STORE_LISTING_LIVE not found");

  const hit = s.lookup?.results?.find((r) => String(r.trackId ?? "") === appleId);
  const pageOk = s.page?.status === 200;
  const lookupOk = (s.lookup?.resultCount ?? 0) >= 1 && !!hit;
  if (hit && bundleId && hit.bundleId && hit.bundleId !== bundleId) {
    problems.push(`Apple's lookup for ${appleId} returns bundle ${hit.bundleId}, not ${bundleId}`);
  }
  const appleLive = pageOk && lookupOk;

  if (!appleLive && repo.listingLive === true) {
    problems.push("APP_STORE_LISTING_LIVE is true but Apple does not list the app: every store link is dead");
  }
  if (problems.length) return { verdict: "inconsistent", problems, steps: [] };
  if (!appleLive) return { verdict: "not-live", problems, steps: [] };
  if (repo.listingLive && repo.bannerId === appleId) return { verdict: "live-and-shipped", problems, steps: [] };
  return {
    verdict: "flip-now",
    problems,
    steps: [
      `src/lib/appStore.ts: APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id${appleId}" and APP_STORE_LISTING_LIVE: boolean = true`,
      `index.html <head>: <meta name="apple-itunes-app" content="app-id=${appleId}, app-argument=helpr://" />`,
      "src/test/appStoreLinksHiddenUntilLive.test.ts: flip to the live expectations (listing live; banner present with this id; readers still gated)",
      "look at the Footer at 375 and 1440, light and dark (Apple chip back), then land with bash scripts/land.sh",
    ],
  };
}
