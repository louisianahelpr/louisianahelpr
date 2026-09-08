import { describe, it, expect } from "vitest";
import { isLockedOut } from "./banStatus";

// DH-017: ProtectedRoute tested ban_status membership alone, so a 7-day
// suspension that had ALREADY ended kept the user at /account-banned until a
// scheduled server sweep flipped the row back to `active`. The three states
// that matter are pinned here.

const NOW = new Date("2026-09-07T12:00:00Z");
const PAST = "2026-09-07T11:00:00Z";
const FUTURE = "2026-09-08T12:00:00Z";

describe("isLockedOut", () => {
  it("locks out an ACTIVE temp suspension", () => {
    expect(isLockedOut("temp_banned", FUTURE, NOW)).toBe(true);
  });

  it("releases a LAPSED temp suspension the server has not swept yet", () => {
    expect(isLockedOut("temp_banned", PAST, NOW)).toBe(false);
  });

  it("still locks out a temp ban carrying no expiry at all", () => {
    expect(isLockedOut("temp_banned", null, NOW)).toBe(true);
    expect(isLockedOut("temp_banned", "not-a-date", NOW)).toBe(true);
  });

  it("never releases the untimed bans, whatever the timestamp says", () => {
    for (const status of ["banned", "permanently_banned"]) {
      expect(isLockedOut(status, PAST, NOW)).toBe(true);
      expect(isLockedOut(status, null, NOW)).toBe(true);
    }
  });

  it("does not lock out an account in any non-ban state", () => {
    for (const status of [null, undefined, "active", "final_warning"]) {
      expect(isLockedOut(status, null, NOW)).toBe(false);
    }
  });
});
