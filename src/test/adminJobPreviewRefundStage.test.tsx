/**
 * Q2683 (Jobs stages audit 1102e row 10): the admin job preview's "Refund asked" stage drew the same page as
 * "Approve before payment", because the page reads the refund_requests switch and that switch is testers-only (off
 * for the owner). The stage now asks the preview backend to answer that switch on (PreviewSample.switchesOn), and the
 * job page draws the open request (Q2694, PageRefundRequest). Every write stays blocked (adminJobPreviewIsInert).
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts | switchesOn: stage === "refund" ? ["refund_requests"] : [], | switchesOn: [],
 * @mutate src/pages/admin/preview/previewBackend.ts | for (const key of s.switchesOn) on[key] = true; | void on;
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

// Signed in as the admin, so the page asks for its switches (useFeature reads useAuthReady).
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isReady: true }) }));

import JobPreviewPage from "@/pages/admin/preview/JobPreviewPage";

const realFetch = globalThis.fetch;
beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  // The admin's own switches, as the live app answers them for the owner: refund_requests is off (testers only).
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = url.includes("/rpc/feature_switches_for_me") ? { refund_requests: false } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function renderPreview(stage: string, viewer: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/job?stage=${stage}&viewer=${viewer}`]}>
        <Routes><Route path="/admin/preview/job" element={<JobPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin job preview, Refund asked (Q2683)", () => {
  it("the Helpr's page shows the open request with Answer, though the admin's switch is off", async () => {
    renderPreview("refund", "helpr");
    expect(await screen.findByText(/Only the front yard was done/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument();
  });

  it("the poster's page says who has until when", async () => {
    renderPreview("refund", "poster");
    expect(await screen.findByText(/You asked/, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
