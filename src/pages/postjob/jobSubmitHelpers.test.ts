import { describe, it, expect } from "vitest";

import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "./jobSubmitHelpers";

/**
 * These lock the sales-tax columns written at INSERT time.
 *
 * The bug they exist to prevent: `salesTaxRate` was hardcoded to 10 in
 * usePostJobForm and multiplied by the whole budget here, so EVERY job — in
 * every category — persisted ~10% of its budget as sales tax the poster was
 * never charged. Stripe applies LA sales tax only to the assembly labor line
 * (see lib/salesTax.ts), and the admin revenue rollups sum this column, so the
 * fabricated value over-reported platform revenue on essentially every job.
 */
const base: BuildJobInsertPayloadInput = {
  userId: "u1",
  businessId: null,
  title: "Mow the lawn",
  description: "Front and back",
  category: "yard_work",
  streetAddress: "123 Main St",
  city: "Baton Rouge",
  addrState: "LA",
  zipCode: "70801",
  parish: "East Baton Rouge",
  dateNeeded: "2026-09-01",
  startTime: "09:00",
  isFlexibleSchedule: false,
  estimatedHours: "2",
  budget: "100",
  specialRequirements: "",
  isRecurring: false,
  recurrenceInterval: "",
  recurrenceEndDate: "",
  isGroupJob: false,
  helpersNeeded: "2",
  isUrgent: false,
  urgentFee: "5",
  platformFee: 15,
  salesTaxRate: 10.45,
  offerToHelperId: null,
};

describe("buildJobInsertPayload — sales tax", () => {
  it("writes ZERO tax for an exempt category even when the parish has a rate", () => {
    const p = buildJobInsertPayload(base) as Record<string, unknown>;
    expect(p.sales_tax_amount).toBe(0);
    // The EFFECTIVE rate, so rate x budget always reconciles with the amount.
    expect(p.sales_tax_rate).toBe(0);
  });

  it("writes the parish rate on the labor line for a taxable category", () => {
    const p = buildJobInsertPayload({ ...base, category: "assembly" }) as Record<string, unknown>;
    expect(p.sales_tax_rate).toBe(10.45);
    expect(p.sales_tax_amount).toBeCloseTo(10.45, 2);
  });

  it("writes zero when the parish rate is unknown (0), not a guess", () => {
    const p = buildJobInsertPayload({ ...base, category: "assembly", salesTaxRate: 0 }) as Record<string, unknown>;
    expect(p.sales_tax_rate).toBe(0);
    expect(p.sales_tax_amount).toBe(0);
  });

  it("still locks the platform fee against the full budget", () => {
    const p = buildJobInsertPayload(base) as Record<string, unknown>;
    expect(p.platform_fee_percent).toBe(15);
    expect(p.platform_fee_amount).toBeCloseTo(15, 2);
  });
});
