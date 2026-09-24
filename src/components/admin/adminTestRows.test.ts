/**
 * Q368 (owner, 2026-09-24; AM-012): admin home counts exclude seed rows and
 * show them beside the count as "0 (+N test)"; the Disputes, Users and Reports
 * queues keep listing them, each marked with a "Test" tag. Before this the
 * home tile read 0 disputes while the queue beside it listed 2 seed disputes
 * wired to money buttons, with nothing saying why the numbers differed.
 */
// @mutate src/components/admin/dashboard/types.ts | test > 0 ? | test < 0 ?
// @mutate src/pages/Admin.tsx | .eq("status", "disputed").eq("is_seed", true), | .eq("status", "disputed").eq("is_seed", false),
// @mutate src/components/admin/dashboard/DashboardHome.tsx | value={v(withTestCount(stats.disputedJobs, stats.testDisputedJobs))} | value={v(stats.disputedJobs)}
// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | {job.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/adminusers/AdminUserRow.tsx | {p.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminReports.tsx | {report.is_test && <> <TestTag /></>} | {null}
// @mutate src/components/admin/AdminReports.tsx | if (j.is_seed) seedIds.add(j.id); | void j;
// @mutate src/components/admin/AdminDisputes.tsx | customer_fee_amount, sales_tax_amount, is_seed",\n | customer_fee_amount, sales_tax_amount",\n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTestCount } from "./dashboard/types";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");

describe("admin keeps test rows visible and says so", () => {
  it("a home count names its test rows beside it", () => {
    expect(withTestCount(0, 2)).toBe("0 (+2 test)");
    expect(withTestCount(3, 0)).toBe("3");
    expect(withTestCount(1200, 5)).toBe("1,200 (+5 test)");
  });

  it("home reads the seed side of the disputes, active-jobs and subscriptions counts", () => {
    const admin = read("src/pages/Admin.tsx");
    expect(admin).toContain('.eq("status", "disputed").eq("is_seed", true),');
    expect(admin).toContain('.in("status", ["open", "accepted", "in_progress"]).eq("is_seed", true),');
    expect(admin).toContain('.not("subscription_tier", "is", null).eq("is_seed", true),');
    const home = read("src/components/admin/dashboard/DashboardHome.tsx");
    for (const k of ["activeJobs, stats.testActiveJobs", "disputedJobs, stats.testDisputedJobs", "activeSubscriptions, stats.testActiveSubscriptions"]) {
      expect(home).toContain(`value={v(withTestCount(stats.${k}))}`);
    }
  });

  it("each queue fetches is_seed and tags the row", () => {
    const disputes = read("src/components/admin/AdminDisputes.tsx");
    const selects = disputes.match(/sales_tax_amount[^"]*"/g) ?? [];
    expect(selects.length).toBe(3);
    for (const s of selects) expect(s).toContain("is_seed");
    expect(read("src/components/admin/adminDisputes/DisputeCard.tsx")).toContain("{job.is_seed && <TestTag />}");
    expect(read("src/components/admin/adminusers/AdminUserRow.tsx")).toContain("{p.is_seed && <TestTag />}");
    const reports = read("src/components/admin/AdminReports.tsx");
    expect(reports).toContain('.select("id, title, is_seed")');
    expect(reports).toContain('.select("user_id, full_name, is_seed")');
    expect(reports).toContain("if (j.is_seed) seedIds.add(j.id);");
    expect(reports).toContain("if (p.is_seed) seedIds.add(p.user_id);");
    expect(reports).toContain("{report.is_test && <> <TestTag /></>}");
  });

  it("no queue filters seed rows out", () => {
    for (const f of ["src/components/admin/AdminDisputes.tsx", "src/components/admin/AdminUsers.tsx", "src/components/admin/AdminReports.tsx"]) {
      expect(read(f), f).not.toMatch(/\.eq\("is_seed", false\)/);
    }
  });
});
