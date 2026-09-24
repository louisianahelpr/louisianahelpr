import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { JobDetailFooter } from "./JobDetailFooter";
import type { EnrichedJob } from "../types";

// VN-2 (owner, 2026-09-14): an applicant must NOT see the Message button in
// the job detail footer — only the poster, the offered helper and the hired
// helper. The original gate also admitted `viewerAppPosition != null`, so the
// "applicant" case below failed before the fix.
function makeJob(overrides: Record<string, unknown> = {}): EnrichedJob {
  return {
    id: "job-1",
    title: "Fix the fence",
    budget: 100,
    customer_id: "poster",
    helper_id: null,
    offered_to_helper_id: null,
    credential_tier: 0,
    ...overrides,
  } as unknown as EnrichedJob;
}

function renderFooter(viewerUserId: string, viewerAppPosition: number | null, job = makeJob()) {
  return render(
    <JobDetailFooter
      job={job}
      guest={false}
      onApply={vi.fn()}
      navigate={vi.fn()}
      viewerUserId={viewerUserId}
      viewerAppPosition={viewerAppPosition}
      viewerTier={0}
      onAskQuestion={vi.fn()}
    />,
  );
}

const messageButton = () => screen.queryByRole("button", { name: "Ask a question" });

describe("JobDetailFooter Message button (VN-2)", () => {
  afterEach(cleanup);

  it("is hidden from an applicant who has not been offered or hired", () => {
    renderFooter("applicant", 0);
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(messageButton()).toBeNull();
  });

  it("is hidden from a browsing helper", () => {
    renderFooter("browser", null);
    expect(messageButton()).toBeNull();
  });

  it("shows for the poster once a Helpr is hired", () => {
    renderFooter("poster", null, makeJob({ helper_id: "helper" }));
    expect(messageButton()).not.toBeNull();
  });

  it("shows for the poster once a Helpr is offered", () => {
    renderFooter("poster", null, makeJob({ offered_to_helper_id: "helper" }));
    expect(messageButton()).not.toBeNull();
  });

  // DH-002: with nobody hired or offered, the only thread would be with themselves.
  it("is hidden from the poster when there is nobody to message", () => {
    renderFooter("poster", null);
    expect(messageButton()).toBeNull();
  });

  it("shows for the offered helper, even though they applied", () => {
    renderFooter("helper", 0, makeJob({ offered_to_helper_id: "helper" }));
    expect(messageButton()).not.toBeNull();
  });

  it("shows for the hired helper", () => {
    renderFooter("helper", 0, makeJob({ helper_id: "helper" }));
    expect(messageButton()).not.toBeNull();
  });
});

// The original VN-2 gate, restored: `|| viewerAppPosition != null` let any
// applicant message the poster from the job detail footer.
// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | viewerUserId === (job as { helper_id?: string \| null }).helper_id) && | viewerUserId === (job as { helper_id?: string \| null }).helper_id \|\| viewerAppPosition != null) &&
// DH-002: without the counterpart gate the poster gets a thread with themselves.
// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | askQuestionCounterpart(job, viewerUserId) != null && ( | (
// @mutate src/components/dashboard/jobDetailDialog/askQuestionCounterpart.ts | ? job.helper_id ?? job.offered_to_helper_id ?? null | ? job.customer_id
