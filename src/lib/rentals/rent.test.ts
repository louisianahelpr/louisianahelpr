/**
 * The rent tracker's words (D2/D10): money, calendar dates read as that day, the late-fee line and the
 * D10 warning (the landlord sets the fee; the app warns above 10% of the rent, never caps).
 *
 * @mutate src/lib/rentals/rent.ts |   if (amountCents <= 0 \|\| lateFeeCents <= amountCents * 0.1) return null; |   return null;
 * @mutate src/lib/rentals/rent.ts |   return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", | return new Date(isoDate).toLocaleDateString("en-US", { timeZone: "America/Chicago",
 */
import { describe, expect, it } from "vitest";
import { centralToday, dayLabel, lateFeeLine, lateFeeWarning, money } from "./rent";

describe("rent tracker words", () => {
  it("money in dollars", () => {
    expect(money(120000)).toBe("$1,200.00");
    expect(money(5)).toBe("$0.05");
  });
  it("a due date is that calendar day in every time zone (never the day before)", () => {
    expect(dayLabel("2026-11-01")).toBe("Nov 1, 2026");
  });
  it("today is Central time", () => {
    expect(centralToday(new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-01");
  });
  it("D10: warns above 10% of the rent, not at or under it", () => {
    expect(lateFeeWarning(100000, 10000)).toBeNull();
    expect(lateFeeWarning(100000, 10001)).toMatch(/more than 10% of the rent/);
  });
  it("the late-fee line", () => {
    const plan = { amount_cents: 100000, frequency: "monthly" as const, first_due_on: "2026-11-01", grace_days: 0, late_fee_cents: 0, pay_methods: [], next_due_on: null };
    expect(lateFeeLine(plan)).toBe("No late fee.");
    expect(lateFeeLine({ ...plan, late_fee_cents: 2500 })).toBe("Late fee $25.00 if rent is still open the day after it's due.");
    expect(lateFeeLine({ ...plan, late_fee_cents: 2500, grace_days: 1 })).toBe("Late fee $25.00 if rent is still open more than 1 day after the due date.");
  });
});
