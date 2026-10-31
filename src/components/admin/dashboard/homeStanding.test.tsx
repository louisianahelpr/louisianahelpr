/**
 * The admin home says "calm" only when every number behind it was read and is zero.
 *
 * THE BUG (Admin H1, measured 2026-10-30): "Everything looks calm on the platform."
 * while 4 critical and 84 error ledger items were open on 2026-10-30, because the line asked
 * three of the nine queues and never the ledger, and read a query still loading
 * as a zero.
 *
 * @mutate src/components/admin/dashboard/homeStanding.ts | const counts = [...ADMIN_QUEUE_IDS.map((id) => input.queues[id]), input.seriousAlerts]; | const counts = [input.queues.disputes, input.queues.reports, input.queues.support];
 * @mutate src/components/admin/dashboard/homeStanding.ts | if (input.dataError \|\| counts.some((n) => n === undefined)) return "unknown"; |
 * @mutate src/components/admin/dashboard/DashboardHome.tsx | {HOME_STANDING_LINE[standing]} | {hasAlerts ? HOME_STANDING_LINE.attention : HOME_STANDING_LINE.calm}
 * @mutate src/components/admin/dashboard/DashboardHome.tsx | {healthAlerts > 0 && ( | {false && (
 * @mutate src/pages/admin/Admin.tsx | seriousAlerts: seriousAlertCount,\n            dataError: | seriousAlerts: 0,\n            dataError:
 * @mutate src/components/admin/adminHealth/useOpenAlerts.ts | .in("severity", ["fatal", "critical", "error"]) | .in("severity", ["fatal"])
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DashboardStats } from "./types";
import { ADMIN_QUEUE_IDS, type PendingCounts } from "@/components/admin/adminRailBadges";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DashboardHome } from "./DashboardHome";
import { HOME_STANDING_LINE, homeStanding, type HomeStanding } from "./homeStanding";

const allRead = (): PendingCounts => Object.fromEntries(ADMIN_QUEUE_IDS.map((id) => [id, 0])) as PendingCounts;

describe("homeStanding", () => {
  it("knows every queue (floor: the nine on the rail)", () => {
    expect(ADMIN_QUEUE_IDS.length).toBeGreaterThan(8);
  });

  it("calm: every queue and the ledger read, all zero, no failed read", () => {
    expect(homeStanding({ queues: allRead(), seriousAlerts: 0, dataError: false })).toBe("calm");
  });

  it("the original bug: open serious ledger items are not calm", () => {
    expect(homeStanding({ queues: allRead(), seriousAlerts: 88, dataError: false })).toBe("attention");
  });

  it.each(ADMIN_QUEUE_IDS)("something waiting in %s is not calm", (id) => {
    expect(homeStanding({ queues: { ...allRead(), [id]: 1 }, seriousAlerts: 0, dataError: false })).toBe("attention");
  });

  it.each(ADMIN_QUEUE_IDS)("%s not loaded yet is unknown, not calm", (id) => {
    expect(homeStanding({ queues: { ...allRead(), [id]: undefined }, seriousAlerts: 0, dataError: false })).toBe("unknown");
  });

  it("the ledger not loaded yet is unknown, not calm", () => {
    expect(homeStanding({ queues: allRead(), seriousAlerts: undefined, dataError: false })).toBe("unknown");
  });

  it("a failed read elsewhere is unknown, not calm", () => {
    expect(homeStanding({ queues: allRead(), seriousAlerts: 0, dataError: true })).toBe("unknown");
  });

  it("a known count still says attention while another is unread", () => {
    expect(homeStanding({ queues: { ...allRead(), stalled: 2, fraud: undefined }, seriousAlerts: undefined, dataError: true })).toBe("attention");
  });
});

const stats: DashboardStats = {
  totalUsers: 1, activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0, lateCancellationRevenue: 0,
  newUsersInRange: 0, newUsersPrev: 0, revenueInRange: 0, revenuePrev: 0, completedJobsInRange: 0, completedJobsPrev: 0,
  feesThisQuarter: 0, newUsersSeries: [], revenueSeries: [], completedJobsSeries: [], activeJobsSeries: [],
  openReports: 0, supportTickets: 0, disputedJobs: 0,
};

function renderHome(standing: HomeStanding, seriousAlerts: number | undefined, onNavigate = (_v: string) => {}) {
  return render(
    <MemoryRouter>
      <DashboardHome
        stats={stats}
        statsLoading={false}
        onNavigate={onNavigate}
        dateRange="7d"
        setDateRange={() => {}}
        customDays={7}
        setCustomDays={() => {}}
        rangeLabel="last 7d"
        prevLabel="prior 7d"
        standing={standing}
        seriousAlerts={seriousAlerts}
      />
    </MemoryRouter>,
  );
}

describe("the admin home's greeting and alert row", () => {
  it("open serious alerts: says so, not calm, and the row opens Health", () => {
    const onNavigate = vi.fn();
    renderHome("attention", 88, onNavigate);
    expect(screen.getByText(HOME_STANDING_LINE.attention)).toBeInTheDocument();
    expect(screen.queryByText(HOME_STANDING_LINE.calm)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /88\s*Health alerts/ }));
    expect(onNavigate).toHaveBeenCalledWith("health");
  });

  it("nothing read yet: no calm line, no alert row", () => {
    renderHome("unknown", undefined);
    expect(screen.getByText(HOME_STANDING_LINE.unknown)).toBeInTheDocument();
    expect(screen.queryByText(HOME_STANDING_LINE.calm)).toBeNull();
    expect(screen.queryByText("Health alerts")).toBeNull();
  });

  it("calm: the line shows and no alert row", () => {
    renderHome("calm", 0);
    expect(screen.getByText(HOME_STANDING_LINE.calm)).toBeInTheDocument();
    expect(screen.queryByText("Health alerts")).toBeNull();
  });
});

describe("the wiring", () => {
  const code = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("Admin hands the ledger count to homeStanding", () => {
    expect(code("src/pages/admin/Admin.tsx")).toMatch(/homeStanding\(\{\s*queues: openQueues,\s*seriousAlerts: seriousAlertCount,/);
  });

  it("the count asks the ledger for every serious severity", () => {
    expect(code("src/components/admin/adminHealth/useOpenAlerts.ts")).toContain(`.in("severity", ["fatal", "critical", "error"])`);
  });
});
