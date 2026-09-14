/**
 * The Sentry release name for this build — one pure function so it can be
 * tested, because the last time this was an inline `||` chain inside
 * `initSentry()` it was wrong in production for months with nothing to catch
 * it (lh-observability OBS-005: every real event reported release "1.0.0",
 * a release Sentry had no source maps for, so no production stack trace could
 * symbolicate).
 *
 * THE RULE: a production release name is the 40-character git commit SHA, and
 * nothing else. Both shipping builds reach it by a different road and must
 * agree:
 *   - web on Vercel — `__APP_COMMIT_FULL__` (vite.config.ts) reads
 *     `VERCEL_GIT_COMMIT_SHA`, because Vercel's build clone is not guaranteed
 *     to be a usable git checkout;
 *   - iOS via `npm run build:ios` (fastlane, and .github/workflows/ios-beta.yml)
 *     — the same define, reached by `git rev-parse HEAD` in a real checkout.
 * `.github/workflows/sentry-release.yml` creates the release under
 * `github.sha` and uploads the source maps, so the three names are one name.
 *
 * WHY NOT "1.0.0": a version-shaped fallback looks like a legitimate release
 * in the Sentry UI, so a build that failed to identify itself is
 * indistinguishable from one that did — which is exactly how the gap survived.
 * `UNIDENTIFIED_RELEASE` is deliberately ugly: if it ever shows up in Sentry,
 * the build pipeline is broken and it says so.
 */

/** What a build that could not identify itself reports. Never version-shaped. */
export const UNIDENTIFIED_RELEASE = "unidentified-build";

const SHA = /^[0-9a-f]{40}$/i;

export interface ReleaseSources {
  /** `VITE_SENTRY_RELEASE` — set only inside sentry-release.yml's own build. */
  viteRelease?: string;
  /** `__APP_COMMIT_FULL__` — VERCEL_GIT_COMMIT_SHA, else `git rev-parse HEAD`, else "dev". */
  buildCommit?: string;
}

export function resolveSentryRelease({ viteRelease, buildCommit }: ReleaseSources): string {
  for (const candidate of [viteRelease, buildCommit]) {
    const v = candidate?.trim();
    // "dev" is vite.config.ts's honest answer when neither source exists; it
    // is not a release and must not become one.
    if (v && v !== "dev" && SHA.test(v)) return v.toLowerCase();
  }
  return UNIDENTIFIED_RELEASE;
}
