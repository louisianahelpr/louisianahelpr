/**
 * POSTED'S PAGE DOES NOT FETCH THE DECLUTTER CHUNKS OR SIGNED-IN-DEEP (Q2706, Builder 3, 2026-11-05).
 *
 * /jobs?tab=posted was the slowest signed-in route live (Fast 4G, 375, cold LCP 2104 ms for a helper with nothing
 * posted, 2416 for the test poster). Its page reached a few small leaves the build filed under
 * declutter-first-screen (series dates, the maps link, the support subject), declutter-item-pages (the time wheel's
 * step, the photo upload helpers) and signed-in-deep (refund requests, crew lifecycle, proof-photo cleaning, ...),
 * so every Posted load fetched all three chunks and, through their other modules, Declutter's api and seller tools.
 * Local build: Posted's static closure 134 chunks / 619,832 B gz -> 130 / 550,088 with the posted-* groups.
 *
 * Source half (this file): bootReach.mjs postedDeepModules finds those leaves, and vite.config.ts gives them groups
 * that outrank the three. Built half: scripts/check-deferred-vendors.mjs walks PostedJobsTab-*.js's real closure.
 *
 * @mutate scripts/perf/bootReach.mjs |     firstScreen: new Set(mine.filter((f) => split.declutterOnly.has(f))), |     firstScreen: new Set(),
 * @mutate scripts/perf/bootReach.mjs |   const reach = staticReach(root, [path.join(root, POSTED_ROOT)]); |   const reach = new Set();
 * @mutate vite.config.ts |               name: "posted-ip", |               name: "posted-ip-off",
 * @mutate vite.config.ts | const { firstScreen: postedFirstScreen, itemPages: postedItemPages, deep: postedDeep } = postedDeepModules( | const { firstScreen: postedFirstScreen, deep: postedItemPages, itemPages: postedDeep } = postedDeepModules(
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { postedDeepModules, signedInSplit } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const abs = (rel: string) => join(ROOT, rel).split("\\").join("/");
const config = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));

/** The priority of the codeSplitting group with this name. */
function groupPriority(name: string): number {
  const at = config.indexOf(`name: "${name}",`);
  expect(at, `group ${name}`).toBeGreaterThan(-1);
  const m = /priority:\s*([\d.]+)/.exec(config.slice(at, at + 2000));
  expect(m, `group ${name} has a priority`).not.toBeNull();
  return Number(m![1]);
}

/** The set variable the group's test reads (`postedDeep.has(...)`). */
function groupSet(name: string): string {
  const at = config.indexOf(`name: "${name}",`);
  const m = /test:\s*\(id: string\) => (\w+)\.has\(/.exec(config.slice(at, at + 400));
  expect(m, `group ${name} tests a set`).not.toBeNull();
  return m![1];
}

describe("Posted's page skips declutter-first-screen, declutter-item-pages and signed-in-deep", () => {
  const split = signedInSplit(ROOT);
  const posted = postedDeepModules(ROOT, split);

  it("finds the leaves Posted reaches in each of the three groups", () => {
    expect(posted.firstScreen.has(abs("src/lib/seriesDates.ts"))).toBe(true);
    expect(posted.firstScreen.has(abs("src/lib/mapsLink.ts"))).toBe(true);
    expect(posted.itemPages.has(abs("src/lib/declutter/photos.ts"))).toBe(true);
    expect(posted.itemPages.has(abs("src/hooks/useWheelStep.ts"))).toBe(true);
    expect(posted.deep.has(abs("src/lib/cleanProofPhoto.ts"))).toBe(true);
    expect(posted.deep.has(abs("src/lib/refundRequests/index.ts"))).toBe(true);
  });

  it("each part comes from its own group, and Declutter's api stays behind", () => {
    // Measured 11-05: firstScreen 4, itemPages 4, deep 18 modules.
    expect(posted.firstScreen.size).toBeGreaterThanOrEqual(3);
    expect(posted.itemPages.size).toBeGreaterThanOrEqual(3);
    expect(posted.deep.size).toBeGreaterThanOrEqual(10);
    for (const f of posted.firstScreen) expect(split.declutterOnly.has(f), f).toBe(true);
    for (const f of posted.deep) expect(split.deep.has(f), f).toBe(true);
    const all = [...posted.firstScreen, ...posted.itemPages, ...posted.deep];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(abs("src/lib/declutter/api.ts"));
  });

  it("vite.config.ts files each part in its own group, above the three it leaves", () => {
    expect(groupSet("posted-fs")).toBe("postedFirstScreen");
    expect(groupSet("posted-ip")).toBe("postedItemPages");
    expect(groupSet("posted-deep")).toBe("postedDeep");
    expect(config).toMatch(/const \{ firstScreen: postedFirstScreen, itemPages: postedItemPages, deep: postedDeep \} = postedDeepModules\(/);
    for (const g of ["posted-fs", "posted-ip", "posted-deep"]) {
      for (const off of ["declutter-first-screen", "declutter-item-pages", "signed-in-deep"]) {
        expect(groupPriority(g), `${g} above ${off}`).toBeGreaterThan(groupPriority(off));
      }
    }
  });
});
