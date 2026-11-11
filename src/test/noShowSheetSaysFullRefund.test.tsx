/**
 * F272 (owner 11-11; full refund decided ~2:50 PM): the no-show sheet says plainly
 * "If you don't pick a new date, you get a full refund of $X. <name> gets a strike."
 * $X is the server's own quote of the refund the report leads to (create-payment cancel_quote with asNoShow, which
 * void-cancelled-payments then sends: src/test/edge/posterCancelQuoteMatchesRefund.test.ts "F272"). With no quote,
 * no number is shown.
 *
 * @mutate src/components/job-card/NoShowDialog.tsx | void fetchPosterCancelQuote(jobId, { asNoShow: true }) | void fetchPosterCancelQuote(jobId)
 * @mutate src/components/job-card/NoShowDialog.tsx | ? `If you don't pick a new date, you get a full refund of $${formatPriceExact(backCents / 100)}.` | ? `If you don't pick a new date, you get a full refund.`
 * @mutate src/components/job-card/NoShowDialog.tsx |   const who = helperName?.trim() \|\| "The Helpr"; |   const who = "The Helpr";
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const quoteMock = vi.fn();
vi.mock("@/lib/posterCancelQuote", () => ({ fetchPosterCancelQuote: (...a: unknown[]) => quoteMock(...a) }));

import { NoShowDialog, noShowRefundLine } from "@/components/job-card/NoShowDialog";

const job = { id: "j1", date_needed: "2026-11-12", start_time: "09:00:00", helper_id: "h1" };

describe("F272: the no-show sheet states the full refund and the strike", () => {
  afterEach(() => { cleanup(); quoteMock.mockReset(); });

  it("the line, with and without the server's amount", () => {
    expect(noShowRefundLine(12096)).toBe("If you don't pick a new date, you get a full refund of $120.96.");
    expect(noShowRefundLine(22200)).toBe("If you don't pick a new date, you get a full refund of $222.");
    expect(noShowRefundLine(null)).toBe("If you don't pick a new date, you get a full refund.");
    expect(noShowRefundLine(0)).toBe("If you don't pick a new date, you get a full refund.");
  });

  it("asks the server for the no-show refund and names the Helpr", async () => {
    quoteMock.mockResolvedValue({ can_cancel: true, back_to_you_cents: 12096 });
    render(<NoShowDialog jobId="j1" job={job} helperName="Eli R." onClose={() => {}} onConfirm={() => {}} reporting={false} />);
    expect(quoteMock).toHaveBeenCalledWith("j1", { asNoShow: true });
    await waitFor(() => expect(screen.getByTestId("no-show-outcome").textContent)
      .toBe("If you don't pick a new date, you get a full refund of $120.96. Eli R. gets a strike."));
  });

  it("no quote: no number, and no name falls back to The Helpr", async () => {
    quoteMock.mockResolvedValue(null);
    render(<NoShowDialog jobId="j1" job={job} onClose={() => {}} onConfirm={() => {}} reporting={false} />);
    await waitFor(() => expect(quoteMock).toHaveBeenCalled());
    expect(screen.getByTestId("no-show-outcome").textContent).toBe("If you don't pick a new date, you get a full refund. The Helpr gets a strike.");
  });
});
