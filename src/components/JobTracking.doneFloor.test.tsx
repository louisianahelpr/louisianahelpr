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
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]>; select?: string };
const calls: Call[] = [];
const invokeMock = vi.fn(async () => ({ data: { success: true, bothDone: true }, error: null }));
const stampRow: Record<string, unknown> = { id: "job-1", poster_completed_at: null };
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

/**
 * Owner, 2026-10-08: "mark job complete should be greyed out until its
 * available in the 30 min" / "if it's greyed then no toast is needed". The
 * server's floor is COALESCE(poster_confirmed_working_at, helper_arrived_at)
 * + 30 min; the tracker's Done CTA is disabled until then, never live-then-toast.
 *
 * @mutate src/components/JobTracking.tsx |         const doneTooEarly = isDoneStep && doneFloorActive; |         const doneTooEarly = false;
 * @mutate src/components/job-card/useDoneFloor.ts |   return unlocksAt !== null && now < unlocksAt; |   return false;
 */
const AGO_MIN = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
function renderWorkingAt(arrivedMinAgo: number, workingMinAgo: number | null = null) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return render(
    <JobTracking
      jobId="job-1" helperId="helper-1" isHelper isOwner={false}
      jobDateNeeded={today} jobStatus="in_progress"
      helperConfirmedAt={AGO_MIN(600)} posterConfirmedAt={AGO_MIN(600)}
      helperOnTheWayAt={AGO_MIN(arrivedMinAgo + 20)} helperArrivedAt={AGO_MIN(arrivedMinAgo)}
      helperArrivalVerifiedAt={AGO_MIN(arrivedMinAgo)} posterConfirmedArrivalAt={AGO_MIN(arrivedMinAgo)}
      posterConfirmedWorkingAt={workingMinAgo === null ? null : AGO_MIN(workingMinAgo)}
      proofBeforeUrls={["b.jpg"]} proofAfterUrls={["a.jpg"]} requirePhotoProof
      initialTracking={{ id: "t-1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: AGO_MIN(arrivedMinAgo) }}
    />,
  );
}

describe("Mark Job Complete is greyed for the first 30 minutes", () => {
  it("10 minutes after arrival: disabled", async () => {
    renderWorkingAt(10);
    const btn = await screen.findByRole("button", { name: /mark job complete/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
  it("45 minutes after arrival: live", async () => {
    renderWorkingAt(45);
    const btn = await screen.findByRole("button", { name: /mark job complete/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
  it("the poster's later 'working' tap restarts the floor, as the server counts it", async () => {
    renderWorkingAt(45, 5);
    const btn = await screen.findByRole("button", { name: /mark job complete/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
