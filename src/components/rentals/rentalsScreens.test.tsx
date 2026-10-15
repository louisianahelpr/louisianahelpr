/**
 * Rentals S1 screens: the states a member can reach (docs/specs/landlord-hub-prep.md).
 * The Rentals API module and the account hooks are stubbed: these tests check
 * what each STATE renders; the backend proof is
 * src/test/pglite/rentalsMaintenance.pglite.mjs.
 *
 * @mutate src/components/rentals/rentalsUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/components/rentals/MaintenanceRequestForm.tsx |   const showEmergencySteps = urgency === "emergency" && !emergencyAcknowledged; |   const showEmergencySteps = false;
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |                 disabled={!reason \|\| decline.isPending} |                 disabled={decline.isPending}
 * @mutate src/components/rentals/RentalsHomeView.tsx |               !adding && !underAge && ( |               !adding && (
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |         {isLandlord && r.status === "approved" && job.booking === "none" && ( |         {isLandlord && r.status === "approved" && !job.jobId && (
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |         {isTenant && r.status === "approved" && workStarted && ( |         {isTenant && r.status === "approved" && !!job.jobId && (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  underAge: false,
  tenancies: [] as unknown[],
  request: null as unknown,
  job: { jobId: null as string | null, booking: "none", jobStatus: null as string | null },
};

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>Page not found</p> }));
vi.mock("@/lib/rentals/api", () => ({
  fetchMyProperties: async () => [],
  fetchUnits: async () => [],
  fetchMyHomes: async () => state.tenancies,
  fetchMyRequests: async () => [],
  fetchRequest: async () => state.request,
  fetchRequestPhotos: async () => [],
  fetchRequestJobState: async () => state.job,
  signedFileUrl: async () => "https://signed/x",
  fileRequest: vi.fn(async () => "r1"),
  approveRequest: vi.fn(async () => undefined),
  declineRequest: vi.fn(async () => undefined),
  withdrawRequest: vi.fn(async () => undefined),
  answerFixed: vi.fn(async () => undefined),
  createProperty: vi.fn(),
  submitOwnershipProof: vi.fn(),
  addUnit: vi.fn(),
  setAutoApprove: vi.fn(),
  inviteTenant: vi.fn(),
}));

import RentalsPage from "@/pages/rentals/RentalsPage";
import MaintenanceRequestPage from "@/pages/rentals/MaintenanceRequestPage";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // RentalsGate waits for the switch query to settle before showing the 404.
  qc.setQueryData(["feature-enabled", "rentals", "u1"], state.feature);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rentals" element={<RentalsPage />} />
          <Route path="/rentals/requests/:id" element={<MaintenanceRequestPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TENANCY = { tenancy_id: "t1", property_id: "p1", unit_id: "u9", label: "Oak Street duplex", unit_label: "A", street_address: "1 Oak", city: "Lafayette", zip_code: "70501" };
const REQ = {
  id: "r1", status: "submitted", landlord_id: "u1", tenant_id: "t9", category: "plumbing", description: "Sink drips all night.",
  urgency: "soon", access_windows: "", pets_on_site: false, ok_to_enter_alone: false, property_label: "Oak", unit_label: "A",
  created_at: "2026-10-15T06:00:00Z", decided_at: null, decline_reason_code: null, decline_reason_text: null, job_id: null,
  tenant_answered_at: null, tenant_says_fixed: null, tenant_fixed_note: null, auto_approved: false,
};

beforeEach(() => {
  state.feature = true;
  state.underAge = false;
  state.tenancies = [];
  state.request = null;
  state.job = { jobId: null, booking: "none", jobStatus: null };
});

describe("Rentals screens", () => {
  it("the hidden switch off: /rentals is the 404", async () => {
    state.feature = false;
    renderAt("/rentals");
    expect(await screen.findByText("Page not found")).toBeTruthy();
  });

  it("one page for everyone: both the renter and the owner sections show", async () => {
    renderAt("/rentals");
    expect(await screen.findByText("Homes you rent")).toBeTruthy();
    expect(screen.getByText("Properties you own")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a property" })).toBeTruthy();
  });

  it("an emergency shows the 911 / utility steps BEFORE anything is sent (Q40)", async () => {
    state.tenancies = [TENANCY];
    renderAt("/rentals");
    fireEvent.click(await screen.findByRole("button", { name: "Request a repair" }));
    fireEvent.click(screen.getByLabelText(/Emergency/));
    expect(screen.getByRole("alert").textContent).toMatch(/call 911/i);
    expect(screen.getByRole("link", { name: "Call 911" }).getAttribute("href")).toBe("tel:911");
    expect(screen.queryByRole("button", { name: "Send to my landlord" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /I'm safe/ }));
    expect(screen.getByRole("button", { name: "Send to my landlord" })).toBeTruthy();
  });

  it("under 18: no repair request or property buttons (Q59)", async () => {
    state.underAge = true;
    state.tenancies = [TENANCY];
    renderAt("/rentals");
    expect(await screen.findByText(/must be 18 or older/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request a repair" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a property" })).toBeNull();
  });

  it("the landlord can only decline after picking a reason (Q46)", async () => {
    state.request = REQ;
    renderAt("/rentals/requests/r1");
    const decline = await screen.findByRole("button", { name: "Decline request" });
    expect((decline as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Already scheduled"));
    expect((decline as HTMLButtonElement).disabled).toBe(false);
  });

  it("a declined request shows the landlord's reason to the tenant", async () => {
    state.request = { ...REQ, landlord_id: "l1", tenant_id: "u1", status: "declined", decline_reason_code: "not_my_responsibility", decline_reason_text: "Tenant damage", decided_at: "2026-10-15T07:00:00Z" };
    renderAt("/rentals/requests/r1");
    expect(await screen.findByText(/Not my responsibility under the lease/)).toBeTruthy();
    expect(screen.getByText(/Tenant damage/)).toBeTruthy();
    expect(screen.getByText("Answered")).toBeTruthy();
  });

  describe("an approved request: the linked job's real state, not 'a job id is set' (lh-money-escrow review #1)", () => {
    const approved = { ...REQ, status: "approved", decided_at: "2026-10-15T07:00:00Z", job_id: "j1" };
    it("landlord, payment failed or abandoned: the post button is back", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "none", jobStatus: "open" };
      renderAt("/rentals/requests/r1");
      expect(await screen.findByRole("button", { name: "Post the repair job" })).toBeTruthy();
    });
    it("landlord, checkout in flight: says so, and no second post", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "paying", jobStatus: "open" };
      renderAt("/rentals/requests/r1");
      expect(await screen.findByText(/Checkout started/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Post the repair job" })).toBeNull();
    });
    it("landlord, mid-refund: 'Refund in progress', not 'paying'", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "refunding", jobStatus: "cancelled" };
      renderAt("/rentals/requests/r1");
      expect(await screen.findByText("Refund in progress.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Post the repair job" })).toBeNull();
    });
    it("tenant, linked but not funded: 'Approved, not booked yet' and no 'Was it fixed?'", async () => {
      state.request = { ...approved, landlord_id: "l1", tenant_id: "u1" };
      state.job = { jobId: "j1", booking: "none", jobStatus: "open" };
      renderAt("/rentals/requests/r1");
      expect(await screen.findByText("Approved, not booked yet.")).toBeTruthy();
      expect(screen.queryByText("Was it fixed?")).toBeNull();
    });
    it("tenant, booked and work started: 'Was it fixed?' shows", async () => {
      state.request = { ...approved, landlord_id: "l1", tenant_id: "u1" };
      state.job = { jobId: "j1", booking: "booked", jobStatus: "in_progress" };
      renderAt("/rentals/requests/r1");
      expect(await screen.findByText("A Helpr job is booked for this repair.")).toBeTruthy();
      expect(screen.getByText("Was it fixed?")).toBeTruthy();
    });
  });
});
