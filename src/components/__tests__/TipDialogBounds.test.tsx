/**
 * ME-017 #2: TipDialog had no local $1–$1,000 bound, so an out-of-range custom
 * tip round-tripped to create-payment and came back as a server error toast.
 * The dialog now refuses it with the server's own wording and sends nothing.
 *
 * @mutate src/components/TipDialog.tsx | if (tipAmount * 100 < TIP_MIN_CENTS \|\| tipAmount * 100 > TIP_MAX_CENTS) { | if (false) {
 *
 * A3-41 (audit 11-01): the button said "Tip $18.00" while the poster is charged $18.85; it now says "Pay $18.85"
 * (the "You pay" figure). A3-42: no divider over "You pay", the card's only row.
 * @mutate src/components/TipCostBreakdown.tsx | ? `Pay ${centsLabel(tipQuoteForDollars(tipDollars).chargeCents)}` : "Tip"; | ? `Tip ${centsLabel(Math.round(tipDollars * 100))}` : "Tip";
 * @mutate src/components/TipDialog.tsx |  : tipPayLabel(amount)} |  : "Tip"}
 * @mutate src/components/CompletionPrompts.tsx |  : tipPayLabel(customTip)} |  : "Tip"}
 * @mutate src/components/TipCostBreakdown.tsx |     <div className="flex items-baseline justify-between gap-4"> |     <div className="flex items-baseline justify-between gap-4 pt-2 mt-1 border-t">
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// TipDialog reads the job's price for its percent presets (useTipJob, board
// 180); with no job row the presets fall back to whole dollars.
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const openOther = () => fireEvent.click(screen.getByRole("button", { name: "Other" }));

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));

import { TipDialog } from "../TipDialog";

describe("TipDialog custom amount bounds (ME-017 #2)", () => {
  beforeEach(() => {
    invoke.mockReset();
    toastError.mockReset();
  });

  it("refuses $5,000 locally with the server's wording and never calls create-payment", () => {
    render(<TipDialog jobId="job-1" open onClose={() => {}} />);
    openOther();
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Pay \$/ }));
    expect(toastError).toHaveBeenCalledWith("Tips must be between $3 and $1,000.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows only the total the poster pays before sending, and that the Helpr gets the whole tip (owner 2026-10-25)", () => {
    render(<TipDialog jobId="job-1" open onClose={() => {}} />);
    // With no job price the presets are whole dollars; picking one quotes it.
    fireEvent.click(screen.getByRole("button", { name: "$5" }));
    expect(screen.getByLabelText("Tip cost breakdown").textContent).toBe("You pay$5.46");
    expect(document.body.textContent).toContain("Your Helpr receives the whole $5.00 tip.");
    expect(document.body.textContent).not.toMatch(/card processing|card fee|processing/i);
    openOther();
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "10" } });
    const breakdown = screen.getByLabelText("Tip cost breakdown");
    expect(breakdown.textContent).toBe("You pay$10.61");
    // A3-42: the only row draws no divider over itself.
    expect(breakdown.querySelector(".border-t")).toBeNull();
    expect(document.body.textContent).toContain("Your Helpr receives the whole $10.00 tip.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still sends an in-range amount", () => {
    invoke.mockReturnValue(new Promise(() => {}));
    render(<TipDialog jobId="job-1" open onClose={() => {}} />);
    openOther();
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "25" } });
    // A3-41: the button names the charge (the "You pay" figure), not the tip alone.
    const pay = screen.getByLabelText("Tip cost breakdown").textContent!.replace("You pay", "");
    expect(pay).not.toBe("$25.00");
    expect(screen.queryByRole("button", { name: "Tip $25.00" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Pay ${pay}` }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("A3-41: the Job done screen's tip button names the charge too", () => {
  it("CompletionPrompts labels its tip button with tipPayLabel", () => {
    expect(blankComments(readFileSync("src/components/CompletionPrompts.tsx", "utf8"))).toContain(" : tipPayLabel(customTip)}");
  });
});
