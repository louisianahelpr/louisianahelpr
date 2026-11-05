/**
 * Q2706 Admin CLS (Builder 3 11-05). Live cwv-lab, prod, the admin persona, /admin at 375, CLS 0.2092 on all 4 runs
 * (Slow and Fast 4G; ~/.lh-shots/b3-errlogs/live-admin.json):
 *   - 0.130: the Priority Alerts card arrived after the counts and pushed the KPI grid down 148 px;
 *   - 0.073: the KPI tiles grew 114 -> 175 px when their compare line and sparkline lane arrived.
 * The Priority Alerts card is now always drawn: one alert row's box while the counts are out, "No priority alerts
 * right now" in that same box when nothing is open (lead 11-05: a card that LEFT would shift everything up). Each range
 * tile holds its compare line and sparkline lane while loading.
 *
 * @mutate src/components/admin/dashboard/DashboardHome.tsx |         {!hasAlerts ? ( |         {!hasAlerts && alertsPending ? (
 * @mutate src/components/admin/dashboard/DashboardHome.tsx |             {!alertsPending && <span className="text-ds-11 sm:text-ds-13 font-semibold text-muted-foreground leading-tight">No priority alerts right now</span>} |             {null}
 * @mutate src/components/admin/dashboard/KpiCard.tsx |       {pending && !trend && compareLabel && ( |       {false && pending && !trend && compareLabel && (
 * @mutate src/components/admin/dashboard/KpiCard.tsx |       {pending && sparkline && ( |       {false && pending && sparkline && (
 * @mutate src/pages/admin/Admin.tsx |           alertsPending={statsLoading \|\| ([openQueues.disputes, openQueues.reports, openQueues.support].includes(undefined) && !pendingCounts.isError) \|\| (seriousAlertCount === undefined && !seriousAlertsFailed)} |           alertsPending={false}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users } from "lucide-react";
import type { DashboardStats } from "./types";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DashboardHome } from "./DashboardHome";
import { KpiCard } from "./KpiCard";

const ZERO: DashboardStats = {
  totalUsers: 0, activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0, lateCancellationRevenue: 0,
  newUsersInRange: 0, newUsersPrev: 0, revenueInRange: 0, revenuePrev: 0, completedJobsInRange: 0, completedJobsPrev: 0,
  feesThisQuarter: 0, newUsersSeries: [], revenueSeries: [], completedJobsSeries: [], activeJobsSeries: [],
  openReports: 0, supportTickets: 0, disputedJobs: 0,
};

function home(p: { statsLoading: boolean; alertsPending: boolean; seriousAlerts: number | undefined; stats?: Partial<DashboardStats> }) {
  return render(
    <MemoryRouter>
      <DashboardHome
        stats={{ ...ZERO, ...p.stats }}
        statsLoading={p.statsLoading}
        onNavigate={() => {}}
        dateRange="7d"
        setDateRange={() => {}}
        customDays={7}
        setCustomDays={() => {}}
        rangeLabel="last 7d"
        prevLabel="prior 7d"
        standing="calm"
        seriousAlerts={p.seriousAlerts}
        alertsPending={p.alertsPending}
      />
    </MemoryRouter>,
  );
}

describe("the admin dashboard holds its shape while it loads (Admin CLS)", () => {
  it("holds one Priority Alerts row while the counts are out", () => {
    const { unmount } = home({ statsLoading: true, alertsPending: true, seriousAlerts: undefined });
    expect(screen.getByTestId("priority-alerts-reserved")).toBeTruthy();
    expect(screen.getByText("Priority Alerts")).toBeTruthy();
    unmount();
  });

  it("the real rows replace the held row; with nothing open the card stays and says so", () => {
    const a = home({ statsLoading: false, alertsPending: false, seriousAlerts: 20 });
    expect(screen.queryByTestId("priority-alerts-reserved")).toBeNull();
    expect(screen.getByText("Health alerts")).toBeTruthy();
    a.unmount();
    const b = home({ statsLoading: false, alertsPending: false, seriousAlerts: 0 });
    expect(screen.queryByTestId("priority-alerts-reserved")).toBeNull();
    expect(screen.getByText("Priority Alerts")).toBeTruthy();
    expect(screen.getByTestId("priority-alerts-none").textContent).toBe("No priority alerts right now");
    b.unmount();
  });

  it("a loading tile holds its compare line and sparkline lane; a loaded one draws the real ones", () => {
    const { unmount, rerender } = render(<KpiCard label="New Users" value="—" icon={Users} accent="accent" trend={null} compareLabel="vs prior 7d" sparkline={[]} pending />);
    expect(screen.getByTestId("kpi-compare-reserved")).toBeTruthy();
    expect(screen.getByTestId("kpi-spark-reserved")).toBeTruthy();
    rerender(<KpiCard label="New Users" value="17" icon={Users} accent="accent" trend={{ pct: 86, up: false }} compareLabel="vs prior 7d" sparkline={[0, 0]} />);
    expect(screen.queryByTestId("kpi-compare-reserved")).toBeNull();
    expect(screen.queryByTestId("kpi-spark-reserved")).toBeNull();
    expect(screen.getByText(/86% vs prior 7d/)).toBeTruthy();
    unmount();
  });

  it("the dashboard's four range tiles pass pending, and Admin passes alertsPending from every read the card waits on", () => {
    const dash = blankComments(readFileSync(resolve(__dirname, "DashboardHome.tsx"), "utf8"));
    expect(dash.match(/pending=\{statsLoading\}/g)?.length).toBe(4);
    const admin = blankComments(readFileSync(resolve(__dirname, "../../../pages/admin/Admin.tsx"), "utf8"));
    expect(admin).toContain("alertsPending={statsLoading || ([openQueues.disputes, openQueues.reports, openQueues.support].includes(undefined) && !pendingCounts.isError) || (seriousAlertCount === undefined && !seriousAlertsFailed)}");
  });
});
