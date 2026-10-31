/**
 * Rentals slice 3 (owner Q41, "the tenant OKs the visit time the Helpr offers"):
 * the hired Helpr's control on their job card. The server rules (who may offer,
 * the tenant-only confirm, the stale-time guard) are proven in
 * src/test/pglite/rentalsMaintenance.pglite.mjs ("visit: ...").
 *
 * @mutate src/components/rentals/RentalVisitHelpr.tsx | enabled: on, queryFn | enabled: true, queryFn
 * @mutate src/components/rentals/RentalVisitHelpr.tsx |     mutationFn: () => proposeVisit(jobId, new Date(when).toISOString()), |     mutationFn: async () => undefined,
 * @mutate src/components/rentals/RentalVisitHelpr.tsx |             ? `Rental repair: the tenant OK'd ${fmtDate(v.proposedFor)}.` |             ? `Rental repair: you offered ${fmtDate(v.proposedFor)}. Waiting for the tenant to OK it.`
 * @mutate src/components/rentals/RentalVisitHelprSlot.tsx |       <RentalVisitHelpr jobId={jobId} /> |       {null}
 * @mutate src/components/rentals/RentalVisitHelprSlot.tsx | if (!show \|\| !VISIT_STATUSES.has(jobStatus ?? "")) return null; | if (!show) return null;
 * @mutate src/pages/jobs/AppliedJobCard.tsx | && !!job.helper_confirmed_at} /> | } />
 * @mutate src/pages/jobs/AppliedJobCard.tsx | <RentalVisitHelprSlot jobId={app.job_id} | <span data-x={app.job_id}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = { on: true, visit: null as null | { requestId: string; proposedFor: string | null; confirmedAt: string | null } };
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/lib/rentals/api", () => ({
  fetchVisitForJob: vi.fn(async () => state.visit),
  proposeVisit: vi.fn(async () => undefined),
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import RentalVisitHelpr from "./RentalVisitHelpr";
import { fetchVisitForJob, proposeVisit } from "@/lib/rentals/api";

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentalVisitHelpr jobId="j1" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.on = true;
  state.visit = null;
  vi.mocked(proposeVisit).mockClear();
  vi.mocked(fetchVisitForJob).mockClear();
});

describe("RentalVisitHelpr", () => {
  it("offers a time on a job posted from a repair request, and sends the chosen time", async () => {
    state.visit = { requestId: "r1", proposedFor: null, confirmedAt: null };
    renderIt();
    expect(await screen.findByText("Rental repair: offer the tenant a visit time.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Visit time to offer"), { target: { value: "2026-10-20T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Offer this time" }));
    await vi.waitFor(() => expect(proposeVisit).toHaveBeenCalledWith("j1", new Date("2026-10-20T10:00").toISOString()));
  });
  it("shows waiting, then the tenant's OK", async () => {
    state.visit = { requestId: "r1", proposedFor: "2026-10-20T15:00:00Z", confirmedAt: null };
    const { unmount } = renderIt();
    expect(await screen.findByText(/Waiting for the tenant to OK it\./)).toBeTruthy();
    unmount();
    state.visit = { requestId: "r1", proposedFor: "2026-10-20T15:00:00Z", confirmedAt: "2026-10-19T00:00:00Z" };
    renderIt();
    expect(await screen.findByText(/the tenant OK'd/)).toBeTruthy();
  });
  it("renders nothing while the switch is off or for a job that came from no request", async () => {
    state.on = false;
    state.visit = { requestId: "r1", proposedFor: null, confirmedAt: null };
    const { container, unmount } = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(fetchVisitForJob, "the switch is off: no Rentals read at all").not.toHaveBeenCalled();
    unmount();
    state.on = true;
    state.visit = null;
    const second = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(second.container.textContent).toBe("");
  });
  it("the hired Helpr's expanded card mounts it (AppliedJobCard, through the lazy RentalVisitHelprSlot)", () => {
    const slot = blankComments(readFileSync("src/components/rentals/RentalVisitHelprSlot.tsx", "utf8"));
    expect(slot).toContain('import("@/components/rentals/RentalVisitHelpr")');
    expect(slot).toContain("<RentalVisitHelpr jobId={jobId} />");
    expect(slot).toMatch(/if \(!show \|\| !VISIT_STATUSES\.has\(jobStatus \?\? ""\)\) return null;/);
    const src = blankComments(readFileSync("src/pages/jobs/AppliedJobCard.tsx", "utf8"));
    expect(src).toContain("<RentalVisitHelprSlot jobId={app.job_id} jobStatus={job.status}");
    // Only a Helpr who said yes (lh-authz-rls review of 39ee72808 #1): never on an offer card.
    expect(src).toMatch(/show=\{[^}]*app\.status === "accepted" && !!job\.helper_confirmed_at\} \/>/);
  });
});
