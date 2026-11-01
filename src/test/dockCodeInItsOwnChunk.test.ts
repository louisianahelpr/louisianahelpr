/**
 * The dock's share of the every-page signed-in code has its own chunk (B86, 11-01). bootReach's homeLate set (the
 * signed-in code only the every-page roots run) was one signed-in-late chunk, so the dock (MobileNav) waited for
 * Legal's data export, the ID sheet's switch reads and the award copy too. vite.config.ts now puts the part of
 * homeLate that MobileNav reaches statically in signed-in-dock. Lab (/home, Slow 4G, x4 CPU, median of 3, same
 * session): the dock's closure 18.2 -> 13.8 KB gz, dock drawn 3.37 -> 3.15 s.
 *
 * @mutate vite.config.ts | test: (id: string) => homeLate.has(norm(id)) && dockSet.has(norm(id)), | test: (id: string) => homeLate.has(norm(id)) && dockSet.has(norm(id)) && false,
 * @mutate vite.config.ts | [path.join(process.cwd(), "src/components/MobileNav.tsx")] | [path.join(process.cwd(), "src/components/MobileNavX.tsx")]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";

const config = blankComments(readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8"));

describe("signed-in-dock", () => {
  it("is a group of the dock's homeLate modules, above signed-in-late", () => {
    const at = config.indexOf('name: "signed-in-dock"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(config.indexOf('name: "signed-in-late"'));
    const group = config.slice(at, config.indexOf("}", at));
    expect(group).toContain("test: (id: string) => homeLate.has(norm(id)) && dockSet.has(norm(id)),");
    expect(config).toMatch(/const dockSet = staticReach\(process\.cwd\(\), \[path\.join\(process\.cwd\(\), "src\/components\/MobileNav\.tsx"\)\]\);/);
  });

  it("has modules to hold, and leaves some for signed-in-late", () => {
    const { homeLate } = signedInSplit(process.cwd());
    const dock = staticReach(process.cwd(), [resolve(process.cwd(), "src/components/MobileNav.tsx")]);
    const inDock = [...homeLate].filter((f) => dock.has(f));
    expect(inDock.length).toBeGreaterThan(3);
    expect(homeLate.size - inDock.length).toBeGreaterThan(3);
  });
});
