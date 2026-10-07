export interface AppStoreRepoState {
  url: string | null;
  urlId: string | null;
  listingLive: boolean | null;
  bannerId: string | null;
}
export function readAppleId(metadataYml: string): string | null;
export function readBundleId(metadataYml: string): string | null;
export function readRepoState(appStoreTs: string, indexHtml: string): AppStoreRepoState;
export function judgeAppStore(s: {
  appleId: string | null;
  bundleId: string | null;
  repo: AppStoreRepoState;
  page: { status: number } | null;
  lookup: { resultCount: number; results: { bundleId?: string; trackId?: number }[] } | null;
}): {
  verdict: "not-live" | "flip-now" | "live-and-shipped" | "inconsistent";
  problems: string[];
  steps: string[];
};
