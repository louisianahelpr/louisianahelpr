/**
 * Rentals S1 (Q39, Q41): an approved maintenance request pre-fills a normal
 * job; the landlord checks the price and pays. Pure builder only.
 *
 * @mutate src/pages/post-job/maintenancePrefill.ts |     notApproved: row.status !== "approved", |     notApproved: false,
 * @mutate src/pages/post-job/maintenancePrefill.ts |   if (MONEY_BACK.has(pay)) return false; |   if (pay === "refunded") return false;
 * @mutate src/pages/post-job/maintenancePrefill.ts | (!j.stripe_session_id \|\| pay === "abandoned")) return false; | true) return false;
 * @mutate src/pages/post-job/maintenancePrefill.ts |   if (j.status === "cancelled" && NEVER_FUNDED.has(pay) | if (NEVER_FUNDED.has(pay)
 * @mutate src/pages/post-job/maintenancePrefill.ts |   ].filter(Boolean); |   ].filter(() => false);
 * @mutate src/pages/post-job/maintenancePrefill.ts |   const lines = [row.description, "", "Rental repair.", | const lines = [row.description, "", `Rental repair at ${where}. ${row.access_windows}`,
 * @mutate src/lib/rentals/copy.ts |   { value: "pests", label: "Pests", jobCategory: "other" }, |   { value: "pests", label: "Pests", jobCategory: "errands" },
 * @mutate src/lib/rentals/copy.ts | label: "Heating or air conditioning", jobCategory: "hvac" | label: "Heating or air conditioning", jobCategory: "handyman"
 * @mutate src/lib/rentals/copy.ts | label: "Appliances", jobCategory: "handyman" | label: "Appliances", jobCategory: "appliance_repair"
 */
import { describe, expect, it } from "vitest";
import { buildMaintenancePrefill } from "./maintenancePrefill";
import { MAINTENANCE_CATEGORIES } from "@/lib/rentals/copy";
import { defaultRequirePhotoProof } from "@/lib/photoProofDefaults";
import { CREDENTIAL_TIER_CATEGORIES, LICENSE_WARNINGS } from "@/components/postjob/detailsSection/detailsSectionConstants";

const base = {
  id: "r1",
  status: "approved",
  category: "plumbing",
  description: "Kitchen sink drips all night.",
  urgency: "soon",
  access_windows: "Weekdays after 5pm",
  pets_on_site: true,
  ok_to_enter_alone: false,
  access_notes: "Gate code 4471",
  property_address: "123 Oak St, Lafayette, LA 70501",
  property_label: "Oak Street duplex",
  unit_label: "Unit A",
  approved_budget_cents: null as number | null,
  job_id: null as string | null,
  jobs: null as { status: string; payment_status: string | null } | null,
};

describe("buildMaintenancePrefill", () => {
  it("drafts a job the landlord can post: category, title, details, address, private access notes", () => {
    const p = buildMaintenancePrefill(base);
    expect(p.category).toBe("plumbing");
    expect(p.title).toBe("Plumbing repair");
    expect(p.description).toContain("Kitchen sink drips all night.");
    expect(p.description).toContain("Pets are on site.");
    // Private: entry times, home-or-not, the unit and the gate code go ONLY to the booked Helpr.
    for (const secret of ["Weekdays after 5pm", "wants to be home", "4471", "Unit A"]) {
      expect(p.description).not.toContain(secret);
      expect(p.accessNotes).toContain(secret);
    }
    expect(p.location).toBe("123 Oak St, Lafayette, LA 70501");
    expect(p.budget).toBe("");
    expect(p.autoApproveLimit).toBeNull();
    expect(p.notApproved).toBe(false);
    expect(p.alreadyPosted).toBe(false);
  });
  it("never pre-fills the price from the auto-approve limit (a hint only)", () => {
    const p = buildMaintenancePrefill({ ...base, approved_budget_cents: 15000 });
    expect(p.budget).toBe("");
    expect(p.autoApproveLimit).toBe("150");
  });
  it("offers nothing for an undecided or declined request, or one already funded", () => {
    expect(buildMaintenancePrefill({ ...base, status: "submitted" }).notApproved).toBe(true);
    expect(buildMaintenancePrefill({ ...base, status: "declined" }).notApproved).toBe(true);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "escrow" } }).alreadyPosted).toBe(true);
    // Slice 3 (one live job per request, 20261017220911): posted but not paid yet is live too.
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: null } }).alreadyPosted).toBe(true);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "unpaid" } }).alreadyPosted).toBe(true);
    // An open 'abandoned' job can be re-minted by create-payment: still live (re-review of bb5b8bc6e #2).
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "abandoned", stripe_session_id: "cs_1" } }).alreadyPosted).toBe(true);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "chargeback" } }).alreadyPosted).toBe(true);
    // Settled: cancelled and never funded with no live checkout, or money back.
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "cancelled", payment_status: "unpaid" } }).alreadyPosted).toBe(false);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "cancelled", payment_status: "failed" } }).alreadyPosted).toBe(false);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "cancelled", payment_status: "abandoned", stripe_session_id: "cs_1" } }).alreadyPosted).toBe(false);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "completed", payment_status: "refunded" } }).alreadyPosted).toBe(false);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "completed", payment_status: "cancelled" } }).alreadyPosted).toBe(false);
    // A cancelled job whose checkout may still complete is not settled.
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "cancelled", payment_status: "unpaid", stripe_session_id: "cs_1" } }).alreadyPosted).toBe(true);
    // A checkout in flight counts as posted (the link RPC's own rule): no second payment.
    const paying = buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "unpaid", stripe_session_id: "cs_1" } });
    expect(paying.alreadyPosted).toBe(true);
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "cancelling", stripe_session_id: "cs_1" } }).alreadyPosted).toBe(true);
    expect(paying.linkedJobId).toBe("j");
    expect(buildMaintenancePrefill({ ...base, job_id: "j", jobs: { status: "open", payment_status: "failed", stripe_session_id: "cs_1" } }).alreadyPosted).toBe(true);
  });
  it("keeps the job title within the 32-character CHECK", () => {
    expect(Array.from(buildMaintenancePrefill({ ...base, category: "electrical" }).title).length).toBeLessThanOrEqual(32);
  });

  it("Q42: every maintenance category drafts a job whose before/after photo proof starts ON", () => {
    expect(MAINTENANCE_CATEGORIES.length).toBeGreaterThan(5);
    expect(MAINTENANCE_CATEGORIES.filter((c) => !defaultRequirePhotoProof(c.jobCategory)).map((c) => c.value)).toEqual([]);
  });

  it("Q43: plumbing, electrical and HVAC requests draft into their trade category, which carries the licence heads-up and the Licensed tier", () => {
    const trades = MAINTENANCE_CATEGORIES.filter((c) => ["plumbing", "electrical", "hvac"].includes(c.value));
    expect(trades.length).toBe(3);
    for (const c of trades) {
      expect(c.jobCategory, c.value).toBe(c.value);
      expect(LICENSE_WARNINGS[c.jobCategory], c.value).toBeTruthy();
      expect(CREDENTIAL_TIER_CATEGORIES.has(c.jobCategory), c.value).toBe(true);
    }
  });

  it("Q43 / Q1831: roof-or-ceiling and appliance requests stay Handyman until the owner rules on trade sales tax", () => {
    const held = Object.fromEntries(MAINTENANCE_CATEGORIES.filter((c) => c.value === "roof" || c.value === "appliance").map((c) => [c.value, c.jobCategory]));
    expect(held).toEqual({ roof: "handyman", appliance: "handyman" });
  });
});
