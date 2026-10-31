/**
 * THE 8-STEP TRACKER KEEPS THE BEFORE AND AFTER PHOTOS (owner, 2026-10-23: "like before and after photos were
 * required on the last tracker we need to keep that also").
 *
 * On the old rail (before f657c09997) a job with require_photo_proof asked for the before photo before Start
 * working and the after photo before Done: the owed photo was the step row's primary (HelperPhotoAsk), Start
 * working / Mark done stayed disabled with the reason, and the server refused both (enforce_job_tracking_arrival_gate
 * reads proof_before_urls; enforce_helper_completion_gates and rpc_helper_mark_done raise
 * completion_requires_proof_photos; all three measured live on prod 2026-10-23 with pg_get_functiondef).
 *
 * The new tracker kept the gates and the line ("Take the before photo"), but the collapsed card's ONE button said
 * "Start working" under "Take the before photo" and "Mark done" under "Take the after photo" (measured with WebKit
 * on prod data, ~/.lh-shots/ui5-photos/before-*): a button the gates refuse. Now:
 *  1. the face's button IS the owed photo, both photos, on time and overdue;
 *  2. its tap opens the card's own photo control's capture dialog (photoCaptureRequest), not a tracker step;
 *  3. the bar puts that step on Arrived (before) / Working (after) as the viewer's move;
 *  4. the gates that enforce them are still there: Start working and Done stay disabled while a photo is owed,
 *     and an owed photo is the step row's primary.
 *
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (photo === "before") return { jobId: job.id, key: "before_photo", label: "Take the before photo" }; |
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (photo === "after") return { jobId: job.id, key: "after_photo", label: "Take the after photo" }; |
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | step.key === "before_photo" ? requestPhotoCapture(step.jobId, "before") : | step.key === "before_photo" ? requestHelperStep(step.jobId, step.key) :
 * @mutate src/components/job-card/jobStatusLine.ts |   if (beforePhotoIsThePrimary(job)) return "before_photo";\n  if (progress?.workUnderway) | if (progress?.workUnderway) return afterPhotoIsThePrimary(job) ? "after_photo" : "working";\n  if (beforePhotoIsThePrimary(job)) return "before_photo";\n  if (progress?.workUnderway)
 * @mutate src/components/PhotoProof.tsx |     if (chip && asPrimary && existingUrls.length === 0 && takePhotoCapture(jobId, type)) setOpen(true); |
 * @mutate src/components/tracker/jobStepFromWait.ts | done: [6], before_photo: [5], after_photo: [6] }; | done: [6] };
 * @mutate src/components/JobTracking.tsx |         const ctaDisabled = updating \|\| isLocked \|\| needsArrival \|\| needsBeforePhoto \|\| needsProof \|\| doneTooEarly; |         const ctaDisabled = updating \|\| isLocked \|\| needsArrival \|\| doneTooEarly;
 * @mutate src/components/JobTracking.tsx |         const photoIsPrimary = needsBeforePhoto \|\| needsProof; |         const photoIsPrimary = false;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({}) }, from: () => ({}), rpc: () => ({}) } }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: () => [], PENDING_PHOTO_SRC: "" }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { helperFaceAction, helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { takePhotoCapture, requestPhotoCapture } from "@/components/job-card/photoCaptureRequest";
import { takeHelperStepRequest } from "@/components/job-card/helperStepRequest";
import { cardBar } from "@/components/tracker/jobStepFromWait";
import { helperCardLine } from "@/pages/jobs/appliedJobCard/HelperCollapsedStrip";
import { PhotoProofCaptureChip } from "@/components/PhotoProof";
import { blankComments } from "./helpers/blankNonCode";

const T = "2026-10-22T15:00:00Z";
const job = { id: "job-p", status: "in_progress", helper_dayof_confirmed_at: T, helper_on_the_way_at: T, helper_arrived_at: T, helper_completed_at: null };
const noop = () => {};
afterEach(cleanup);

/** Every photo wait the Helpr's line has (jobStatusLine: before_photo, after_photo and their overdue forms). */
const PHOTO_CASES: Array<[string, string, string]> = [
  ["before_photo", "before_photo", "Take the before photo"],
  ["overdue_before_photo", "before_photo", "Take the before photo"],
  ["after_photo", "after_photo", "Take the after photo"],
  ["overdue_after_photo", "after_photo", "Take the after photo"],
];

describe("the tracker keeps the before and after photos (owner 2026-10-23)", () => {
  it("the photo waits are all here (floor: 4 on 2026-10-23)", () => {
    expect(PHOTO_CASES.length).toBeGreaterThan(3);
  });

  it.each(PHOTO_CASES)("1. line %s -> the face's button is the photo (%s)", (wait, key, label) => {
    const step = helperFaceNextStep(job, { status: wait.includes("after") ? "working" : "arrived" } as never, wait);
    expect(step).toMatchObject({ key, label });
  });

  it("1a. an owed before photo is the line even when the card infers work is underway (no tracking row known)", () => {
    const row = { ...job, status: "in_progress", helper_confirmed_at: T, poster_confirmed_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: T,
      require_photo_proof: true, proof_before_urls: [], proof_after_urls: [], date_needed: "2037-10-24", start_time: "15:00:00", helper_id: "h", payment_status: "escrow" } as never;
    const app = { id: "a", job: row, helper_id: "h", status: "accepted", closed_reason: null } as never;
    for (const tracking of [null, { status: "arrived" }]) {
      const line = helperCardLine(app, row, new Set(), tracking as never);
      expect({ tracking, line: line.id }).toEqual({ tracking, line: "before_photo" });
      expect(helperFaceNextStep(row, tracking as never, line.id)?.label).toBe("Take the before photo");
    }
  });

  it("1b. with no photo owed the steps are unchanged (Start working, Mark job complete)", () => {
    expect(helperFaceNextStep(job, { status: "arrived" } as never, "start_working")?.label).toBe("Start working");
    expect(helperFaceNextStep(job, { status: "working" } as never, "working")?.label).toBe("Mark job complete");
  });

  it("2. the tap asks the card's photo control to open, not the tracker to press a step", () => {
    const open = vi.fn();
    for (const [wait, type] of [["before_photo", "before"], ["after_photo", "after"]] as const) {
      const step = helperFaceNextStep(job, null, wait);
      const face = helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: noop, manage: noop, open, step });
      expect(face).toMatchObject({ tone: "primary", step: `${type}_photo` });
      face!.onClick();
      expect(takeHelperStepRequest("job-p", `${type}_photo`)).toBe(false);
      expect(takePhotoCapture("job-p", type)).toBe(true);
    }
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("2b. the row's primary photo control opens its capture dialog on the face's request, once", () => {
    requestPhotoCapture("job-p", "before");
    render(<PhotoProofCaptureChip jobId="job-p" type="before" existingUrls={[]} label="Before photo" asPrimary />);
    expect(screen.getByText("Before photos")).toBeTruthy();
    cleanup();
    render(<PhotoProofCaptureChip jobId="job-p" type="before" existingUrls={[]} label="Before photo" asPrimary />);
    expect(screen.queryByText("Before photos")).toBeNull();
  });

  it("3. the bar: the before photo is the viewer's move on Arrived, the after photo on Working", () => {
    const line = (id: string) => ({ id, detail: "", eyebrow: "", tone: "you" }) as never;
    const stamps = { ...job, helper_confirmed_at: T, poster_confirmed_at: T, date_needed: "2037-10-24" } as never;
    const before = cardBar("helpr", { line: line("before_photo"), face: { tone: "primary", step: "before_photo" } } as never, stamps, Date.parse(T));
    const after = cardBar("helpr", { line: line("after_photo"), face: { tone: "primary", step: "after_photo" } } as never, stamps, Date.parse(T));
    expect([before?.stage, before?.waitingOnYou]).toEqual([5, true]);
    expect([after?.stage, after?.waitingOnYou]).toEqual([6, true]);
    // The face's photo step alone (a line that is not the viewer's tone) still makes it the viewer's move.
    const quiet = (id: string) => ({ id, detail: "", eyebrow: "", tone: "them" }) as never;
    expect(cardBar("helpr", { line: quiet("before_photo"), face: { tone: "primary", step: "before_photo" } } as never, stamps, Date.parse(T))?.waitingOnYou).toBe(true);
  });

  it("4. the gates are still there: Start working and Done disabled while a photo is owed; the owed photo is the primary", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/JobTracking.tsx"), "utf8"));
    expect(src).toMatch(/const ctaDisabled = updating \|\| isLocked \|\| needsArrival \|\| needsBeforePhoto \|\| needsProof \|\| doneTooEarly;/);
    expect(src).toMatch(/const photoIsPrimary = needsBeforePhoto \|\| needsProof;/);
    expect(src).toMatch(/const needsBeforePhoto =/);
  });
});
