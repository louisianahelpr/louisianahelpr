/**
 * Owner's UI audit 11-09, F145 (/admin): a KPI tile said its change twice, a tiny "12%" pill beside the label and a
 * 10px "+12% vs prior 7d" line under the number. It now says it ONCE, under the number, at 12px with its arrow.
 *
 * @mutate src/components/admin/dashboard/KpiCard.tsx | const KPI_CHANGE_CLASS = "flex items-center gap-1 text-ds-12 font-semibold tabular-nums mt-1 leading-tight"; | const KPI_CHANGE_CLASS = "flex items-center gap-1 text-ds-10 font-semibold tabular-nums mt-1 leading-tight";
 * @mutate src/components/admin/dashboard/KpiCard.tsx |       </div>\n      <p className="text-ds-17 | {trend && <span>{trend.pct}%</span>}</div>\n      <p className="text-ds-17
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { KpiCard } from "./KpiCard";

describe("a KPI tile states its change once, readable (F145)", () => {
  it.each([
    [{ pct: 12, up: true }, "+12% vs prior 7d"],
    [{ pct: 100, up: false }, "−100% vs prior 7d"],
  ])("%o", (trend, words) => {
    const { container, unmount } = render(
      <KpiCard label="New Users (last 7d)" value="7" icon={Users} accent="accent" trend={trend} compareLabel="vs prior 7d" />,
    );
    // The percentage appears exactly once in the tile.
    const text = container.textContent ?? "";
    expect(text.match(new RegExp(`${trend.pct}%`, "g"))?.length).toBe(1);
    const line = screen.getByTestId("kpi-change");
    expect(line.textContent).toBe(words);
    expect(line.className.split(" ")).toContain("text-ds-12");
    expect(line.className).not.toMatch(/text-ds-1[01]\b/);
    // It sits under the number, not in the label row.
    const number = screen.getByText("7");
    expect(number.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
  });

  it("a tile with no trend shows no change line", () => {
    const { unmount } = render(<KpiCard label="Active Jobs" value="3" icon={Users} accent="primary" />);
    expect(screen.queryByTestId("kpi-change")).toBeNull();
    unmount();
  });
});
