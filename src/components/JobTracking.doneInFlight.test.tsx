// JobTracking "Mark Job Complete" — synchronous in-flight guard + the live-status
// predicate on the helper_completed_at stamp.
//
// `updating` is React state, so two clicks on the confirm dialog's primary
// button dispatched in one frame both read false: each ran the gate read and
// each wrote helper_completed_at. The second write moved the stamp the 24h
// auto-release clock is keyed on and re-notified the poster — and, landing
// after a concurrent release or cancel, stamped a job that was no longer live
// (measured in PGlite, 20260914215112's header). Same class and fix as
// useActivityActions.inFlight.test.tsx: a ref set before the first await.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]>; select?: string };
const calls: Call[] = [];
const invokeMock = vi.fn(async () => ({ data: { success: true, bothDone: true }, error: null }));
let stampRow: Record<string, unknown> = { id: "job-1", poster_completed_at: null };

function chain(table: string) {
  const c: Call = { table, op: "select", filters: [] };
  calls.push(c);
  const self: Record<string, unknown> = {};
  self.select = (cols?: string) => { if (c.op === "select") c.select = cols; else c.select = cols; return self; };
  self.update = (p: unknown) => { c.op = "update"; c.payload = p; return self; };
  self.insert = (p: unknown) => { c.op = "insert"; c.payload = p; return self; };
  for (const m of ["eq", "in", "is", "order", "limit"]) {
    self[m] = (col: string, v: unknown) => { c.filters.push([m, col, v]); return self; };
  }
  self.single = () => self;
  self.then = (resolve: (v: unknown) => void) => {
    if (table === "jobs" && c.op === "select") {
      resolve({
        data: {
          proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"], require_photo_proof: true,
          poster_confirmed_working_at: null, helper_arrived_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
          helper_arrival_verified_at: new Date(Date.now() - 3 * 3600e3).toISOString(), poster_confirmed_arrival_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
        },
        error: null,
      });
    } else if (table === "jobs" && c.op === "update") {
      resolve({ data: [stampRow], error: null });
    } else if (c.op === "select") {
      resolve({ data: [], error: null });
    } else {
      resolve({ data: [{ id: "t-1" }], error: null });
    }
  };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: (...args: unknown[]) => invokeMock(...(args as [])) },
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/realtimeRecovery", () => ({ subscribeWithRecovery: () => ({ close: () => {}, unsubscribe: () => {} }) }));
vi.mock("@/lib/enRouteLocation", () => ({ startEnRouteWatch: () => ({ stop: () => {}, mode: null }) }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/hooks/usePermissionRationale", () => ({ usePermissionRationale: () => ({ request: async () => false }) }));

import { JobTracking } from "./JobTracking";

const AGO = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

function renderWorking() {
  const today = new Date().toISOString().slice(0, 10);
  return render(
    <JobTracking
      jobId="job-1"
      helperId="helper-1"
      isHelper
      isOwner={false}
      jobDateNeeded={today}
      jobStatus="in_progress"
      helperConfirmedAt={AGO(6)}
      posterConfirmedAt={AGO(6)}
      helperOnTheWayAt={AGO(4)}
      helperArrivedAt={AGO(3)}
      helperArrivalVerifiedAt={AGO(3)}
      posterConfirmedArrivalAt={AGO(3)}
      proofBeforeUrls={["b.jpg"]}
      proofAfterUrls={["a.jpg"]}
      requirePhotoProof
      initialTracking={{ id: "t-1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: AGO(2) }}
    />,
  );
}

const stamps = () => calls.filter((c) => c.table === "jobs" && c.op === "update" && c.payload && "helper_completed_at" in (c.payload as object));

describe("JobTracking Done — one request per decision", () => {
  beforeEach(() => {
    calls.length = 0;
    invokeMock.mockClear();
    stampRow = { id: "job-1", poster_completed_at: null };
  });

  it("two same-frame clicks on 'Yes, I'm Done' write helper_completed_at once", async () => {
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    const confirm = await screen.findByRole("button", { name: /mark complete/i });
    act(() => {
      confirm.click();
      confirm.click();
    });
    await waitFor(() => expect(stamps().length).toBeGreaterThan(0));
    // Let any second in-flight call reach its write.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(stamps()).toHaveLength(1);
  });

  it("the stamp only matches a LIVE job (status predicate), and reads back poster_completed_at", async () => {
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(stamps()).toHaveLength(1));
    const [stamp] = stamps();
    expect(stamp.filters).toContainEqual(["in", "status", ["accepted", "in_progress", "revision_requested"]]);
    expect(stamp.select).toMatch(/poster_completed_at/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("when the poster already confirmed, the Done finishes the release through create-payment", async () => {
    stampRow = { id: "job-1", poster_completed_at: AGO(0.1) };
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("create-payment", { body: { action: "release", jobId: "job-1" } });
  });
});
