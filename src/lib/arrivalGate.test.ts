import { describe, it, expect } from "vitest";
import {
  arrivalState,
  arrivalEstablished,
  arrivalGateMessage,
  arrivalRefusalFromError,
  arrivalRefusalMessage,
  formatArrivalDistance,
} from "./arrivalGate";
import * as shared from "../../supabase/functions/_shared/arrivalRule";

const T = "2026-09-14T10:00:00Z";

describe("arrivalGate — VN-33: GPS verified AND poster confirmed", () => {
  it("treats a bare helper claim as NOT established", () => {
    const job = { helper_arrived_at: T };
    expect(arrivalState(job)).toBe("claimed");
    expect(arrivalEstablished(job)).toBe(false);
  });

  // The two cases that the OLD rule (verified OR confirmed) let through. Each
  // of these returned true before VN-33 and must fail on that rule.
  it("does NOT accept a server-verified arrival until the poster confirms", () => {
    const job = { helper_arrived_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: null };
    expect(arrivalState(job)).toBe("verified");
    expect(arrivalEstablished(job)).toBe(false);
  });

  it("does NOT accept the poster's confirmation without a verified location (no fallback)", () => {
    const job = { helper_arrived_at: T, helper_arrival_verified_at: null, poster_confirmed_arrival_at: T };
    expect(arrivalState(job)).toBe("confirmed");
    expect(arrivalEstablished(job)).toBe(false);
    expect(arrivalEstablished({ poster_confirmed_arrival_at: T })).toBe(false);
  });

  it("accepts an arrival only when both stamps are on the row", () => {
    expect(
      arrivalEstablished({ helper_arrived_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: T }),
    ).toBe(true);
  });

  it("is not established when nothing has happened", () => {
    expect(arrivalEstablished({})).toBe(false);
    expect(arrivalEstablished(null)).toBe(false);
    expect(arrivalState(undefined)).toBe("none");
  });

  it("is the SAME predicate create-payment reads (one rule, not two)", () => {
    expect(arrivalEstablished).toBe(shared.arrivalEstablished);
    expect(arrivalGateMessage).toBe(shared.arrivalGateMessage);
  });

  it("says both are needed and names the missing half, never offering either one as enough", () => {
    const gpsOnly = arrivalGateMessage({ helper_arrived_at: T, helper_arrival_verified_at: T });
    expect(gpsOnly).toContain("Confirm They Arrived");
    expect(gpsOnly).toMatch(/both are needed/);

    const posterOnly = arrivalGateMessage({ helper_arrived_at: T, poster_confirmed_arrival_at: T });
    expect(posterOnly).toContain("Try My Location Again");
    expect(posterOnly).toMatch(/both are needed/);

    const claimed = arrivalGateMessage({ helper_arrived_at: T });
    expect(claimed).toContain("Try My Location Again");
    expect(claimed).toContain("Confirm They Arrived");

    const none = arrivalGateMessage({});
    expect(none).toContain("Mark yourself arrived");
    expect(none).toMatch(/both are needed/);

    for (const m of [gpsOnly, posterOnly, claimed, none]) {
      expect(m).not.toMatch(/works too|either one|that unlocks/i);
    }
  });

  it("names the door: wrap-up on Done, the next step on Working", () => {
    const job = { helper_arrived_at: T, helper_arrival_verified_at: T };
    expect(arrivalGateMessage(job, "wrap-up")).toContain("mark the job complete");
    expect(arrivalGateMessage(job, "tracker")).toContain("start working");
  });
});

describe("arrival refusals from mark_helper_arrival (20260915044137)", () => {
  it("reads the distance out of arrival_too_far", () => {
    const r = arrivalRefusalFromError({ message: "arrival_too_far", details: "distance_ft=11081180" });
    expect(r).toEqual({ kind: "too_far", distanceFt: 11081180 });
    expect(arrivalRefusalMessage(r!)).toBe("You're about 2099 mi from the job — get closer to mark arrived.");
  });

  it("reads a missing or invalid location", () => {
    expect(arrivalRefusalFromError({ message: "arrival_location_required" })).toEqual({ kind: "no_location" });
    expect(arrivalRefusalFromError({ message: "arrival_location_invalid" })).toEqual({ kind: "no_location" });
  });

  it("does not mistake any other error for a refusal", () => {
    expect(arrivalRefusalFromError({ message: "not_the_assigned_helper" })).toBeNull();
    expect(arrivalRefusalFromError({ message: "Failed to fetch" })).toBeNull();
    expect(arrivalRefusalFromError(null)).toBeNull();
  });

  it("keeps a too-far refusal readable without a distance", () => {
    const r = arrivalRefusalFromError({ message: "arrival_too_far", details: null });
    expect(r).toEqual({ kind: "too_far", distanceFt: null });
    expect(arrivalRefusalMessage(r!)).toMatch(/too far from the job/);
  });

  it("formats feet under a tenth of a mile, miles above", () => {
    expect(formatArrivalDistance(510)).toBe("510 ft");
    expect(formatArrivalDistance(640)).toBe("0.1 mi");
    expect(formatArrivalDistance(5280 * 3.24)).toBe("3.2 mi");
    expect(formatArrivalDistance(5280 * 2091.4)).toBe("2091 mi");
  });

  it("never offers the poster as a substitute for a location", () => {
    for (const kind of ["denied", "no_location"] as const) {
      expect(arrivalRefusalMessage({ kind })).not.toMatch(/poster|person who posted/i);
    }
  });
});

describe("server refusal copy (lifecycleErrors) — both halves, never either", () => {
  it("maps every arrival/completion refusal code to copy that does not offer a substitute", async () => {
    const { lifecycleErrorMessage } = await import("./lifecycleErrors");
    const codes = [
      "arrival_too_far",
      "arrival_location_required",
      "arrival_location_invalid",
      "completion_requires_confirmed_arrival",
      "tracker_requires_arrival",
    ];
    for (const code of codes) {
      const copy = lifecycleErrorMessage({ message: code });
      expect(copy, code).toBeTruthy();
      expect(copy!, code).not.toMatch(/works too|either one|or ask the poster/i);
    }
    expect(lifecycleErrorMessage({ message: "completion_requires_confirmed_arrival" })).toMatch(/Both are needed/);
  });
});

describe("VN-33(b) bad map pin: a near miss counts only beside the poster's confirmation", () => {
  const nearMiss = "2026-09-15T12:00:00Z";
  it("a within-a-mile near miss plus the poster's confirmation establishes the arrival", () => {
    expect(arrivalEstablished({ helper_arrived_at: nearMiss, helper_arrival_near_miss_at: nearMiss, poster_confirmed_arrival_at: nearMiss })).toBe(true);
  });
  it("a near miss alone unlocks nothing", () => {
    expect(arrivalEstablished({ helper_arrival_near_miss_at: nearMiss })).toBe(false);
    expect(arrivalGateMessage({ helper_arrival_near_miss_at: nearMiss })).toMatch(/poster can tap "Confirm They Arrived"/);
  });
  it("the Helpr is told the poster can confirm, not just that they are too far", () => {
    expect(arrivalRefusalMessage({ kind: "too_far", distanceFt: 1490, posterCanConfirm: true })).toMatch(/map pin[\s\S]*Confirm They Arrived/);
    expect(arrivalRefusalMessage({ kind: "too_far", distanceFt: 11_081_180 })).toMatch(/get closer/);
  });
});
