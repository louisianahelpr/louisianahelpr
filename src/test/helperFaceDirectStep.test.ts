/**
 * Boards 62/64: the Helpr's Working card face names the real next tracker step and takes it
 * through the tracker's own button (helperStepRequest.ts), so the tracker's gates still decide.
 *
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (!job.helper_dayof_confirmed_at \|\| job.helper_completed_at) return null; |   if (job.helper_completed_at) return null;
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (job.status === "revision_requested" \|\| job.status === "disputed") return null; |
 * @mutate src/components/job-card/helperStepRequest.ts |   return req.step === step && Date.now() - req.at < REQUEST_TTL_MS; |   return Date.now() - req.at < REQUEST_TTL_MS;
 * @mutate src/components/JobTracking.tsx |         if (trackingSettled && !ctaDisabled && takeHelperStepRequest(jobId, nextStatus.key)) queueMicrotask(runNext); |         if (trackingSettled && takeHelperStepRequest(jobId, nextStatus.key)) queueMicrotask(runNext);
 * @mutate src/pages/jobs/AppliedJobCard.tsx | open: () => { if (!isExpanded) toggleExpandedJobId(app.job_id); }, | open: () => toggleExpandedJobId(app.job_id),
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   if (wait === "arrival_unconfirmed" \|\| wait === "overdue_arrival_unconfirmed") return null; |
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { helperFaceAction, helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { requestHelperStep, takeHelperStepRequest } from "@/components/job-card/helperStepRequest";

const code = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");
const T = "2026-10-31T13:00:00Z";
const base = { id: "j1", helper_dayof_confirmed_at: T, helper_on_the_way_at: null, helper_arrived_at: null, helper_completed_at: null };

describe("Helpr face: the real next step, taken through the tracker", () => {
  it("walks the tracker's order, gated on the Helpr's own day-before confirm", () => {
    expect(helperFaceNextStep({ ...base, helper_dayof_confirmed_at: null }, null)).toBeNull();
    expect(helperFaceNextStep({ ...base, status: "revision_requested" }, null)).toBeNull();
    expect(helperFaceNextStep(base, null)?.label).toBe("I'm on my way");
    expect(helperFaceNextStep({ ...base, helper_on_the_way_at: T }, null)?.key).toBe("arrived");
    const arrived = { ...base, helper_on_the_way_at: T, helper_arrived_at: T };
    expect(helperFaceNextStep(arrived, null)?.label).toBe("Start working");
    const tr = { id: "t", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: T };
    expect(helperFaceNextStep(arrived, tr)?.label).toBe("Mark job complete");
    expect(helperFaceNextStep({ ...arrived, helper_completed_at: T }, tr)).toBeNull();
  });

  it("the face button is filled, asks for the step and opens (never closes) the card", () => {
    const open = vi.fn(), manage = vi.fn();
    const a = helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: () => {}, manage, open, step: helperFaceNextStep(base, null) });
    expect(a).toMatchObject({ label: "I'm on my way", tone: "primary" });
    a!.onClick();
    expect(open).toHaveBeenCalled();
    expect(manage).not.toHaveBeenCalled();
    expect(takeHelperStepRequest("j1", "on_the_way")).toBe(true);
    expect(takeHelperStepRequest("j1", "on_the_way")).toBe(false); // one shot
    expect(helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: () => {}, manage, step: null })).toMatchObject({ label: "Manage job", tone: "secondary" });
  });

  it("a request for another step is dropped, and old requests expire", () => {
    requestHelperStep("j2", "done");
    expect(takeHelperStepRequest("j2", "working")).toBe(false);
    expect(takeHelperStepRequest("j2", "done")).toBe(false);
    vi.useFakeTimers();
    requestHelperStep("j3", "done");
    vi.advanceTimersByTime(11_000);
    expect(takeHelperStepRequest("j3", "done")).toBe(false);
    vi.useRealTimers();
  });

  it("the tracker presses its own button only when that button is enabled", () => {
    const src = code("src/components/JobTracking.tsx");
    // A greyed draw does not use the request up (owner 11-01: the after photo's upload asks for Done before the row is re-read).
    expect(src).toMatch(/if \(trackingSettled && !ctaDisabled && takeHelperStepRequest\(jobId, nextStatus\.key\)\) queueMicrotask\(runNext\);/);
    expect(src).toMatch(/onClick=\{runNext\}/);
    expect(src).toMatch(/disabled=\{ctaDisabled\}/);
    expect(code("src/pages/jobs/AppliedJobCard.tsx")).toMatch(/open: \(\) => \{ if \(!isExpanded\) toggleExpandedJobId\(app\.job_id\); \}/);
    expect(code("src/pages/jobs/AppliedJobCard.tsx")).toMatch(/step: \(isConfirmed \|\| isActive\) && !isCrewLive && !job\.is_group_job \? helperFaceNextStep\(job, initialTracking, cardLine\.id\) : null/);
  });

  it("no Start working while the card's own line says it is locked on the arrival rule (lead review 2026-10-22)", () => {
    const arrived = { ...base, helper_on_the_way_at: T, helper_arrived_at: T };
    expect(helperFaceNextStep(arrived, null, "start_working")?.label).toBe("Start working");
    expect(helperFaceNextStep(arrived, null, "arrival_unconfirmed")).toBeNull();
    expect(helperFaceNextStep(arrived, null, "overdue_arrival_unconfirmed")).toBeNull();
  });
});
