/**
 * Owner 2026-10-25 and 2026-10-27 ("i should never see test stuff in my admin
 * panel"): admin screens never show a test (is_seed) row, never count one, and
 * never label one "Test". This replaces Q368 (2026-09-24), where the queues
 * kept seed rows with a "Test" tag and the home tiles read "0 (+N test)".
 * Per-view coverage is adminSeedEveryView.test.ts; this file pins the shared
 * helper, the home tiles and the three queues Q368 named.
 */
// @mutate src/components/admin/seedRows.ts |   return rows.filter((r) => !r.is_seed); |   return rows;
// @mutate src/components/admin/AdminDisputes.tsx |     setDisputes(sorted.filter((j) => !j.is_seed)); |     setDisputes(sorted);
// @mutate src/components/admin/AdminReports.tsx |         })).filter(r => !r.is_test); |         }));
// @mutate src/components/admin/AutoRestrictedRail.tsx |       .eq("is_seed", false)\n      .not("auto_suspended_until", "is", null) |       .not("auto_suspended_until", "is", null)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withoutTestRows } from "./seedRows";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");

describe("admin never shows test rows", () => {
  it("the shared helper drops seed rows and keeps everything else", () => {
    const rows = [
      { id: "real", is_seed: false },
      { id: "seed", is_seed: true },
      { id: "unknown", is_seed: null },
      { id: "untagged" },
    ];
    expect(withoutTestRows(rows).map((r) => r.id)).toEqual(["real", "unknown", "untagged"]);
  });

  it("home tiles show the real count alone, with no test side read", () => {
    const home = read("src/components/admin/dashboard/DashboardHome.tsx");
    expect(home).not.toMatch(/\(\+.*test\)|withTestCount|stats\.test/);
    for (const k of ["activeJobs", "disputedJobs"]) {
      expect(home).toContain(`stats.${k}.toLocaleString()`);
    }
    expect(read("src/pages/admin/Admin.tsx")).not.toMatch(/\.eq\("is_seed", true\)/);
  });

  it("Disputes, Reports, Users and the restricted rail drop test rows", () => {
    const disputes = read("src/components/admin/AdminDisputes.tsx");
    const jobSelects = disputes.match(/sales_tax_amount[^"]*"/g) ?? [];
    // Floor (vacuity, nightly-red #2894): 3 job selects measured 2026-10-29; none found would pass vacuously.
    expect(jobSelects.length).toBeGreaterThan(2);
    for (const s of jobSelects) expect(s).toContain("is_seed");
    expect(disputes).toContain("setDisputes(sorted.filter((j) => !j.is_seed));");
    expect(disputes).toContain("!unsettledJobIds.has(j.id) && !j.is_seed");
    expect(read("src/components/admin/AdminReports.tsx")).toContain("})).filter(r => !r.is_test);");
    const users = read("src/components/admin/AdminUsers.tsx");
    expect(users).toContain("const showTest = false;");
    expect(users).not.toMatch(/Show test accounts/);
    expect(read("src/components/admin/AutoRestrictedRail.tsx")).toMatch(/\.eq\("ban_status", "temp_banned"\)\s*\/\/[^\n]*\n\s*\.eq\("is_seed", false\)/);
  });
});
