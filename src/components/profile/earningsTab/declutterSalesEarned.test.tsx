/**
 * A3-56 (audit 2026-11-01): Money > Earned showed "total earned $0.00 · 0 jobs" to a seller with a $40 sale paid out. The Earned figure
 * now adds the range's sent sale payouts, the caption says "N jobs · M sales", and a "Declutter sales" card lists every
 * sale payout. The read and the range rule: src/lib/declutter/salePayouts.test.ts.
 *
 * @mutate src/components/profile/EarningsTab.tsx |             earnedDollars={rangeEarnings + rangeSales.cents / 100} |             earnedDollars={rangeEarnings}
 * @mutate src/components/profile/EarningsTab.tsx |           <DeclutterSalesEarned rows={salePayouts ?? []} | <DeclutterSalesEarned rows={[]}
 * @mutate src/components/profile/earningsTab/EarningsSummaryCard.tsx |  · {saleCount} sale{saleCount === 1 ? "" : "s"} |
 * @mutate src/components/profile/earningsTab/DeclutterSalesEarned.tsx |   if (failed) return <ErrorState | if (false) return <ErrorState
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { EarningsSummaryCard } from "./EarningsSummaryCard";
import { DeclutterSalesEarned } from "./DeclutterSalesEarned";
import type { SalePayout } from "@/lib/declutter/salePayouts";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const row = (order_id: string, title: string, status: SalePayout["status"], amount_cents: number, executed_at: string | null): SalePayout =>
  ({ order_id, title, status, amount_cents, executed_at, items_cents: amount_cents, delivery_cents: 0, refunded_cents: 0, debt_cents: 0 });

describe("Declutter sales in Money > Earned (A3-56)", () => {
  it("the caption counts jobs and sales", () => {
    render(<EarningsSummaryCard loading={false} range="lifetime" onRangeChange={() => {}} earnedDollars={40} jobCount={0} saleCount={1}
      tipsDollars={0} tipCount={0} inProgressCount={0} />);
    expect(screen.getByText("$40.00")).toBeTruthy();
    expect(screen.getByText(/· 0 jobs · 1 sale$/)).toBeTruthy();
  });

  it("each sale payout is a row: 'Sold: <item>' and '<amount> · <state>'", () => {
    render(<DeclutterSalesEarned rows={[row("o1", "Oak rocking chair", "succeeded", 4000, "2026-10-29T15:00:00Z"), row("o2", "Lamp", "failed", 1200, null)]}
      failed={false} onRetry={() => {}} />);
    const rows = document.querySelectorAll("[data-sale-payout]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("Sold: Oak rocking chair$40.00 · Paid Oct 29");
    expect(rows[1].textContent).toBe("Sold: Lamp$12.00 · Didn't go through");
  });

  it("nothing sold: no card; a failed read: says so with Try again", () => {
    const { container, unmount } = render(<DeclutterSalesEarned rows={[]} failed={false} onRetry={() => {}} />);
    expect(container.textContent).toBe("");
    unmount();
    render(<DeclutterSalesEarned rows={[]} failed onRetry={() => {}} />);
    expect(screen.getByText("We couldn't load your Declutter sales.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("EarningsTab adds the range's sales to Earned and mounts the sales card", () => {
    const src = blankComments(readFileSync("src/components/profile/EarningsTab.tsx", "utf8")).replace(/\s+/g, " ");
    expect(src).toContain("const rangeSales = salesEarnedIn(salePayouts ?? [], rangeSince);");
    expect(src).toContain("earnedDollars={rangeEarnings + rangeSales.cents / 100}");
    expect(src).toContain("saleCount={rangeSales.count}");
    expect(src).toContain("<DeclutterSalesEarned rows={salePayouts ?? []}");
    const hook = blankComments(readFileSync("src/components/profile/earningsTab/useEarningsData.ts", "utf8")).replace(/\s+/g, " ");
    expect(hook).toContain("queryFn: () => fetchMySalePayouts(helperId)");
  });
});
