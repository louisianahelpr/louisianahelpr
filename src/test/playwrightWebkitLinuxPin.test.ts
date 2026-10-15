/**
 * Q1816 (2026-10-15): never run a Playwright whose Linux WebKit is known to
 * stop painting.
 *
 * THE BUG (measured). nightly-webkit run 38692697851 went red on two specs
 * that had passed on 10-13 (home-chrome.spec.ts:275, nav-hide-on-scroll.spec.ts:432):
 * a click inside the filter sheet waited 30 s for its target to be "stable",
 * and the trace's screencast sent no frame after the sheet opened. Three
 * dependency bumps landed in between (#2933 dev tooling with Playwright 1.64.0,
 * #2934 Radix Dialog 1.2.0, #2936 framer-motion 14). Bisected on ubuntu-latest,
 * mocked backend, the two specs only:
 *   run 38697230656: as on main (1.64.0) FAIL; Playwright 1.63.0 PASS;
 *     Radix Dialog 1.1.23 or framer-motion 13.5.0 under 1.64.0 still FAIL.
 *   run 38697854281: 1.64.0 with backdrop-filter forced off everywhere PASS;
 *     with animations and transitions off FAIL; with backdrop-filter off only
 *     inside dialogs, the dialog spec PASSES and the page-scroll spec still
 *     FAILS (the page's own glass surfaces stall it).
 * The same two specs PASS on macOS WebKit 2370 (1.64.0's build) with main's
 * exact dependencies, so the fault is the Linux browser build, not the app.
 *
 * THE RULE. The installed @playwright/test is not a known-bad version, the
 * spec in package.json is EXACT (a caret lets a lock refresh float back into
 * the bad version), the lock agrees for all three packages, and Dependabot
 * skips each known-bad line. A newer release is still offered: when it is,
 * this test fails until someone re-runs the WebKit specs on it and either
 * adds it to KNOWN_BAD or drops the pin (Q?webkit-linux-pin).
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

/** Versions whose Linux WebKit build stalls painting under backdrop-filter, with the run that proved it. */
const KNOWN_BAD: Record<string, string> = {
  "1.64.0": "nightly-webkit 38692697851; bisect 38697230656 + 38697854281",
};
/** The version every workflow runs today, and the newest one proven green on the two specs (bisect 38697230656). */
const PINNED = "1.63.0";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
};
const dependabot = readFileSync(".github/dependabot.yml", "utf8").replace(/#.*$/gm, "");
const minorLine = (v: string) => v.split(".").slice(0, 2).join(".") + ".x";

describe("Playwright stays off a version whose Linux WebKit stalls (Q1816)", () => {
  it("reads real files (floor)", () => {
    expect(Object.keys(lock.packages).length).toBeGreaterThan(500);
    expect(Object.keys(KNOWN_BAD).length).toBeGreaterThan(0);
  });

  it("package.json pins @playwright/test exactly, to a version not known bad", () => {
    const spec = pkg.devDependencies["@playwright/test"];
    expect(spec, "pin it exactly: a range can float back into a known-bad release").toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(KNOWN_BAD), `@playwright/test ${spec} is known bad: ${KNOWN_BAD[spec]}`).not.toContain(spec);
    expect(spec, `a new Playwright (${spec}): re-run nightly-webkit's two specs on it, then add it to KNOWN_BAD or drop the pin and update PINNED`).toBe(PINNED);
  });

  it("the lock installs that version for @playwright/test, playwright and playwright-core", () => {
    expect(lock.packages[""].devDependencies?.["@playwright/test"]).toBe(PINNED);
    for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(PINNED);
    }
  });

  it("Dependabot skips every known-bad release line", () => {
    for (const bad of Object.keys(KNOWN_BAD)) {
      const block = new RegExp(`dependency-name:\\s*"@playwright/test"\\s*\\n\\s*versions:\\s*\\[[^\\]]*"${minorLine(bad).replace(/\./g, "\\.")}"`);
      expect(dependabot, `.github/dependabot.yml must ignore @playwright/test ${minorLine(bad)}`).toMatch(block);
    }
  });
});
