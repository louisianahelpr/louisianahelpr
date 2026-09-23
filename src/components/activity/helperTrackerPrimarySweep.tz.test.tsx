import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppliedApp, Job } from "./activityConstants";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/**
 * CLASS GUARD: the Helpr's Confirmed card offers at most ONE primary at every
 * instant, and WHICH primary it offers is a function of the instant alone —
 * never of the viewer's device timezone.
 *
 * WHAT IT CATCHES (nightly-red, main: Vitest, 2026-09-23 04:18Z = 23:18
 * Central). jobStepOneRow's "day-of confirmation still owed" case rendered
 * ["I'm On My Way", "I'm Still On"] in the row's primary slot on the UTC CI
 * runner and passed on a Central laptop. HelperTrackerPanel measured its
 * "Confirmed step still open" gate from `parseLocalDate(date_needed)` — the
 * VIEWER's midnight — while JobConfirmation, which renders "I'm Still On",
 * measures the same window from the JOB's (America/Chicago) midnight. On a
 * device east of Central the gate dropped early (UTC: 19:00 Central on the job
 * day), the tracker went live with "I'm On My Way" once the start was inside
 * its 2h unlock, and "I'm Still On" was still on screen beside it. West of
 * Central the gate outlived the control that releases it: no primary at all.
 * A real product bug for any helper whose phone is not set to Central, not a
 * fixture clock bug — the same instant renders differently by zone.
 *
 * HOW: the job day is fixed, and the clock (Date only; timers stay real) is
 * swept every 30 minutes across the day before, the job day and the day after
 * — 144 instants — for a start at 09:00 and at 23:59, rendered on a device in
 * each of four zones. Per instant it asserts ≤1 primary in the slot and that
 * every zone's primary equals the America/Chicago device's. Shown red on the
 * original: with `parseLocalDate` restored in HelperTrackerPanel, the UTC and
 * New York devices fail at the evening hours of the job day and Los Angeles at
 * the first hours after it.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null,
  PhotoProofStep: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";

const ZONES = ["America/Chicago", "UTC", "America/New_York", "America/Los_Angeles"] as const;
const STARTS = ["09:00", "23:59"] as const;
const STEP_MS = 30 * 60_000;

// A fixed job day, resolved the fixture-doctrine way (Central) from a fixed
// instant, so the sweep is the same on every runner at every hour.
const JOB_DAY = jobLocalDateISO(0, new Date("2026-09-22T17:00:00Z"));
const CENTRAL_MIDNIGHT_BEFORE = Date.parse("2026-09-21T05:00:00Z"); // 00:00 CDT, the day before
const INSTANTS = Array.from({ length: 144 }, (_, i) => CENTRAL_MIDNIGHT_BEFORE + i * STEP_MS);

const ORIGINAL_TZ = process.env.TZ;
function setZone(tz: string) {
  process.env.TZ = tz;
}

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function job(startTime: string): Job {
  return {
    id: "job-1", title: "Mow the lawn", description: "Front and back", location: "Lafayette, LA",
    customer_id: "poster-1", helper_id: "helper-1", budget: 100, category: "yard_work",
    date_needed: JOB_DAY, start_time: startTime, latitude: null, longitude: null,
    proof_before_urls: [], proof_after_urls: [],
    // Accepted days early, so only the day-of tap can complete the step.
    helper_confirmed_at: "2026-09-18T15:00:00Z", helper_dayof_confirmed_at: null,
    poster_confirmed_at: "2026-09-18T15:00:00Z", poster_confirmed_working_at: null,
    helper_on_the_way_at: null, helper_arrived_at: null,
    helper_completed_at: null, poster_completed_at: null,
    status: "accepted",
  } as unknown as Job;
}

async function primaryAt(at: number, startTime: string): Promise<string[]> {
  vi.setSystemTime(at);
  const j = job(startTime);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmedSection
          app={{ id: "app-1", job_id: j.id, helper_id: "helper-1", status: "accepted", created_at: "2026-09-18T15:00:00Z", job: j } as unknown as AppliedApp}
          job={j}
          userId="helper-1"
          initialTracking={{ id: "t-1", status: "confirmed", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-09-18T15:00:00Z" } as never}
          navigate={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  const slot = container.querySelector("[data-job-step-primary]");
  const labels = slot ? [...slot.children].map((b) => (b.textContent || "").trim()) : [];
  unmount();
  client.clear();
  return labels;
}

describe("Helpr Confirmed card — one primary at every instant, the same in every device zone", () => {
  it("the device zone really switches inside this process", () => {
    // The sweep is meaningless if assigning process.env.TZ does not move the
    // local offset (it does on Node ≥13); prove it rather than assume it.
    setZone("UTC");
    const utc = new Date(2026, 8, 22).getTimezoneOffset();
    setZone("America/Chicago");
    const central = new Date(2026, 8, 22).getTimezoneOffset();
    expect([utc, central]).toEqual([0, 300]);
  });

  for (const start of STARTS) {
    it(`start ${start}: 72h swept every 30 min in ${ZONES.join(", ")}`, async () => {
      const bad: string[] = [];
      let sawStillOn = 0;
      let sawOnMyWay = 0;
      for (const at of INSTANTS) {
        const byZone: Record<string, string[]> = {};
        for (const tz of ZONES) {
          setZone(tz);
          byZone[tz] = await primaryAt(at, start);
        }
        const central = byZone["America/Chicago"];
        if (central.includes("I'm Still On")) sawStillOn++;
        if (central.includes("I'm On My Way")) sawOnMyWay++;
        for (const tz of ZONES) {
          const got = byZone[tz];
          if (got.length > 1 || JSON.stringify(got) !== JSON.stringify(central)) {
            bad.push(`${new Date(at).toISOString()} on a ${tz} device: [${got.join(" | ")}] (Central device: [${central.join(" | ")}])`);
          }
        }
      }
      expect(bad, `instants where the card offers two primaries or a zone-dependent one:\n${bad.join("\n")}`).toEqual([]);
      // Floors, so a fixture that stops reaching either state cannot pass by
      // rendering nothing everywhere.
      expect(sawStillOn, "the sweep never reached the day-of confirmation").toBeGreaterThan(0);
      if (start === "23:59") expect(sawOnMyWay, "the sweep never reached On My Way").toBeGreaterThan(0);
    }, 120_000);
  }
});
