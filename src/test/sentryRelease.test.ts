/**
 * Every production build — web and iOS — reports a Sentry release named after
 * the git commit SHA.
 *
 * WHAT THIS CATCHES: the release tag silently degrading to something that is
 * not a commit (lh-observability OBS-005, where every production event
 * reported "1.0.0" and no stack trace could symbolicate, for months, with CI
 * green throughout). The class is "the runtime release name and the name
 * sentry-release.yml uploads source maps under stop agreeing".
 *
 * It asserts the WIRING, not just the helper: the helper is pure, so a test of
 * it alone would still pass if `initSentry()` stopped calling it, if
 * vite.config.ts stopped deriving the commit from VERCEL_GIT_COMMIT_SHA, or if
 * the iOS build script stopped going through `vite build` (which is where the
 * define lives, and the only reason the .ipa gets a release at all).
 *
 * WHAT IT CANNOT SEE: Sentry. The four wiring tests are SOURCE-TEXT PINS on
 * sentry.ts, vite.config.ts, package.json and sentry-release.yml; nothing here
 * asks Sentry what release the last production event actually reported, or
 * whether source maps for that release exist. A release name that is correct
 * in the repo and wrong in the wild — an upload that 401s, a DSN pointed at a
 * different project — is invisible to this file. Live release/artifact state
 * is an uncovered class, not a gap in these assertions.
 *
 * Proven able to fail 2026-09-21 by re-creating OBS-005 itself: making the
 * unidentified-build sentinel version-shaped ("1.0.0"), so an unidentifiable
 * build once again looks like a legitimate release in the Sentry UI.
 */
// @mutate src/lib/sentryRelease.ts | export const UNIDENTIFIED_RELEASE = "unidentified-build"; | export const UNIDENTIFIED_RELEASE = "1.0.0";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSentryRelease, UNIDENTIFIED_RELEASE } from "@/lib/sentryRelease";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SHA = "7238ccda530504b3786e998af67a6ec6c27ffc05";

describe("Sentry release name", () => {
  it("is the commit SHA a production build was built from", () => {
    // Vercel's web build: __APP_COMMIT_FULL__ comes from VERCEL_GIT_COMMIT_SHA.
    expect(resolveSentryRelease({ buildCommit: SHA })).toBe(SHA);
    // iOS build (npm run build:ios): the same define, via `git rev-parse HEAD`.
    expect(resolveSentryRelease({ viteRelease: undefined, buildCommit: SHA })).toBe(SHA);
    // sentry-release.yml's own build may set VITE_SENTRY_RELEASE; it wins.
    expect(resolveSentryRelease({ viteRelease: SHA, buildCommit: "dev" })).toBe(SHA);
    expect(resolveSentryRelease({ buildCommit: SHA.toUpperCase() })).toBe(SHA);
  });

  it("never reports a version-shaped release for an unidentified build", () => {
    // The whole OBS-005 failure: "1.0.0" looks like a real release in the
    // Sentry UI, so a build that could not identify itself was invisible.
    for (const bad of [undefined, "", "   ", "dev", "1.0.0", "v1.0.3", "main"]) {
      const out = resolveSentryRelease({ buildCommit: bad });
      expect(out).toBe(UNIDENTIFIED_RELEASE);
      expect(out).not.toMatch(/^v?\d+\.\d+/);
    }
    // A short SHA is a lookup, not an identity — sentry-release.yml uploads
    // maps under the full github.sha, so a 7-char name would never match.
    expect(resolveSentryRelease({ buildCommit: SHA.slice(0, 7) })).toBe(UNIDENTIFIED_RELEASE);
  });

  it("is what initSentry() actually passes to Sentry", () => {
    const src = read("src/lib/sentry.ts");
    expect(src).toMatch(/resolveSentryRelease\(/);
    expect(src).toMatch(/__APP_COMMIT_FULL__/);
    // The value handed to init() is the resolved one, not a literal.
    expect(src).toMatch(/release:\s*RELEASE\b/);
    expect(src).not.toMatch(/release:\s*["'`]/);
    // No version-shaped fallback anywhere in the release chain.
    expect(src).not.toMatch(/VITE_APP_VERSION/);
  });

  it("the build actually defines the commit, from Vercel or from git", () => {
    const vite = read("vite.config.ts");
    expect(vite).toMatch(/__APP_COMMIT_FULL__:\s*JSON\.stringify\(appCommitFull\)/);
    expect(vite).toMatch(/VERCEL_GIT_COMMIT_SHA/);
    expect(vite).toMatch(/git rev-parse HEAD/);
    // The same value is stamped into index.html, so prod-freshness.yml and
    // Sentry cannot disagree about which commit is live.
    expect(vite).toMatch(/name="build-commit" content="\$\{appCommitFull\}"/);
  });

  it("every shipping build goes through vite build, so the define applies", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    // iOS is the one that is easy to lose: fastlane runs `npm run build:ios`.
    for (const name of ["build", "build:ios"]) {
      expect(pkg.scripts[name], `${name} script is missing`).toBeTruthy();
      expect(pkg.scripts[name], `${name} must run vite build`).toMatch(/\bvite build\b/);
    }
  });

  it("CI uploads source maps under that same name", () => {
    const wf = read(".github/workflows/sentry-release.yml");
    expect(wf).toMatch(/SENTRY_AUTH_TOKEN/);
    expect(wf).toMatch(/version:\s*\$\{\{\s*github\.sha\s*\}\}/);
    expect(wf).toMatch(/sourcemaps:/);
  });
});
