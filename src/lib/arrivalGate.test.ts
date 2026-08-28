import { describe, it, expect } from "vitest";
import { arrivalState, arrivalEstablished, arrivalGateMessage } from "./arrivalGate";

describe("arrivalGate", () => {
  it("treats a bare helper claim as NOT established", () => {
    const job = { helper_arrived_at: "2026-08-27T10:00:00Z" };
    expect(arrivalState(job)).toBe("claimed");
    expect(arrivalEstablished(job)).toBe(false);
  });

  it("accepts a server-verified arrival", () => {
    const job = {
      helper_arrived_at: "2026-08-27T10:00:00Z",
      helper_arrival_verified_at: "2026-08-27T10:00:00Z",
    };
    expect(arrivalState(job)).toBe("verified");
    expect(arrivalEstablished(job)).toBe(true);
  });

  // THE RECOURSE PATH. A helper whose GPS never got a fix is not stranded:
  // the poster standing in front of them can vouch, and that vouch alone
  // satisfies the gate. Without this, "location required" would be a hard
  // block on anyone inside a metal building.
  it("accepts the poster's vouch even with no verified GPS at all", () => {
    const job = {
      helper_arrived_at: null,
      helper_arrival_verified_at: null,
      poster_confirmed_arrival_at: "2026-08-27T10:05:00Z",
    };
    expect(arrivalState(job)).toBe("confirmed");
    expect(arrivalEstablished(job)).toBe(true);
  });

  it("is not established when nothing has happened", () => {
    expect(arrivalEstablished({})).toBe(false);
    expect(arrivalEstablished(null)).toBe(false);
    expect(arrivalState(undefined)).toBe("none");
  });

  it("never leaves the helper without a next step in the blocked copy", () => {
    expect(arrivalGateMessage({ helper_arrived_at: "x" })).toContain("Confirm They Arrived");
    expect(arrivalGateMessage({})).toContain("Mark yourself arrived");
    expect(arrivalGateMessage({})).toContain("poster");
  });
});
