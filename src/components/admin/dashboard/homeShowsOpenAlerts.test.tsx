/**
 * Audit 2026-10-30 H1: a critical money alert was open for a day while the
 * admin home said "Everything looks calm on the platform." The home counts
 * open critical and error ledger rows now.
 *
 * @mutate src/components/admin/dashboard/DashboardHome.tsx | [stats.criticalAlerts, stats.errorAlerts, stats.disputedJobs, | [stats.disputedJobs,
 * @mutate src/components/admin/dashboard/useOpenAlertCounts.ts | .neq("status", "closed") | .neq("status", "nothing")
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { DashboardStats } from "./types";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DashboardHome } from "./DashboardHome";

const stats = (over: Partial<DashboardStats>): DashboardStats => ({
  totalUsers: 1, activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0, lateCancellationRevenue: 0,
  newUsersInRange: 0, newUsersPrev: 0, revenueInRange: 0, revenuePrev: 0, completedJobsInRange: 0, completedJobsPrev: 0,
  feesThisQuarter: 0, newUsersSeries: [], revenueSeries: [], completedJobsSeries: [], activeJobsSeries: [],
  openReports: 0, supportTickets: 0, disputedJobs: 0, criticalAlerts: 0, errorAlerts: 0,
  ...over,
});

function renderHome(over: Partial<DashboardStats>, onNavigate: (v: string) => void = () => {}) {
  render(
    <DashboardHome
      stats={stats(over)}
      statsLoading={false}
      onNavigate={onNavigate}
      dateRange="7d"
      setDateRange={() => {}}
      customDays={7}
      setCustomDays={() => {}}
      rangeLabel="last 7d"
      prevLabel="prior 7d"
    />,
  );
}

describe("the admin home counts open critical and error alerts", () => {
  it("says calm only with nothing open", () => {
    renderHome({});
    expect(screen.getByText("Everything looks calm on the platform.")).toBeTruthy();
    expect(screen.queryByText("Critical alerts")).toBeNull();
  });

  it("a critical alert ends the calm line and opens Health", () => {
    const go = vi.fn();
    renderHome({ criticalAlerts: 1 }, go);
    expect(screen.queryByText("Everything looks calm on the platform.")).toBeNull();
    screen.getByText("Critical alerts").click();
    expect(go).toHaveBeenCalledWith("health");
  });

  it("an open error ends the calm line too", () => {
    renderHome({ errorAlerts: 3 });
    expect(screen.queryByText("Everything looks calm on the platform.")).toBeNull();
    expect(screen.getByText("Open errors")).toBeTruthy();
  });

  it("the count reads the same open rows as Health", () => {
    const src = readFileSync("src/components/admin/dashboard/useOpenAlertCounts.ts", "utf8");
    expect(src).toContain('.neq("status", "closed")');
    expect(src).toContain('["fatal", "critical", "error"]');
  });
});
