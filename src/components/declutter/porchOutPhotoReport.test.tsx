/**
 * Audit 11-10 F378: the buyer's porch-photo caption said "Something wrong? Report it before you take your pickup photo."
 * with no Report button anywhere in the card (the card's own "Report a problem" waits for the pickup time to pass).
 * PorchOutPhoto now takes `onProblem` and puts a "Report a problem" text button right under that sentence for the
 * buyer; the seller's caption has none; and the order card passes the card's one problem form opener (not while a
 * problem is already open).
 *
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | {side === "buyer" && onProblem && ( | {false && (
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | onProblem={problem ? undefined : () => { setAtHandover(true); setProblemOpen(true); }} |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "buyer", confirmed_at: null,
    set_out_at: "2026-11-10T15:00:00Z", set_out_photo_path: "p.jpg", set_out_note: null, picked_up_at: null }),
  handoverPhotoUrl: async (path: string) => `https://signed.test/${path}`,
}));

import { PorchOutPhoto } from "./DeclutterPorchHandover";

function show(side: "buyer" | "seller", onProblem?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><PorchOutPhoto orderId="o1" side={side} onProblem={onProblem} /></QueryClientProvider>);
}

describe("F378: Report a problem sits under the porch photo's sentence", () => {
  it("the buyer gets the button right after the caption, and it opens the card's problem form", async () => {
    const onProblem = vi.fn();
    show("buyer", onProblem);
    const caption = await screen.findByText(/Report it before you take your pickup photo/);
    const button = screen.getByRole("button", { name: "Report a problem" });
    expect(button).toHaveAttribute("data-porch-report");
    expect(caption.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(onProblem).toHaveBeenCalledTimes(1);
  });

  it("the seller's photo (and a buyer card with a problem already open) has no such button", async () => {
    show("seller", vi.fn());
    await screen.findByText("The buyer sees this photo.");
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
    show("buyer");
    await screen.findByText(/Report it before you take your pickup photo/);
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("the order card wires the button to its one problem form, except while a problem is open", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterHandoverViews.tsx"), "utf8"));
    expect(src).toContain('<PorchOutPhoto orderId={order.orderId} side={order.side} onProblem={problem ? undefined : () => { setAtHandover(true); setProblemOpen(true); }} />');
  });
});
