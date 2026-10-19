/**
 * The Homes lease template (owner D4: our Louisiana template only; docs/specs/lease-template-draft.md
 * APPROVED AS WRITTEN). A shipped version's words never change: a signed lease is re-rendered from its
 * version for its PDF forever, and both signatures cover the sha256 of those words. So a fixed fill of
 * each version is pinned here by hash; changing the wording means adding a new version.
 *
 * Also: every numbered section and addendum of the approved spec is in the lease; a complete fill leaves
 * no blank; the text is plain ASCII (the PDF's built-in fonts are Latin-1); a hidden blank never reaches
 * the stored lease.
 *
 * @mutate src/lib/rentals/leaseTemplate.ts | Consent once is not consent again. | Consent once is consent again.
 * @mutate src/lib/rentals/leaseTemplate.ts |   add("26. Attorney's fees", |   add("26. Attorneys fees",
 * @mutate src/lib/rentals/leaseTemplate.ts | if (!isFieldShown(field, f) \|\| v === undefined) continue; | if (v === undefined) continue;
 * @mutate src/lib/rentals/leaseTemplate.ts |     .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'") |     .replace(/[\u2018]/g, "'")
 * @mutate src/lib/rentals/leaseTemplate.ts |     out[field.key] = typeof v === "string" ? normalizeLeaseText(v).trim() : v; |     out[field.key] = typeof v === "string" ? v.trim() : v;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEASE_FIELDS,
  LEASE_TEMPLATES,
  LEASE_TEMPLATE_VERSION,
  cleanLeaseFields,
  initialLeaseFields,
  leaseSha256,
  leaseText,
  missingLeaseFields,
  normalizeLeaseText,
  normalizeSignature,
  renderLease,
  type LeaseFields,
} from "@/lib/rentals/leaseTemplate";

const FULL: LeaseFields = {
  ...initialLeaseFields(),
  lease_date: "2026-10-20", landlord_name: "Dana Landlord LLC", tenant_names: "Terry Tenant", home_address: "123 Oak St, Lafayette, LA 70501",
  home_type: "house", bedrooms: "3", bathrooms: "2", home_includes: "yard and driveway", term_kind: "fixed", start_date: "2026-11-01",
  end_date: "2027-10-31", rent_amount: "1200", pay_methods: "Zelle", payee: "Dana Landlord LLC", first_rent_amount: "1,200.00",
  late_fee: "50", late_fee_cap: "$100", deposit_amount: "1200", tenant_utilities: "electric, water, internet", occupants: "none",
  guest_days_six_months: "30", emergency_contact: "Pat Tenant, 337-555-0100", appliances: "refrigerator, stove", pest_control: "Landlord",
  detector_locations: "hallway, each bedroom", key_count: "2", key_cost: "25", landlord_contact: "dana@example.com",
  tenant_contact: "337-555-0101", landlord_address: "PO Box 1, Lafayette LA 70502", insurance: "recommended", holdover_amount: "$40 per day",
  foreclosure: "none", flood_zone: "No", flooded_before: "No", mold: "No",
};

// The sha256 of the pinned fill of each shipped version. NEVER edit a line here; add a version instead.
const PINNED: Record<string, string> = {
  "la-2026-10-14": "ceeaac6e9a0bb4893f7950bfd9f152049ad151d02150dca60c433d7ae0d97fc7",
};

describe("Homes lease template", () => {
  it("a complete fill leaves no blank and renders no [not filled]", () => {
    expect(missingLeaseFields(FULL).map((f) => f.key)).toEqual([]);
    expect(leaseText(renderLease(FULL))).not.toContain("[not filled]");
    expect(LEASE_FIELDS.length).toBeGreaterThan(80);
  });

  it("an empty fill lists what is missing and the send stays off", () => {
    const missing = missingLeaseFields({}).map((f) => f.key);
    expect(missing).toContain("landlord_name");
    expect(missing).toContain("rent_amount");
    expect(missing).not.toContain("end_date"); // only asked for a fixed term
    expect(missingLeaseFields({ ...FULL, rent_amount: "twelve hundred" }).map((f) => f.key)).toEqual(["rent_amount"]);
  });

  it("every numbered section and addendum of the approved spec is in the lease", () => {
    const spec = readFileSync(join(process.cwd(), "docs/specs/lease-template-draft.md"), "utf8");
    const specHeads = [...spec.matchAll(/^### (\d+\. .+)$/gm)].map((m) => m[1].trim());
    expect(specHeads.length).toBe(28);
    const rendered = renderLease({ ...FULL, built_before_1978: true, lead_known: "none", lead_records: "none", flood_disclosure: true });
    const heads = rendered.map((s) => s.heading);
    for (const h of specHeads) expect(heads).toContain(h);
    for (const a of ["ADDENDUM 1", "ADDENDUM 2", "ADDENDUM 3", "ADDENDUM 4"]) expect(heads.some((h) => h.startsWith(a))).toBe(true);
    expect(heads).toContain("Payment schedule");
  });

  it("the optional clauses appear only when chosen", () => {
    const off = leaseText(renderLease(FULL));
    expect(off).not.toContain("Waiver of notice to vacate");
    expect(off).not.toContain("ADDENDUM 1");
    expect(off).toContain("No pets.");
    const on = leaseText(renderLease({ ...FULL, notice_waiver: true, pets_allowed: true, pet_list: "Cat, tabby, Milo, 10 lbs", pet_max: "1",
      pet_fee: "150", early_exit: true, early_exit_fee: "600", term_kind: "fixed" }));
    expect(on).toContain("Waiver of notice to vacate (INITIALED by both parties)");
    expect(on).toContain("Pets allowed per the Pet & Assistance-Animal Addendum");
    expect(on).toContain("Pet fee: $150.00, due at signing.");
    expect(on).toContain("Total due before move-in: $2,550.00.");
    expect(on).toContain("early-termination fee of $600.00");
  });

  it("is plain ASCII (the PDF's built-in fonts are Latin-1)", () => {
    const t = leaseText(renderLease({ ...FULL, built_before_1978: true, lead_known: "known", lead_details: "Porch rails", lead_records: "none" }));
    expect([...t].filter((c) => c.charCodeAt(0) > 126)).toEqual([]);
  });

  it("a hidden blank never reaches the stored lease; text blanks are trimmed", () => {
    const c = cleanLeaseFields({ ...FULL, term_kind: "monthly", end_date: "2027-10-31", landlord_name: "  Dana  " });
    expect("end_date" in c).toBe(false);
    expect(c.landlord_name).toBe("Dana");
  });

  it("lead review #4: typed text becomes plain ASCII the same way for the hash, the screen and the PDF", () => {
    expect(normalizeLeaseText("O\u2019Brien \u201Cthe\u201D Jos\u00e9 \u2013 Ren\u00e9e\u2026")).toBe("O'Brien \"the\" Jose - Renee...");
    expect(normalizeLeaseText("line one\r\nline\ttwo \u2603")).toBe("line one\nline two ?");
    expect(normalizeSignature("  Jos\u00e9   O\u2019Neil ")).toBe("Jose O'Neil");
    const c = cleanLeaseFields({ ...FULL, landlord_name: "Dana \u201CDee\u201D L\u00f3pez" });
    expect(c.landlord_name).toBe('Dana "Dee" Lopez');
    const t = leaseText(renderLease({ ...FULL, landlord_name: "Dana \u201CDee\u201D L\u00f3pez", extra_rules: "No \u2018grills\u2019" }));
    expect([...t].filter((ch) => ch.charCodeAt(0) > 126)).toEqual([]);
    expect(t).toContain('Dana "Dee" Lopez');
  });

  it("a shipped version's words never change (pinned hash of a fixed fill)", async () => {
    expect(Object.keys(LEASE_TEMPLATES)).toEqual(Object.keys(PINNED));
    expect(LEASE_TEMPLATE_VERSION in PINNED).toBe(true);
    for (const [version, render] of Object.entries(LEASE_TEMPLATES)) {
      expect(await leaseSha256(leaseText(render(FULL)))).toBe(PINNED[version]);
    }
  });
});
