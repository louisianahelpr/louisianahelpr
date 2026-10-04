/**
 * Q1194 (lh-silent-failure review must-fix): when the health data's reads
 * fail, the admin health screen says so instead of rendering the fallback
 * shell's zeros ("0 sent", "0 unresolved", and the red "No admin has
 * registered a push token" banner, which the failure would have raised by
 * itself). Red before: AdminHealth read only `data`, so a never-loaded error
 * rendered all of those.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const health = vi.hoisted(() => ({ isError: true, dataUpdatedAt: 0 }));
const FALLBACK = {
  emailStats: { total: 0, sent: 0, failed: 0, suppressed: 0 },
  pushStats: { total: 0, ios: 0, android: 0, latestAt: null },
  fraudCount: 0,
  adminPushTokenCount: 0,
  recentJobs: { open: 0, completed: 0, disputed: 0, cancelled: 0 },
  healthStatus: "unknown",
  parishStats: [],
  medianTimeToFirstAppMin: null,
  jobsAwaitingApps: 0,
};
vi.mock("./adminHealth/useHealthData", () => ({
  useHealthData: () => ({
    queryKey: ["admin-health"],
    data: FALLBACK,
    isFetching: false,
    isError: health.isError,
    dataUpdatedAt: health.dataUpdatedAt,
    refetch: vi.fn(),
  }),
}));
vi.mock("./adminHealth/useConfigChecks", () => ({ useConfigChecks: () => ({ data: [] }) }));
vi.mock("./adminHealth/useCronHealth", () => ({ useCronHealth: () => ({ data: [] }) }));
vi.mock("./adminHealth/useOpenAlerts", () => ({ useOpenAlerts: () => ({ data: [] }) }));
vi.mock("./adminHealth/useFillRate", () => ({
  useFillRate: () => ({
    fillDays: 30, setFillDays: vi.fn(), fillSort: "parish", fillSortAsc: true,
    fillData: null, fillFetching: false, sortedParishes: [], handleFillSort: vi.fn(),
  }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminHealth from "./AdminHealth";

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminHealth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminHealth when its health reads fail (Q1194)", () => {
  it("never loaded: an error, no zeros, no false push banner", () => {
    health.isError = true;
    health.dataUpdatedAt = 0;
    const { container } = renderIt();
    expect(screen.getByText("Couldn't load platform health")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toContain("0 sent");
    expect(text).not.toContain("0 unresolved");
    expect(text).not.toContain("No admin has registered a push token");
  });

  it("loaded earlier: the last reading stays, marked as stale", () => {
    health.isError = true;
    health.dataUpdatedAt = Date.now() - 60_000;
    const { container } = renderIt();
    expect(container.textContent).toContain("Couldn't refresh platform health");
    expect(container.textContent).toContain("0 sent");
  });

  it("healthy: no error and the readings render (control)", () => {
    health.isError = false;
    health.dataUpdatedAt = Date.now();
    const { container } = renderIt();
    expect(container.textContent).not.toContain("Couldn't");
    expect(container.textContent).toContain("0 sent");
  });
});

// @mutate src/components/admin/AdminHealth.tsx |   const healthNeverLoaded = isError && !dataUpdatedAt; |   const healthNeverLoaded = false;
// @mutate src/components/admin/AdminHealth.tsx |       {!healthNeverLoaded && adminPushTokenCount === 0 && ( |       {adminPushTokenCount === 0 && (
// @mutate src/components/admin/AdminHealth.tsx |   const healthStale = isError && !!dataUpdatedAt; |   const healthStale = false;
