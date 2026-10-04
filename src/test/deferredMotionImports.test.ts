/**
 * Q1172: the dock and /home draw without framer-motion.
 *
 * MobileNav's static imports of NavQuickMenu and SharedLayoutPill made the dock
 * wait on proxy.js (~35 kB brotli); SwipeableJobCard's made /home carry it
 * before its first draw. Each now reaches framer only through a dynamic import
 * (useDockMotion.ts, SwipeableJobCard's createLazyModule). The BUILT graph is
 * held by scripts/check-deferred-vendors.mjs (npm run gate); this is the
 * source-level half, so the regression is red in vitest too.
 *
 * @mutate src/components/MobileNav.tsx | import { DockPill } from "@/components/mobileNav/DockPill"; | import { DockPill } from "@/components/mobileNav/DockPill";\nimport { NavQuickMenu } from "@/components/mobileNav/NavQuickMenu";
 * @mutate src/components/dashboard/SwipeableJobCard.tsx | import JobCard from "./JobCard"; | import JobCard from "./JobCard";\nimport { motion } from "framer-motion";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
/** Files that draw on a first paint and so must not import framer-motion, directly or via the two dock primitives. */
const FIRST_PAINT_FILES = [
  "src/components/MobileNav.tsx",
  "src/components/mobileNav/DockPill.tsx",
  "src/components/mobileNav/useDockMotion.ts",
  "src/components/dashboard/SwipeableJobCard.tsx",
  "src/lib/lazyModule.ts",
];
const FORBIDDEN = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?from\s*)?["'](framer-motion|@\/components\/mobileNav\/NavQuickMenu|\.\/NavQuickMenu|@\/components\/ui\/SharedLayoutPill|\.\/SwipeMotionLayer|\.\/dockMotion)["']/g;

describe("framer-motion stays off the dock's and /home's first paint (Q1172)", () => {
  it("scans the real files", () => {
    expect(FIRST_PAINT_FILES.length).toBeGreaterThan(4);
    for (const f of FIRST_PAINT_FILES) expect(readFileSync(join(ROOT, f), "utf8").length).toBeGreaterThan(200);
  });

  it("none of them statically imports framer-motion, NavQuickMenu, SharedLayoutPill or the lazy layers", () => {
    const hits = FIRST_PAINT_FILES.flatMap((f) =>
      [...blankComments(readFileSync(join(ROOT, f), "utf8")).matchAll(FORBIDDEN)].map((m) => `${f} → ${m[1]}`),
    );
    expect(hits).toEqual([]);
  });

  it("the lazy layers are reached by import(), so the chunks exist", () => {
    const dock = blankComments(readFileSync(join(ROOT, "src/components/mobileNav/useDockMotion.ts"), "utf8"));
    const swipe = blankComments(readFileSync(join(ROOT, "src/components/dashboard/SwipeableJobCard.tsx"), "utf8"));
    expect(dock).toMatch(/import\("\.\/dockMotion"\)/);
    expect(swipe).toMatch(/import\("\.\/SwipeMotionLayer"\)/);
  });
});
