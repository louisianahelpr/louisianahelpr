/**
 * ResponseDeadlineDialog failure surfacing.
 *
 * Proven live 2026-08-28: the server award gate (trigger jobs_award_gate)
 * refused a helper with stale payout flags, confirmAcceptWithDeadline only
 * fired a toast (invisible behind the open dialog), and the poster tapped
 * "Send Offer" four times with no visible response. The contract now is:
 * onConfirm THROWS a human-readable Error on failure, and the dialog renders
 * it inline, stays open, and re-enables Send.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { posterAwardBlockMessage } from "@/lib/awardGate";

// jsdom lacks a few pointer APIs Radix dialogs touch.
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe("ResponseDeadlineDialog", () => {
  it("shows an award-gate refusal inline and stays open with Send re-enabled", async () => {
    const gateMessage = posterAwardBlockMessage("helper_payout_setup_incomplete", "Jane Doe");
    const onConfirm = vi.fn().mockRejectedValue(new Error(gateMessage));
    const onClose = vi.fn();

    render(
      <ResponseDeadlineDialog open helperName="Jane Doe" onConfirm={onConfirm} onClose={onClose} />,
    );

    const send = screen.getByRole("button", { name: /send offer/i });
    fireEvent.click(send);

    // The refusal is rendered INSIDE the dialog, verbatim.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(gateMessage);

    // Dialog stayed open (never closed itself) and Send is usable again.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send offer/i })).toBeEnabled(),
    );

    // A retry clears the previous error while in flight and re-shows on
    // a second refusal.
    fireEvent.click(screen.getByRole("button", { name: /send offer/i }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("alert")).toHaveTextContent(gateMessage);
  });

  it("falls back to generic copy when the failure carries no message", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error(""));
    render(
      <ResponseDeadlineDialog open helperName="Jane Doe" onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send offer/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't send the offer — please try again.",
    );
  });
});
