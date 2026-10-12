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
 * @mutate src/components/job-card/jobStatusLine.ts |       if (beforePhotoIsThePrimary(job)) return "before_photo"; |       if (false) return "before_photo";
 * @mutate src/components/job-card/jobStatusLine.ts | return beforePhotoIsThePrimary(job) ? "overdue_before_photo" : "overdue_unfinished"; | return "overdue_unfinished";
 * @mutate src/components/job-card/primaryPhotoAsk.ts |   if (!job.helper_arrived_at \|\| !photoProofRequired(job)) return false; |   if (!job.helper_arrived_at) return false;
 * @mutate src/components/job-card/primaryPhotoAsk.ts |   if (args.crew) return null; |   if (false) return null;
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelperPhotoAsk } from "@/pages/jobs/appliedJobCard/steps/HelperPhotoAsk";
import { deriveHelperStep } from "@/pages/jobs/appliedJobCard/steps/stepContract";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

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
