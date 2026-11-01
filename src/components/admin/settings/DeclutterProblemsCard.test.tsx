/**
 * The admin "Declutter problems" card (slice 4, B54) with slice 5's delivery
 * decision: an item reported damaged or not received gets "Damaged in
 * delivery" (row 43; declutter_admin_decide_delivery_damage), because the
 * ordinary "Refund the buyer" pays the Helpr for the trip (B69) and the server
 * refuses it there (lh-money-escrow review #1, 2026-10-16). The server rules
 * are proven in src/test/pglite/declutterDelivery.pglite.mjs.
 *
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {row.reporter_side === "helpr" && (row.photo_paths ?? []).map((p) => <HelprPhoto key={p} path={p} />)} |
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const deliveryReason = (row.reason === "damaged" \|\| row.reason === "not_received") && row.detail?.helpr_delivery !== false; |   const deliveryReason = false;
 *
 * A2-13 (audit2 SH2-4, 2026-10-28): the card showed only "Order d07a84de" and
 * the note. With declutter_admin_open_problems it shows the item, what was
 * paid, both names and the handover photos with time and place, and offers
 * "Damaged in delivery" only on an order a Helpr carries.
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {row.detail ? <ProblemDetail d={row.detail} /> : null} |
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |  && row.detail?.helpr_delivery !== false; | ;
 * @mutate src/components/admin/settings/DeclutterProblemCase.tsx |   if (d.picked_up_photo_path) { |   if (false) {
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |     mutationFn: () => adminDecideDeliveryDamage(row.id, note.trim() \|\| null), |     mutationFn: () => adminDecideProblem(row.id, "refund_buyer", "none", false, null),
 *
 * AL-6 (owner 2026-10-28, "Chats saved and filtered"): the card shows the buyer and seller's whole handover chat
 * and the questions on the items (declutter_admin_problem_talk), each line as a side, never a name.
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       <ProblemTalk problemId={row.id} /> |
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |   const chat = talk.data.filter((r) => r.kind === "chat"); |   const chat = talk.data.filter((r) => r.kind === "chat").slice(-1);
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx | {q.removed ? " · hidden in the app" : ""} | {""}
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx | {SIDE[m.side]} · {when(m.said_at)} | {when(m.said_at)}
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |  onRetry={() => void talk.refetch()} /> |  />
 *
 * AL-4 (owner 2026-10-28, "One dispute screen for admin"): the order's steps (OrderSteps, from the order's own rows
 * via declutter_admin_problem_case) and both sides' handover photos side by side with their times and places, the
 * Helpr's pickup and drop-off photos included, above the decide buttons.
 * @mutate src/components/admin/settings/DeclutterProblemCase.tsx |   if (c?.helpr_dropoff_photo_path) { |   if (false) {
 * @mutate src/components/admin/settings/DeclutterProblemCase.tsx |   if (c?.helpr_pickup_photo_path) { |   if (false) {
 * @mutate src/components/admin/settings/DeclutterProblemCase.tsx |       place: metres(c.helpr_dropoff_distance_m, "drop-off address"), helpr: true }); |       place: null, helpr: true });
 * @mutate src/components/admin/settings/DeclutterProblemCase.tsx |             slotStart: c.slot_start ?? c.pickup_day, |             slotStart: null,
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {row.detail ? <ProblemCaseView problemId={row.id} d={row.detail} /> : null} |
 *
 * D2-14 (owner 2026-10-29: allow partial): after the handover the admin can refund PART of the price, pre-filled with the
 * seller's last part offer, never more than the item price; before the handover it is not offered. D2-3: the reporter's
 * photos and the other side's words and photos are on the card.
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const [part, setPart] = useState(offer ? (offer / 100).toFixed(2) : ""); |   const [part, setPart] = useState("");
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const partOk = partCents !== null && itemsCents !== null && partCents < itemsCents; |   const partOk = partCents !== null;
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const canPart = row.detail?.order_status === "handed_over"; |   const canPart = true;
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx | adminDecideProblem(...args, partCents) : | adminDecideProblem(...args, null) :
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {row.detail?.other_side_note ? ( |       {false ? (
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { asked: [] as unknown[], rows: [] as unknown[], calls: [] as unknown[][], talk: [] as unknown[] | null, talkError: false, talkAsked: 0, kase: null as unknown };

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/helprTasks/photoUrl", () => ({ taskPhotoUrl: async (p: string) => `https://signed.test/${p}` }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchOpenProblemsWithDetail: async (includeTest?: boolean) => { state.asked.push(includeTest); return state.rows; },
  handoverPhotoUrl: async (p: string) => `https://signed.test/${p}`,
  adminDecideProblem: async (...a: unknown[]) => { state.calls.push(["decide", ...a]); return {}; },
  adminDecideDeliveryDamage: async (...a: unknown[]) => { state.calls.push(["damage", ...a]); return {}; },
  adminDecideStuckDelivery: async (...a: unknown[]) => { state.calls.push(["stuck", ...a]); return {}; },
}));

vi.mock("@/lib/declutter/adminProblemCase", () => ({
  fetchProblemTalk: async () => { state.talkAsked += 1; if (state.talkError) throw new Error("not_admin"); return state.talk; },
  fetchProblemCase: async () => state.kase,
}));

import { DeclutterProblemsCard } from "./DeclutterProblemsCard";

const row = (reason: string, reporter_side = "buyer", photo_paths: string[] = [], detail: Record<string, unknown> | null = null) => ({
  id: "p1", order_id: "o1234567-0000", reporter_side, reason, note: "The leg is broken.", photo_paths, created_at: "2026-10-16T12:00:00Z", detail,
});
const detail = (over: Record<string, unknown> = {}) => ({
  handover: "porch", items_cents: 3200, bundle_discount_cents: 0, delivery_cents: 0, premium_cents: 480, tax_cents: 0, total_cents: 3680,
  paid_at: "2026-10-15T12:00:00Z", item_titles: ["Oak side table", "Lamp"], item_photo_paths: ["s1/declutter/i1/a.jpg"],
  buyer_name: "Hallie B", seller_name: "Sam S",
  set_out_photo_path: "s1/declutter/handover/o1/out.jpg", set_out_at: "2026-10-16T09:00:00Z",
  picked_up_photo_path: "b1/declutter/handover/o1/got.jpg", picked_up_at: "2026-10-16T10:00:00Z", picked_up_distance_m: 12,
  confirmed_at: null, confirmed_by: null, helpr_delivery: false, ...over,
});

function show(includeTest?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemsCard includeTest={includeTest} /></QueryClientProvider>);
}

beforeEach(() => {
  state.asked = [];
  state.rows = [];
  state.calls = [];
  state.talk = [];
  state.talkError = false;
  state.talkAsked = 0;
  state.kase = null;
});

// Audit 1028 part 2, D2-4: with "Show test listings" on, the card asks the server for test accounts' problems too.
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |     queryFn: () => fetchOpenProblemsWithDetail(includeTest), |     queryFn: () => fetchOpenProblemsWithDetail(),
describe("DeclutterProblemsCard: test accounts' problems (D2-4)", () => {
  it("off by default; on, the read asks for them and the card says so", async () => {
    const off = show();
    expect(await screen.findByText("No open problems.")).toBeTruthy();
    expect(state.asked).toEqual([false]);
    off.unmount();
    show(true);
    expect(await screen.findByText(/test accounts' included/)).toBeTruthy();
    await waitFor(() => expect(state.asked).toEqual([false, true]));
  });
});

describe("DeclutterProblemsCard: the delivery decision", () => {
  it("a damaged item offers \"Damaged in delivery\", which sends the damage decision with the note", async () => {
    state.rows = [row("damaged")];
    show();
    fireEvent.change(await screen.findByLabelText("Note (both sides see it)"), { target: { value: "Broken in the truck." } });
    fireEvent.click(screen.getByRole("button", { name: "Damaged in delivery" }));
    await waitFor(() => expect(state.calls).toEqual([["damage", "p1", "Broken in the truck."]]));
  });

  it("so does an item not received", async () => {
    state.rows = [row("not_received")];
    show();
    expect(await screen.findByRole("button", { name: "Damaged in delivery" })).toBeInTheDocument();
  });

  it("other reasons do not, and the Helpr's \"seller wasn't there\" report says who reported it", async () => {
    state.rows = [row("no_show", "helpr", ["h1/task/t1/away.jpg"])];
    show();
    expect(await screen.findByText(/Someone didn't show · reported by the Helpr/)).toBeInTheDocument();
    // The evidence the report needs is shown to the admin (lh-silent-failure re-review #1).
    expect(await screen.findByAltText("The Helpr's photo at the pickup address")).toHaveAttribute("src", "https://signed.test/h1/task/t1/away.jpg");
    expect(screen.queryByRole("button", { name: "Damaged in delivery" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refund the buyer" }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("decide"));
  });
});

describe("DeclutterProblemsCard: what the admin decides from (A2-13)", () => {
  it("shows the item, what was paid, both names and both handover photos with their time and place", async () => {
    state.rows = [row("not_as_described", "buyer", [], detail())];
    show();
    expect(await screen.findByText("Oak side table and 1 more")).toBeInTheDocument();
    expect(screen.getByText(/Paid \$36\.80/)).toBeInTheDocument();
    expect(screen.getByText(/items \$32(\.00)?, buyer fee \$4\.80/)).toBeInTheDocument();
    expect(screen.getByText("Buyer: Hallie B. Seller: Sam S.")).toBeInTheDocument();
    expect(await screen.findByAltText("Seller set it out")).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o1/out.jpg");
    expect(await screen.findByAltText("Buyer picked it up")).toHaveAttribute("src", "https://signed.test/b1/declutter/handover/o1/got.jpg");
    expect(screen.getByText("12 m from the pickup address")).toBeInTheDocument();
  });

  it("a damaged item on an order no Helpr carries does not offer \"Damaged in delivery\"", async () => {
    state.rows = [row("damaged", "buyer", [], detail({ helpr_delivery: false }))];
    show();
    await screen.findByText("Oak side table and 1 more");
    expect(screen.queryByRole("button", { name: "Damaged in delivery" })).toBeNull();
  });

  it("on a Helpr delivery it does", async () => {
    state.rows = [row("damaged", "buyer", [], detail({ helpr_delivery: true }))];
    show();
    expect(await screen.findByRole("button", { name: "Damaged in delivery" })).toBeInTheDocument();
  });
});

// AL-5 (20261029000048): a strike for a proven false report, as its own explicit question.
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx | falseOn ? false : strike, note.trim() \|\| null, falseOn] as const; | falseOn ? false : strike, note.trim() \|\| null, false] as const;
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       const args = [row.id, decision, falseOn ? (reporter as "buyer" \| "seller") : fault, |       const args = [row.id, decision, fault,
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |  disabled={decide.isPending \|\| (falseOn && againstReporter !== "refund_buyer")}>Refund the buyer</Button> |  disabled={decide.isPending}>Refund the buyer</Button>
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {reporter ? (\n        <fieldset className="space-y-1"> |       {false ? (\n        <fieldset className="space-y-1">
describe("DeclutterProblemsCard: a false report (AL-5)", () => {
  it("a buyer's false report: the fault is the buyer's, only \"Pay the seller\" is left, and the call says false_report", async () => {
    state.rows = [row("not_received", "buyer", [], detail())];
    show();
    fireEvent.click(await screen.findByLabelText(/No, it was false: the buyer gets a strike for a false report/));
    expect(screen.getByLabelText("Whose fault?")).toHaveValue("buyer");
    expect(screen.getByLabelText("Whose fault?")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Give the at-fault side a strike" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refund the buyer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Damaged in delivery" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pay the seller" }));
    await waitFor(() => expect(state.calls).toEqual([["decide", "p1", "pay_seller", "buyer", false, null, true]]));
  });

  it("a seller's false report leaves only \"Refund the buyer\", with the seller at fault", async () => {
    state.rows = [row("no_show", "seller", [], detail())];
    show();
    fireEvent.click(await screen.findByLabelText(/No, it was false: the seller gets a strike/));
    expect(screen.getByRole("button", { name: "Pay the seller" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refund the buyer" }));
    await waitFor(() => expect(state.calls).toEqual([["decide", "p1", "refund_buyer", "seller", false, null, true]]));
  });

  it("by default the report is not called false, and a Helpr's report never offers it", async () => {
    state.rows = [row("not_as_described", "buyer", [], detail())];
    const v = show();
    fireEvent.click(await screen.findByRole("button", { name: "Pay the seller" }));
    await waitFor(() => expect(state.calls).toEqual([["decide", "p1", "pay_seller", "none", false, null, false]]));
    v.unmount();
    state.rows = [row("no_show", "helpr")];
    show();
    await screen.findByText(/reported by the Helpr/);
    expect(screen.queryByText("Was the report true?")).toBeNull();
  });
});

describe("DeclutterProblemsCard: the chat and the questions (AL-6)", () => {
  const talkRows = [
    { kind: "question", side: "buyer", body: "Does the lamp work?", said_at: "2026-10-14T09:00:00Z", answer: "Yes, new bulb.", answered_at: "2026-10-14T10:00:00Z", removed: false },
    { kind: "question", side: "another_member", body: "Is it heavy?", said_at: "2026-10-14T11:00:00Z", answer: null, answered_at: null, removed: true },
    { kind: "chat", side: "buyer", body: "No spot near me. Porch?", said_at: "2026-10-15T09:00:00Z", answer: null, answered_at: null, removed: false },
    { kind: "chat", side: "seller", body: "Sure, Saturday morning.", said_at: "2026-10-15T09:30:00Z", answer: null, answered_at: null, removed: false },
  ];

  it("shows the whole chat as Buyer and Seller, and every question with its answer, a hidden one marked", async () => {
    state.talk = talkRows;
    state.rows = [row("not_received", "buyer", [], detail())];
    show();
    const chat = await screen.findByRole("list", { name: "Handover chat" });
    expect(chat.textContent).toMatch(/^Buyer · .*No spot near me\. Porch\?Seller · .*Sure, Saturday morning\.$/);
    const qs = screen.getByRole("list", { name: "Questions on the items" });
    expect(qs.textContent).toContain("Question from buyer");
    expect(qs.textContent).toContain("Seller's answer");
    expect(qs.textContent).toContain("Yes, new bulb.");
    expect(qs.textContent).toMatch(/Question from another member · .* · hidden in the app/);
    // Sides only: the names on the card come from the order line above, never from the chat.
    expect(chat.textContent).not.toMatch(/Hallie|Sam/);
  });

  // D2-1 leftover (20261030042545): the chat the two sides had after paying, as its own list, sides only.
  // @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |   const orderChat = talk.data.filter((r) => r.kind === "order_chat"); |   const orderChat = talk.data.filter((r) => r.kind === "chat");
  // @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |       {orderChat.length > 0 && ( |       {false && (
  it("shows the chat after payment as its own list, Buyer and Seller", async () => {
    state.talk = [
      ...talkRows,
      { kind: "order_chat", side: "buyer", body: "It arrived cracked.", said_at: "2026-10-17T09:00:00Z", answer: null, answered_at: null, removed: false },
      { kind: "order_chat", side: "seller", body: "Sorry, I can refund.", said_at: "2026-10-17T10:00:00Z", answer: null, answered_at: null, removed: false },
    ];
    state.rows = [row("damaged", "buyer", [], detail())];
    show();
    const after = await screen.findByRole("list", { name: "Chat after payment" });
    expect(after.textContent).toMatch(/^Buyer · .*It arrived cracked\.Seller · .*Sorry, I can refund\.$/);
    expect(screen.getByRole("list", { name: "Handover chat" }).textContent).not.toContain("cracked");
  });

  it("only a chat after payment: no 'No chat' line", async () => {
    state.talk = [{ kind: "order_chat", side: "buyer", body: "Hello?", said_at: "2026-10-17T09:00:00Z", answer: null, answered_at: null, removed: false }];
    state.rows = [row("damaged", "buyer", [], detail())];
    show();
    await screen.findByRole("list", { name: "Chat after payment" });
    expect(screen.queryByText("No chat and no questions on these items.")).toBeNull();
  });

  it("says so when there is no chat and no question", async () => {
    state.rows = [row("not_received", "buyer", [], detail())];
    show();
    expect(await screen.findByText("No chat and no questions on these items.")).toBeInTheDocument();
  });

  it("a failed read says so with Try again, which asks again", async () => {
    state.talkError = true;
    state.rows = [row("not_received", "buyer", [], detail())];
    show();
    const again = await screen.findByRole("button", { name: "Try again" });
    const before = state.talkAsked;
    state.talkError = false;
    fireEvent.click(again);
    await waitFor(() => expect(state.talkAsked).toBeGreaterThan(before));
  });
});

describe("DeclutterProblemsCard: one dispute screen (AL-4)", () => {
  const kase = (over: Record<string, unknown> = {}) => ({
    handover: "porch", order_status: "paid", slot_start: null, pickup_day: "2026-10-16", seller_delivery_status: null,
    seller_delivery_slot_start: null, seller_delivered_at: null, helpr_accepted_at: null, helpr_picked_up_at: null,
    helpr_pickup_photo_path: null, helpr_delivered_at: null, helpr_dropoff_photo_path: null, helpr_dropoff_distance_m: null, ...over,
  });

  // DB-8 (audit 2026-10-30): on a seller-delivered order the photo in the seller's column is the one at the buyer's door.
  // @mutate src/components/admin/settings/DeclutterProblemCase.tsx | const outLabel = c?.seller_delivery_status ? | const outLabel = false ?
  it("DB-8: a seller-delivered order's door photo is named as the delivery, not a porch set-out", async () => {
    state.kase = kase({ handover: "seller_delivery", seller_delivery_status: "booked", seller_delivered_at: "2026-10-16T15:20:00Z" });
    state.rows = [row("not_as_described", "buyer", [], detail({ picked_up_photo_path: null, picked_up_at: null }))];
    show();
    expect(await screen.findByAltText("Seller delivered it (photo at the buyer's address)")).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o1/out.jpg");
    expect(screen.queryByAltText("Seller set it out")).toBeNull();
  });

  it("draws the order's steps from its own rows: porch, day picked, on the porch, picked up", async () => {
    state.kase = kase();
    state.rows = [row("not_as_described", "buyer", [], detail({ set_out_photo_path: null, set_out_at: null, picked_up_photo_path: null, picked_up_at: null }))];
    const v = show();
    await screen.findByText("Oak side table and 1 more");
    await waitFor(() => expect(document.querySelector("[data-order-steps]")).not.toBeNull());
    let steps = document.querySelector("[data-order-steps]")!;
    expect(steps.getAttribute("data-order-steps")).toBe("porch");
    // A day is picked (the booking's porch day), nothing set out yet: "Time booked" is the current step.
    expect(steps.getAttribute("data-order-step")).toBe("1");
    v.unmount();
    // Set out, not yet picked up: "On the porch".
    state.rows = [row("not_as_described", "buyer", [], detail({ picked_up_photo_path: null, picked_up_at: null }))];
    show();
    await waitFor(() => expect(document.querySelector("[data-order-steps]")).not.toBeNull());
    steps = document.querySelector("[data-order-steps]")!;
    expect(steps.getAttribute("data-order-step")).toBe("2");
  });

  it("puts the seller's side next to the buyer's, with the Helpr's pickup and drop-off photos, times and the drop-off distance", async () => {
    state.kase = kase({ handover: "delivery", helpr_accepted_at: "2026-10-16T08:00:00Z", helpr_picked_up_at: "2026-10-16T09:30:00Z",
      helpr_pickup_photo_path: "h1/task/t1/pickup.jpg", helpr_delivered_at: "2026-10-16T11:00:00Z", helpr_dropoff_photo_path: "h1/task/t1/dropoff.jpg",
      helpr_dropoff_distance_m: 18 });
    state.rows = [row("damaged", "buyer", [], detail({ handover: "delivery", helpr_delivery: true, set_out_photo_path: null, picked_up_photo_path: null }))];
    show();
    const grid = await screen.findByLabelText("Handover photos, side by side");
    const [seller, buyer] = Array.from(grid.children) as HTMLElement[];
    expect(seller.textContent).toMatch(/^Seller's side/);
    expect(buyer.textContent).toMatch(/^Buyer's side/);
    expect(await within(seller).findByAltText("Helpr picked it up")).toHaveAttribute("src", "https://signed.test/h1/task/t1/pickup.jpg");
    expect(await within(buyer).findByAltText("Helpr dropped it off")).toHaveAttribute("src", "https://signed.test/h1/task/t1/dropoff.jpg");
    expect(within(buyer).getByText("18 m from the drop-off address")).toBeInTheDocument();
    expect(seller.textContent).toContain(new Date("2026-10-16T09:30:00Z").toLocaleString());
    // The decide buttons stay on the same card.
    expect(screen.getByRole("button", { name: "Damaged in delivery" })).toBeInTheDocument();
  });

  it("D2-14: after the handover, a part refund pre-filled with the seller's offer sends exactly that many cents; never at or above the item price", async () => {
    state.rows = [row("not_as_described", "buyer", [], detail({ order_status: "handed_over", refund_offer_cents: 500 }))];
    show();
    const box = await screen.findByLabelText("Or refund part of the price (the buyer keeps the item)");
    expect((box as HTMLInputElement).value).toBe("5.00");
    expect(screen.getByText(/^The seller offered \$5(\.00)?\.$/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "32" } });
    expect(screen.getByRole("button", { name: "Refund part" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "7.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund part" }));
    await waitFor(() => expect(state.calls).toEqual([["decide", "p1", "refund_part", "none", false, null, false, 725]]));
  });

  it("D2-14: before the handover there is no part refund", async () => {
    state.rows = [row("not_as_described", "buyer", [], detail({ order_status: "paid" }))];
    show();
    await screen.findByRole("button", { name: "Refund the buyer" });
    expect(document.querySelector("[data-admin-part-refund]")).toBeNull();
  });

  it("D2-3: the buyer's photos and the seller's side, with its photos, are on the card", async () => {
    state.rows = [row("damaged", "buyer", ["b1/declutter/problem/o1/a.jpg"], detail({ order_status: "handed_over",
      other_side_note: "It left here in one piece.", other_side_photo_paths: ["s1/declutter/problem/o1/b.jpg"] }))];
    show();
    expect(await screen.findByAltText("The buyer's photo")).toHaveAttribute("src", "https://signed.test/b1/declutter/problem/o1/a.jpg");
    expect(screen.getByText(/The seller's side:/).closest("p")?.textContent).toBe("The seller's side: It left here in one piece.");
    expect(await screen.findByAltText("The other side's photo")).toHaveAttribute("src", "https://signed.test/s1/declutter/problem/o1/b.jpg");
  });
});

// LEAD-ADMIN-HELPR-FAULT (owner rule 10-30 "Helpr's fault, Helpr bears it"; 20261101000817): a disputed "the Helpr
// didn't come" can be decided as the Helpr's fault, on a Helpr delivery only, and only as a full refund.
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |         {helprNeverPickedUp ? <option value="helpr">The Helpr's</option> : null} |
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx | disabled={decide.isPending \|\| helprFault \|\| (falseOn | disabled={decide.isPending \|\| (falseOn
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |         {helprNeverPickedUp ? <option value="helpr">The Helpr's</option> : null} |         <option value="helpr">The Helpr's</option>
describe("DeclutterProblemsCard: the Helpr's fault (LEAD-ADMIN-HELPR-FAULT)", () => {
  it("on a Helpr delivery: the Helpr's fault refunds the buyer in full, with a strike; Pay the seller is off", async () => {
    state.rows = [row("other", "buyer", [], detail({ helpr_delivery: true }))];
    show();
    const fault = await screen.findByLabelText("Whose fault?");
    expect([...(fault as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Nobody's", "The seller's", "The buyer's", "The Helpr's"]);
    fireEvent.change(fault, { target: { value: "helpr" } });
    expect(screen.getByRole("button", { name: "Pay the seller" })).toBeDisabled();
    expect(screen.getByText(/The Helpr's fault \(they took it and never picked it up\) = the whole payment back, delivery included/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Give the at-fault side a strike" }));
    fireEvent.click(screen.getByRole("button", { name: "Refund the buyer" }));
    await waitFor(() => expect(state.calls).toEqual([["decide", "p1", "refund_buyer", "helpr", true, null, false]]));
  });

  it("not on a sale no Helpr carries", async () => {
    state.rows = [row("other", "buyer", [], detail({ helpr_delivery: false }))];
    show();
    const fault = await screen.findByLabelText("Whose fault?");
    expect([...(fault as HTMLSelectElement).options].map((o) => o.value)).toEqual(["none", "seller", "buyer"]);
  });
});

// B42 (BUY-36 screen check, 375 and 1440, mocked data): every Helpr delivery offered both "The Helpr's" fault (a Helpr
// who never picked it up) and the can't-finish buttons (a Helpr who has it), and the server refuses each outside its
// own moment. The order's steps (declutter_admin_problem_case, the read the card already makes) now pick the one that fits.
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const helprNeverPickedUp = helprDelivery && (steps ? !!steps.helpr_accepted_at && !steps.helpr_picked_up_at : true); |   const helprNeverPickedUp = helprDelivery;
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const helprHasIt = helprDelivery && (steps ? !!steps.helpr_picked_up_at && !steps.helpr_delivered_at : true); |   const helprHasIt = helprDelivery;
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx | <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" | <input type="checkbox"
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const steps = kase.data ?? null; |   const steps = null as typeof kase.data \| null;
describe("DeclutterProblemsCard: which Helpr decision fits (B42)", () => {
  const kase = (over: Record<string, unknown>) => ({
    handover: "delivery", order_status: "paid", slot_start: null, pickup_day: null, seller_delivery_status: null, seller_delivery_slot_start: null,
    seller_delivered_at: null, helpr_accepted_at: "2026-10-16T08:00:00Z", helpr_picked_up_at: null, helpr_pickup_photo_path: null,
    helpr_delivered_at: null, helpr_dropoff_photo_path: null, helpr_dropoff_distance_m: null, ...over,
  });

  it("the Helpr took it and never picked it up: \"The Helpr's\" fault, no can't-finish buttons", async () => {
    state.kase = kase({});
    state.rows = [row("no_show", "seller", [], detail({ helpr_delivery: true }))];
    show();
    const fault = await screen.findByLabelText("Whose fault?");
    await waitFor(() => expect([...(fault as HTMLSelectElement).options].map((o) => o.value)).toEqual(["none", "seller", "buyer", "helpr"]));
    expect(document.querySelector("[data-admin-stuck-delivery]")).toBeNull();
  });

  it("the Helpr has it: the can't-finish buttons, not \"The Helpr's\" fault, and the Helpr's fault is sent", async () => {
    state.kase = kase({ helpr_picked_up_at: "2026-10-16T10:00:00Z" });
    state.rows = [row("damaged", "helpr", [], detail({ helpr_delivery: true }))];
    show();
    const fault = await screen.findByLabelText("Whose fault?");
    await waitFor(() => expect([...(fault as HTMLSelectElement).options].map((o) => o.value)).toEqual(["none", "seller", "buyer"]));
    const stuck = document.querySelector("[data-admin-stuck-delivery]") as HTMLElement;
    expect(stuck).not.toBeNull();
    fireEvent.click(within(stuck).getByRole("button", { name: "The Helpr's fault" }));
    await waitFor(() => expect(state.calls).toEqual([["stuck", "p1", "helpr", null]]));
  });

  it("delivered: neither", async () => {
    state.kase = kase({ helpr_picked_up_at: "2026-10-16T10:00:00Z", helpr_delivered_at: "2026-10-16T11:00:00Z" });
    state.rows = [row("damaged", "buyer", [], detail({ helpr_delivery: true }))];
    show();
    const fault = await screen.findByLabelText("Whose fault?");
    await waitFor(() => expect([...(fault as HTMLSelectElement).options].map((o) => o.value)).toEqual(["none", "seller", "buyer"]));
    expect(document.querySelector("[data-admin-stuck-delivery]")).toBeNull();
  });

  it("the report radios and the strike box are drawn at their own size inside a 44px row", async () => {
    state.rows = [row("other", "buyer", [], detail({ helpr_delivery: true }))];
    show();
    const box = await screen.findByRole("checkbox", { name: "Give the at-fault side a strike" });
    for (const el of [box, ...screen.getAllByRole("radio")]) {
      expect(el.className).toMatch(/(^|\s)min-h-0(\s|$)/);
      expect(el.closest("label")?.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    }
  });
});
