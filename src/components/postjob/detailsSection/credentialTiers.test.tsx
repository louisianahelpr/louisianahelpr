/**
 * T2 (owner 2026-10-14): trades join "Who can apply?" with the "Licensed" tier.
 * Owner 2026-10-21: every "Heads up: … license/permit … choose 'Licensed'
 * below" notice on Post a job is REMOVED (moving permit, arborist and the
 * rest); the "Licensed" option itself stays.
 */
// @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts |   "plumbing",\n  "hvac", |   "hvac",
// @mutate src/components/postjob/DetailsSection.tsx |           <CredentialTierSelector |           <div
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as constants from "./detailsSectionConstants";
import { CREDENTIAL_TIER_CATEGORIES, CREDENTIAL_TIERS } from "./detailsSectionConstants";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";

const LICENSED_TRADES = ["electrical", "plumbing", "hvac", "roofing", "carpentry", "flooring", "concrete_masonry", "fencing", "appliance_repair"];
const UNLICENSED_TRADES = ["welding", "auto_repair", "pressure_washing"];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("Who can apply? and no licensing heads-up", () => {
  it("the Licensed option stays", () => {
    expect(CREDENTIAL_TIERS.some((t) => t.label === "Licensed")).toBe(true);
  });

  it("licensed trades offer the tier; unlicensed trades do not", () => {
    for (const t of LICENSED_TRADES) expect(CREDENTIAL_TIER_CATEGORIES.has(t), t).toBe(true);
    for (const t of UNLICENSED_TRADES) expect(CREDENTIAL_TIER_CATEGORIES.has(t), t).toBe(false);
  });

  it("every tier category is a real job_category", () => {
    const real = new Set<string>(JOB_CATEGORY_VALUES);
    for (const c of CREDENTIAL_TIER_CATEGORIES) expect(real.has(c), c).toBe(true);
  });

  it("owner 2026-10-21: no licensing heads-up exists anywhere on Post a job", () => {
    expect("LICENSE_WARNINGS" in constants).toBe(false);
    const files = [...walk(join(process.cwd(), "src/components/postjob")), ...walk(join(process.cwd(), "src/pages/post-job"))];
    expect(files.length).toBeGreaterThan(20);
    const hits = files.filter((f) => /Heads up:[^"]*(licen[cs]|permit|certif)/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    const details = readFileSync(join(process.cwd(), "src/components/postjob/DetailsSection.tsx"), "utf8");
    expect(details).not.toMatch(/LicenseWarning/);
    expect(details).toContain("<CredentialTierSelector");
  });
});
