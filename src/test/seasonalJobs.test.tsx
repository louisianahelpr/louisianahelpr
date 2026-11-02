/**
 * Q2016 LOUISIANA SEASONS (owner order 2026-10-17): storm prep and cleanup, crawfish boil help, Mardi Gras and
 * festival help, back-to-school moves lead "Pick a template" on Post a job while in season, marked "In season".
 *
 * PRICE-GOUGING CARE, La. R.S. 29:732(A): during a declared emergency, prices "may not exceed the prices ordinarily
 * charged for comparable goods and services in the same market area" before it. The seasonal entries carry no price
 * at all, no file the seasons live in mentions a price or a multiplier, a template still leaves the price empty, and
 * the price hint (PriceGuidance) reads no date, season or emergency.
 *
 * @mutate src/data/seasonalJobs.ts |   return seasonalJobs.filter((j) => j.seasons.some((s) => s.from <= md && md <= s.to)); |   return seasonalJobs;
 * @mutate src/data/seasonalJobs.ts |   const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", | const parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC",
 * @mutate src/pages/post-job/EntryChoice.tsx |   const allTemplates = [...inSeason, ...sampleJobs]; |   const allTemplates = [...sampleJobs, ...inSeason];
 * @mutate src/pages/post-job/EntryChoice.tsx |                   {seasonalIds.has(sample.id) && ( |                   {false && (
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { inSeasonJobs, louisianaMonthDay, seasonalJobs } from "@/data/seasonalJobs";

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));
/** Noon in Louisiana on a date (CST/CDT both fall inside 16:00-18:00Z). */
const la = (iso: string) => new Date(`${iso}T17:00:00Z`);
const ids = (d: Date) => inSeasonJobs(d).map((j) => j.id);

describe("Louisiana seasons (Q2016)", () => {
  it("covers the four seasons the owner named", () => {
    expect(seasonalJobs.length).toBeGreaterThan(3);
    expect(seasonalJobs.map((j) => j.id).sort()).toEqual(
      ["back-to-school-move", "crawfish-boil-help", "mardi-gras-festival-help", "storm-cleanup-debris", "storm-prep-yard"].sort(),
    );
  });

  it("each template shows only in its season (Louisiana date)", () => {
    expect(ids(la("2026-02-10"))).toEqual(["crawfish-boil-help", "mardi-gras-festival-help"]);
    expect(ids(la("2026-04-15"))).toEqual(["crawfish-boil-help"]);
    expect(ids(la("2026-08-10"))).toEqual(["storm-prep-yard", "storm-cleanup-debris", "back-to-school-move"]);
    expect(ids(la("2026-10-01"))).toEqual(["storm-prep-yard", "storm-cleanup-debris", "mardi-gras-festival-help"]);
    expect(ids(la("2026-12-15"))).toEqual([]);
    // Hurricane season ends Nov 30 in Louisiana, even when it is already Dec 1 in UTC (11 PM CST = 05:00Z).
    expect(louisianaMonthDay(new Date("2026-12-01T05:00:00Z"))).toBe("11-30");
    expect(ids(new Date("2026-12-01T05:00:00Z"))).toContain("storm-prep-yard");
  });

  it("no seasonal template carries a price, and the seasons file names no price (R.S. 29:732)", () => {
    for (const j of seasonalJobs) {
      expect(Object.keys(j)).not.toContain("typical_price");
      expect(`${j.title} ${j.description}`).not.toMatch(/\$|\brate\b|price|surge|premium|extra/i);
    }
    const code = read("src/data/seasonalJobs.ts");
    expect(code.length).toBeGreaterThan(500);
    expect(code).not.toMatch(/price|budget|multiplier|surge|\brate\b/i);
  });

  it("a template still leaves the price empty, and the price hint reads no date, season or emergency", () => {
    const entry = read("src/pages/post-job/useJobEntry.ts");
    const body = entry.slice(entry.indexOf("const applyTemplateFields"), entry.indexOf("const clearOffer"));
    expect(body.length).toBeGreaterThan(50);
    expect(body).toContain('setBudget("")');
    const hint = read("src/components/postjob/PriceGuidance.tsx");
    expect(hint.length).toBeGreaterThan(200);
    expect(hint).not.toMatch(/seasonalJobs|inSeason|new Date\(|getMonth|emergency|storm/i);
  });

  it("Post a job's templates put the in-season ones first, marked In season", () => {
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    expect(entry).toContain("const inSeason = inSeasonJobs();");
    expect(entry).toContain("const allTemplates = [...inSeason, ...sampleJobs];");
    expect(entry).toMatch(/seasonalIds\.has\(sample\.id\) && \(/);
    expect(entry).toContain('t("postJob.inSeason")');
  });
});
