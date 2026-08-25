import { existsSync, readFileSync, readdirSync } from "node:fs";
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

  it("keeps the old unfunded spawn cron gone", () => {
    // charge-recurring-visits supersedes it. The function was removed outright
    // in f29ebfbe0; if a file ever reappears at this path, both crons would
    // post visits for the same series and only one of them pays — so its
    // absence is the guarantee this test pins.
    expect(
      existsSync(resolve(__dirname, "../../../supabase/functions/spawn-recurring-jobs")),
    ).toBe(false);
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

  it("writes the fee columns the way create-payment does", () => {
    // These two are easy to transpose and the transposition is silent: the
    // helper is still paid correctly (release-payout overwrites
    // platform_fee_amount), but the admin gross rollups read
    // `budget + customer_fee_amount + sales_tax_amount` and the cancellation
    // refund reads `customer_fee_amount ?? 0` — so a swap under-reports revenue
    // on every visit AND refunds a service fee that was actually collected.
    const src = read("../../../supabase/functions/charge-recurring-visits/index.ts");
    // platform_fee_amount is the HELPER's commission, not the poster's fee.
    expect(src).toMatch(/platform_fee_amount: helperFeeAmount/);
    // customer_fee_amount is the poster's service fee, and must be written —
    // the column defaults to 0, so omitting it is silently wrong, not absent.
    expect(src).toMatch(/customer_fee_amount: feeCents \/ 100/);
    expect(src).toMatch(/helper_fee_percent: helperFeePercent/);
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

  it("only opens Repeats while the charge cron is scheduled", () => {
    // The gate was never about whether the picker worked — it was about whether
    // anything BILLS the saved card for visit 2. Shipping the picker without
    // the cron would let a poster book twelve visits and receive one, the exact
    // failure the rebuild removed.
    //
    // So the assertion is a LINK, not a constant: if the flag is on, a
    // migration that schedules charge-recurring-visits must exist. Flipping the
    // flag back on in a future branch without the schedule fails here.
    const src = read("../../components/postjob/LogisticsSection.tsx");
    const enabled = /const RECURRING_ENABLED = true/.test(src);
    if (!enabled) {
      expect(src).toMatch(/const RECURRING_ENABLED = false/);
      return;
    }
    const migrations = readdirSync(
      resolve(__dirname, "../../../supabase/migrations"),
    ).filter((f) => f.endsWith(".sql"));
    const schedules = migrations.filter((f) =>
      /cron\.schedule/.test(
        readFileSync(
          resolve(__dirname, "../../../supabase/migrations", f),
          "utf8",
        ),
      ) &&
      readFileSync(
        resolve(__dirname, "../../../supabase/migrations", f),
        "utf8",
      ).includes("charge-recurring-visits"),
    );
    expect(
      schedules.length,
      "RECURRING_ENABLED is true but no migration schedules charge-recurring-visits",
    ).toBeGreaterThan(0);
  });
});
