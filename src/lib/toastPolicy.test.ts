import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { applyToastPolicy } from "./toastPolicy";

/**
 * The policy is a monkey-patch on a shared module instance, so the thing worth
 * testing is not "does it call sonner" but "which calls survive it". A plain
 * confirmation must be swallowed; a toast that carries an `action` must not,
 * because that action is only reachable through the toast.
 */
describe("applyToastPolicy", () => {
  let real: {
    success: typeof toast.success;
    info: typeof toast.info;
    message: typeof toast.message;
    error: typeof toast.error;
    warning: typeof toast.warning;
  };

  beforeEach(() => {
    real = {
      success: vi.fn() as unknown as typeof toast.success,
      info: vi.fn() as unknown as typeof toast.info,
      message: vi.fn() as unknown as typeof toast.message,
      error: vi.fn() as unknown as typeof toast.error,
      warning: vi.fn() as unknown as typeof toast.warning,
    };
    toast.success = real.success;
    toast.info = real.info;
    toast.message = real.message;
    toast.error = real.error;
    toast.warning = real.warning;
    applyToastPolicy();
  });

  it("swallows a bare confirmation on every neutral channel", () => {
    toast.success("Availability saved");
    toast.info("Heads up");
    toast.message("Something happened");

    expect(real.success).not.toHaveBeenCalled();
    expect(real.info).not.toHaveBeenCalled();
    expect(real.message).not.toHaveBeenCalled();
  });

  it("swallows a confirmation that has options but no action", () => {
    toast.success("Saved", { description: "All good", duration: 3000 });

    expect(real.success).not.toHaveBeenCalled();
  });

  it("lets an actionable toast through — the action is only reachable here", () => {
    const onClick = vi.fn();
    toast.success("Attachment removed", { action: { label: "Undo", onClick } });

    expect(real.success).toHaveBeenCalledWith(
      "Attachment removed",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
  });

  it("never touches the channels that report failure", () => {
    toast.error("Card declined");
    toast.warning("Payout failed — retry manually.");

    expect(real.error).toHaveBeenCalledWith("Card declined");
    expect(real.warning).toHaveBeenCalledWith("Payout failed — retry manually.");
  });
});
