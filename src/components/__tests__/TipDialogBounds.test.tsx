/**
 * ME-017 #2: TipDialog had no local $1–$1,000 bound, so an out-of-range custom
 * tip round-tripped to create-payment and came back as a server error toast.
 * The dialog now refuses it with the server's own wording and sends nothing.
 *
 * @mutate src/components/TipDialog.tsx | if (tipAmount * 100 < TIP_MIN_CENTS \|\| tipAmount * 100 > TIP_MAX_CENTS) { | if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    fireEvent.click(screen.getByRole("button", { name: /^Tip \$/ }));
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
    expect(document.body.textContent).toContain("Your Helpr receives the whole $10.00 tip.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still sends an in-range amount", () => {
    invoke.mockReturnValue(new Promise(() => {}));
    render(<TipDialog jobId="job-1" open onClose={() => {}} />);
    openOther();
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Tip $25.00" }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
