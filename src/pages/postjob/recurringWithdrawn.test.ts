import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "./jobSubmitHelpers";

/**
 * Recurring is withdrawn until each visit charges the poster.
 *
 * The reason it has to be enforced in more than one place: the poster funds
 * escrow ONCE at checkout (`action: "escrow"` is invoked from exactly one
 * place, useJobSubmit), so every later visit `spawn-recurring-jobs` posted went
 * in with no money behind it — publicly appliable, with nothing to release to
 * the helper who did the work.
 *
 * These are cheap guards against re-opening the door by accident: the form
 * control, the client state, and the spawn cron each have to stay shut.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("recurring jobs stay withdrawn", () => {
  it("the post form offers no Recurring job type", () => {
    const src = read("../../components/postjob/LogisticsSection.tsx");
    expect(src).not.toMatch(/key:\s*"recurring"/);
    // Two options, not three — a stale grid-cols-3 would leave a dead cell.
    expect(src).toContain("grid grid-cols-2 gap-1 p-1 rounded-2xl");
  });

  it("the form's isRecurring setter cannot be turned on", () => {
    const src = read("./usePostJobForm.ts");
    // A restored draft and a rebook both replay a saved `is_recurring: true`
    // through this setter, so pinning it off is what actually holds.
    expect(src).toMatch(/const setIsRecurring = \(_v: boolean\) => setIsRecurringRaw\(false\)/);
  });

  it("the spawn cron is disabled", () => {
    const src = read("../../../supabase/functions/spawn-recurring-jobs/index.ts");
    expect(src).toMatch(/const SPAWNING_ENABLED = false/);
    expect(src).toMatch(/if \(!SPAWNING_ENABLED\)/);
  });

  it("still writes is_recurring: false through the INSERT payload", () => {
    const base = {
      userId: "u1", businessId: null, title: "T", description: "D",
      category: "cleaning", streetAddress: "1 Main", city: "Houma",
      addrState: "LA", zipCode: "70360", parish: "Terrebonne",
      dateNeeded: "2026-09-01", startTime: "09:00", isFlexibleSchedule: false,
      estimatedHours: "2", budget: "50", specialRequirements: "",
      isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "",
      isGroupJob: false, helpersNeeded: "2", isUrgent: false, urgentFee: "5",
      platformFee: 15, salesTaxRate: 0, offerToHelperId: null,
    } satisfies BuildJobInsertPayloadInput;
    const p = buildJobInsertPayload(base) as Record<string, unknown>;
    expect(p.is_recurring).toBe(false);
    expect(p.recurrence_interval).toBeNull();
    expect(p.recurrence_end_date).toBeNull();
  });
});
