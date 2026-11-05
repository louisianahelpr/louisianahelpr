/**
 * A3-115 follow-up (lead 11-01): the open Working card's tracker offered "Mark it done" before a day set to finish,
 * which the server refuses (continue_day_ahead). It is greyed with the same note as the job page and the card face.
 *
 * @mutate src/components/JobTrackingView.tsx |         const doneBeforeContinueDay = isDoneStep && !!continueDayNote; |         const doneBeforeContinueDay = false;
 * @mutate src/hooks/useContinueDays.ts |     enabled: enabled && !!jobId && !!client, |     enabled: false,
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const day = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock("@/lib/continueDayReads", async (orig) => ({ ...(await orig<typeof import("@/lib/continueDayReads")>()), fetchContinueDay: async () => day.row }));

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

const AGO_MIN = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ahead = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 3 * 86_400_000));
function renderDoneStep() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <JobTracking
        jobId="job-1" helperId="helper-1" isHelper isOwner={false}
        jobDateNeeded={today} jobStatus="in_progress"
        helperConfirmedAt={AGO_MIN(600)} posterConfirmedAt={AGO_MIN(600)}
        helperOnTheWayAt={AGO_MIN(200)} helperArrivedAt={AGO_MIN(180)}
        helperArrivalVerifiedAt={AGO_MIN(180)} posterConfirmedArrivalAt={AGO_MIN(180)} posterConfirmedWorkingAt={AGO_MIN(170)}
        proofBeforeUrls={["b.jpg"]} proofAfterUrls={["a.jpg"]} requirePhotoProof
        initialTracking={{ id: "t-1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: AGO_MIN(170) }}
      />
    </QueryClientProvider>,
  );
}

describe("the open card's Mark it done before a day set to finish", () => {
  it("no day: enabled (the fixture is the done step)", async () => {
    day.row = null;
    renderDoneStep();
    const btn = await screen.findByRole("button", { name: /mark it done/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("a set day still ahead: greyed, with the note", async () => {
    day.row = { id: "c1", job_id: "job-1", proposed_by: "poster", new_date: ahead, new_start_time: "09:00:00", note: null, status: "set", helper_confirmed_at: AGO_MIN(30) };
    renderDoneStep();
    expect(await screen.findByText(/You can mark it done on \w{3} \d+\/\d+, the day you set to finish\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: /mark it done/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
