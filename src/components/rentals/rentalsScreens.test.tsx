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
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |               onClick={ageGate("post", () => navigate(`/post-job?maintenance=${r.id}`))} |               onClick={() => navigate(`/post-job?maintenance=${r.id}`)}
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |         {isTenant && r.status === "approved" && workStarted && ( |         {isTenant && r.status === "approved" && !!job.jobId && (
 * @mutate src/components/rentals/rentalsUi.tsx |   return settled ? <NotFound /> : <>{skeleton}</>; |   return settled ? <NotFound /> : null;
 * @mutate src/pages/rentals/MaintenanceRequestPage.tsx | : <MaintenanceRequestUnavailable />}> | : <RentalsGateFrame title="Repair request" backTo="/rentals" label="Loading the request" />}>
 * @mutate src/components/rentals/MaintenanceRequestView.tsx |     enabled: validId && !!uid, |     enabled: !!id && !!uid,
 * @mutate src/components/rentals/RentalsHomeView.tsx |   if (!data.isError && !data.data) return <RentalsHomeSkeleton />; |   if (!data.isError && !data.data) return null;
 * @mutate src/components/rentals/RentalsHomeView.tsx |                   <EndTenancyButton tenancyId={h.tenancy_id} kind="leave" onDone={refresh} /> |                   {null}
 * @mutate src/components/rentals/RentalsHomeView.tsx |                 <EndTenancyButton tenancyId={t.id} kind={t.status === "active" ? "end" : "cancel-invite"} onDone={onChange} /> |                 {null}
 * @mutate src/components/rentals/EndTenancyButton.tsx |     mutationFn: () => endTenancy(tenancyId), |     mutationFn: async () => undefined,
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  /** false: the switch's answer has not arrived (the gate's loading frame). */
  switchSettled: true,
  requestReads: 0,
  homeLoads: true,
  underAge: false,
  tenancies: [] as unknown[],
  properties: [] as unknown[],
  units: [] as unknown[],
  live: [] as unknown[],
  request: null as unknown,
  job: { jobId: null as string | null, booking: "none", jobStatus: null as string | null },
};

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: state.underAge,
    gate:
      <A extends unknown[]>(_kind: string, go: (...args: A) => void) =>
      (...args: A) => {
        if (!state.underAge) go(...args);
      },
    gatedProps: () => (state.underAge ? { "aria-disabled": true } : {}),
  }),
}));
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
  fetchMyProperties: async () => state.properties,
  fetchUnits: async () => state.units,
  fetchLiveTenancies: async () => state.live,
  endTenancy: vi.fn(async () => undefined),
  fetchMyHomes: () => (state.homeLoads ? Promise.resolve(state.tenancies) : new Promise(() => {})),
  fetchMyRequests: async () => [],
  fetchRequest: async () => {
    state.requestReads++;
    return state.request;
  },
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

import { endTenancy } from "@/lib/rentals/api";
import RentalsPage from "@/pages/rentals/RentalsPage";
import MaintenanceRequestPage from "@/pages/rentals/MaintenanceRequestPage";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // RentalsGate waits for the switch query to settle before showing the 404.
  if (state.switchSettled) qc.setQueryData(["feature-enabled", "rentals", "u1"], state.feature);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rentals" element={<RentalsPage />} />
          <Route path="/rentals/requests/:id" element={<MaintenanceRequestPage />} />
          <Route path="/post-job" element={<p>Post a Job form</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const TENANCY = { tenancy_id: "t1", property_id: "p1", unit_id: "u9", label: "Oak Street duplex", unit_label: "A", street_address: "1 Oak", city: "Lafayette", zip_code: "70501" };
const REQ = {
  id: RID, status: "submitted", landlord_id: "u1", tenant_id: "t9", category: "plumbing", description: "Sink drips all night.",
  urgency: "soon", access_windows: "", pets_on_site: false, ok_to_enter_alone: false, property_label: "Oak", unit_label: "A",
  created_at: "2026-10-15T06:00:00Z", decided_at: null, decline_reason_code: null, decline_reason_text: null, job_id: null,
  tenant_answered_at: null, tenant_says_fixed: null, tenant_fixed_note: null, auto_approved: false,
};

beforeEach(() => {
  state.feature = true;
  state.switchSettled = true;
  state.requestReads = 0;
  state.homeLoads = true;
  state.underAge = false;
  state.tenancies = [];
  state.properties = [];
  state.units = [];
  state.live = [];
  state.request = null;
  state.job = { jobId: null, booking: "none", jobStatus: null };
});

describe("Rentals screens", () => {
  it("the hidden switch off: /rentals is the 404", async () => {
    state.feature = false;
    renderAt("/rentals");
    expect(await screen.findByText("Page not found")).toBeTruthy();
  });

  describe("loading frames: the page's own shell, never a blank page (measure-loading-states, 2026-10-15)", () => {
    it("/rentals while the switch loads: the real header, no bones (the switch may still say off)", () => {
      state.feature = false;
      state.switchSettled = false;
      renderAt("/rentals");
      expect(screen.getByRole("heading", { name: "Rentals" })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Loading your rentals");
      expect(screen.queryByText("Homes you rent")).toBeNull();
      expect(screen.queryByText("Page not found")).toBeNull();
    });
    it("/rentals while its data loads: both cards with bones", async () => {
      state.homeLoads = false;
      renderAt("/rentals");
      expect(await screen.findByRole("status", { name: "Loading your rentals" })).toBeTruthy();
      expect(screen.getByText("Homes you rent")).toBeTruthy();
      expect(screen.getByText("Properties you own")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add a property" })).toBeNull();
    });
    it("a request while the switch loads: the request page's header", () => {
      state.feature = false;
      state.switchSettled = false;
      renderAt(`/rentals/requests/${RID}`);
      expect(screen.getByRole("heading", { name: "Repair request" })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Loading the request");
    });
    it("a link that cannot name a request: 'isn't available' at once, and no read is sent", async () => {
      state.feature = false;
      state.switchSettled = false;
      const { unmount } = renderAt("/rentals/requests/test");
      expect(screen.getByText("This request isn't available.")).toBeTruthy();
      unmount();
      state.feature = true;
      state.switchSettled = true;
      renderAt("/rentals/requests/test");
      expect(await screen.findByText("This request isn't available.")).toBeTruthy();
      expect(state.requestReads).toBe(0);
    });
  });

  it("one page for everyone: both the renter and the owner sections show", async () => {
    renderAt("/rentals");
    expect(await screen.findByRole("button", { name: "Add a property" })).toBeTruthy();
    expect(screen.getByText("Homes you rent")).toBeTruthy();
    expect(screen.getByText("Properties you own")).toBeTruthy();
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
    renderAt(`/rentals/requests/${RID}`);
    const decline = await screen.findByRole("button", { name: "Decline request" });
    expect((decline as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Already scheduled"));
    expect((decline as HTMLButtonElement).disabled).toBe(false);
  });

  it("a declined request shows the landlord's reason to the tenant", async () => {
    state.request = { ...REQ, landlord_id: "l1", tenant_id: "u1", status: "declined", decline_reason_code: "not_my_responsibility", decline_reason_text: "Tenant damage", decided_at: "2026-10-15T07:00:00Z" };
    renderAt(`/rentals/requests/${RID}`);
    expect(await screen.findByText(/Not my responsibility under the lease/)).toBeTruthy();
    expect(screen.getByText(/Tenant damage/)).toBeTruthy();
    expect(screen.getByText("Answered")).toBeTruthy();
  });

  describe("an approved request: the linked job's real state, not 'a job id is set' (lh-money-escrow review #1)", () => {
    const approved = { ...REQ, status: "approved", decided_at: "2026-10-15T07:00:00Z", job_id: "j1" };
    it("landlord, payment failed or abandoned: the post button is back", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "none", jobStatus: "open" };
      renderAt(`/rentals/requests/${RID}`);
      fireEvent.click(await screen.findByRole("button", { name: "Post the repair job" }));
      expect(await screen.findByText("Post a Job form")).toBeTruthy();
    });
    it("landlord under 18: Post the repair job is greyed out and goes nowhere (Q1586(c))", async () => {
      state.underAge = true;
      state.request = approved;
      state.job = { jobId: "j1", booking: "none", jobStatus: "open" };
      renderAt(`/rentals/requests/${RID}`);
      const btn = await screen.findByRole("button", { name: "Post the repair job" });
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(btn);
      expect(screen.queryByText("Post a Job form")).toBeNull();
    });
    it("landlord, checkout in flight: says so, and no second post", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "paying", jobStatus: "open" };
      renderAt(`/rentals/requests/${RID}`);
      expect(await screen.findByText(/Checkout started/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Post the repair job" })).toBeNull();
    });
    it("landlord, mid-refund: 'Refund in progress', not 'paying'", async () => {
      state.request = approved;
      state.job = { jobId: "j1", booking: "refunding", jobStatus: "cancelled" };
      renderAt(`/rentals/requests/${RID}`);
      expect(await screen.findByText("Refund in progress.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Post the repair job" })).toBeNull();
    });
    it("tenant, linked but not funded: 'Approved, not booked yet' and no 'Was it fixed?'", async () => {
      state.request = { ...approved, landlord_id: "l1", tenant_id: "u1" };
      state.job = { jobId: "j1", booking: "none", jobStatus: "open" };
      renderAt(`/rentals/requests/${RID}`);
      expect(await screen.findByText("Approved, not booked yet.")).toBeTruthy();
      expect(screen.queryByText("Was it fixed?")).toBeNull();
    });
    it("tenant, booked and work started: 'Was it fixed?' shows", async () => {
      state.request = { ...approved, landlord_id: "l1", tenant_id: "u1" };
      state.job = { jobId: "j1", booking: "booked", jobStatus: "in_progress" };
      renderAt(`/rentals/requests/${RID}`);
      expect(await screen.findByText("A Helpr job is booked for this repair.")).toBeTruthy();
      expect(screen.getByText("Was it fixed?")).toBeTruthy();
    });
  });

  describe("ending a tenancy: both sides have the control (rentals_end_tenancy)", () => {
    const confirmIn = async (button: string, confirm: string) => {
      fireEvent.click(await screen.findByRole("button", { name: button }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === confirm)!);
    };
    beforeEach(() => vi.mocked(endTenancy).mockClear());

    it("a tenant leaves a home they rent, after a confirm", async () => {
      state.tenancies = [TENANCY];
      renderAt("/rentals");
      await confirmIn("Leave this home", "Leave home");
      await vi.waitFor(() => expect(vi.mocked(endTenancy)).toHaveBeenCalledWith("t1"));
    });

    it("a landlord ends an active tenancy and cancels an unused invite, each after a confirm", async () => {
      state.properties = [{ id: "p1", owner_id: "u1", label: "Oak", street_address: "1 Oak", city: "Lafayette", zip_code: "70501", ownership_status: "approved", auto_approve_limit_cents: null }];
      state.units = [{ id: "u9", property_id: "p1", label: "A" }];
      state.live = [
        { id: "ta", unit_id: "u9", status: "active", accepted_at: "2026-10-16T12:00:00Z", invite_expires_at: "2026-10-30T12:00:00Z", created_at: "2026-10-16T11:00:00Z" },
        { id: "ti", unit_id: "u9", status: "invited", accepted_at: null, invite_expires_at: "2026-10-30T12:00:00Z", created_at: "2026-10-17T11:00:00Z" },
      ];
      renderAt("/rentals");
      expect(await screen.findByText(/Tenant connected/)).toBeTruthy();
      expect(screen.getByText(/Invite not used yet/)).toBeTruthy();
      await confirmIn("End tenancy", "End tenancy");
      await vi.waitFor(() => expect(vi.mocked(endTenancy)).toHaveBeenCalledWith("ta"));
      await confirmIn("Cancel invite", "Cancel invite");
      await vi.waitFor(() => expect(vi.mocked(endTenancy)).toHaveBeenCalledWith("ti"));
    });

    it("closing the confirm ends nothing", async () => {
      state.tenancies = [TENANCY];
      renderAt("/rentals");
      fireEvent.click(await screen.findByRole("button", { name: "Leave this home" }));
      fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));
      expect(vi.mocked(endTenancy)).not.toHaveBeenCalled();
    });
  });
});
