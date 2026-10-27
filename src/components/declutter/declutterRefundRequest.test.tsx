/**
 * Board 141, Declutter side: the refund request panel on a handed-over order (migration 20261026155251).
 * The rules and every amount are proven in SQL by src/test/pglite/declutterRefundRequests.pglite.mjs; this
 * proves the panel shows the SERVER's amounts, starts the seller's offer EMPTY (owner 2026-10-21), sends
 * exactly what the member chose, and offers Report a problem only after the seller says no.
 *
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |   const [amount, setAmount] = useState(""); |   const [amount, setAmount] = useState("10");
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |     mutationFn: () => answerRefund(v.request?.id ?? "", choice, choice === "part" ? offerCents : null), |     mutationFn: () => answerRefund(v.request?.id ?? "", choice, offerCents),
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |           {v.can_report && problemForm} |           {problemForm}
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       <button type="button" className={primary} disabled={send.isPending \|\| (choice === "part" && offerCents === null)} onClick={() => send.mutate()}> |       <button type="button" className={primary} disabled={send.isPending} onClick={() => send.mutate()}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RefundRequestView } from "@/lib/declutter/refundRequests";

const state = vi.hoisted(() => ({
  view: null as unknown,
  asked: [] as unknown[][],
  answered: [] as unknown[][],
  offers: [] as unknown[][],
  returned: [] as unknown[][],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/refundRequests", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/refundRequests")>();
  return {
    ...real,
    fetchRefundRequestView: async () => state.view,
    askRefund: async (...a: unknown[]) => { state.asked.push(a); return { result: "asked" }; },
    answerRefund: async (...a: unknown[]) => { state.answered.push(a); return { result: "offered" }; },
    answerRefundOffer: async (...a: unknown[]) => { state.offers.push(a); return { result: "refunded" }; },
    withdrawRefund: async () => ({ result: "withdrawn" }),
    confirmItemReturned: async (...a: unknown[]) => { state.returned.push(a); return { result: "refunded" }; },
  };
});

import { DeclutterRefundPanel } from "./DeclutterRefundRequest";

const BASE: RefundRequestView = {
  order_id: "o1", side: "buyer", handed_over: true, window_ends_at: "2026-10-24T18:00:00Z",
  can_ask: true, can_report: true, items_cents: 4000, full_refund_cents: 4120, delivery_kept_cents: 0, request: null,
};
const REQ = {
  id: "r1", status: "open" as const, reason: "damaged" as const, note: "The leg is cracked.", answer_by: "2026-10-24T18:00:00Z",
  offer_cents: null, offer_answer_by: null, declined_at: null, return_by: null, returned_at: null, report_until: null, refund_cents: null, refund_status: null,
  created_at: "2026-10-23T18:00:00Z",
};

function show(view: RefundRequestView) {
  state.view = view;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterRefundPanel orderId="o1" who="Nikki" problemForm={<p>PROBLEM FORM</p>} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.asked = [];
  state.answered = [];
  state.offers = [];
  state.returned = [];
});

describe("DeclutterRefundPanel", () => {
  it("buyer: asks with the reason and words chosen, and sees the server's full-refund amount", async () => {
    show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    expect(screen.getByText(/A full refund is \$41\.20/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Damaged"));
    fireEvent.change(screen.getByLabelText("Tell them more"), { target: { value: "  The leg is cracked.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the seller" }));
    await waitFor(() => expect(state.asked).toEqual([["o1", "damaged", "The leg is cracked."]]));
  });

  it("seller: the offer starts empty, cannot be sent until it is an amount, and sends exactly that amount", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    expect(await screen.findByText(/then gets \$41\.20 back once you confirm you have it/)).toBeTruthy();
    fireEvent.click(screen.getByText("Offer part of it"));
    const box = screen.getByLabelText(/How much back\?/) as HTMLInputElement;
    expect(box.value).toBe("");
    const send = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "12.50" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(state.answered).toEqual([["r1", "part", 1250]]));
  });

  it("seller: Refund in full sends no amount (the server decides it), even after typing an offer", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    fireEvent.click(await screen.findByText("Offer part of it"));
    fireEvent.change(screen.getByLabelText(/How much back\?/), { target: { value: "12.50" } });
    fireEvent.click(screen.getByText("Refund in full"));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(state.answered).toEqual([["r1", "full", null]]));
  });

  it("buyer: takes the seller's offer", async () => {
    show({ ...BASE, can_ask: false, request: { ...REQ, status: "offered", offer_cents: 1250, offer_answer_by: "2026-10-25T18:00:00Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "Take $12.50" }));
    await waitFor(() => expect(state.offers).toEqual([["r1", true]]));
  });

  it("buyer: Report a problem shows only after the seller says no, while the server allows it", async () => {
    const { unmount } = show({ ...BASE, can_ask: false, request: { ...REQ, status: "declined", declined_at: "2026-10-23T19:00:00Z", report_until: "2026-10-24T19:00:00Z" } });
    expect(await screen.findByText("PROBLEM FORM")).toBeTruthy();
    unmount();
    show({ ...BASE, can_ask: false, can_report: false, request: { ...REQ, status: "declined", declined_at: "2026-10-23T19:00:00Z", report_until: null } });
    expect(await screen.findByText(/Nikki said no to a refund\./)).toBeTruthy();
    expect(screen.queryByText("PROBLEM FORM")).toBeNull();
  });

  // #3558 answer 2 (owner 2026-10-23): a full refund waits for the item; only the seller's "I got it back" sends it.
  // Money review 2026-10-27: the tap asks once before the irreversible refund.
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx |         <button type="button" className={primary} disabled={back.isPending} onClick={() => setConfirmBack(true)}>I got it back</button> |
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx |           onPrimary={() => back.mutate(undefined, { onSettled: () => setConfirmBack(false) })} |           onPrimary={() => setConfirmBack(false)}
  it("seller: a full refund agreed waits for the item; I got it back asks once, then sends it", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "I got it back" }));
    // Nothing is sent by the first tap: it only opens the confirm.
    expect(state.returned).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Yes, send the refund" }));
    await waitFor(() => expect(state.returned).toEqual([["r1"]]));
  });

  it("buyer: while the item goes back, the refund is promised on the seller's confirmation, with no button to press", async () => {
    show({ ...BASE, can_ask: false, request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z" } });
    expect(await screen.findByText(/Give the item back; arrange it in Messages\. Your refund is sent as soon as Nikki confirms they have it\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I got it back" })).toBeNull();
  });
});
