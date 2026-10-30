/**
 * Owner 2026-10-30: "Declutter opens with the map showing. Make Jobs do the same thing." Jobs' desktop map column
 * defaulted ON, but under "helpr.browseMapVisible", where a device that once hid it kept a "0" (the owner's did),
 * so Jobs opened list-only while Declutter opened split. Jobs now reads a new key that starts ON, and never the old.
 *
 * @mutate src/lib/jobsMapVisible.ts | export const JOBS_MAP_KEY = "helpr.jobsMapVisible"; | export const JOBS_MAP_KEY = "helpr.browseMapVisible";
 * @mutate src/lib/jobsMapVisible.ts |   return safeStorage.getItem(JOBS_MAP_KEY) !== "0"; |   return safeStorage.getItem(JOBS_MAP_KEY) === "1";
 * @mutate src/pages/home/Dashboard.tsx |   const [mapVisible, setMapVisible] = useState<boolean>(readJobsMapVisible); |   const [mapVisible, setMapVisible] = useState<boolean>(() => safeStorage.getItem("helpr.browseMapVisible") !== "0");
 * @mutate src/pages/home/Dashboard.tsx |     saveJobsMapVisible(next); |     safeStorage.setItem("helpr.browseMapVisible", next ? "1" : "0");
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const OLD_KEY = "helpr.browseMapVisible";
// Loaded per test, so the file is red (not a crash) on a tree without the module.
const mod = () => import("./jobsMapVisible");

beforeEach(() => localStorage.clear());

describe("Jobs opens with the map, like Declutter (owner 2026-10-30)", () => {
  it("a device that hid the map under the old key opens with it now", async () => {
    const { JOBS_MAP_KEY, readJobsMapVisible } = await mod();
    localStorage.setItem(OLD_KEY, "0");
    expect(JOBS_MAP_KEY).not.toBe(OLD_KEY);
    expect(readJobsMapVisible()).toBe(true);
  });

  it("a fresh device opens with the map", async () => {
    const { readJobsMapVisible } = await mod();
    expect(readJobsMapVisible()).toBe(true);
  });

  it("the toggle is remembered on this device from then on", async () => {
    const { JOBS_MAP_KEY, readJobsMapVisible, saveJobsMapVisible } = await mod();
    saveJobsMapVisible(false);
    expect(localStorage.getItem(JOBS_MAP_KEY)).toBe("0");
    expect(readJobsMapVisible()).toBe(false);
    saveJobsMapVisible(true);
    expect(readJobsMapVisible()).toBe(true);
  });

  it("Jobs' Browse reads and saves the map choice only through this module, never the old key", () => {
    const file = resolve(__dirname, "../pages/home/Dashboard.tsx");
    const src = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const literals: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Inventory floor: the scan really read Dashboard's strings.
    expect(literals.length).toBeGreaterThan(50);
    expect(literals).not.toContain(OLD_KEY);
    expect(src).toContain("useState<boolean>(readJobsMapVisible)");
    expect(src).toMatch(/saveJobsMapVisible\(next\)/);
  });
});
