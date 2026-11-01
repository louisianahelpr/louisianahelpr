/**
 * B81 (2026-11-01): Money's "More insights" opened onto an empty panel for a member with no earnings yet (its only
 * content, EarningsBreakdownCharts, hid itself), so a tap looked dead (B77's lab tap: the chevron turned, nothing
 * showed). With no data it now says why in one line; with data it draws the breakdown as before.
 */
// @mutate src/components/profile/EarningsBreakdownCharts.tsx | Nothing to chart yet. Once a job or a sale pays you, this shows where your money comes from, by category and month. |
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EarningsBreakdownCharts } from "./EarningsBreakdownCharts";

describe("More insights never opens empty", () => {
  it("with no earnings it says there is nothing to chart yet", () => {
    const { container } = render(<EarningsBreakdownCharts earningsJobs={[]} feeFallbackPercent={10} firstPayoutFee={0} ledger={[]} />);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(20);
    expect(screen.getByText(/Nothing to chart yet\. Once a job or a sale pays you/)).toBeTruthy();
  });
});
