// JobTracking "Mark Job Complete" — synchronous in-flight guard + the
// server-owned completion RPC.
//
// `updating` is React state, so two clicks on the confirm dialog's primary
// button dispatched in one frame both read false: each ran the gate read and
// each fired the completion write. A second stamp moved the 24h auto-release
// clock and re-notified the poster — and, landing after a concurrent release or
// cancel, stamped a job that was no longer live (measured in PGlite,
// 20260914215112's header). Same class and fix as
// useActivityActions.inFlight.test.tsx: a ref set before the first await.
//
// Since 20260915073143 the Done write is rpc_helper_mark_done — the direct
// jobs PATCH of helper_completed_at is refused by the server-owned trigger, and
// the RPC alone stamps now(). This asserts one RPC call per decision, the
// _job_id it carries, poster_completed_at read back from its result, and the
// finish-the-release path when the poster already confirmed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]>; select?: string };
const calls: Call[] = [];
const invokeMock = vi.fn(async () => ({ data: { success: true, bothDone: true }, error: null }));
let stampRow: Record<string, unknown> = { id: "job-1", poster_completed_at: null };
const rpcMock = vi.fn(async (name: string, _args?: unknown) => {
  if (name === "rpc_helper_mark_done") {
    return {
      data: {
        already_done: false,
        helper_completed_at: new Date().toISOString(),
        poster_completed_at: stampRow.poster_completed_at ?? null,
      },
      error: null,
    };
  }
  return { data: null, error: null };
});

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
    rpc: (...args: unknown[]) => rpcMock(...(args as [string, unknown?])),
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
  // The day-gate (`isLocked`) compares this date's midnight against
  // `todayMs()`, which resolves TODAY in the platform zone (America/Chicago).
  // Building `today` from `toISOString()` (UTC) makes it a day AHEAD whenever
  // UTC has already rolled past midnight while Chicago has not — i.e. every
  // evening in the US and, in CI, every nightly run in the small UTC hours.
  // That future date locks the CTA, the confirm dialog never opens, and the
  // suite goes red purely on wall-clock time. Resolve today in the SAME zone
  // the gate uses so the fixture is "today" wherever and whenever it runs.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

const doneRpcCalls = () => rpcMock.mock.calls.filter(([name]) => name === "rpc_helper_mark_done");
// A direct jobs UPDATE of helper_completed_at must NOT happen on the happy path
// any more — the server-owned trigger refuses it; the RPC is the only writer.
const directStamps = () => calls.filter((c) => c.table === "jobs" && c.op === "update" && c.payload && "helper_completed_at" in (c.payload as object));

describe("JobTracking Done — one request per decision", () => {
  beforeEach(() => {
    calls.length = 0;
    invokeMock.mockClear();
    rpcMock.mockClear();
    stampRow = { id: "job-1", poster_completed_at: null };
  });

  it("two same-frame clicks on 'Yes, I'm Done' call rpc_helper_mark_done once", async () => {
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    const confirm = await screen.findByRole("button", { name: /mark complete/i });
    act(() => {
      confirm.click();
      confirm.click();
    });
    await waitFor(() => expect(doneRpcCalls().length).toBeGreaterThan(0));
    // Let any second in-flight call reach its write.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(doneRpcCalls()).toHaveLength(1);
    // And never a direct client stamp of helper_completed_at.
    expect(directStamps()).toHaveLength(0);
  });

  it("Done goes through the RPC with the job id, and does not release when the poster hasn't confirmed", async () => {
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(doneRpcCalls()).toHaveLength(1));
    expect(doneRpcCalls()[0][1]).toEqual({ _job_id: "job-1" });
    expect(directStamps()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("when the RPC reports the poster already confirmed, Done finishes the release through create-payment", async () => {
    stampRow = { id: "job-1", poster_completed_at: AGO(0.1) };
    renderWorking();
    fireEvent.click(await screen.findByRole("button", { name: /mark job complete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("create-payment", { body: { action: "release", jobId: "job-1" } });
  });
});

// Shown able to fail:
// Remove the synchronous in-flight ref, so two same-frame taps on the confirm both
// reach rpc_helper_mark_done — a second stamp moving the 24h auto-release clock.
// @mutate src/components/JobTracking.tsx | if (updateInFlight.current) return; |
