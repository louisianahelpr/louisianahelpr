/**
 * BOARD 51's head (spec v2 §9.17): You › Money opens on two tiles, "Coming to
 * you" and the held payment ("Held for <job>"), the SAME component and the SAME reads as Home's
 * money strip (HomeMoneyTiles over useHomeMoney), never a second copy. On the
 * Money tab a tile opens that page's own half instead of navigating to itself:
 * Held -> Spent; Coming -> Earned, or the payout account when there is none.
 *
 * @mutate src/components/profile/EarningsTab.tsx |         placement="money" |         placement="side"
 * @mutate src/components/profile/EarningsTab.tsx |           if (kind === "held") setView("spent"); |           if (kind === "held") setView("earned");
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |           onClick={() => (onOpen ? onOpen("held") : navigate("/profile?tab=earnings&view=spent"))} |           onClick={() => navigate("/profile?tab=earnings&view=spent")}
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   const span = money.coming && money.held ? "" : placement === "side" ? "" : "col-span-2"; |   const span = money.coming && money.held ? "" : placement === "main" ? "col-span-2" : "";
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

afterEach(cleanup);
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
const COMING = { cents: 9655, at: null, overdue: false, severalDates: false, hasPayoutAccount: true };

describe("You › Money opens on board 51's two tiles", () => {
  it("EarningsTab draws Home's tiles from Home's hook, at the top, every width", () => {
    const tab = read("components/profile/EarningsTab.tsx");
    expect(tab).toContain("const money = useHomeMoney(user);");
    const at = tab.indexOf('placement="money"');
    expect(at).toBeGreaterThan(0);
    // Above the connect card, the wallet and the Earned | Spent switcher.
    for (const below of ["<PaymentTab", "<WalletCard", "<MoneyViewSwitcher"]) {
      expect(tab.indexOf(below)).toBeGreaterThan(at);
    }
  });

  it("on the Money tab a tile opens its own half; a lone tile takes the row; no breakpoint hides it", () => {
    const opened: string[] = [];
    const { container } = render(
      <MemoryRouter>
        <HomeMoneyTiles money={{ coming: COMING, held: { cents: 4000, jobs: 1, only: null } }} placement="money" onOpen={(k) => opened.push(k)} />
      </MemoryRouter>,
    );
    const strip = container.querySelector('[data-home-money="money"]') as HTMLElement;
    expect(strip.className).not.toMatch(/hidden/);
    fireEvent.click(screen.getByRole("button", { name: /^Held for 1 job/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Coming to you/ }));
    expect(opened).toEqual(["held", "coming"]);
    // ...and the Money tab's own onOpen sends "held" to Spent (EarningsTab is not rendered here).
    expect(read("components/profile/EarningsTab.tsx")).toMatch(/if \(kind === "held"\) setView\("spent"\);/);
    cleanup();
    render(<MemoryRouter><HomeMoneyTiles money={{ coming: null, held: { cents: 4000, jobs: 1, only: null } }} placement="money" /></MemoryRouter>);
    expect((document.querySelector('[data-money-tile="held"]') as HTMLElement).className).toContain("col-span-2");
  });

  it("Home's desktop column keeps a lone tile at half width", () => {
    render(<MemoryRouter><HomeMoneyTiles money={{ coming: null, held: { cents: 4000, jobs: 1, only: null } }} placement="side" /></MemoryRouter>);
    expect((document.querySelector('[data-money-tile="held"]') as HTMLElement).className).not.toContain("col-span-2");
  });
});
