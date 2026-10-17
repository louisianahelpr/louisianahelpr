// A CLICK NEVER HIDES WHAT THE HOVER JUST SHOWED (nightly-red #2353,
// press-every-control 38536821617 shard 11): a mouse reaches a step dot before
// it clicks it, so the hover had opened the "Done — <date>" tooltip and the
// click's toggle closed it again: the press read "no observable change".
// @mutate src/components/JobTracking.tsx |                             if (hoverOpenedStepRef.current === s.key) { |                             if (false) {
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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


const stepDots = () => screen.getAllByRole("button").filter((b) => / — [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/.test(b.getAttribute("aria-label") ?? ""));

describe("JobTracking step dots: a click shows the step's time", () => {
  it("hover then click (a mouse) leaves the tooltip open; leaving closes it", () => {
    renderWorking();
    const dots = stepDots();
    expect(dots.length, "no passed step dot with a time").toBeGreaterThan(0);
    const dot = dots[0];
    fireEvent.mouseEnter(dot);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.click(dot);
    expect(screen.queryByRole("tooltip"), "the click hid the tooltip the hover had shown").not.toBeNull();
    fireEvent.mouseLeave(dot);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a tap (no hover) opens it and a second tap closes it", () => {
    renderWorking();
    const dot = stepDots()[0];
    fireEvent.click(dot);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.click(dot);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
