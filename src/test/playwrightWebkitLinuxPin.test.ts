/**
 * nightly-red #2962 (nightly-webkit): never run a Playwright whose Linux
 * WebKit build stops painting.
 *
 * THE BUG (measured). nightly-webkit has been red since 2026-10-15 on two
 * specs: home-chrome.spec.ts:275 and nav-hide-on-scroll.spec.ts:432 (runs
 * 38692697851, 39034702084, 39131032798). A click inside the filter sheet, or
 * on the Map toggle, waited 30 s for its target to be "stable". The trace of
 * run 39131032798 shows why: the page's screencast sent its last frame about
 * 2 s after the Filters tap and none in the 29 s after that. WebKit stopped
 * painting, so Playwright's stability check never completed.
 * (The first red run, 38434750617 on 10-13, was a different failure, an
 * Apply now button at 43.8 px, and ran on Playwright 1.63.0.)
 *
 * WHY IT IS PLAYWRIGHT. 1.64.0 (#2933) moved Linux WebKit from build 2359 to
 * 2370 (playwright-core browsers.json). Bisected on ubuntu-latest:
 *   run 38697230656 (the two specs): 1.64.0 FAIL; 1.63.0 PASS; Radix Dialog
 *     1.1.23 or framer-motion 13.5.0 under 1.64.0 still FAIL.
 *   run 38697854281: 1.64.0 with backdrop-filter forced off PASS; with
 *     animations and transitions off FAIL.
 * Whole nightly-webkit workflow on main 02b4209b4 (2026-10-18):
 *   run 39200114886: Playwright pinned to 1.63.0 (WebKit 2359): 161 passed,
 *     0 failed, 0 flaky.
 *   run 39200116779: Playwright 1.64.0 (WebKit 2370) with OptimizedImage
 *     fading from opacity 0 again (00c5c09b1's 0.01 undone): the same two
 *     specs FAIL, so that commit is not the cause.
 * e2e-journeys run 39167770990's journeys-webkit leg ran WebKit 2370 too and
 * stalled in the same filter sheet; it installs from this lock as well.
 * 1.64.1 ships the same WebKit build 2370 (its browsers.json), so it is held
 * too without a run of its own.
 *
 * THE RULE. The installed @playwright/test is not a known-bad version, the
 * spec in package.json is EXACT (a caret lets a lock refresh float back into
 * the bad version), the lock agrees for all three packages, and Dependabot
 * skips each known-bad release line. A newer release is still offered: when
 * it is, this test fails until someone runs nightly-webkit on it and either
 * adds it to KNOWN_BAD or moves PINNED.
 *
 * Not "turn backdrop-filter off in the WebKit runs": catching WebKit
 * backdrop-filter bugs is what those runs are for.
 *
 * @mutate package.json | "@playwright/test": "1.63.0", | "@playwright/test": "^1.63.0",
 * @mutate package-lock.json | "version": "1.63.0",\n      "resolved": "https://registry.npmjs.org/playwright-core/ | "version": "1.64.0",\n      "resolved": "https://registry.npmjs.org/playwright-core/
 * @mutate .github/dependabot.yml |         versions: ["1.64.x"] |         versions: ["1.62.x"]
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankHashComments } from "./helpers/blankNonCode";

/** Versions whose Linux WebKit build stalls painting, with what proved it. */
const KNOWN_BAD: Record<string, string> = {
  "1.64.0": "WebKit 2370; nightly-webkit 38692697851, 39131032798; bisect 38697230656 + 38697854281",
  "1.64.1": "same WebKit 2370 as 1.64.0 (playwright-core browsers.json)",
};
/** The version every workflow runs, and the newest one proven green in Linux WebKit. */
const PINNED = "1.63.0";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
};
const dependabot = blankHashComments(readFileSync(".github/dependabot.yml", "utf8"));
const minorLine = (v: string) => v.split(".").slice(0, 2).join(".") + ".x";

describe("Playwright stays off a version whose Linux WebKit stops painting (nightly-red #2962)", () => {
  it("reads real files (floor)", () => {
    expect(Object.keys(lock.packages).length).toBeGreaterThan(500);
    expect(Object.keys(KNOWN_BAD).length).toBeGreaterThan(1);
    expect(dependabot).toContain('package-ecosystem: "npm"');
  });

  it("package.json pins @playwright/test exactly, to a version not known bad", () => {
    const spec = pkg.devDependencies["@playwright/test"];
    expect(spec, "pin it exactly: a range can float back into a known-bad release").toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(KNOWN_BAD), `@playwright/test ${spec} is known bad: ${KNOWN_BAD[spec]}`).not.toContain(spec);
    expect(
      spec,
      `a new Playwright (${spec}): run nightly-webkit on it, then add it to KNOWN_BAD or move PINNED`,
    ).toBe(PINNED);
  });

  it("the lock installs that version for @playwright/test, playwright and playwright-core", () => {
    expect(lock.packages[""].devDependencies?.["@playwright/test"]).toBe(PINNED);
    for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(PINNED);
    }
  });

  it("Dependabot skips every known-bad release line", () => {
    for (const bad of Object.keys(KNOWN_BAD)) {
      const line = minorLine(bad).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const block = new RegExp(`dependency-name:\\s*"@playwright/test"\\s*\\n\\s*versions:\\s*\\[[^\\]]*"${line}"`);
      expect(dependabot, `.github/dependabot.yml must ignore @playwright/test ${minorLine(bad)}`).toMatch(block);
    }
  });
});
