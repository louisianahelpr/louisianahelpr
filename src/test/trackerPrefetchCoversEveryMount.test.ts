/**
 * #1582, press-every-control run 36275729414: /jobs/6e1a1c36… as customer sent
 * 48,049 requests in about 60 minutes and cut shard 3 short. One load of the
 * poster's "done" tab sent 50 `GET job_tracking?job_id=eq.…&limit=1`, one per
 * card (measured 2026-09-26, main 2dce37649, against prod). The batched
 * `job_tracking` prefetch in useActivityData covered accepted / in_progress /
 * disputed only, while the poster's card also mounts <JobTracking> on
 * `completed` and `revision_requested`, and the Helpr's card on
 * `revision_requested` and a part-staffed group job still `open`. A card whose
 * id is not in the batch gets `initialTracking === undefined` and queries for
 * itself.
 *
 * CLASS: every card state that mounts a querying tracker is in the batch. The
 * inventory is the app's own `job_status` enum crossed with helper / no helper
 * (poster) and every application status and confirmation (Helpr); the oracle
 * is the card's own mount predicate (PostedJobCard's `showsTracker`,
 * AppliedJobCard's isConfirmed / isActive / isDisputed from
 * deriveAppliedJobCardState), not a list written here.
 *
 * @mutate src/hooks/useActivityData.ts | trackedIds: postedJobs.filter(postedCardTrackerQueries) | trackedIds: postedJobs.filter((j) => isActiveStatus(j.status))
 * @mutate src/components/job-card/trackerMounts.ts | s === "open" \|\| | false \|\|
 * @mutate src/pages/posts/PostedJobCard.tsx | const showsTracker = postedCardShowsTracker(job); | const showsTracker = postedCardShowsTracker(job) \|\| job.status === "cancelled";
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Constants } from "@/integrations/supabase/types";
import { appliedDetailInputs, postedDetailInputs } from "@/hooks/useActivityData";
import { postedCardShowsTracker } from "@/components/job-card/trackerMounts";
import { deriveAppliedJobCardState } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const STATUSES = Constants.public.Enums.job_status;

function job(id: string, status: string, helper_id: string | null, confirmed: string | null = null): Job {
  return { id, status, helper_id, helper_confirmed_at: confirmed, customer_id: "c" } as unknown as Job;
}

describe("the job_tracking prefetch covers every card that mounts a tracker (#1582)", () => {
  it("inventory: the job_status enum is the real one", () => {
    // Measured 2026-09-26: 8 statuses.
    expect(STATUSES.length).toBeGreaterThan(5);
  });

  it("poster: every status x helper that shows a querying tracker is prefetched", () => {
    const jobs: Job[] = [];
    for (const s of STATUSES) for (const h of ["h1", null]) jobs.push(job(`${s}-${h ?? "none"}`, s, h));
    const tracked = new Set(postedDetailInputs(jobs).trackedIds);
    const mounting = jobs.filter((j) => postedCardShowsTracker(j) && !!j.helper_id);
    // Floor: accepted, in_progress, revision_requested, disputed, completed, open (with a helper).
    expect(mounting.length).toBeGreaterThanOrEqual(5);
    expect(mounting.filter((j) => !tracked.has(j.id)).map((j) => j.id)).toEqual([]);
  });

  it("PostedJobCard decides showsTracker with the shared predicate, not a copy", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "src/pages/posts/PostedJobCard.tsx"), "utf8"));
    expect(src).toMatch(/const showsTracker = postedCardShowsTracker\(job\);/);
  });

  it("Helpr: every Confirmed / Active / Disputed card is prefetched", () => {
    const apps: AppliedApp[] = [];
    const expected: string[] = [];
    for (const s of STATUSES)
      for (const appStatus of ["accepted", "pending", "rejected", "withdrawn"])
        for (const confirmed of [null, "2026-09-26T00:00:00Z"]) {
          const id = `${s}-${appStatus}-${confirmed ? "c" : "u"}`;
          const j = job(id, s, "h1", confirmed);
          const app = { id: `a-${id}`, job_id: id, helper_id: "h1", status: appStatus, job: j } as unknown as AppliedApp;
          apps.push(app);
          const st = deriveAppliedJobCardState(app, j, new Set(), new Set());
          if (st.isConfirmed || st.isActive || st.isDisputed) expected.push(id);
        }
    // Floor: open+accepted confirmed, accepted confirmed, in_progress x2, revision_requested x2, disputed x2.
    expect(expected.length).toBeGreaterThanOrEqual(8);
    const tracked = new Set(appliedDetailInputs(apps).trackedIds);
    expect(expected.filter((id) => !tracked.has(id))).toEqual([]);
  });

  it("the only Helpr-side tracker mounts are the Confirmed, Active and Disputed sections", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const q = join(d, f);
        if (statSync(q).isDirectory()) walk(q);
        else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) files.push(q);
      }
    };
    walk(resolve(ROOT, "src/pages/jobs"));
    const mounts = files
      .filter((f) => /<(HelperTrackerPanel|JobTracking)\b/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => f.replace(ROOT + "/", ""))
      .sort();
    // A new section that mounts a tracker must be added to appliedCardMountsTracker
    // (trackerMounts.ts) and to this list in the same commit.
    expect(mounts).toEqual([
      "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx",
      "src/pages/jobs/appliedJobCard/ConfirmedSection.tsx",
      "src/pages/jobs/appliedJobCard/DisputedSection.tsx",
      "src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx",
    ]);
  });
});
