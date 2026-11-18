/**
 * Area 06 H2 (11-18): "You get $40 once you set up payouts in Settings." had no way to the payout settings.
 *
 * @mutate src/components/declutter/FailedPayoutLink.tsx |   if (paused \|\| !/(once you set up payouts in Settings\|once your payout account is ready)\.$/.test(line)) return null; |   return null;
 * @mutate src/components/declutter/FailedPayoutLink.tsx |   return <>{line}<PayoutSetupLink line={line} /></>; |   return <>{line}</>;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ block: "none" as string }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => h.block }));

import { PayoutLineText } from "./FailedPayoutLink";

const draw = (line: string) => render(<MemoryRouter><p><PayoutLineText line={line} /></p></MemoryRouter>);

describe("the seller's payout line links to payout setup when it waits on it", () => {
  it("links 'Set up payouts' to the payment tab", () => {
    draw("You get $40 once you set up payouts in Settings.");
    expect(screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href")).toBe("/profile?tab=payment");
  });
  it("no link on a line that does not wait on setup, or while setup is paused", () => {
    draw("You get $40, paid on Friday unless the buyer asks for a refund.");
    expect(screen.queryByRole("link")).toBeNull();
    h.block = "paused";
    draw("You get $40 once your payout account is ready.");
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelectorAll("p").length).toBeGreaterThan(1);
  });
});
