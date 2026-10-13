/**
 * The Helpr's collapsed card line names the step its expanded primary asks for.
 *
 * Seen live at 375 on seed job 90aa6c8b (lead, 2026-10-12): an ARRIVED,
 * photo-required job with no before photo drew "Take Before Photo" as the
 * expanded card's primary, while the collapsed line read "Finish and mark it
 * done": two different next steps on one card. deriveHelperWait returned
 * `working` for every arrived in_progress job and never looked at the photo.
 *
 * CLASS: for every arrived one-Helpr job the expanded card can show (photo
 * required / not / column missing, before photo taken / not, on the day / past
 * it), the REAL HelperPhotoAsk primary and the REAL collapsed line agree on
 * whether the next step is the before photo. Both now read one rule,
 * src/components/job-card/primaryPhotoAsk.ts. A crew member's job never gets
 * the photo line (crews have no photo primary; their strip is CrewStatusStrip).
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   if (beforePhotoIsThePrimary(job)) return "before_photo"; |   if (false) return "before_photo";
 * @mutate src/components/job-card/jobStatusLine.ts |   before_photo: "overdue_before_photo", |   before_photo: "overdue_unfinished",
 * @mutate src/components/job-card/primaryPhotoAsk.ts |   if (!job.helper_arrived_at \|\| !photoProofRequired(job)) return false; |   if (!job.helper_arrived_at) return false;
 * @mutate src/components/job-card/primaryPhotoAsk.ts |   if (args.crew) return null; |   if (false) return null;
 * @mutate src/pages/jobs/appliedJobCard/HelperCollapsedStrip.tsx | helperProgress(job, tracking?.status).workUnderway | helperProgress(job, null).workUnderway
 * @mutate src/components/job-card/jobStatusLine.ts |   return arrivalEstablished(job) ? "start_working" : "arrival_unconfirmed"; |   return "working";
 * @mutate src/components/job-card/jobStatusLine.ts |   if (progress?.workUnderway) return afterPhotoIsThePrimary(job) ? "after_photo" : "working"; |   if (progress?.workUnderway) return "working";
 * @mutate src/components/job-card/jobStatusLine.ts |   if (job.helper_arrived_at) return OVERDUE_ARRIVED[arrivedWait(job, progress)]; |   if (job.helper_arrived_at) return "overdue_unfinished";
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelperPhotoAsk } from "@/pages/jobs/appliedJobCard/steps/HelperPhotoAsk";
import { deriveHelperStep } from "@/pages/jobs/appliedJobCard/steps/stepContract";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { HelperCollapsedStrip } from "@/pages/jobs/appliedJobCard/HelperCollapsedStrip";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import { arrivalEstablished } from "@/lib/arrivalGate";
import type { TrackingData } from "@/components/JobTracking";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The chip's own uploader is not under test: paint its label and "Take" when it is the primary.
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofCaptureChip: ({ label, asPrimary }: { label: string; asPrimary?: boolean }) => (
    <button type="button">{asPrimary ? `Take ${label}` : label}</button>
  ),
}));

afterEach(cleanup);

const HELPER = "helper-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function arrivedJob(over: Record<string, unknown>): Job {
  return {
    id: "job-photo-1",
    status: "in_progress",
    helper_id: HELPER,
    customer_id: "poster-1",
    title: "Clean the camp",
    helper_confirmed_at: ago(30),
    helper_arrived_at: ago(1),
    helper_completed_at: null,
    poster_completed_at: null,
    proof_before_urls: [],
    proof_after_urls: [],
    date_needed: jobLocalDateISO(0),
    ...over,
  } as unknown as Job;
}

const app = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", created_at: ago(72), job }) as unknown as AppliedApp;

/** What the expanded card's primary asks for, rendered from the real component at the card's real step. */
function expandedPrimary(job: Job): string | null {
  const step = deriveHelperStep({ status: job.status, helperCompletedAt: job.helper_completed_at, workUnderway: false, hasArrived: true });
  expect(step).toBe("on_site");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HelperPhotoAsk jobId={job.id} job={job} step={step as "on_site"} mode="primary" />
    </QueryClientProvider>,
  );
  const text = screen.queryByRole("button")?.textContent ?? null;
  cleanup();
  return text;
}

const CASES: Array<[string, Record<string, unknown>]> = [];
for (const required of [true, false, undefined])
  for (const before of [[], ["before.jpg"]])
    for (const day of ["today", "past"] as const)
      CASES.push([
        `required=${String(required)} before=${before.length} ${day}`,
        {
          ...(required === undefined ? {} : { require_photo_proof: required }),
          proof_before_urls: before,
          ...(day === "past" ? { date_needed: jobLocalDateISO(-1), helper_confirmed_at: ago(48), helper_arrived_at: ago(30) } : {}),
        },
      ]);

describe("the collapsed line and the expanded primary name the same next step", () => {
  it("covers every combination (inventory floor)", () => {
    expect(CASES.length).toBe(12);
  });

  for (const [name, over] of CASES) {
    it(name, () => {
      const job = arrivedJob(over);
      const primary = expandedPrimary(job);
      const line = helperStatusLine(app(job));
      const primaryIsBefore = primary === "Take Before Photo";
      expect(
        /before photo/i.test(line.detail),
        `expanded primary "${primary ?? "(none: the tracker's next step)"}" but the collapsed line reads "${line.detail}"`,
      ).toBe(primaryIsBefore);
    });
  }

  it("the seed-job shape reads exactly the photo step, as Needs You", () => {
    const line = helperStatusLine(app(arrivedJob({ require_photo_proof: true })));
    expect(line.id).toBe("before_photo");
    expect(line.detail).toBe("Take the before photo");
    expect(line.eyebrow).toBe("Needs You");
    expect(expandedPrimary(arrivedJob({ require_photo_proof: true }))).toBe("Take Before Photo");
  });

  it("a crew member's job never gets the photo line (crews have no photo primary)", () => {
    const line = helperStatusLine(app(arrivedJob({ is_group_job: true })));
    expect(line.detail).not.toMatch(/before photo/i);
  });
});

/*
 * THE TRACKER'S HALF (lane B finding, 2026-10-12): on the on-site step with
 * the before photo taken (or not owed), the expanded primary is the tracker's
 * "Start Working", but the collapsed line read "Finish and mark it done". The
 * jobs row cannot say whether work started; the `job_tracking` row can, and
 * the strip never saw it. Now AppliedJobCard passes the list's tracking row to
 * HelperCollapsedStrip, which reads it through helperProgress, the same
 * derivation ActiveJobSection picks its step component from.
 *
 * CLASS: every tracking row the list can hold (none / arrived / working) x
 * every arrival evidence (claim only / GPS verified / poster confirmed) x on
 * the day / past it x after photo taken or not, with the before photo taken:
 * the REAL strip, rendered, names Start Working exactly when the expanded card
 * is on its on-site step and Start Working is unlocked, names the poster's
 * arrival tap when it is locked (arrivalEstablished), names the after photo
 * exactly when the real HelperPhotoAsk makes it the working step's primary
 * (the same mismatch one step later: "Take After Photo" over "Finish and mark
 * it done"), and says finish only when nothing else is the primary.
 */
describe("the collapsed strip names the tracker's next step (Start Working)", () => {
  const TRACKER_SRC = readFileSync(join(__dirname, "../components/JobTracking.tsx"), "utf8");
  const START = "Start Working";

  const STRIP_CASES: Array<[string, Record<string, unknown>, string | null]> = [];
  for (const tracking of [null, "arrived", "working"])
    for (const [evidence, stamps] of [
      ["claim only", {}],
      ["gps verified", { helper_arrival_verified_at: ago(1) }],
      ["poster confirmed", { poster_confirmed_arrival_at: ago(1) }],
    ] as const)
      for (const day of ["today", "past"] as const)
        for (const after of [[], ["after.jpg"]])
          STRIP_CASES.push([
            `tracking=${tracking ?? "none"} ${evidence} after=${after.length} ${day}`,
            {
              require_photo_proof: true,
              proof_before_urls: ["before.jpg"],
              proof_after_urls: after,
              ...stamps,
              ...(day === "past" ? { date_needed: jobLocalDateISO(-1), helper_confirmed_at: ago(48), helper_arrived_at: ago(30) } : {}),
            },
            tracking,
          ]);

  function stripText(job: Job, trackingStatus: string | null): string {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HelperCollapsedStrip
          app={app(job)}
          job={job}
          userId={HELPER}
          isCrewLive={false}
          unsettledDisputeJobIds={new Set()}
          tracking={trackingStatus ? ({ id: "t-1", status: trackingStatus, latitude: null, longitude: null, eta_minutes: null, updated_at: ago(1) } as TrackingData) : null}
        />
      </QueryClientProvider>,
    );
    const text = document.body.textContent ?? "";
    cleanup();
    return text;
  }

  it("covers every combination, and the tracker's on-site action is still called Start Working (inventory floor)", () => {
    expect(STRIP_CASES.length).toBe(36);
    expect(TRACKER_SRC).toMatch(/key: "working", label: "Working", action: "Start Working"/);
  });

  for (const [name, over, trackingStatus] of STRIP_CASES) {
    it(name, () => {
      const job = arrivedJob(over);
      const progress = helperProgress(job, trackingStatus);
      const step = deriveHelperStep({ status: job.status, helperCompletedAt: job.helper_completed_at, workUnderway: progress.workUnderway, hasArrived: progress.hasArrived });
      // The before photo is taken, so the expanded primary is the after photo
      // (working step, none yet) or the tracker's own next step.
      const photo = expandedPrimaryAt(job, step);
      const text = stripText(job, trackingStatus);
      const unlocked = arrivalEstablished(job);
      const where = `expanded step "${step}", primary "${photo ?? `tracker (Start Working ${unlocked ? "unlocked" : "locked on the arrival rule"})`}", collapsed strip "${text}"`;
      expect(/after photo/i.test(text), where).toBe(photo === "Take After Photo");
      expect(text.includes(START), where).toBe(step === "on_site" && unlocked);
      expect(/confirm you arrived|arrival not confirmed/i.test(text), where).toBe(step === "on_site" && !unlocked);
      expect(/finish and mark it done/i.test(text), where).toBe(step === "working" && photo === null);
    });
  }

  it("the reported shape (on site, photo taken, tracking row 'arrived', GPS verified) reads Start Working, as Needs You", () => {
    const job = arrivedJob({ require_photo_proof: true, proof_before_urls: ["before.jpg"], helper_arrival_verified_at: ago(1) });
    const line = helperStatusLine(app(job), false, { workUnderway: helperProgress(job, "arrived").workUnderway });
    expect(line.id).toBe("start_working");
    expect(line.detail).toBe("Tap Start Working");
    expect(line.eyebrow).toBe("Needs You");
  });
});

/** The expanded card's photo primary at a given step (null = the tracker's step is the primary). */
function expandedPrimaryAt(job: Job, step: string): string | null {
  if (step !== "on_site" && step !== "working") return null;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HelperPhotoAsk jobId={job.id} job={job} step={step} mode="primary" />
    </QueryClientProvider>,
  );
  const text = screen.queryByRole("button")?.textContent ?? null;
  cleanup();
  return text;
}
