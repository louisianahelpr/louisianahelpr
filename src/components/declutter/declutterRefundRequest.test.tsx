/**
 * Board 141, Declutter side: the refund request panel on a handed-over order (migration 20261026155251).
 * The rules and every amount are proven in SQL by src/test/pglite/declutterRefundRequests.pglite.mjs; this
 * proves the panel shows the SERVER's amounts, starts the seller's offer EMPTY (owner 2026-10-21), sends
 * exactly what the member chose, and offers Report a problem only after the seller says no.
 *
 * Deep audit 2026-10-28 B-5 (#5): the full refund is less than the payment (the card network keeps its part); the buyer
 * is told why in words wherever that amount is shown, with no fee name or figure (membersSeeNoFeeWords scans the copy).
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | .{reason === "not_received" ? "" : <> <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span></>}{" "} | .{" "}
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | .{reason === "not_received" ? "" : <> <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span></>}{" "} | .{reason === "not_received" ? "" : <> <span data-full-refund-why="">{FULL_REFUND_WHY}</span></>}{" "}
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | const fullRefundWhy = (deliveryKeptCents: number) => (deliveryKeptCents > 0 ? FULL_REFUND_WHY_ITEM : FULL_REFUND_WHY); | const fullRefundWhy = (deliveryKeptCents: number) => (deliveryKeptCents > 0 ? FULL_REFUND_WHY : FULL_REFUND_WHY);
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | {cap(who)} agreed to refund you {refundDollars(v.full_refund_cents)}. <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span> | {cap(who)} agreed to refund you {refundDollars(v.full_refund_cents)}.
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | {cap(who)} agreed to refund you {refundDollars(v.full_refund_cents)}. <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span> | {cap(who)} agreed to refund you {refundDollars(v.full_refund_cents)}. <span data-full-refund-why="">{FULL_REFUND_WHY}</span>
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |   const [amount, setAmount] = useState(""); |   const [amount, setAmount] = useState("10");
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       return answerRefund(r?.id ?? "", choice ?? "decline", choice === "part" ? offerCents : null); |       return answerRefund(r?.id ?? "", choice ?? "decline", offerCents);
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |           {v.can_report && problemForm} |           {problemForm}
 * D2-5 (audit 1b #5): a request Louisiana Helpr decided says so on both sides, never "is looking" or "said no".
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       if (r.admin_decided) return <p | if (false) return <p
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |   if (r.status === "declined" && r.admin_decided) return | if (false) return
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       {r.admin_decided && "Louisiana Helpr decided to refund the buyer. "} |
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       <button type="button" className={primary} disabled={send.isPending \|\| !choice \|\| (choice === "part" && offerCents === null) \|\| (choice === "full" && !neverGotIt && !pickArgs)} onClick={() => setAskingSend(true)}> |       <button type="button" className={primary} disabled={send.isPending} onClick={() => setAskingSend(true)}>
 *
 * Audit 1028 part 2, D2-15: both pick-one lists are the app's RadioCardList (no browser radios), and the amount box
 * is capped to a money field's width.
 * BUY-27: the seller answers with the buyer's photos in front of them; the form uploaded them and nothing showed them.
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |       <ProblemPhotos paths={r.photo_paths ?? []} />\n |
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
  accepted: [] as unknown[][],
}));
vi.mock("@/lib/declutter/refundReturns", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/refundReturns")>();
  return { ...real, acceptRefundWithReturn: async (...a: unknown[]) => { state.accepted.push(a); return { result: "returning" }; } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// D2-11: who made the handover (declutter_my_handover); the card's handover row.
const handover = vi.hoisted(() => ({ row: { confirmed_by: "auto", picked_up_at: null } as { confirmed_by: string | null; picked_up_at: string | null } }));
vi.mock("@/lib/declutter/problemPhotos", () => ({
  PROBLEM_PHOTO_MAX: 3,
  PROBLEM_FORM_PHOTOS_READY: false,
  get REFUND_FORM_PHOTOS_READY() { return state.refundPhotos; },
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, ...handover.row }),
  handoverPhotoUrl: async (p: string) => `https://signed.example/${p}`,
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

function show(view: RefundRequestView, who = "Nikki") {
  state.view = view;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterRefundPanel orderId="o1" who={who} problemForm={<p>PROBLEM FORM</p>} />
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
  state.accepted = [];
});

// Audit 2026-10-30 DB-11: "Take it back" ended the refund request in one tap, with no word on what follows.
// @mutate src/components/declutter/DeclutterRefundRequest.tsx | disabled={withdraw.isPending} onClick={() => setConfirmWithdraw(true)}>Take it back</button> | disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>Take it back</button>
// @mutate src/components/declutter/DeclutterRefundRequest.tsx |             {`${cap(who)} is told, and is paid once the sale is final. You can't ask for a refund on this sale again.`} |             {""}
async function sendAnswer() {
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole("button", { name: "Send answer" }));
}

describe("the seller's answer shows the buyer's photos", () => {
  it("each photo is a signed link beside the buyer's words", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, photo_paths: ["b/declutter/problem/o1/a.jpg", "b/declutter/problem/o1/b.jpg"] } });
    expect(await screen.findByAltText("Problem photo 1")).toHaveAttribute("src", "https://signed.example/b/declutter/problem/o1/a.jpg");
    expect(await screen.findByAltText("Problem photo 2")).toHaveAttribute("src", "https://signed.example/b/declutter/problem/o1/b.jpg");
  });
});

// BUY-10 (buying audit 10-30 #10): Take $X and Ask Louisiana Helpr to decide were one tap and final.
// @mutate src/components/declutter/DeclutterRefundRequest.tsx | disabled={offer.isPending} onClick={() => setAnswering("take")}> | disabled={offer.isPending} onClick={() => offer.mutate(true)}>
// @mutate src/components/declutter/DeclutterRefundRequest.tsx | disabled={offer.isPending} onClick={() => setAnswering("ask")}> | disabled={offer.isPending} onClick={() => offer.mutate(false)}>
// @mutate src/components/declutter/DeclutterRefundRequest.tsx |             onConfirm={() => offer.mutate(answering === "take", { onSettled: () => setAnswering(null) })} |             onConfirm={() => offer.mutate(true, { onSettled: () => setAnswering(null) })}
describe("DeclutterRefundPanel: answering a part refund asks first (BUY-10)", () => {
  const OFFERED = { ...REQ, status: "offered" as const, offer_cents: 1500, offer_answer_by: "2026-10-25T18:00:00Z" };
  it("Take $15 opens a sheet saying what ends; Not now sends nothing; the sheet's button takes it", async () => {
    show({ ...BASE, can_ask: false, request: OFFERED });
    fireEvent.click(await screen.findByRole("button", { name: "Take $15" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Take $15 back?");
    expect(sheet).toHaveTextContent("$15 comes back to your card and you keep the item. This ends your refund request.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.offers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Take $15" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take $15" }));
    await waitFor(() => expect(state.offers).toEqual([["r1", true]]));
  });

  it("Ask Louisiana Helpr to decide says the offer ends, and sends a no only from the sheet", async () => {
    show({ ...BASE, can_ask: false, request: OFFERED });
    fireEvent.click(await screen.findByRole("button", { name: "Ask Louisiana Helpr to decide" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Nikki's offer of $15 ends, and Louisiana Helpr decides what, if anything, comes back to you.");
    expect(state.offers).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Ask Louisiana Helpr" }));
    await waitFor(() => expect(state.offers).toEqual([["r1", false]]));
  });
});

describe("DeclutterRefundPanel: taking a refund request back asks first (DB-11)", () => {
  it("Take it back opens a sheet that says what follows; Keep my request sends nothing; the sheet's button withdraws", async () => {
    show({ ...BASE, can_ask: false, request: REQ });
    fireEvent.click(await screen.findByRole("button", { name: "Take it back" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Take back your refund request?");
    expect(sheet).toHaveTextContent("Nikki is told, and is paid once the sale is final. You can't ask for a refund on this sale again.");
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep my request" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("seller: nothing is picked at the start, and Send answer waits for a choice (BUY-26)", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    await screen.findByText("Offer part of it");
    expect((screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("I'll pick it up")).toBeNull();
  });

  it("seller: never got it: no way back to pick, the sheet says the money goes now, and it goes (BUY-25)", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, reason: "not_received" } });
    fireEvent.click(await screen.findByText("Refund in full"));
    expect(screen.queryByText("I'll pick it up")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toMatch(/\$41\.20 back to .* now, and you get no payout/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(state.answered).toEqual([["r1", "full", null]]));
    expect(state.accepted).toEqual([]);
  });

  it("seller: a sale with no pickup offered has only I'll pick it up (BUY-23)", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, can_drop_off: false, request: REQ });
    fireEvent.click(await screen.findByText("Refund in full"));
    expect(screen.getByText("I'll pick it up")).toBeTruthy();
    expect(screen.queryByText(/brings it back/)).toBeNull();
  });

  it("buyer: an open drop-off names the address (BUY-23)", async () => {
    show({ ...BASE, request: { ...REQ, status: "returning", return_way: "drop_off", return_day: "2030-01-02", drop_off_address: "12 Home Street, Lafayette" } });
    expect((await screen.findByText("12 Home Street, Lafayette")).closest("[data-return-drop-address]")).toBeTruthy();
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
    await sendAnswer();
    await waitFor(() => expect(state.answered).toEqual([["r1", "part", 1250]]));
  });

  it("seller: Refund in full sends no amount (the server decides it), even after typing an offer", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    fireEvent.click(await screen.findByText("Offer part of it"));
    fireEvent.change(screen.getByLabelText(/How much back\?/), { target: { value: "12.50" } });
    fireEvent.click(screen.getByText("Refund in full"));
    await sendAnswer();
    // Declutter returns (20261030071818): the full answer and the way back go in ONE call, with no amount.
    await waitFor(() => expect(state.accepted).toHaveLength(1));
    expect(state.accepted[0]).toEqual(["r1", "drop_off", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), null]);
    expect(state.answered).toEqual([]);
  });

  it("seller: I don't agree sends no amount, even after typing an offer", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    fireEvent.click(await screen.findByText("Offer part of it"));
    fireEvent.change(screen.getByLabelText(/How much back\?/), { target: { value: "12.50" } });
    fireEvent.click(screen.getByText("I don't agree"));
    await sendAnswer();
    await waitFor(() => expect(state.answered).toEqual([["r1", "decline", null]]));
    expect(state.accepted).toEqual([]);
  });

  it("seller: Refund in full with I'll pick it up sends the time, and needs one first", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: REQ });
    fireEvent.click(await screen.findByText("Refund in full"));
    fireEvent.click(await screen.findByText("I'll pick it up"));
    expect(screen.getByRole("button", { name: "Send answer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/When will you come\?/), { target: { value: "2030-01-02T15:00" } });
    await sendAnswer();
    await waitFor(() => expect(state.accepted).toEqual([["r1", "collect", null, new Date("2030-01-02T15:00").toISOString()]]));
  });

  // Audit BUY-32: "Bring the item back to The seller's pickup address".
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx | <DeclutterReturnBuyer v={v} who={who} /> | <DeclutterReturnBuyer v={v} who={who.toUpperCase()} />
  // @mutate src/components/declutter/DeclutterRefundRequest.tsx | <DeclutterReturnSellerInfo v={v} who={who} /> | <DeclutterReturnSellerInfo v={v} who={who.toUpperCase()} />
  // @mutate src/components/declutter/DeclutterRefundReturn.tsx | <p className="text-sm">{cap(who)} will come for it | <p className="text-sm">{who} will come for it
  // @mutate src/components/declutter/DeclutterRefundReturn.tsx | data-return-drop-off="">{cap(who)} brings it to | data-return-drop-off="">{who} brings it to
  describe("BUY-32: the other person's name is capitalised only at the start of a sentence", () => {
    const back = { status: "returning" as const, return_by: "2026-10-26T18:00:00Z" };
    it("buyer, a drop-off: mid-sentence stays lower case", async () => {
      const { container } = show({ ...BASE, can_ask: false, request: { ...REQ, ...back, return_way: "drop_off" } }, "the seller");
      await screen.findByRole("button", { name: "Take your drop-off photo" });
      expect(container.querySelector("[data-return-drop-off] p")?.textContent).toMatch(/^Bring the item back to the seller's pickup address/);
    });
    it("buyer, a collect: a sentence's first word is capitalised", async () => {
      show({ ...BASE, can_ask: false, request: { ...REQ, ...back, return_way: "collect" } }, "the seller");
      expect(await screen.findByText(/^The seller will come for it/)).toBeTruthy();
    });
    it("seller, a collect with no address yet: mid-sentence stays lower case", async () => {
      show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, ...back, return_way: "collect" } }, "the buyer");
      expect(await screen.findByText("Waiting for the buyer to add the address.")).toBeTruthy();
    });
    it("seller, a drop-off: a sentence's first word is capitalised", async () => {
      const { container } = show({ ...BASE, side: "seller", can_ask: false, can_report: false, request: { ...REQ, ...back, return_way: "drop_off" } }, "the buyer");
      await screen.findByRole("button", { name: "I got it back" });
      expect(container.querySelector("[data-return-drop-off]")?.textContent).toMatch(/^The buyer brings it to your pickup address/);
    });
  });

  it("seller: a collect shows the buyer's address with directions while it is coming back", async () => {
    show({ ...BASE, side: "seller", can_ask: false, can_report: false,
      request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z", return_way: "collect", return_at: "2026-10-25T20:00:00Z",
        return_address: "77 Return Rd", return_lat: 30.46, return_lng: -91.16 } });
    expect(await screen.findByText("77 Return Rd")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toMatch(/^https:\/\/maps\.apple\.com\/\?ll=30\.46,-91\.16/);
  });

  it("buyer: takes the seller's offer", async () => {
    show({ ...BASE, can_ask: false, request: { ...REQ, status: "offered", offer_cents: 1250, offer_answer_by: "2026-10-25T18:00:00Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "Take $12.50" }));
    // BUY-10: it asks first.
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take $12.50" }));
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
    await waitFor(() => expect(state.returned).toEqual([["r1", null]]));
  });

  it("AUD31-37: on a Helpr-delivery order (the delivery stays paid) the form never says the refund is all you paid", async () => {
    show({ ...BASE, delivery_kept_cents: 1500 });
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a refund" }));
    fireEvent.click(screen.getByRole("radio", { name: "Damaged" }));
    expect(screen.getByText(/the delivery stays paid: the Helpr made the trip/)).toBeTruthy();
    const why = document.querySelector("[data-full-refund-why]")!;
    expect(why.textContent).toBe("That's what you paid for the item, less the small part the card network kept for the payment, which it doesn't give back.");
    expect(why.textContent).not.toMatch(/\$|\d|fee/i);
  });

  it("AUD31-37: the item going back on a Helpr-delivery order says the same", async () => {
    show({ ...BASE, delivery_kept_cents: 1500, can_ask: false, request: { ...REQ, status: "returning", return_by: "2026-10-26T18:00:00Z" } });
    await screen.findByText(/Your refund is sent as soon as Nikki confirms they have it\./);
    expect(document.querySelector("[data-full-refund-why]")?.textContent).toMatch(/^That's what you paid for the item, less the small part/);
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
