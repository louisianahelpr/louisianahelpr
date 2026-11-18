/**
 * Design audit area 10 #6 (11-18): a KPI whose prior period was 0 said "+100%", which is not a real number (growth
 * from zero has no percent). It now says "New this period".
 *
 * @mutate src/components/admin/dashboard/KpiCard.tsx |   if (previous === 0) return { pct: 0, up: true, fresh: true }; |   if (previous === 0) return { pct: 100, up: true };
 * @mutate src/components/admin/dashboard/KpiCard.tsx | {trend.fresh ? "New this period" : | {false ? "New this period" :
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Users } from "lucide-react";
import { KpiCard, computeTrend } from "./KpiCard";

afterEach(() => cleanup());

describe("KPI change from a zero prior period", () => {
  it("is 'New this period', never +100%", () => {
    const t = computeTrend(5, 0);
    expect(t?.fresh).toBe(true);
    render(<KpiCard label="New Users" value="5" icon={Users} accent="accent" trend={t} compareLabel="vs prior 7d" />);
    const line = screen.getByTestId("kpi-change").textContent ?? "";
    expect(line).toContain("New this period");
    expect(line).not.toMatch(/%/);
  });
  it("a real prior still shows the percent", () => {
    expect(computeTrend(15, 10)).toEqual({ pct: 50, up: true });
    expect(computeTrend(0, 0)).toBeNull();
  });
});
