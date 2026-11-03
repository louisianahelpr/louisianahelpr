import { lazy } from "react";
import { loadModule, untilReload } from "@/lib/loadModule";
import type { Tab } from "@/components/job-card/activityConstants";

// Tab content is lazy-split so the initial Activity chunk only contains the
// shell (header, filters, skeleton fallbacks). The open tab's bundle starts
// downloading when the list mounts, BESIDE its data read (startTabChunk below).
// Q1158 (B46, 11-03): it used to start only once the data was in. Measured
// (cwv-lab, signed in, 375, Slow 4G, median of 3) on a cold /jobs?tab=posted:
// get_my_activity_cores answered at ~7.5 s and only then PostedJobsTab and the
// ~45 chunks under it downloaded (7.57 -> 9.6 s); the first card drew at ~9.7 s.
// Through loadModule (src/test/dynamicImportThenDoesNoWork.test.ts): a prevented preload resolves null, and the lazy
// waits on the recovery reload instead of reading a member off undefined.
const loadPostedTab = () => loadModule(() => import("@/pages/posts/PostedJobsTab"));
const loadAppliedTab = () => loadModule(() => import("@/pages/jobs/AppliedJobsTab"));
export const PostedJobsTab = lazy(() => loadPostedTab().then((m) => (m ? { default: m.PostedJobsTab } : untilReload())));
export const AppliedJobsTab = lazy(() => loadAppliedTab().then((m) => (m ? { default: m.AppliedJobsTab } : untilReload())));
/** Start the open tab's chunk now; the lazy component's own import (the same module) owns any failure. */
export function startTabChunk(tab: Tab): void {
  (tab === "posted" ? loadPostedTab : loadAppliedTab)().catch(() => {
    /* the tab's lazy render retries and reports it */
  });
}
