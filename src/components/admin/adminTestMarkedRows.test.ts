/**
 * Design audit area 10 #5 (11-18; owner rule: test data never shows to the owner). Rows no seed ACCOUNT gives away
 * but whose text is a test run's ("SEED audit fixture.", "E2E ban journey lg0izi", "E2E-0905 automated test report",
 * all measured on prod 11-18) are hidden from the Audit log and Reports unless "Show test rows" is on, and never
 * counted on a Reports pill or the rail badge.
 *
 * @mutate src/components/admin/seedRows.ts | const TEST_TEXT_MARKER = /\bSEED audit fixture\b\|\bE2E[-\s]/; | const TEST_TEXT_MARKER = /\bSEED audit fixture\b/;
 * @mutate src/components/admin/AdminAuditLog.tsx |   const entries = showTest ? allEntries : allEntries.filter((e) => !e.test_marked); |   const entries = allEntries;
 * @mutate src/components/admin/AdminReports.tsx |   const reports = showTest ? allReports : countedReports(allReports); |   const reports = allReports;
 * @mutate src/components/admin/adminRailBadges.ts | reports.data.filter((r) => !r.test_marked).length | reports.data.length
 * @mutate src/components/admin/adminReports/fetchReports.ts | test_marked: mentionsTestMarker(r.reason, r.description) | test_marked: false
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mentionsTestMarker } from "./seedRows";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("test-marked admin rows (design audit area 10 #5)", () => {
  it("matches the measured prod markers, and not ordinary words", () => {
    const test = [
      "SEED audit fixture.",
      "SEED audit fixture report.",
      { op: "DELETE", old: { reason: "Terms of Service violation — E2E ban journey lg0izi" } },
      "E2E-0905 automated test report — please ignore",
    ];
    for (const t of test) expect(mentionsTestMarker(t), JSON.stringify(t)).toBe(true);
    const real = ["He kept asking to pay outside the app", "seed money for the garden", "Spam listing", null, { reason: "harassment" }];
    for (const t of real) expect(mentionsTestMarker(t), JSON.stringify(t)).toBe(false);
    expect(test.length + real.length).toBeGreaterThan(5);
  });

  it("the Audit log and Reports hide them behind \"Show test rows\", and counts skip them", () => {
    const audit = read("src/components/admin/AdminAuditLog.tsx");
    expect(audit).toMatch(/test_marked: mentionsTestMarker\(e\.details\)/);
    expect(audit).toMatch(/const entries = showTest \? allEntries : allEntries\.filter\(\(e\) => !e\.test_marked\);/);
    expect(audit).toMatch(/Show test rows/);
    const reports = read("src/components/admin/AdminReports.tsx");
    expect(reports).toMatch(/const reports = showTest \? allReports : countedReports\(allReports\);/);
    expect(reports).toMatch(/\(rows\) => countedReports\(rows\)\.length/);
    expect(reports).toMatch(/Show test rows/);
    expect(read("src/components/admin/adminReports/fetchReports.ts")).toMatch(/test_marked: mentionsTestMarker\(r\.reason, r\.description\)/);
    expect(read("src/components/admin/adminRailBadges.ts")).toMatch(/reports\.data\.filter\(\(r\) => !r\.test_marked\)\.length/);
  });
});
