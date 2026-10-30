/**
 * Board 141, Declutter side: the refund request panel on a handed-over order (migration 20261026155251).
 * The rules and every amount are proven in SQL by src/test/pglite/declutterRefundRequests.pglite.mjs; this
 * proves the panel shows the SERVER's amounts, starts the seller's offer EMPTY (owner 2026-10-21), sends
 * exactly what the member chose, and offers Report a problem only after the seller says no.
 *
 * Deep audit 2026-10-28 B-5 (#5): the full refund is less than the payment (the card network keeps its part); the buyer
 * is told why in words wherever that amount is shown, with no fee name or figure (membersSeeNoFeeWords scans the copy).
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | . <span data-full-refund-why="">{FULL_REFUND_WHY}</span> For a full refund | . For a full refund
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | {refundDollars(v.full_refund_cents)}. <span data-full-refund-why="">{FULL_REFUND_WHY}</span> Give the item back; | {refundDollars(v.full_refund_cents)}. Give the item back;
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |   const [amount, setAmount] = useState(""); |   const [amount, setAmount] = useState("10");
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |     mutationFn: () => answerRefund(v.request?.id ?? "", choice, choice === "part" ? offerCents : null), |     mutationFn: () => answerRefund(v.request?.id ?? "", choice, offerCents),
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |           {v.can_report && problemForm} |           {problemForm}
 * D2-5 (audit 1b #5): a request Louisiana Helpr decided says so on both sides, never "is looking" or "said no".
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       if (r.admin_decided) return <p | if (false) return <p
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |   if (r.status === "declined" && r.admin_decided) return | if (false) return
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       {r.admin_decided && "Louisiana Helpr decided to refund the buyer. "} |
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       <button type="button" className={primary} disabled={send.isPending \|\| (choice === "part" && offerCents === null)} onClick={() => send.mutate()}> |       <button type="button" className={primary} disabled={send.isPending} onClick={() => send.mutate()}>
 *
 * Audit 1028 part 2, D2-15: both pick-one lists are the app's RadioCardList (no browser radios), and the amount box
 * is capped to a money field's width.
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | const amountInput = `${input} max-w-[12rem]`; | const amountInput = input;
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |           label="What's wrong?" |           label="Reason"
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |         label="Your answer" |         label="Answer"
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |           onChange={(k, via) => { if (via === "click") hapticLight(); setReason(k as RefundReason); }} |           onChange={() => undefined}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RefundRequestView } from "@/lib/declutter/refundRequests";

const state = vi.hoisted(() => ({
  view: null as unknown,
  asked: [] as unknown[][],
  answered: [] as unknown[][],
  offers: [] as unknown[][],
  returned: [] as unknown[][],
  withdrawn: [] as unknown[][],
  /** D2-7: whether declutter_ask_refund takes photos (problemPhotos.ts; off until it does), and what was uploaded. */
  refundPhotos: false,
  uploaded: [] as unknown[][],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// D2-11: who made the handover (declutter_my_handover); the card's handover row.
const handover = vi.hoisted(() => ({ row: { confirmed_by: "auto", picked_up_at: null } as { confirmed_by: string | null; picked_up_at: string | null } }));
vi.mock("@/lib/declutter/problemPhotos", () => ({
  PROBLEM_PHOTO_MAX: 3,
  PROBLEM_FORM_PHOTOS_READY: false,
  get REFUND_FORM_PHOTOS_READY() { return state.refundPhotos; },
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, ...handover.row }),
  uploadProblemPhoto: async (orderId: string, f: File) => { state.uploaded.push([orderId, f.name]); return `me/declutter/problem/${orderId}/${f.name}`; },
}));
vi.mock("@/lib/declutter/refundRequests", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/refundRequests")>();
  return {
    ...real,
    fetchRefundRequestView: async () => state.view,
    askRefund: async (...a: unknown[]) => { state.asked.push(a); return { result: "asked" }; },
    answerRefund: async (...a: unknown[]) => { state.answered.push(a); return { result: "offered" }; },
    answerRefundOffer: async (...a: unknown[]) => { state.offers.push(a); return { result: "refunded" }; },
    withdrawRefund: async (...a: unknown[]) => { state.withdrawn.push(a); return { result: "withdrawn" }; },
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
  handover.row = { confirmed_by: "auto", picked_up_at: null };
  state.asked = [];
  state.answered = [];
  state.offers = [];
  state.returned = [];
  state.withdrawn = [];
  state.uploaded = [];
});

// Audit 2026-10-30 DB-11: "Take it back" ended the refund request in one tap, with no word on what follows.
// @mutate src/components/declutter/DeclutterRefundRequest.tsx | disabled={withdraw.isPending} onClick={() => setConfirmWithdraw(true)}>Take it back</button> | disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>Take it back</button>
// @mutate src/components/declutter/DeclutterRefundRequest.tsx |             {`${cap(who)} is told, and is paid once the sale is final. You can't ask for a refund on this sale again.`} |             {""}
describe("DeclutterRefundPanel: taking a refund request back asks first (DB-11)", () => {
  it("Take it back opens a sheet that says what follows; Keep my request sends nothing; the sheet's button withdraws", async () => {
    show({ ...BASE, can_ask: false, request: REQ });
    fireEvent.click(await screen.findByRole("button", { name: "Take it back" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Take back your refund request?");
    expect(sheet).toHaveTextContent("Nikki is told, and is paid once the sale is final. You can't ask for a refund on this sale again.");
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep my request" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.withdrawn).toEqual([["r1"]]));
  });
});

// Audit 1028 part 2, D2-11: "Never got it" was offered after the buyer tapped "I got it".
// @mutate src/components/declutter/DeclutterRefundRequest.tsx |   const buyerHasIt = handover.data?.confirmed_by === "buyer" \|\| !!handover.data?.picked_up_at; |   const buyerHasIt = false;
describe("DeclutterRefundPanel: the reasons fit the handover (D2-11)", () => {
  const reasonLabels = () => screen.getAllByRole("radio").map((r) => r.textContent);
  it("after the buyer's I got it or pickup photo: no Never got it", async () => {
    for (const row of [{ confirmed_by: "buyer", picked_up_at: null }, { confirmed_by: "auto", picked_up_at: "2026-10-23T18:00:00Z" }]) {
      handover.row = row;
      const { unmount } = show(BASE);
      fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
      await waitFor(() => expect(reasonLabels()).toEqual(["Not as described", "Damaged"]));
      unmount();
    }
  });

  it("paid automatically, the buyer never said they had it: Never got it stays", async () => {
    show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    await screen.findAllByRole("radio");
    expect(reasonLabels()).toEqual(["Not as described", "Damaged", "Never got it"]);
  });
});

describe("DeclutterRefundPanel: the app's radio style and a money-sized amount box (D2-15)", () => {
  it("buyer: the reasons are one RadioCardList, no browser radios", async () => {
    show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    const group = screen.getByRole("radiogroup", { name: "What's wrong?" });
    expect(group.querySelectorAll("button[role=radio]").length).toBe(3);
    expect(document.querySelectorAll("input[type=radio]").length).toBe(0);
    const damaged = screen.getByRole("radio", { name: "Damaged" });
    fireEvent.click(damaged);
    expect(damaged.getAttribute("aria-checked")).toBe("true");
  });

  it("seller: full, part and no are one RadioCardList with their sub lines; the amount box is capped", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    const group = await screen.findByRole("radiogroup", { name: "Your answer" });
    expect([...group.querySelectorAll("button[role=radio]")].map((b) => b.querySelector("span.font-semibold")?.textContent)).toEqual([
      "Refund in full", "Offer part of it", "I don't agree",
    ]);
    expect(document.querySelectorAll("input[type=radio]").length).toBe(0);
    fireEvent.click(screen.getByRole("radio", { name: /Offer part of it/ }));
    const box = screen.getByLabelText(/How much back\?/);
    expect(box.className.split(/\s+/)).toContain("max-w-[12rem]");
  });
});

describe("DeclutterRefundPanel", () => {
  it("buyer: asks with the reason and words chosen, and sees the server's full-refund amount", async () => {
    show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    expect(screen.getByText(/A full refund is \$41\.20/)).toBeTruthy();
    // #5: why it is less than what was paid, in words, never a fee figure.
    const why = document.querySelector("[data-full-refund-why]")!;
    expect(why.textContent).toBe("That's all you paid, less the small part the card network kept for the payment, which it doesn't give back.");
    expect(why.textContent).not.toMatch(/\$|\d|fee/i);
    fireEvent.click(screen.getByRole("radio", { name: "Damaged" }));
    fireEvent.change(screen.getByLabelText("Tell them more"), { target: { value: "  The leg is cracked.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the seller" }));
    await waitFor(() => expect(state.asked).toEqual([["o1", "damaged", "The leg is cracked.", []]]));
  });

  // Audit 1b D2-7: up to 3 photos on the refund form, uploaded on Send and sent with the request; hidden until
  // declutter_ask_refund takes them (problemPhotosWaitForServer.test.ts).
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx | REFUND_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(v.order_id, photos) : [] | []
  it("D2-7: the refund form's photos are uploaded and sent with the request once the server takes them; hidden before", async () => {
    Object.assign(URL, { createObjectURL: () => "blob:p", revokeObjectURL: () => undefined });
    state.refundPhotos = false;
    const off = show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    expect(screen.queryByRole("group", { name: "Photos" })).toBeNull();
    off.unmount();
    state.refundPhotos = true;
    const { container } = show(BASE);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    const input = container.querySelector('[data-problem-photos] input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" }), new File(["x"], "b.jpg", { type: "image/jpeg" })] } });
    fireEvent.change(screen.getByLabelText("Tell them more"), { target: { value: "Cracked" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the seller" }));
    await waitFor(() => expect(state.asked).toEqual([["o1", "not_as_described", "Cracked", ["me/declutter/problem/o1/a.jpg", "me/declutter/problem/o1/b.jpg"]]]));
    expect(state.uploaded).toEqual([["o1", "a.jpg"], ["o1", "b.jpg"]]);
    state.refundPhotos = false;
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
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx |           onConfirm={() => back.mutate(undefined, { onSettled: () => setConfirmBack(false) })} |           onConfirm={() => setConfirmBack(false)}
  it("seller: a full refund agreed waits for the item; I got it back asks once, then sends it", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "I got it back" }));
    // Nothing is sent by the first tap: it only opens the confirm.
    expect(state.returned).toEqual([]);
    // #59: Declutter's one confirm style, the in-app sheet.
    expect(document.querySelector('[data-confirm-sheet="refund-item-back"]')).toHaveTextContent("It can't be undone.");
    fireEvent.click(await screen.findByRole("button", { name: "Yes, send the refund" }));
    await waitFor(() => expect(state.returned).toEqual([["r1"]]));
  });

  it("buyer: while the item goes back, the refund is promised on the seller's confirmation, with no button to press", async () => {
    show({ ...BASE, can_ask: false, request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z" } });
    expect(await screen.findByText(/Give the item back; message Nikki from your order\. Your refund is sent as soon as Nikki confirms they have it\./)).toBeTruthy();
    expect(document.querySelector("[data-full-refund-why]")?.textContent).toMatch(/^That's all you paid, less the small part the card network kept/);
    expect(screen.queryByRole("button", { name: "I got it back" })).toBeNull();
  });

  it("D2-5: a request Louisiana Helpr decided says who decided, on both sides", async () => {
    const decidedFor = { ...REQ, status: "declined" as const, declined_at: "2026-10-24T19:00:00Z", admin_decided: true };
    let u = show({ ...BASE, can_ask: false, can_report: false, request: decidedFor });
    expect(await screen.findByText("Louisiana Helpr decided: Nikki keeps the payment, and the sale is final.")).toBeTruthy();
    expect(screen.queryByText(/said no/)).toBeNull();
    expect(screen.queryByText(/is looking/)).toBeNull();
    u.unmount();
    u = show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: decidedFor });
    expect(await screen.findByText("Louisiana Helpr decided: you keep the payment, and the sale is final.")).toBeTruthy();
    expect(screen.queryByText(/You said no/)).toBeNull();
    u.unmount();
    const refunded = { ...REQ, status: "agreed" as const, refund_cents: 1330, refund_status: "pending" as const, admin_decided: true };
    u = show({ ...BASE, can_ask: false, can_report: false, request: refunded });
    expect((await screen.findByText(/Louisiana Helpr decided to refund the buyer\./)).textContent).toBe("Louisiana Helpr decided to refund the buyer. $13.30 is coming back to your card.");
    u.unmount();
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: refunded });
    expect((await screen.findByText(/Louisiana Helpr decided to refund the buyer\./)).textContent).toBe("Louisiana Helpr decided to refund the buyer. The buyer got $13.30 back.");
  });
});
