/**
 * Q1158 (B46, 11-03): the Posted / Working tab's code (PostedJobsTab, AppliedJobsTab and the ~45 chunks under them)
 * starts downloading when the list MOUNTS, beside its data read, instead of after the data is in.
 *
 * Measured before (cwv-lab, signed in, 375, Slow 4G + calibrated CPU, median of 3, local real-key build vs prod data):
 * cold /jobs?tab=posted drew its first card at ~9.7 s. get_my_activity_cores answered at ~7.5 s, and only then did
 * PostedJobsTab's chunks download (7.57 -> 9.6 s): two waits in a row that have nothing to do with each other.
 */
// @mutate src/components/job-card/JobListPage.tsx |   useEffect(() => startTabChunk(tab), [tab]); |
// @mutate src/components/job-card/activityTabChunks.ts |   (tab === "posted" ? loadPostedTab : loadAppliedTab)().catch(() => { |   (tab === "posted" ? loadAppliedTab : loadPostedTab)().catch(() => {
// @mutate src/components/job-card/activityTabChunks.ts | export const PostedJobsTab = lazy(() => loadPostedTab().then((m) => (m ? { default: m.PostedJobsTab } : untilReload()))); | export const PostedJobsTab = lazy(() => import("@/pages/posts/PostedJobsTab").then((m) => ({ default: m.PostedJobsTab })));
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const posted = vi.fn();
const applied = vi.fn();
vi.mock("@/pages/posts/PostedJobsTab", () => {
  posted();
  return { PostedJobsTab: () => null };
});
vi.mock("@/pages/jobs/AppliedJobsTab", () => {
  applied();
  return { AppliedJobsTab: () => null };
});

const ROOT = resolve(__dirname, "../..");
const SRC = blankComments(readFileSync(resolve(ROOT, "src/components/job-card/JobListPage.tsx"), "utf8"));
// The loaders and lazy tabs live in their own file (L52 train 4: JobListPage stays under its size baseline).
const TABS = blankComments(readFileSync(resolve(ROOT, "src/components/job-card/activityTabChunks.ts"), "utf8"));

afterEach(() => {
  posted.mockClear();
  applied.mockClear();
});

describe("the open tab's code downloads beside its data (B46, Q1158)", () => {
  it("the component starts its tab's chunk on mount, before any early return", () => {
    const body = SRC.slice(SRC.indexOf("const Activity = ("));
    expect(body.length).toBeGreaterThan(5000);
    const start = body.indexOf("useEffect(() => startTabChunk(tab), [tab]);");
    const firstReturn = body.search(/\n\s+if \([^)]*\) return\b|\n\s+return\s*[(<]/);
    expect(start, "the mount effect that starts the tab's chunk").toBeGreaterThan(0);
    expect(firstReturn).toBeGreaterThan(0);
    expect(start).toBeLessThan(firstReturn);
  });

  it("the lazy tabs load through the same loaders startTabChunk starts (one module instance)", () => {
    expect(TABS).toMatch(/const PostedJobsTab = lazy\(\(\) => loadPostedTab\(\)/);
    expect(TABS).toMatch(/const AppliedJobsTab = lazy\(\(\) => loadAppliedTab\(\)/);
  });

  it("startTabChunk loads the open tab's module and only that one", async () => {
    const { startTabChunk } = await import("@/components/job-card/activityTabChunks");
    startTabChunk("posted");
    await vi.dynamicImportSettled();
    expect(posted).toHaveBeenCalledTimes(1);
    expect(applied).not.toHaveBeenCalled();
    startTabChunk("applied");
    await vi.dynamicImportSettled();
    expect(applied).toHaveBeenCalledTimes(1);
  }, 60_000);
});
