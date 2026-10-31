/**
 * AUD31-79 (audit 10-31, Jobs arrival): the job page's "Mark job complete" opened the Working card but not the confirm
 * ("Mark this job complete?"), so it took two presses. The page leaves a one-shot request (helperStepRequest.ts) and
 * opens the card. On a Working tab that has not loaded the card's tracking row yet, the tracker first draws from the
 * job row alone (arrived, no poster tap: next step Start working), and that first draw dropped the "done" request
 * before the row said Working. The tracker now takes a request only once its tracking row has settled.
 *
 * @mutate src/components/JobTracking.tsx |         if (trackingSettled && takeHelperStepRequest(jobId, nextStatus.key) && !ctaDisabled) queueMicrotask(runNext); |         if (takeHelperStepRequest(jobId, nextStatus.key) && !ctaDisabled) queueMicrotask(runNext);
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]>; select?: string };
const calls: Call[] = [];
const invokeMock = vi.fn(async () => ({ data: { success: true, bothDone: true }, error: null }));
const stampRow: Record<string, unknown> = { id: "job-1", poster_completed_at: null };
const AGO = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const trackingRow = { id: "t-1", job_id: "job-1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: AGO(45) };
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
    } else if (table === "job_tracking" && c.op === "select") {
      // The card's own read of the tracking row, answered a beat later (as on a cold Working tab).
      setTimeout(() => resolve({ data: [trackingRow], error: null }), 30);
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
import { requestHelperStep } from "@/components/job-card/helperStepRequest";

describe("AUD31-79: a done request from the job page opens the confirm on a cold Working card", () => {
  it("the tracking row arrives after the first draw; the request still opens Mark this job complete?", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    requestHelperStep("job-1", "done");
    render(
      <JobTracking
        jobId="job-1" helperId="helper-1" isHelper isOwner={false}
        jobDateNeeded={today} jobStatus="in_progress"
        helperConfirmedAt={AGO(600)} posterConfirmedAt={AGO(600)}
        helperOnTheWayAt={AGO(65)} helperArrivedAt={AGO(45)} helperArrivalVerifiedAt={AGO(45)}
        posterConfirmedArrivalAt={null} posterConfirmedWorkingAt={null}
        proofBeforeUrls={["b.jpg"]} proofAfterUrls={["a.jpg"]} requirePhotoProof
      />,
    );
    expect(await screen.findByRole("button", { name: /mark job complete/i })).toBeTruthy();
    expect(await screen.findByText("Mark this job complete?", {}, { timeout: 2000 })).toBeTruthy();
  });
});
