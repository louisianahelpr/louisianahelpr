/**
 * M12 (iOS design audit 11-16): an empty Money page read as an error. "On its way $0.00" was drawn in rust, and the
 * "You'll set up payouts once you're hired" line sat in the rust money-state box (MoneyNote) inside a card, though
 * nothing is wrong and there is nothing to do. A zero amount is now the neutral ink, and the note is a quiet neutral
 * card; rust stays for money that is really moving or held.
 *
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx | style={{ color: cents === 0 ? "hsl(var(--ink-deep))" : "hsl(var(--accent-ink))" }} | style={{ color: "hsl(var(--accent-ink))" }}
 * @mutate src/components/payouts/PayoutSetupPausedNotice.tsx | style={{ background: "hsl(var(--olivewood) / 0.05)" }} | style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => "needs_hire", usePayoutSetupPaused: () => false }));

import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";

describe("an empty Money page is quiet (M12)", () => {
  it("On its way $0.00 is the neutral ink, not rust", () => {
    render(<MemoryRouter><HomeMoneyTiles money={{ coming: null, held: null }} placement="money" /></MemoryRouter>);
    const amounts = [...document.querySelectorAll<HTMLElement>("[data-money-amount]")];
    expect(amounts).toHaveLength(1); // vacuity floor: the zero tile is drawn
    expect(amounts[0].textContent).toBe("$0.00");
    expect(amounts[0].style.color).toBe("hsl(var(--ink-deep))");
  });

  it("the payout-setup line is a quiet neutral card, not the rust money note", () => {
    const { container } = render(<PayoutSetupPausedNotice />);
    const note = container.querySelector<HTMLElement>("[data-payout-quiet-note]");
    expect(note).not.toBeNull();
    expect(container.querySelector("[data-money-note]")).toBeNull();
    expect(note!.getAttribute("style")).not.toContain("burnt-sienna");
    expect(note!.style.color).not.toContain("accent-ink");
  });
});
