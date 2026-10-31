/**
 * BUY-2 (owner 10-31): after no Helpr took the delivery, the buyer sees the choice and the cancel sheet says who pays
 * the card fee (the buyer) with the server's sums. soldstates-5 (owner 10-31): the seller's "The Helpr didn't come"
 * (only 15 minutes after the pickup time, behind a sheet) and the Helpr's answer box.
 *
 * @mutate src/components/declutter/DeclutterNoHelpr.tsx | You get {formatPrice(c.refund_cents)} back. | You get {formatPrice(c.card_fee_cents)} back.
 * @mutate src/components/declutter/DeclutterNoHelpr.tsx | onClick={() => setAsking(true)}>\n        Cancel and get a refund | onClick={() => cancel.mutate()}>\n        Cancel and get a refund
 * @mutate src/components/declutter/DeclutterNoHelpr.tsx |   if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null; |   if (false) return null;
 * @mutate src/components/declutter/DeclutterNoHelpr.tsx |   if (!r \|\| r.settled_at) return null; |   if (!r) return null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  choice: null as null | { refund_cents: number; card_fee_cents: number; delivery_refunded_cents: number; pickup_by: string },
  report: null as null | { reported_at: string; answer_by: string; answered_at: string | null; settled_at: string | null },
  calls: [] as string[],
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/noHelpr", () => ({
  fetchNoHelprChoice: async () => state.choice,
  cancelAfterNoHelpr: async (id: string) => { state.calls.push(`cancel:${id}`); return { result: "refunding" }; },
  fetchHelprNoShowReport: async () => state.report,
  reportHelprNoShow: async (id: string) => { state.calls.push(`report:${id}`); return { result: "helpr_told", answer_by: "" }; },
  answerHelprNoShow: async (id: string, note: string) => { state.calls.push(`answer:${id}:${note}`); return "p1"; },
}));

import { HelprNoShowAnswer, HelprNoShowReportButton, NoHelprChoice } from "./DeclutterNoHelpr";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { state.choice = null; state.report = null; state.calls = []; });

describe("BUY-2: the buyer's choice after no Helpr", () => {
  it("shows nothing for an order that isn't one", async () => {
    const { container } = wrap(<NoHelprChoice orderId="o1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-no-helpr-choice]")).toBeNull();
  });

  it("says the delivery fee is back, and the sheet says the buyer pays the card fee, with the server's sums", async () => {
    state.choice = { refund_cents: 4287, card_fee_cents: 213, delivery_refunded_cents: 1800, pickup_by: "2026-11-06T18:00:00Z" };
    wrap(<NoHelprChoice orderId="o1" />);
    expect(await screen.findByText("No Helpr took your delivery.")).toBeTruthy();
    expect(screen.getByText(/The \$18 you paid for delivery is coming back to your card/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel and get a refund" }));
    expect(state.calls).toEqual([]);
    expect(await screen.findByText(/You get \$42\.87 back\./)).toBeTruthy();
    // membersSeeNoFeeWords (owner 2026-10-25): the amount only, no fee named.
    expect(document.body.textContent ?? "").not.toMatch(/card fee/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel the sale" }));
    await waitFor(() => expect(state.calls).toEqual(["cancel:o1"]));
  });
});

describe("soldstates-5: the seller's report and the Helpr's answer", () => {
  it("no button before 15 minutes past the pickup time", async () => {
    wrap(<HelprNoShowReportButton orderId="o1" taskId="t1" slotStart={new Date(Date.now() - 5 * 60_000).toISOString()} who="Sam" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "The Helpr didn't come" })).toBeNull();
  });

  it("after 15 minutes: asks first, then reports", async () => {
    wrap(<HelprNoShowReportButton orderId="o1" taskId="t1" slotStart={new Date(Date.now() - 20 * 60_000).toISOString()} who="Sam" />);
    fireEvent.click(await screen.findByRole("button", { name: "The Helpr didn't come" }));
    expect(state.calls).toEqual([]);
    expect(await screen.findByText(/We tell Sam now\. They have 24 hours to answer\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tell them" }));
    await waitFor(() => expect(state.calls).toEqual(["report:o1"]));
  });

  it("the Helpr answers within the 24 hours; nothing once it is settled", async () => {
    state.report = { reported_at: "2026-10-31T15:00:00Z", answer_by: "2026-11-01T15:00:00Z", answered_at: null, settled_at: null };
    const { unmount } = wrap(<HelprNoShowAnswer taskId="t1" />);
    expect(await screen.findByText("The seller says you didn't come.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/What happened\?/), { target: { value: "I was there at 2" } });
    fireEvent.click(screen.getByRole("button", { name: "I was there" }));
    await waitFor(() => expect(state.calls).toEqual(["answer:t1:I was there at 2"]));
    unmount();
    state.report = { ...state.report, settled_at: "2026-11-01T15:05:00Z" };
    const { container } = wrap(<HelprNoShowAnswer taskId="t1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });
});
