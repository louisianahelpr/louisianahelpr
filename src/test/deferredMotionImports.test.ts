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
 *
 * Q1299 (2026-10-05) adds the last two first-screen closures that carried framer: /messages
 * through SwipeableConversationRow (now ConversationSwipeLayer, loaded on
 * demand) and /post-job through PhotoUpload's Reorder (now PhotoReorderGrid,
 * loaded once a photo is added). check-deferred-vendors.mjs's
 * KNOWN_ROUTE_CLOSURE_VIOLATIONS went from 2 entries to 0 in the same commit (2026-10-05).
 * @mutate src/components/messages/SwipeableConversationRow.tsx | import { createPortal } from "react-dom"; | import { createPortal } from "react-dom";\nimport { motion } from "framer-motion";
 * @mutate src/components/postjob/detailsSection/PhotoUpload.tsx | import { useEffect } from "react"; | import { useEffect } from "react";\nimport { Reorder } from "framer-motion";
 *
 * Q1356 (owner, 2026-10-12: drop the page-change fade, keep the swipe-back):
 * App.tsx loads PageTransition and ScrollToTop on every route once the page
 * settles, so each made every visitor download framer-motion for a fade. Both
 * are plain pointer events / CSS now; the built half is check-deferred-vendors.mjs's
 * PageTransition and ScrollToTop roots.
 * @mutate src/components/PageTransition.tsx | import { useLocation, useNavigate } from "react-router-dom"; | import { useLocation, useNavigate } from "react-router-dom";\nimport { motion } from "framer-motion";
 * @mutate src/components/ScrollToTop.tsx | import { ChevronUp } from "lucide-react"; | import { ChevronUp } from "lucide-react";\nimport { AnimatePresence } from "framer-motion";
 * SuccessMomentHost mounts on every route as well; it reaches SuccessMoment (framer) by import().
 * @mutate src/components/feedback/SuccessMomentHost.tsx | const moment = createLazyModule(() => import("./SuccessMoment"), "SuccessMomentHost.load"); | import * as Eager from "./SuccessMoment";\nconst moment = createLazyModule(() => Promise.resolve(Eager), "SuccessMomentHost.load");
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
  "src/components/messages/SwipeableConversationRow.tsx",
  "src/components/postjob/detailsSection/PhotoUpload.tsx",
  "src/components/PageTransition.tsx",
  "src/components/ScrollToTop.tsx",
  "src/components/feedback/SuccessMomentHost.tsx",
];
const FORBIDDEN = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?from\s*)?["'](framer-motion|\.\/SuccessMoment|@\/components\/mobileNav\/NavQuickMenu|\.\/NavQuickMenu|@\/components\/ui\/SharedLayoutPill|\.\/SwipeMotionLayer|\.\/dockMotion|\.\/ConversationSwipeLayer|\.\/PhotoReorderGrid)["']/g;

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
    const row = blankComments(readFileSync(join(ROOT, "src/components/messages/SwipeableConversationRow.tsx"), "utf8"));
    const photos = blankComments(readFileSync(join(ROOT, "src/components/postjob/detailsSection/PhotoUpload.tsx"), "utf8"));
    expect(row).toMatch(/import\("\.\/ConversationSwipeLayer"\)/);
    expect(photos).toMatch(/import\("\.\/PhotoReorderGrid"\)/);
  });
});
