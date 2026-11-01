/**
 * ONCE WORK HAS STARTED, THE POSTER'S CARD LINE AND THE TRACKER LINE BOTH SAY "IS WORKING" (lead decision 2026-10-31,
 * B43's open item 1). The tracker's Working step turned yellow (JobProgressState.begun) as soon as the job was in
 * progress past arrival, while the tracker's line and the poster's card line still read "Your Helpr is at the job"
 * until the poster tapped the optional working vouch. All three now read ONE rule (src/components/tracker/workHasBegun.ts).
 * The class check: over every combination of status, arrival / vouch stamps, tracking-row progress and name, the
 * tracker line and the card line say "is working" exactly when the bar's Working step has begun, and "is at the job"
 * exactly when it has not.
 *
 * @mutate src/components/tracker/workHasBegun.ts |   if (job.poster_confirmed_working_at) return true; |   if (job.poster_confirmed_working_at) return false;
 * @mutate src/components/tracker/workHasBegun.ts |   if (o.lineId && HELPR_NOT_STARTED.has(o.lineId)) return false; |
 * @mutate src/components/tracker/jobProgressState.ts | poster ? (workHasBegun(job, { workUnderway: o.workUnderway }) ? | poster ? (job.poster_confirmed_working_at ?
 * @mutate src/components/job-card/jobStatusLine.ts |   const atTheJob = id === "working" && !workHasBegun(job, { workUnderway: progress?.workUnderway }); |   const atTheJob = id === "working" && !job.poster_confirmed_working_at;
 * @mutate src/components/job-card/jobStatusLine.ts |   working: (n) => `${firstName(n)} is working`, |   working: (n) => `${firstName(n)} is at the job`,
 * @mutate src/components/job-card/jobStatusLine.ts |   working: { detail: "Your Helpr is working", eyebrow: BUCKET_LABEL.waiting, tone: "them" }, |   working: { detail: "Work is underway", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
 */
import { describe, it, expect } from "vitest";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import { workHasBegun } from "@/components/tracker/workHasBegun";
import type { Job } from "@/components/job-card/activityConstants";

const NOW = new Date("2037-10-21T15:00:00Z");
const BASE: ProgressJob = {
  status: "in_progress", helper_id: "h", payment_status: "escrow", date_needed: "2037-10-21", start_time: "09:00",
  helper_confirmed_at: "2037-10-19T15:00:00Z", helper_dayof_confirmed_at: "2037-10-21T13:00:00Z", poster_confirmed_at: "2037-10-21T13:30:00Z",
  helper_on_the_way_at: "2037-10-21T14:30:00Z", helper_arrived_at: "2037-10-21T14:50:00Z",
};

const ARRIVALS: Partial<ProgressJob>[] = [
  { poster_confirmed_arrival_at: "2037-10-21T14:55:00Z" },
  { helper_arrival_verified_at: "2037-10-21T14:52:00Z" },
  { poster_confirmed_arrival_at: "2037-10-21T14:55:00Z", poster_confirmed_working_at: "2037-10-21T14:58:00Z" },
  { poster_confirmed_working_at: "2037-10-21T14:58:00Z" },
];
const STATUSES = ["in_progress", "revision_requested"] as const;
const PROGRESS = [undefined, true, false] as const;
const NAMES = ["Hallie Brooks", null] as const;

describe("the poster's Working line follows the bar's Working step (one rule: workHasBegun)", () => {
  it("over every combination, tracker line and card line say 'is working' exactly when Working has begun", () => {
    let trackerChecked = 0;
    let cardChecked = 0;
    for (const status of STATUSES) for (const arrival of ARRIVALS) for (const workUnderway of PROGRESS) for (const name of NAMES) {
      const job: ProgressJob = { ...BASE, ...arrival, status };
      const p = jobProgress(job, { viewer: "poster", otherFirst: name ? name.split(" ")[0] : null, threadHelprId: "h", now: NOW, workUnderway });
      const begun = workHasBegun(job, { workUnderway });
      if (p.stage === 6 && p.tone === "progress") {
        expect(p.begun, JSON.stringify({ status, arrival, workUnderway })).toBe(begun);
        if (/is working|is at the job/.test(p.next)) {
          expect(p.next.endsWith(begun ? "is working" : "is at the job"), `${p.next} ${JSON.stringify({ status, arrival, workUnderway })}`).toBe(true);
          trackerChecked++;
        }
      }
      const line = posterStatusLine(job as unknown as Job, 0, NOW, undefined, false, name, workUnderway === undefined ? undefined : { workUnderway });
      if (line.id === "working") {
        if (begun) expect(line.detail).not.toMatch(/at the job/);
        else expect(line.detail).toMatch(/is at the job$/);
        if (name) expect(line.detail).toBe(begun ? "Hallie is working" : "Hallie is at the job");
        // B49 (375 look, 10-31): unnamed (Home Next up, any card with no name yet) read "Work is underway" under Live now's "Your Helpr is working".
        else expect(line.detail).toBe(begun ? "Your Helpr is working" : "Your Helpr is at the job");
        cardChecked++;
      }
    }
    // Inventory floors: the matrix really reached the Working step on both surfaces.
    expect(trackerChecked).toBeGreaterThan(10);
    expect(cardChecked).toBeGreaterThan(10);
  });

  it("the reported case: in progress past a confirmed arrival, no vouch, yellow Working bar: both lines say working", () => {
    const job: ProgressJob = { ...BASE, poster_confirmed_arrival_at: "2037-10-21T14:55:00Z" };
    const p = jobProgress(job, { viewer: "poster", otherFirst: null, threadHelprId: "h", now: NOW });
    expect(p).toMatchObject({ stage: 6, begun: true, next: "Your Helpr is working" });
    expect(posterStatusLine(job as unknown as Job, 0, NOW, undefined, false, "Hallie").detail).toBe("Hallie is working");
    expect(jobProgress(job, { viewer: "poster", otherFirst: "Hallie", threadHelprId: "h", now: NOW }).next).toBe("Hallie is working");
  });

  it("the Helpr's tracking row says not started (job page): white Working, and both lines say at the job", () => {
    const job: ProgressJob = { ...BASE, poster_confirmed_arrival_at: "2037-10-21T14:55:00Z" };
    const p = jobProgress(job, { viewer: "poster", otherFirst: "Hallie", threadHelprId: "h", now: NOW, workUnderway: false });
    expect(p).toMatchObject({ stage: 6, begun: false, next: "Hallie is at the job" });
    expect(posterStatusLine(job as unknown as Job, 0, NOW, undefined, false, "Hallie", { workUnderway: false }).detail).toBe("Hallie is at the job");
    expect(posterStatusLine(job as unknown as Job, 0, NOW, undefined, false, null, { workUnderway: false }).detail).toBe("Your Helpr is at the job");
  });

  it("the poster's own working vouch counts as started even before the tracking row catches up", () => {
    const job: ProgressJob = { ...BASE, poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t" };
    expect(jobProgress(job, { viewer: "poster", otherFirst: "Hallie", threadHelprId: "h", now: NOW, workUnderway: false })).toMatchObject({ begun: true, next: "Hallie is working" });
    expect(workHasBegun({ status: "accepted", poster_confirmed_working_at: "t" })).toBe(false);
    expect(workHasBegun({ status: "in_progress" }, { lineId: "start_working" })).toBe(false);
  });
});
