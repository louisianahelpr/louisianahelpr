/**
 * THE ARRIVAL REVERSAL, HELPR SIDE — the WIRING, not the rule.
 *
 * OWNER, 2026-09-19 (verbatim): "they can not start working until the poster
 * confirms they are there. they shoud be aware of this so they dont try to
 * cheat the system. if gps is not on, they can mark themselves as arrived but
 * can not move on until the poster marks them arrived. so encourgage to turn
 * on gps. but even if gps does confirm they are there the poster still needs ro
 * cfnrm wither way"
 *
 * The RULE lives in `supabase/functions/_shared/arrivalRule.ts` and is pinned
 * by `src/lib/arrivalGate.test.ts`; the rail's arithmetic is pinned by
 * `JobTracking.test.tsx`. Neither of those can fail if this component simply
 * never calls the RPC — which is EXACTLY the defect the reversal undid:
 * `updateStatus("arrived")` used to `return` on a failed location fix, so a
 * Helpr with Location off produced no `helper_arrived_at`, the poster's
 * "Confirm They Arrived" control (gated on that column) never rendered, and
 * the Helpr's blocked CTA told them to go ask for a tap nobody was offered.
 *
 * So this file drives the real component: it taps the real button, watches the
 * real `supabase.rpc` call, and reads the copy off the rendered DOM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { JobTracking } from "./JobTracking";
import { supabase } from "@/integrations/supabase/client";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/TrackingMap", () => ({ TrackingMap: () => <div data-testid="tracking-map" /> }));
// The pre-prompt is a UX wrapper around the OS call; here it just runs it.
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({
    request: async (_kind: string, run: () => Promise<void> | void) => {
      await run();
      return true;
    },
  }),
}));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ]) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  // A `.select("id")` write must come back with a ROW: the tracking write runs
  // through `unwrapMutation`, which (correctly) treats zero rows as a rejected
  // write. A `data: null` stub would make every transition in this file fail
  // for a reason that has nothing to do with the arrival rule.
  const written = { data: [{ id: "t-1" }], error: null };
  chain.then = (res: (v: typeof written) => unknown) => Promise.resolve(written).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

const AT = "2026-09-19T15:00:00.000Z";
const rpc = () => supabase.rpc as unknown as ReturnType<typeof vi.fn>;

/** Location is off / denied — the state the owner's rule is written for. */
function locationDenied() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }),
      watchPosition: () => 1,
      clearWatch: () => {},
    },
  });
}

/** The verdict `mark_helper_arrival` returns for a fix-less check-in. */
const NO_LOCATION_VERDICT = {
  arrival_recorded: true,
  arrived_at: AT,
  verified: false,
  basis: "no_location",
  distance_ft: null,
  poster_confirmed: false,
  poster_confirmation_required: true,
  arrival_established: false,
};

function renderHelperTracker(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobTracking
          jobId="job-1"
          helperId="helper-1"
          isHelper
          isOwner={false}
          jobDateNeeded="2026-09-19"
          jobStartTime="09:00:00"
          jobStatus="in_progress"
          helperConfirmedAt={AT}
          helperDayofConfirmedAt={AT}
          posterConfirmedAt={AT}
          helperOnTheWayAt={AT}
          initialTracking={{
            id: "t-1", status: "on_the_way", latitude: null, longitude: null,
            eta_minutes: null, updated_at: AT,
          }}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tapArrived = async () => {
  const btn = screen.getByRole("button", { name: /I've Arrived/i });
  await act(async () => { btn.click(); });
};

beforeEach(() => {
  vi.clearAllMocks();
  locationDenied();
});

describe("Mark Arrived always records the check-in", () => {
  it("calls mark_helper_arrival even with NO location fix — the deadlock is gone", async () => {
    rpc().mockResolvedValue({ data: NO_LOCATION_VERDICT, error: null });
    renderHelperTracker();
    await tapArrived();

    // THE ASSERTION THE OLD CODE FAILED. It returned on the failed fix, so the
    // RPC was never reached and `helper_arrived_at` was never written.
    await waitFor(() => {
      expect(rpc().mock.calls.some(([fn]) => fn === "mark_helper_arrival")).toBe(true);
    });
    const call = rpc().mock.calls.find(([fn]) => fn === "mark_helper_arrival")!;
    expect(call[1], "the job is always named").toMatchObject({ p_job_id: "job-1" });
    expect(call[1].p_lat, "no fix: no coordinates, and that is fine").toBeUndefined();
  });

  it("tells them they ARE checked in, and names the poster's tap as what's next", async () => {
    rpc().mockResolvedValue({ data: NO_LOCATION_VERDICT, error: null });
    renderHelperTracker();
    await tapArrived();

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    const said = (toast.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(said, "a successful check-in").toMatch(/checked in/i);
    expect(said, "the one gate, named").toMatch(/Confirm They Arrived/);
    // NOT an error and NOT a warning: an unverified location is an ordinary
    // outcome, not a fault of the Helpr's.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a null verdict body is NOT a success — a null `error` is not a write", async () => {
    rpc().mockResolvedValue({ data: null, error: null });
    renderHelperTracker();
    await tapArrived();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The rail did not move: the same button is still offered.
    expect(screen.getByRole("button", { name: /I've Arrived/i })).toBeTruthy();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("the blocked Start Working CTA is the Helpr's anti-cheat notice", () => {
  it("is disabled on a GPS-VERIFIED arrival the poster has not confirmed", () => {
    // The half of the reversal that did NOT flip: GPS alone unlocks nothing.
    renderHelperTracker({
      helperArrivedAt: AT,
      helperArrivalVerifiedAt: AT,
      initialTracking: {
        id: "t-1", status: "arrived", latitude: null, longitude: null,
        eta_minutes: null, updated_at: AT,
      },
    });
    const cta = screen.getByRole("button", { name: /Start Working/i }) as HTMLButtonElement;
    expect(cta.disabled, "a verified arrival is not a way past the poster").toBe(true);
    expect(document.body.textContent).toMatch(/Confirm They Arrived/);
  });

  it("is ENABLED on the poster's tap alone — no GPS anywhere on the row", () => {
    renderHelperTracker({
      helperArrivedAt: AT,
      posterConfirmedArrivalAt: AT,
      initialTracking: {
        id: "t-1", status: "arrived", latitude: null, longitude: null,
        eta_minutes: null, updated_at: AT,
      },
    });
    const cta = screen.getByRole("button", { name: /Start Working/i }) as HTMLButtonElement;
    expect(cta.disabled, "the poster's tap is the whole gate").toBe(false);
  });
});

describe("the GPS nudge — encouragement, never an accusation", () => {
  const CHECKED_IN_NO_GPS = {
    helperArrivedAt: AT,
    initialTracking: {
      id: "t-1", status: "arrived", latitude: null, longitude: null,
      eta_minutes: null, updated_at: AT,
    },
  };

  it("states the BENEFIT and offers the one tap, on a check-in with no GPS", () => {
    renderHelperTracker(CHECKED_IN_NO_GPS);
    const text = document.body.textContent ?? "";
    // "proof on your side" was the pre-2026-09-19-gate wording of the same
    // benefit; the sentence was cut to one line and the phrasing with it.
    expect(text, "what Location buys them").toMatch(/GPS proof you were here/i);
    expect(text).toMatch(/disputed/i);
    // The one tap, and it is on screen beside the line that names the benefit.
    expect(screen.getByRole("button", { name: /Try My Location Again/i })).toBeTruthy();
  });

  /**
   * THE SEPARATION, ASSERTED ON THE RENDERED CARD (owner, 2026-09-19, final
   * browser gate): "amber says what is BLOCKING; muted says why GPS helps.
   * Nothing else."
   *
   * `arrivalGate.test.ts` pins the amber sentence as a string. It cannot see
   * the OVERLAP, which is a property of the two blocks TOGETHER on one card —
   * and the overlap is what the owner measured: ten lines between the photo box
   * and the buttons, "turn Location on" in both, "Try My Location Again" in
   * both. So this reads the two rendered paragraphs off the real component and
   * asserts neither says the other's job.
   */
  it("does not say the same thing twice: the blocker is amber-only, the GPS ask muted-only", () => {
    renderHelperTracker(CHECKED_IN_NO_GPS);
    const paras = [...document.querySelectorAll("p")].map((p) => p.textContent ?? "");
    const amber = paras.find((t) => t.includes("Confirm They Arrived"));
    const muted = paras.find((t) => /Location on/i.test(t));
    expect(amber, "the blocked CTA's amber reason is not on the card").toBeTruthy();
    expect(muted, "the muted GPS benefit line is not on the card").toBeTruthy();
    expect(amber).not.toBe(muted);

    // Amber: the blocker, and nothing about Location.
    expect(amber!, `amber carries the GPS ask: ${amber}`).not.toMatch(/Location on|Try My Location Again/i);
    // Muted: the benefit, and nothing about the poster's tap.
    expect(muted!, `muted carries the blocker: ${muted}`).not.toMatch(/Confirm They Arrived|person who posted/i);

    // "Try My Location Again" appears exactly ONCE on the card — on the button.
    const hits = (document.body.textContent ?? "").match(/Try My Location Again/g) ?? [];
    expect(hits, `"Try My Location Again" is printed ${hits.length}× on one card`).toHaveLength(1);

    // And the whole block is materially shorter than the ten lines measured.
    const total = amber!.length + muted!.length;
    expect(total, `the arrival prose block is back to ${total} chars`).toBeLessThan(220);
  });

  it("never threatens — the framings the owner rejected stay rejected", () => {
    renderHelperTracker(CHECKED_IN_NO_GPS);
    const text = document.body.textContent ?? "";
    // "unverified arrivals count against you" reads as an accusation to someone
    // with genuinely bad signal. Owner, 2026-09-19: explain the benefit, don't
    // block or nag.
    expect(text).not.toMatch(/count against|held against|penalt|suspicious|we can'?t trust/i);
    // And it never offers Location as a way round the poster, because it isn't.
    expect(text).not.toMatch(/instead of|without waiting|skip (the )?confirm/i);
  });

  it("goes quiet once the poster has confirmed — encouragement, not nagging", () => {
    renderHelperTracker({ ...CHECKED_IN_NO_GPS, posterConfirmedArrivalAt: AT });
    const text = document.body.textContent ?? "";
    expect(text, "nothing left to encourage: they are unblocked").not.toMatch(/proof on your side/i);
    expect(screen.queryByRole("button", { name: /Try My Location Again/i })).toBeNull();
  });

  it("goes quiet once the location IS confirmed", () => {
    renderHelperTracker({ ...CHECKED_IN_NO_GPS, helperArrivalVerifiedAt: AT });
    expect(document.body.textContent ?? "").not.toMatch(/proof on your side/i);
    expect(screen.queryByRole("button", { name: /Try My Location Again/i })).toBeNull();
  });
});
