/**
 * Owner 2026-11-01 11:55 AM (job 7b1da54b): finishing the after-photo upload at the Working step leads straight into
 * Mark done (helperStepRequest "done"; the tracker's own Done confirmation still opens first). A crew member's or a
 * before photo's upload asks for nothing.
 * @mutate src/pages/jobs/appliedJobCard/steps/HelperPhotoAsk.tsx |     if (!crew && step === "working") requestHelperStep(jobId, "done"); |     if (false) requestHelperStep(jobId, "done");
 * @mutate src/components/JobTracking.tsx |         if (trackingSettled && !ctaDisabled && takeHelperStepRequest(jobId, nextStatus.key)) queueMicrotask(runNext); |         if (trackingSettled && takeHelperStepRequest(jobId, nextStatus.key) && !ctaDisabled) queueMicrotask(runNext);
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const uploads = vi.hoisted(() => ({} as Record<string, () => void>));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofCaptureChip: ({ type, onUploaded }: { type: string; onUploaded: () => void }) => { uploads[type] = onUploaded; return <button type="button">{type}</button>; },
}));
vi.mock("@/components/job-card/jobStepRow", () => ({ JobStepRowSlot: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { HelperPhotoAsk } from "@/pages/jobs/appliedJobCard/steps/HelperPhotoAsk";
import { takeHelperStepRequest } from "@/components/job-card/helperStepRequest";
import type { Job } from "@/components/job-card/activityConstants";

const job = (over: Partial<Job> = {}) => ({ id: "j1", require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: [], is_group_job: false, ...over }) as unknown as Job;
const show = (j: Job, step: "working" | "on_site") =>
  render(<QueryClientProvider client={new QueryClient()}><HelperPhotoAsk jobId="j1" job={j} step={step} mode="primary" /></QueryClientProvider>);

describe("after photos lead straight into Mark done", () => {
  it("the after photo's upload at Working asks the tracker for Done", () => {
    show(job(), "working");
    expect(uploads.after).toBeTypeOf("function");
    uploads.after();
    expect(takeHelperStepRequest("j1", "done")).toBe(true);
  });
  it("a before photo asks for nothing", () => {
    show(job({ proof_before_urls: [] } as Partial<Job>), "on_site");
    uploads.before();
    expect(takeHelperStepRequest("j1", "done")).toBe(false);
  });
  it("the tracker keeps the request through a draw where Done is still greyed (the row not yet re-read)", () => {
    const src = blankComments(readFileSync(path.resolve(__dirname, "../components/JobTracking.tsx"), "utf8"));
    expect(src).toMatch(/trackingSettled && !ctaDisabled && takeHelperStepRequest\(jobId, nextStatus\.key\)/);
  });
});
