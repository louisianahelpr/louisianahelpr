/**
 * Owner, 2026-10-08: "alerts should be under welcome back in admin not under
 * the 4 boxes i should see that first." The admin dashboard draws Priority
 * Alerts directly under the greeting, before the KPI tiles.
 *
 * @mutate src/components/admin/dashboard/DashboardHome.tsx | Priority Alerts</span>} | Alerts</span>}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/components/admin/dashboard/DashboardHome.tsx"), "utf8");

describe("admin dashboard: Priority Alerts come first", () => {
  it("the alerts card renders after the greeting and before the first KPI tile", () => {
    const greeting = SRC.indexOf("Welcome back");
    const alerts = SRC.indexOf("Priority Alerts</span>}");
    const firstKpi = SRC.indexOf("<KpiCard");
    expect(greeting).toBeGreaterThan(0);
    expect(firstKpi).toBeGreaterThan(0);
    expect(alerts, "Priority Alerts card is missing").toBeGreaterThan(0);
    expect(alerts).toBeGreaterThan(greeting);
    expect(alerts, "Priority Alerts must come before the KPI tiles").toBeLessThan(firstKpi);
  });
});
