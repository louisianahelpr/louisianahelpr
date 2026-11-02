/**
 * Q2694 (audit 1102e row 6, job-refund-poster-375.png / job-refund-helpr-375.png): the job page never showed an open
 * refund request. RefundsSwitchProvider wrapped only the job lists (JobsSection), so the page never read the
 * refund_requests switch, and it drew no RefundRequestPanel. Now the page draws the cards' own panel, behind the same
 * switch: the Helpr asked sees the amount, the reason, the answer-by and Answer (Accept / Say no); the poster sees
 * what they asked and that Eli has until when to answer.
 *
 * Drawn through the admin job preview's "Refund asked" stage (made-up job, nothing sent), with the switch answered on,
 * and with it answered off (nothing about the refund shows: the switch still gates it).
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {party && (isPoster \|\| isHired) && !!job.helper_id && !job.is_group_job && ( |             {false && (
 *
 * Lead look 11-02 (refund-poster-375.png): the poster's tracker still said "Next: approve Eli's work" with Approve
 * leading the row, beside the refund's own "Waiting on Eli R. to answer"; the Helpr's tracker said "Lexi has until
 * ... to check it" beside "Next: answer Lexi L.'s refund request". While the request is open the refund line is the
 * one next step: the tracker drops its "Next:" line on both sides and Approve leaves the poster's row.
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             hideNext={refundOpen \|\| (isPoster && !continueDay.row && showsNow(job, trackingStatus))} |             hideNext={isPoster && !continueDay.row && showsNow(job, trackingStatus)}
 * @mutate src/pages/jobs/jobPage/posterPageActions.tsx |     const cardLead = !step && cardSteps && flows.leadCount > 0 && !refundOpen; |     const cardLead = !step && cardSteps && flows.leadCount > 0;
 * @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const disputeOpen = status === "disputed" \|\| !!job.has_active_dispute \|\| refundOpen; |   const disputeOpen = status === "disputed" \|\| !!job.has_active_dispute;
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));
// The switch read runs only for a signed-in session (useFeature -> useAuthReady): the admin's.
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isReady: true }),
}));

import JobPreviewPage from "@/pages/admin/preview/JobPreviewPage";
import { previewSample } from "@/pages/admin/preview/jobPreviewSamples";

const realFetch = globalThis.fetch;
let refundsOn = true;

beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  // Underneath the preview: only sign-in and the feature-switch read pass through (previewBackend.ts); answer the
  // switch read with refund_requests on or off, everything else empty.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = url.includes("/rpc/feature_switches_for_me") ? JSON.stringify({ refund_requests: refundsOn }) : "[]";
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function renderStage(viewer: "poster" | "helpr") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/job?stage=refund&viewer=${viewer}`]}>
        <Routes><Route path="/admin/preview/job" element={<JobPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const refundBlock = () => document.querySelector("[data-job-refund]");

describe("the job page shows an open refund request (Q2694)", () => {
  it("the Helpr asked sees the amount, the reason, the answer-by and Answer", async () => {
    refundsOn = true;
    renderStage("helpr");
    await screen.findAllByText(previewSample("refund", "helpr").job.title, undefined, { timeout: 10000 });
    await waitFor(() => expect(refundBlock()?.textContent ?? "").toMatch(/asked for \$40(\.00)? back/), { timeout: 10000 });
    const text = refundBlock()?.textContent ?? "";
    expect(text).toContain("Only the front yard was done; the side yard was skipped.");
    expect(text).toMatch(/Answer by /);
    expect(refundBlock()?.querySelector("button")?.textContent ?? "").toMatch(/Answer/);
  }, 30000);

  it("the poster who asked sees what they asked and until when the Helpr has to answer", async () => {
    refundsOn = true;
    renderStage("poster");
    await screen.findAllByText(previewSample("refund", "poster").job.title, undefined, { timeout: 10000 });
    await waitFor(() => expect(refundBlock()?.textContent ?? "").toMatch(/You asked .* for \$40(\.00)? back/), { timeout: 10000 });
    expect(refundBlock()?.textContent ?? "").toMatch(/has until .* to answer/);
  }, 30000);

  it("the poster's page has one next line while the request is open: no tracker 'Next: approve', no Approve button", async () => {
    refundsOn = true;
    renderStage("poster");
    await waitFor(() => expect(refundBlock()?.textContent ?? "").toMatch(/Waiting on .* to answer/), { timeout: 10000 });
    const steps = document.querySelector("[data-job-steps]")?.textContent ?? "";
    expect(steps).not.toMatch(/approve/i);
    const approve = screen.queryAllByRole("button").filter((b) => /^approve/i.test((b.textContent ?? "").trim()));
    expect(approve).toHaveLength(0);
  }, 30000);

  it("the Helpr's tracker does not contradict the refund line (no 'has until ... to check it')", async () => {
    refundsOn = true;
    renderStage("helpr");
    await waitFor(() => expect(refundBlock()?.textContent ?? "").toMatch(/refund request/), { timeout: 10000 });
    const steps = document.querySelector("[data-job-steps]")?.textContent ?? "";
    expect(steps).not.toMatch(/to check it/);
  }, 30000);

  it("with the switch off, the poster's approve step is back (the yield is the refund's, not the stage's)", async () => {
    refundsOn = false;
    renderStage("poster");
    await screen.findAllByText(previewSample("refund", "poster").job.title, undefined, { timeout: 10000 });
    await waitFor(() => expect(document.querySelector("[data-job-steps]")?.textContent ?? "").toMatch(/approve/i), { timeout: 10000 });
    const approve = screen.queryAllByRole("button").filter((b) => /^approve/i.test((b.textContent ?? "").trim()));
    expect(approve.length).toBeGreaterThan(0);
  }, 30000);

  it("with the switch off, nothing about the refund shows", async () => {
    refundsOn = false;
    renderStage("helpr");
    await screen.findAllByText(previewSample("refund", "helpr").job.title, undefined, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(document.body.textContent ?? "").not.toContain("the side yard was skipped");
  }, 30000);
});
