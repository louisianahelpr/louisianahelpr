/**
 * AUD31-60/66 (part): Home's first screen no longer downloads the code only
 * the OTHER signed-in first screens run.
 *
 * Every signed-in visitor lands on /home, and its first screen fetched all of
 * `signed-in-shared`: the shared code of every signed-in first screen (the job
 * lists, Messages, You, Post a job). Measured on the production build
 * (bundle-size.yml env, 2026-10-31): /home 458 KB gz before, 441 after;
 * scripts/perf/critical-path.mjs now budgets /home, and CI's bundle-size.yml
 * checks the built graph.
 *
 * This file reads the same source walk vite.config.ts splits chunks by
 * (scripts/perf/bootReach.mjs): signedInSplit's `homeOff` (first-screen code
 * Home never runs) is real, disjoint from Home's static reach, and gets its own
 * `signed-in-pages` chunk, ranked above signed-in-shared so it wins those modules.
 *
 * @mutate vite.config.ts |               test: (id: string) => homeOff.has(id.split("?")[0].replace(/\\/g, "/")), |               test: (id: string) => signedInDeep.has(id.split("?")[0].replace(/\\/g, "/")),
 * @mutate vite.config.ts |               priority: 15.5, |               priority: 14,
 * @mutate scripts/perf/bootReach.mjs |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !home.has(f))); |   const homeOff = new Set();
 * @mutate scripts/perf/bootReach.mjs |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !home.has(f))); |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f)));
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homeFirstScreenRoots, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const homeReach = new Set([...staticReach(ROOT, homeFirstScreenRoots(ROOT))].map(rel));

describe("Home's first screen carries only Home's code (AUD31-60/66)", () => {
  it("walks a real first screen (floor: the dock, Home and its summary are all reached)", () => {
    expect(homeReach.size).toBeGreaterThan(60);
    for (const f of ["src/components/MobileNav.tsx", "src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/useHomeSummary.ts", "src/components/ProtectedRoute.tsx"]) {
      expect(homeReach.has(f), f).toBe(true);
    }
  });

  it("splits the first-screen code Home never runs into its own chunk", () => {
    const { homeOff, firstScreen } = signedInSplit(ROOT);
    const off = [...homeOff].map(rel);
    expect(off.length).toBeGreaterThan(50);
    expect(off.filter((f) => homeReach.has(f))).toEqual([]);
    expect([...homeOff].every((f) => firstScreen.has(f))).toBe(true);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const group = config.match(/name:\s*"signed-in-pages",[\s\S]*?\}/)?.[0] ?? "";
    expect(group).toMatch(/test:\s*\(id: string\)\s*=>\s*homeOff\.has\(/);
    // Above signed-in-shared (15), below signed-in-deep (16) and declutter-first-screen (17).
    expect(group).toMatch(/priority:\s*15\.5,/);
  });
});
