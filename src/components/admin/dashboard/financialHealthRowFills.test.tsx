/**
 * Audit 2026-10-28 P5-12 (Admin dashboard, 1440): Financial Health is a
 * two-column grid; without the Late Cancel tile, "Completed Jobs (last 7d)"
 * was the third of three tiles and sat alone beside an empty cell. It now
 * spans the row when the tile count is odd, and keeps its one cell when Late
 * Cancel makes it even.
 *
 * @mutate src/components/admin/dashboard/DashboardHome.tsx | <div className={stats.lateCancellationRevenue > 0 ? undefined : "col-span-2"} data-testid="financial-health-completed"> | <div data-testid="financial-health-completed">
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DashboardStats } from "./types";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DashboardHome } from "./DashboardHome";

const stats = (lateCancellationRevenue: number): DashboardStats => ({
  totalUsers: 243, activeJobs: 2, completedJobs: 30, totalRevenue: 3295, totalFees: 120, lateCancellationRevenue,
  newUsersInRange: 4, newUsersPrev: 3, revenueInRange: 100, revenuePrev: 80, completedJobsInRange: 3, completedJobsPrev: 2,
  feesThisQuarter: 40, newUsersSeries: [], revenueSeries: [], completedJobsSeries: [], activeJobsSeries: [],
  openReports: 0, supportTickets: 0, disputedJobs: 0,
});

function renderHome(late: number) {
  return render(
    <MemoryRouter>
      <DashboardHome
        stats={stats(late)}
        statsLoading={false}
        onNavigate={() => {}}
        dateRange="7d"
        setDateRange={() => {}}
        customDays={7}
        setCustomDays={() => {}}
        rangeLabel="last 7d"
        prevLabel="prior 7d"
        standing="calm"
        seriousAlerts={0}
      />
    </MemoryRouter>,
  );
}

/** The Financial Health grid's cells and how many columns each spans. */
const cells = () => {
  const completed = screen.getByTestId("financial-health-completed");
  const grid = completed.parentElement as HTMLElement;
  expect(grid.className).toMatch(/\bgrid-cols-2\b/);
  return [...grid.children].map((c) => (c.className.includes("col-span-2") ? 2 : 1));
};

describe("Financial Health fills its rows (P5-12)", () => {
  it("three tiles: Completed Jobs takes the whole last row (no empty cell)", () => {
    const { unmount } = renderHome(0);
    const spans = cells();
    expect(spans).toHaveLength(3);
    expect(spans.reduce((a, b) => a + b, 0) % 2).toBe(0);
    expect(screen.getByTestId("financial-health-completed").className).toContain("col-span-2");
    unmount();
  });

  it("four tiles (Late Cancel shown): two full rows, Completed Jobs keeps one cell", () => {
    const { unmount } = renderHome(25);
    const spans = cells();
    expect(spans).toHaveLength(4);
    expect(spans.reduce((a, b) => a + b, 0) % 2).toBe(0);
    expect(screen.getByTestId("financial-health-completed").className ?? "").not.toContain("col-span-2");
    unmount();
  });
});
