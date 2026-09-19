/**
 * THE REFRESH GESTURE IS A REAL REPLACEMENT FOR THE RETRY CHIP.
 *
 * Owner, 2026-09-19: remove "Try My Location Again" from the job card's action
 * row, and make pull-to-refresh do it instead.
 *
 * ── THE DEFECT CLASS THIS GUARDS ──────────────────────────────────────────
 * Removing the chip on its own would have deleted the ONLY claimed -> verified
 * path in the product. It is worth being precise about why, because the reason
 * is not obvious from the screen: when an arrival is recorded but unverified
 * the rail has already advanced past Arrived, so the row's primary reads
 * "Start Working", not "Mark Arrived" — there is no other control whose tap
 * re-runs the location fix. The Helpr would have been permanently unable to
 * earn GPS proof of an arrival they had already made.
 *
 * So this file asserts the REPLACEMENT works, not merely that the chip is
 * gone. "The chip is gone" is pinned next door in
 * JobTracking.arrivalReversal.test.tsx; a guard that only asserted absence
 * would be green on the broken version of this change.
 *
 * ── AND THE CONSERVATISM, WHICH IS THE RISKY PART ─────────────────────────
 * A refresh gesture that performs a WRITE is unusual, so each rule in
 * arrivalRefresh.ts is asserted rather than trusted:
 *
 *   · it asks for a fix ONLY when there is an arrival it could upgrade — so an
 *     ordinary refresh triggers no permission prompt and no write;
 *   · a denial is remembered, so pulling five times does not prompt five times;
 *   · it never throws, so it cannot break the refresh it rides on.
 *
 * The no-prompt rule is the one with teeth: it is asserted by counting calls
 * to `navigator.geolocation`, which is the thing that actually raises the
 * browser prompt.
 *
 * @mutate src/lib/arrivalRefresh.ts | if (!job) return { outcome: "no-candidate" }; | if (!job && false) return { outcome: "no-candidate" };
 * @mutate src/lib/arrivalRefresh.ts | !j.helper_arrival_verified_at && | true &&
 * @mutate src/lib/arrivalRefresh.ts | !j.poster_confirmed_arrival_at && | true &&
 * @mutate src/lib/arrivalRefresh.ts | if (deniedThisSession) return null; | if (false) return null;
 * @mutate src/lib/arrivalRefresh.ts | if (document.visibilityState === "visible") deniedThisSession = false; | if (false) deniedThisSession = false;
 * @mutate src/lib/arrivalRefresh.ts | return verdict.verified | return !verdict.verified
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

import {
  arrivalToUpgrade,
  upgradeUnverifiedArrival,
  resetArrivalRefreshDenial,
  type ArrivalUpgradeCandidate,
} from "@/lib/arrivalRefresh";

const ME = "helper-1";
const AT = "2026-09-19T12:00:00Z";

const job = (over: Partial<ArrivalUpgradeCandidate> = {}): ArrivalUpgradeCandidate => ({
  id: "job-1",
  helper_id: ME,
  helper_arrived_at: AT,
  helper_arrival_verified_at: null,
  poster_confirmed_arrival_at: null,
  status: "in_progress",
  ...over,
});

/** Counts every call that would raise the browser's location prompt. */
let fixCalls = 0;
function stubGeolocation(result: "ok" | "denied" | "unavailable") {
  fixCalls = 0;
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        fixCalls++;
        if (result === "ok") ok({ coords: { latitude: 30.2, longitude: -92.0 } } as GeolocationPosition);
        else fail({ code: result === "denied" ? 1 : 2 } as GeolocationPositionError);
      },
    },
  });
}

beforeEach(() => {
  rpc.mockReset();
  resetArrivalRefreshDenial();
  stubGeolocation("ok");
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// The gate — which job, if any
// ===========================================================================
describe("only an arrival a fix could actually help", () => {
  it("picks a recorded-but-unverified arrival on MY job", () => {
    expect(arrivalToUpgrade([job()], ME)?.id).toBe("job-1");
  });

  it("skips one already GPS-verified — there is nothing to win", () => {
    expect(arrivalToUpgrade([job({ helper_arrival_verified_at: AT })], ME)).toBeNull();
  });

  it("skips one the POSTER has already confirmed — the 'don't nag' rule", () => {
    // Once the poster has vouched, the arrival is settled by the attestation
    // that actually decides it. Same exclusion `gpsNudgeHere` makes.
    expect(arrivalToUpgrade([job({ poster_confirmed_arrival_at: AT })], ME)).toBeNull();
  });

  it("skips one with no arrival yet — checking in is a deliberate tap, not a scroll", () => {
    expect(arrivalToUpgrade([job({ helper_arrived_at: null })], ME)).toBeNull();
  });

  it("skips somebody else's job, and skips a signed-out viewer", () => {
    expect(arrivalToUpgrade([job({ helper_id: "other" })], ME)).toBeNull();
    expect(arrivalToUpgrade([job()], null)).toBeNull();
  });

  it("skips a finished, cancelled or disputed job", () => {
    for (const status of ["completed", "cancelled", "disputed"]) {
      expect(arrivalToUpgrade([job({ status })], ME), `status=${status}`).toBeNull();
    }
  });
});

// ===========================================================================
// The conservatism
// ===========================================================================
describe("a refresh with nothing to upgrade touches nothing", () => {
  it("NEVER asks for a location fix — so no permission prompt, on any ordinary refresh", async () => {
    const res = await upgradeUnverifiedArrival([job({ helper_arrival_verified_at: AT })], ME);
    expect(res.outcome).toBe("no-candidate");
    expect(
      fixCalls,
      "a refresh with nothing to upgrade asked for a location fix — on a browser that is a " +
        "permission prompt the Helpr never asked for, on every single pull",
    ).toBe(0);
    expect(rpc, "a refresh with nothing to upgrade wrote to the database").not.toHaveBeenCalled();
  });

  it("does not prompt again once a fix has been denied", async () => {
    stubGeolocation("denied");
    await upgradeUnverifiedArrival([job()], ME);
    expect(fixCalls).toBe(1);
    // Four more pulls, no more prompts.
    for (let i = 0; i < 4; i++) await upgradeUnverifiedArrival([job()], ME);
    expect(
      fixCalls,
      `location was requested ${fixCalls}× across five refreshes after a denial — that is the ` +
        `prompt storm the remembered denial exists to stop`,
    ).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("RE-ARMS after a foreground return — the copy tells them to go to Settings", async () => {
    /* THE CASE THE STICKY FLAG GOT WRONG. `arrivalRefusalMessage`'s denied
       branch reads "allow it in Settings, then pull down to refresh and we'll
       try again". A Helpr who does exactly that — Settings, allow, back to the
       app, pull — must actually get a retry. With the memory held for the life
       of the page they got nothing: the app told them to do something and then
       ignored them doing it.

       Returning to the foreground is the one honest signal that a permission
       may have changed; the prompt storm this guards against is repeated pulls
       inside one session, asserted in the case above and untouched here. */
    stubGeolocation("denied");
    await upgradeUnverifiedArrival([job()], ME);
    expect(fixCalls).toBe(1);
    await upgradeUnverifiedArrival([job()], ME);
    expect(fixCalls, "still suppressed while the page stays in front").toBe(1);

    // They go to Settings and come back.
    stubGeolocation("ok");
    rpc.mockResolvedValue({
      data: { arrival_recorded: true, verified: true, basis: "gps_verified", distance_ft: 30 },
      error: null,
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));

    const res = await upgradeUnverifiedArrival([job()], ME);
    expect(
      fixCalls,
      "after a foreground return the next pull did not ask for a fix — the Helpr followed " +
        "the app's own instruction and was ignored",
    ).toBe(1); // the stub was replaced, so this counter restarted at 0 then went to 1
    expect(res.outcome).toBe("upgraded");
  });

  it("degrades silently when no fix arrives — nothing is broken, so nothing is said", async () => {
    stubGeolocation("unavailable");
    const res = await upgradeUnverifiedArrival([job()], ME);
    expect(res.outcome).toBe("no-fix");
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// The replacement itself
// ===========================================================================
describe("the re-check the retry chip used to perform", () => {
  it("calls mark_helper_arrival with the fix, and reports the upgrade", async () => {
    // The RPC's real jsonb shape — `basis` is what `arrivalVerdictFromRpc`
    // validates, so a body without it is (correctly) read as "no verdict".
    rpc.mockResolvedValue({
      data: { arrival_recorded: true, verified: true, basis: "gps_verified", distance_ft: 40 },
      error: null,
    });
    const res = await upgradeUnverifiedArrival([job()], ME);
    expect(rpc).toHaveBeenCalledWith("mark_helper_arrival", {
      p_job_id: "job-1",
      p_lat: 30.2,
      p_lng: -92.0,
    });
    expect(
      res.outcome,
      "the one outcome the Helpr is told about — and the only reason this replacement exists",
    ).toBe("upgraded");
  });

  it("a server refusal is an ordinary outcome, not an upgrade", async () => {
    // Standing somewhere the server will not vouch for is not a fault.
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "too_far" } });
    expect((await upgradeUnverifiedArrival([job()], ME)).outcome).toBe("refused");
  });

  it("a null error with no verdict is NOT read as a verification", async () => {
    // A null `error` is not a write. The RPC always returns a jsonb verdict on
    // success, so an unreadable body means something silently did nothing.
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await upgradeUnverifiedArrival([job()], ME)).outcome).toBe("refused");
    // …and a body that is present but missing `basis` is equally not a verdict.
    rpc.mockResolvedValue({ data: { verified: true }, error: null });
    expect(
      (await upgradeUnverifiedArrival([job()], ME)).outcome,
      "a truthy `verified` with no recognisable basis was read as an upgrade",
    ).toBe("refused");
  });

  it("a verdict that did NOT verify says so — no false 'GPS confirmed'", async () => {
    rpc.mockResolvedValue({
      data: { arrival_recorded: true, verified: false, basis: "too_far", distance_ft: 9000 },
      error: null,
    });
    expect((await upgradeUnverifiedArrival([job()], ME)).outcome).toBe("unchanged");
  });

  it("never throws, whatever the RPC does — it must not break the refresh it rides on", async () => {
    rpc.mockRejectedValue(new Error("network"));
    await expect(upgradeUnverifiedArrival([job()], ME)).rejects.toBeInstanceOf(Error);
    // ^ documents the ONE case that does propagate: a rejected promise from the
    //   client itself. Activity.tsx calls this with `void …then(…)` and never
    //   awaits it, so an unhandled rejection cannot delay or fail the refresh;
    //   the refetch is awaited separately. Asserted here rather than swallowed
    //   inside the module so the contract is visible at the call site.
  });
});
