/**
 * The /home route skeleton never pulls guest /browse's chunk (B86, 11-01). App.tsx draws DashboardRouteSkeleton
 * while Home's chunk resolves, and Vite preloads the skeleton chunk's whole static closure. Its one bone
 * (src/components/ui/skeleton.tsx) is reached statically only by guest /browse among the first screens, so it
 * was grouped into browse-first-screen, and a cold signed-in /home preloaded that chunk and its closure
 * (lab, Slow 4G: 445 -> 406 KB on the wire through the dock once it left). vite.config.ts keeps it out.
 *
 * @mutate vite.config.ts | test: (id: string) => !BROWSE_GROUP_SKIPS.test(id) && browseOnly.has( | test: (id: string) => browseOnly.has(
 * @mutate vite.config.ts | const BROWSE_GROUP_SKIPS = /[\\/]src[\\/]components[\\/]ui[\\/]skeleton\.tsx$/; | const BROWSE_GROUP_SKIPS = /[\\/]src[\\/]components[\\/]ui[\\/]skeletonX\.tsx$/;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const config = blankComments(readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8"));
const skeleton = blankComments(readFileSync(resolve(process.cwd(), "src/components/DashboardRouteSkeleton.tsx"), "utf8"));

describe("the /home route skeleton's bone stays out of browse-first-screen", () => {
  it("the skeleton still draws the shared bone (so the check is about a real import)", () => {
    expect(skeleton).toMatch(/from "@\/components\/ui\/skeleton"/);
  });

  it("the browse-first-screen group skips it", () => {
    const skips = config.match(/const BROWSE_GROUP_SKIPS = (\/.*\/);/)?.[1];
    expect(skips).toBeTruthy();
    const re = new RegExp(skips!.slice(1, -1));
    expect(re.test("/repo/src/components/ui/skeleton.tsx")).toBe(true);
    expect(re.test("/repo/src/components/ui/dialog.tsx")).toBe(false);
    const group = config.slice(config.indexOf('name: "browse-first-screen"'), config.indexOf('name: "browse-home-shared"'));
    expect(group.length).toBeGreaterThan(50);
    expect(group).toMatch(/test: \(id: string\) => !BROWSE_GROUP_SKIPS\.test\(id\) && browseOnly\.has\(/);
  });
});
