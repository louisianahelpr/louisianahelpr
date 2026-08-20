import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "./jobSubmitHelpers";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const base: BuildJobInsertPayloadInput = {
  userId: "u1", businessId: null, title: "Mow the lawn", description: "Front and back",
  category: "yard_work", streetAddress: "1 Main", city: "Houma", addrState: "LA",
  zipCode: "70360", parish: "Terrebonne",
  // 2026-09-07 is a Monday.
  dateNeeded: "2026-09-07", startTime: "09:00", isFlexibleSchedule: false,
  estimatedHours: "2", budget: "50", specialRequirements: "",
  isRecurring: false, recurrenceInterval: "weekly", recurrenceEndDate: "",
  isGroupJob: false, helpersNeeded: "2", isUrgent: false, urgentFee: "5",
  platformFee: 15, salesTaxRate: 0, offerToHelperId: null,
};

describe("buildJobInsertPayload — recurring series", () => {
  it("writes the day set and week count", () => {
    const p = buildJobInsertPayload({
      ...base, isRecurring: true, recurrenceDays: [1, 3, 5], recurrenceWeeks: 3,
    }) as Record<string, unknown>;
    expect(p.is_recurring).toBe(true);
    expect(p.recurrence_days).toEqual([1, 3, 5]);
    expect(p.recurrence_weeks).toBe(3);
  });

  it("DERIVES the end date from the schedule rather than trusting the typed one", () => {
    // The poster picks weekdays and a number of weeks; a separately-typed end
    // date could only ever disagree with the days they chose. Mon/Wed/Fri for
    // 3 weeks from Mon 7 Sep ends on Fri 25 Sep — not the stale value below.
    const p = buildJobInsertPayload({
      ...base, isRecurring: true, recurrenceDays: [1, 3, 5], recurrenceWeeks: 3,
      recurrenceEndDate: "2029-01-01",
    }) as Record<string, unknown>;
    expect(p.recurrence_end_date).toBe("2026-09-25");
  });

  it("writes nothing recurring for a one-time job", () => {
    const p = buildJobInsertPayload({
      ...base, recurrenceDays: [1, 3], recurrenceWeeks: 4,
    }) as Record<string, unknown>;
    expect(p.is_recurring).toBe(false);
    expect(p.recurrence_end_date).toBeNull();
    // Omitted entirely, not written as null — the INSERT must still succeed
    // against a database that predates the columns.
    expect("recurrence_days" in p).toBe(false);
    expect("recurrence_weeks" in p).toBe(false);
  });

  it("omits the columns when the day set is empty, rather than writing a broken series", () => {
    const p = buildJobInsertPayload({
      ...base, isRecurring: true, recurrenceDays: [], recurrenceWeeks: 4,
    }) as Record<string, unknown>;
    expect("recurrence_days" in p).toBe(false);
  });
});

describe("recurring series wiring", () => {
  it("forces the card to be saved for a series", () => {
    // Every later visit is charged off-session. With no saved card the cron can
    // only decline, so a poster would book twelve visits and get one.
    const src = read("./useJobSubmit.ts");
    expect(src).toMatch(/saveCardForFuture: saveCardForFuture \|\| isRecurring/);
  });

  it("refuses to post a series with no days", () => {
    const src = read("./useJobSubmit.ts");
    expect(src).toMatch(/isRecurring && recurrenceDays\.length === 0/);
  });

  it("keeps the old unfunded spawn cron disabled", () => {
    // charge-recurring-visits supersedes it. If this ever flips back on, both
    // would post visits for the same series and only one of them pays.
    const src = read("../../../supabase/functions/spawn-recurring-jobs/index.ts");
    expect(src).toMatch(/const SPAWNING_ENABLED = false/);
  });

  it("creates the visit only AFTER the charge succeeds", () => {
    const src = read("../../../supabase/functions/charge-recurring-visits/index.ts");
    const chargeAt = src.indexOf("stripe.paymentIntents.create");
    const insertAt = src.indexOf('.from("jobs")\n          .insert(');
    expect(chargeAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    // The whole design in one assertion: no unfunded visit can exist, because
    // the row is written after the money is in.
    expect(insertAt).toBeGreaterThan(chargeAt);
  });

  it("refunds if the charge lands but the visit row does not", () => {
    const src = read("../../../supabase/functions/charge-recurring-visits/index.ts");
    expect(src).toMatch(/stripe\.refunds\.create/);
  });

  it("offers all seven days, Sunday first", () => {
    const src = read("../../components/postjob/RecurringSchedulePicker.tsx");
    expect(src).toMatch(/WEEKDAY_LABELS\.map/);
    expect(src).toContain("grid-cols-7");
  });
});
