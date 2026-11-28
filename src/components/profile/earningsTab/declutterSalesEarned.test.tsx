/**
 * A3-56 (audit 2026-11-01): Money > Earned showed "total earned $0.00 · 0 jobs" to a seller with a $40 sale paid out. The Earned figure
 * now adds the range's sent sale payouts, the caption says "N jobs · M sales", and a "Declutter sales" card lists every
 * sale payout. The read and the range rule: src/lib/declutter/salePayouts.test.ts.
 *
 * @mutate src/components/profile/EarningsTab.tsx |             earnedDollars={rangeEarnings + rangeSales.cents / 100} |             earnedDollars={rangeEarnings}
 * @mutate src/components/profile/EarningsTab.tsx |           <DeclutterSalesEarned rows={salePayouts ?? []} | <DeclutterSalesEarned rows={[]}
 * @mutate src/components/profile/earningsTab/DeclutterSalesEarned.tsx |   if (failed) return <ErrorState | if (false) return <ErrorState
 * @mutate src/components/profile/earningsTab/DeclutterSalesEarned.tsx | {(r.status === "failed" \|\| (r.status === "pending" && !payoutReady)) && ( | {(r.status === "failed") && (
 * @mutate src/components/profile/earningsTab/EarningsSummaryCard.tsx | {saleCount > 0 ? <> | {saleCount >= 0 ? <>
 * Polish audit 11-27 #72: the row title is a 15px/600 link with a chevron, no underline, centred in its 44px target.
 * @mutate src/components/profile/earningsTab/DeclutterSalesEarned.tsx | className="flex min-h-11 min-w-0 items-center justify-between gap-2 text-ds-15 font-semibold no-underline | className="min-h-11 min-w-0 text-ds-14 font-semibold underline underline-offset-2
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { EarningsSummaryCard } from "./EarningsSummaryCard";
import { DeclutterSalesEarned } from "./DeclutterSalesEarned";
import type { SalePayout } from "@/lib/declutter/salePayouts";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const hooks = vi.hoisted(() => ({ ready: true, paused: false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: hooks.ready ? { stripe_account_id: "acct_1", payouts_enabled: true, charges_enabled: true, stripe_onboarding_complete: true } : {} }) }));
vi.mock("@/lib/payoutAccountReady", () => ({ payoutAccountReady: () => hooks.ready }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => (hooks.paused ? "paused" : null) }));

const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

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
    expect(rows[1].textContent).toBe("Sold: Lamp$12.00 · Didn't go throughYour payout didn't go through yet. Check that your payout account is set up. If it still doesn't arrive, message Support. Check your payouts");
  });

  // Area 06b M8 (design audit 11-18, display only): each row opens its sale; an unsent payout says why with the fix.
  it("each row links to its sale; a failed or waiting payout says why and links to payouts", () => {
    hooks.ready = false;
    render(<DeclutterSalesEarned rows={[row("o1", "Oak rocking chair", "succeeded", 4000, "2026-10-29T15:00:00Z"), row("o2", "Lamp", "pending", 1200, null)]}
      failed={false} onRetry={() => {}} />);
    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-sale-payout-link]")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/declutter?tab=selling&order=o1", "/declutter?tab=selling&order=o2"]);
    expect(document.querySelectorAll("[data-sale-payout-why]")).toHaveLength(1);
    expect(document.querySelector("[data-sale-payout-why='pending']")?.textContent).toBe("It goes out once your payout account is ready. Set up payouts");
    hooks.ready = true;
  });

  it("the caption leaves out '· 0 sales' for a member who has sold nothing", () => {
    render(<EarningsSummaryCard loading={false} range="lifetime" onRangeChange={() => {}} earnedDollars={40} jobCount={2} saleCount={0}
      tipsDollars={0} tipCount={0} inProgressCount={0} />);
    expect(screen.getByText(/· 2 jobs$/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0 sales/);
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

  it("polish audit 11-27 #72: a row's title is a 15px link with a chevron, no underline, centred in its 44px target", () => {
    render(<DeclutterSalesEarned rows={[row("o-1", "Bar stools", "succeeded", 4000, "2026-11-07T12:00:00Z")]} failed={false} onRetry={() => {}} />);
    const link = document.querySelector("[data-sale-payout-link]") as HTMLElement;
    expect(link.textContent).toBe("Sold: Bar stools");
    expect(link.className).toMatch(/\btext-ds-15\b/);
    expect(link.className).toMatch(/\bitems-center\b/);
    expect(link.className).not.toMatch(/(^|\s)underline(\s|$)/);
    expect(link.querySelector("[data-sale-payout-chevron]")).not.toBeNull();
  });
});
