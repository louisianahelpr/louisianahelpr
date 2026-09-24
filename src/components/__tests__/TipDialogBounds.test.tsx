/**
 * ME-017 #2: TipDialog had no local $1–$1,000 bound, so an out-of-range custom
 * tip round-tripped to create-payment and came back as a server error toast.
 * The dialog now refuses it with the server's own wording and sends nothing.
 *
 * @mutate src/components/TipDialog.tsx | if (tipAmount < 1 || tipAmount > 1000) { | if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Tip" }));
    expect(toastError).toHaveBeenCalledWith("Tips must be between $1 and $1,000.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still sends an in-range amount", () => {
    invoke.mockReturnValue(new Promise(() => {}));
    render(<TipDialog jobId="job-1" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tip amount in dollars"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Tip" }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
