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
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |     d.picked_up_photo_path && { | false && {
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |     mutationFn: () => adminDecideDeliveryDamage(row.id, note.trim() \|\| null), |     mutationFn: () => adminDecideProblem(row.id, "refund_buyer", "none", false, null),
 *
 * AL-6 (owner 2026-10-28, "Chats saved and filtered"): the card shows the buyer and seller's whole handover chat
 * and the questions on the items (declutter_admin_problem_talk), each line as a side, never a name.
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       <ProblemTalk problemId={row.id} /> |
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |   const chat = talk.data.filter((r) => r.kind === "chat"); |   const chat = talk.data.filter((r) => r.kind === "chat").slice(-1);
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx | {q.removed ? " · hidden in the app" : ""} | {""}
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx | {SIDE[m.side]} · {when(m.said_at)} | {when(m.said_at)}
 * @mutate src/components/admin/settings/DeclutterProblemTalk.tsx |         <button type="button" className="underline" onClick={() => void talk.refetch()}>Try again</button> |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { rows: [] as unknown[], calls: [] as unknown[][], talk: [] as unknown[] | null, talkError: false, talkAsked: 0 };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/helprTasks/photoUrl", () => ({ taskPhotoUrl: async (p: string) => `https://signed.test/${p}` }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchOpenProblemsWithDetail: async () => state.rows,
  handoverPhotoUrl: async (p: string) => `https://signed.test/${p}`,
  adminDecideProblem: async (...a: unknown[]) => { state.calls.push(["decide", ...a]); return {}; },
  adminDecideDeliveryDamage: async (...a: unknown[]) => { state.calls.push(["damage", ...a]); return {}; },
}));

vi.mock("@/lib/declutter/adminProblemCase", () => ({
  fetchProblemTalk: async () => { state.talkAsked += 1; if (state.talkError) throw new Error("not_admin"); return state.talk; },
  fetchProblemCase: async () => null,
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

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemsCard /></QueryClientProvider>);
}

beforeEach(() => {
  state.rows = [];
  state.calls = [];
  state.talk = [];
  state.talkError = false;
  state.talkAsked = 0;
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
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       adminDecideProblem(row.id, decision, falseOn ? (reporter as "buyer" \| "seller") : fault, falseOn ? false : strike, note.trim() \|\| null, falseOn), |       adminDecideProblem(row.id, decision, falseOn ? (reporter as "buyer" \| "seller") : fault, falseOn ? false : strike, note.trim() \|\| null, false),
// @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       adminDecideProblem(row.id, decision, falseOn ? (reporter as "buyer" \| "seller") : fault, | adminDecideProblem(row.id, decision, fault,
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
