/**
 * T2 (owner 2026-10-14): trades join "Who can apply?", and posters on jobs
 * where Louisiana or federal law requires a license or certificate at ANY price
 * see a plain-words heads-up (a warning, never a block).
 *
 *  1. Every warned category offers the "Licensed" tier, because the copy tells
 *     the poster to choose it ("Choose \"Licensed\" below").
 *  2. The licensed trades are in CREDENTIAL_TIER_CATEGORIES; the trades with no
 *     Louisiana license are not (a gate there filters on nothing).
 *  3. The warning renders for plumbing and not for cleaning; DetailsSection
 *     renders it inside the tier block, above the selector.
 *  4. Every key is a real job_category.
 */
// @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts |   "plumbing",\n  "hvac", |   "hvac",
// @mutate src/components/postjob/DetailsSection.tsx |           <LicenseWarning category={category} />\n | \n
// @mutate src/components/postjob/detailsSection/LicenseWarning.tsx |   if (!text) return null; |   if (text) return null;
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { LicenseWarning } from "./LicenseWarning";
import { CREDENTIAL_TIER_CATEGORIES, CREDENTIAL_TIERS, LICENSE_WARNINGS } from "./detailsSectionConstants";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(cleanup);

const LICENSED_TRADES = ["electrical", "plumbing", "hvac", "roofing", "carpentry", "flooring", "concrete_masonry", "fencing", "appliance_repair"];
const UNLICENSED_TRADES = ["welding", "auto_repair", "pressure_washing"];

describe("T2: licensed trades and the poster warning", () => {
  it("has warnings to check (inventory floor)", () => {
    expect(Object.keys(LICENSE_WARNINGS).length).toBeGreaterThan(3);
  });

  it("every warned category offers the Licensed tier the copy points at", () => {
    expect(CREDENTIAL_TIERS.some((t) => t.label === "Licensed")).toBe(true);
    for (const [cat, text] of Object.entries(LICENSE_WARNINGS)) {
      expect(CREDENTIAL_TIER_CATEGORIES.has(cat), `${cat} warns but hides "Who can apply?"`).toBe(true);
      expect(text).toMatch(/"Licensed"/);
    }
  });

  it("licensed trades offer the tier; unlicensed trades do not", () => {
    for (const t of LICENSED_TRADES) expect(CREDENTIAL_TIER_CATEGORIES.has(t), t).toBe(true);
    for (const t of UNLICENSED_TRADES) expect(CREDENTIAL_TIER_CATEGORIES.has(t), t).toBe(false);
  });

  it("every tier category and warning key is a real job_category", () => {
    const real = new Set<string>(JOB_CATEGORY_VALUES);
    for (const c of CREDENTIAL_TIER_CATEGORIES) expect(real.has(c), c).toBe(true);
    for (const c of Object.keys(LICENSE_WARNINGS)) expect(real.has(c), c).toBe(true);
  });

  it("renders the heads-up for plumbing and nothing for cleaning", () => {
    const { rerender } = render(<LicenseWarning category="plumbing" />);
    expect(screen.getByRole("note").textContent).toMatch(/licensed plumber/);
    rerender(<LicenseWarning category="cleaning" />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("DetailsSection renders the warning inside the tier block, before the selector", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/postjob/DetailsSection.tsx"), "utf8"));
    const block = src.slice(src.indexOf("CREDENTIAL_TIER_CATEGORIES.has(category) && ("));
    const w = block.indexOf("<LicenseWarning");
    const s = block.indexOf("<CredentialTierSelector");
    expect(w).toBeGreaterThan(-1);
    expect(s).toBeGreaterThan(w);
  });
});
