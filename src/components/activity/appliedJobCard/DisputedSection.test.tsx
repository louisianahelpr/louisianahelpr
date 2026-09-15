/**
 * VN-23 (owner, 2026-09-14): "disputes should still show the tracker".
 *
 * The Helpr's disputed card put the dispute banner IN PLACE of the tracker in
 * JobStepCard's `header` slot, while the poster's card (PostedJobCard
 * `showsTracker`) kept the tracker on the same job. This pins the new shape:
 * the header is the same HelperTrackerPanel the live steps mount, read-only,
 * and the dispute banner comes directly after it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AppliedApp, Job } from "../activityConstants";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("./steps/HelperPhotoAsk", () => ({ HelperPhotoAsk: () => null }));
vi.mock("@/components/activity/DeadlineCountdown", () => ({ default: () => null }));
vi.mock("./HelperTrackerPanel", () => ({
  HelperTrackerPanel: ({ readOnly, userId }: { readOnly?: boolean; userId: string }) => (
    <div data-testid="helper-tracker" data-read-only={String(!!readOnly)} data-user={userId} />
  ),
}));

import { DisputedSection } from "./DisputedSection";

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  status: "disputed",
  dispute_status: "open",
  disputed_by: "poster-1",
  dispute_reason: "Left half the driveway",
  customer_id: "poster-1",
  helper_id: "helper-1",
  date_needed: "2026-09-10",
} as unknown as Job;
const app = { id: "app-1", job_id: "job-1", helper_id: "helper-1", status: "accepted" } as unknown as AppliedApp;

const renderSection = () =>
  render(
    <DisputedSection
      app={app}
      job={job}
      userId="helper-1"
      initialTracking={null}
      navigate={() => {}}
      onViewDispute={() => {}}
      onRefresh={() => {}}
      disputeResponse=""
      setDisputeResponse={() => {}}
      respondingJobId={null}
      setRespondingJobId={() => {}}
      submittingResponse={false}
      setSubmittingResponse={() => {}}
    />,
  );

describe("Helpr's disputed card keeps the tracker (VN-23)", () => {
  it("renders the helper tracker, read-only, on a disputed job", () => {
    renderSection();
    const tracker = screen.getByTestId("helper-tracker");
    expect(tracker).toHaveAttribute("data-read-only", "true");
    expect(tracker).toHaveAttribute("data-user", "helper-1");
  });

  it("puts the tracker first and the dispute banner directly below it", () => {
    const { container } = renderSection();
    const step = container.querySelector('[data-job-step="helper:disputed"]');
    expect(step).not.toBeNull();
    const tracker = screen.getByTestId("helper-tracker");
    expect(step!.firstElementChild).toBe(tracker);
    const banner = screen.getByText("Dispute open");
    expect(tracker.nextElementSibling?.contains(banner)).toBe(true);
  });
});
