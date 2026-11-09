/**
 * Q2705 / Q1158 (Builder 3, 2026-11-09): signed-in /jobs (Browse) does not download, before its first draw, three
 * things its first screen never shows.
 *
 * - CompactJobCard: the "compact" density row. Nothing sets that density any more (feedDensity.ts reads a stored
 *   value only), yet its one `formatDistanceToNow` put the whole date-fns chunk (7.9 KB gz) on Browse's first round.
 * - RefundsSwitch: the refund_requests provider wraps only the Posted / Working lists. Its chunk (job-lifecycle) also
 *   carries HelperDoneWhatNext, so the static import put WhatNextSheet and the Sheet on Browse too.
 * - SavedSearches: the saved-searches dialog, closed on every first paint (opened from the filter sheet's row).
 *
 * Measured on a real-key build of main 873309be70 vs this change (scripts/perf/critical-path.mjs): /jobs closure
 * 395 -> 376 KB gz, guest /browse 301 -> 292 KB gz; the dates, job-lifecycle, sheet and WhatNextSheet chunks left the
 * /jobs path. Lab numbers: docs/OPEN.md Q2705 (Builder 3, 11-09). Evidence ~/.lh-shots/speed-home/.
 */
// @mutate src/components/dashboard/feedCards.tsx | import { loadModule, untilReload } from "@/lib/loadModule"; | import { loadModule, untilReload } from "@/lib/loadModule";\nimport "@/components/dashboard/CompactJobCard";
// @mutate src/pages/jobs/JobsSection.tsx | import { navKey } from "@/lib/i18n/navLabels"; | import { navKey } from "@/lib/i18n/navLabels"; import "@/components/refund/RefundsSwitch";
// @mutate src/components/dashboard/BrowseTasksToolbar.tsx | import { hapticLight } from "@/lib/haptics"; | import { hapticLight } from "@/lib/haptics"; import "@/components/SavedSearches";
// @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       {user && (savedSearchesOpen \|\| savedSearchesMounted) && ( |       {user && (
// @mutate src/pages/jobs/JobsSection.tsx |     return { default: (props: Parameters<typeof List>[0]) => <RefundsSwitchProvider><List {...props} /></RefundsSwitchProvider> }; |     return { default: (props: Parameters<typeof List>[0]) => <List {...props} /> };
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const posix = (f: string) => f.replace(/\\/g, "/");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Off Browse's first screen: each is reached only through a dynamic import. */
const OFF_FIRST_SCREEN = [
  "src/components/dashboard/CompactJobCard.tsx",
  "src/components/refund/RefundsSwitch.tsx",
  "src/components/SavedSearches.tsx",
] as const;

describe("signed-in /jobs' first screen stays light (Q2705)", () => {
  const reach = [...staticReach(ROOT, [join(ROOT, "src/pages/jobs/JobsSection.tsx")])].map(posix);

  it("JobsSection does not statically reach the compact row, the refunds provider or the saved-searches dialog", () => {
    // Inventory floor: the walk read Browse's graph (the feed, its cards and the toolbar).
    expect(reach.length).toBeGreaterThan(200);
    for (const f of ["src/pages/home/Dashboard.tsx", "src/components/dashboard/feedCards.tsx", "src/components/dashboard/BrowseTasksToolbar.tsx"]) {
      expect(reach.some((r) => r.endsWith(`/${f}`)), f).toBe(true);
    }
    for (const f of OFF_FIRST_SCREEN) expect(reach.filter((r) => r.endsWith(`/${f}`)), f).toEqual([]);
  });

  it("each is still loaded where it is used", () => {
    expect(code("src/components/dashboard/feedCards.tsx")).toContain('import("@/components/dashboard/CompactJobCard")');
    const section = code("src/pages/jobs/JobsSection.tsx");
    expect(section).toContain('import("@/components/refund/RefundsSwitch")');
    // The lists still get the provider: the lazy wrapper renders it around JobListPage.
    expect(section).toMatch(/<RefundsSwitchProvider><List \{\.\.\.props\} \/><\/RefundsSwitchProvider>/);
    const toolbar = code("src/components/dashboard/BrowseTasksToolbar.tsx");
    expect(toolbar).toContain('import("@/components/SavedSearches")');
    // Mounted from its first open on, not on every first paint.
    expect(toolbar).toMatch(/\{user && \(savedSearchesOpen \|\| savedSearchesMounted\) && \(/);
  });
});
