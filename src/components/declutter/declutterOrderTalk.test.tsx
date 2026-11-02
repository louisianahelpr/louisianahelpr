/**
 * The paid-order chat (audit 1028 part 2, D2-1; server 20261030004216_declutter_order_talk, proven in
 * src/test/pglite/declutterOrderTalk.pglite.mjs). Before: after paying, the buyer and seller had no way to reach
 * each other although the refund copy told them to "arrange it in Messages".
 *
 * What the screen must do, each shown red by the @mutate below it:
 *   1. "Message the seller" (buyer) / "Message the buyer" (seller) on a paid order opens the chat (?order_talk=).
 *   2. ?order_talk=<order id> opens it; the history shows oldest first as "You" and "The seller", never a name.
 *   3. Send posts the trimmed words; a refused message shows the server's own words.
 *   4. An ended chat keeps its history and has no message box and no Send.
 *   5. Manager mode: a message the seller's manager wrote says "Dana (helping Kaci)", to the buyer and to the seller.
 *
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |   const orderId = params.get("order_talk"); |   const orderId = params.get("talk");
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | {side === "buyer" ? "Message the seller" : "Message the buyer"} | {"Message the seller"}
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | (m.mine ? "You" : `The ${other}`) | (m.mine ? `The ${other}` : "You")
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | {labels.data?.get(m.id) ?? (m.mine ? "You" | {(m.mine ? "You"
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |   const labels = useManagerLabels("order_talk", (talk.data?.messages ?? []).map((m) => m.id)); |   const labels = useManagerLabels("order_talk", []);
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |     mutationFn: () => sendOrderMessage(orderId, draft.trim()), |     mutationFn: () => sendOrderMessage(orderId, draft),
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |     onError: (err) => setRefusal(declutterErrorMessage(err)), |     onError: () => setRefusal("Something went wrong."),
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |             {open && (\n              <form |             {(\n              <form
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |           {open && (\n            <SheetPrimaryAction |           {(\n            <SheetPrimaryAction
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { OrderTalkButton, OrderTalkFromLink } from "./DeclutterOrderTalk";

const ORDER = "00000000-0000-4000-8000-0000000000c1";

const state = {
  side: "buyer" as "buyer" | "seller",
  open: true,
  sent: [] as string[],
  sendError: null as unknown,
  openUntil: null as string | null,
  title: "Oak rocking chair" as string | null,
};

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
// Manager labels: the real hook is gated on the switch and reads declutter_manager_message_labels; here, the ids it
// was asked for and the answer it gives.
const labelState = vi.hoisted(() => ({ asked: [] as string[], map: new Map<string, string>() }));
vi.mock("@/lib/declutter/managerMode", () => ({
  useManagerLabels: (_kind: string, ids: string[]) => {
    labelState.asked = ids;
    return { data: new Map([...labelState.map].filter(([k]) => ids.includes(k))) };
  },
}));
vi.mock("@/lib/declutter/orderTalk", () => ({
  MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"],
  fetchOrderTalk: async (id: string) => ({
    order_id: id,
    side: state.side,
    open: state.open,
    open_until: state.openUntil,
    messages: [
      { id: "m1", mine: true, body: "Is Saturday ok?", created_at: "2026-10-29T10:00:00Z" },
      { id: "m2", mine: false, body: "Yes, after 9.", created_at: "2026-10-29T10:05:00Z" },
    ],
  }),
  fetchMyOrderTalks: async () => [{ order_id: ORDER, side: state.side, title: state.title, last_at: "2026-10-29T10:05:00Z", last_mine: false, open: state.open }],
  sendOrderMessage: async (_id: string, body: string) => {
    if (state.sendError) throw state.sendError;
    state.sent.push(body);
    return "m9";
  },
}));

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}

function renderAt(path: string, ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  labelState.asked = [];
  labelState.map = new Map();
  state.side = "buyer";
  state.open = true;
  state.sent = [];
  state.sendError = null;
  state.openUntil = null;
  state.title = "Oak rocking chair";
  vi.mocked(toast.error).mockClear();
});

describe("D2-1: the paid-order chat", () => {
  it("the buyer's button says Message the seller and opens the chat for this order", async () => {
    renderAt("/declutter?tab=buying", <><OrderTalkButton orderId={ORDER} side="buyer" /><OrderTalkFromLink /></>);
    fireEvent.click(screen.getByRole("button", { name: "Message the seller" }));
    expect(screen.getByTestId("where").textContent).toContain(`order_talk=${ORDER}`);
    expect(await screen.findByText("Is Saturday ok?")).toBeTruthy();
  });

  it("the seller's button says Message the buyer", () => {
    renderAt("/declutter?tab=selling", <OrderTalkButton orderId={ORDER} side="seller" />);
    expect(screen.getByRole("button", { name: "Message the buyer" })).toBeTruthy();
  });

  it("?order_talk= opens the history oldest first, as You and The seller", async () => {
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    const list = await screen.findByRole("list", { name: "Messages" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/^You · .*Is Saturday ok\?$/);
    expect(items[1]).toMatch(/^The seller · .*Yes, after 9\.$/);
  });

  it("manager mode: a message the manager wrote says who wrote it, to the buyer and to the seller (never You)", async () => {
    labelState.map = new Map([["m2", "Dana (helping Kaci)"], ["m1", "Dana (helping Kaci)"]]);
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    const list = await screen.findByRole("list", { name: "Messages" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(labelState.asked).toEqual(["m1", "m2"]);
    expect(items[0]).toMatch(/^Dana \(helping Kaci\) · .*Is Saturday ok\?$/);
    expect(items[1]).toMatch(/^Dana \(helping Kaci\) · .*Yes, after 9\.$/);
  });

  it("Send posts the trimmed words; a refusal shows the server's words", async () => {
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    const box = await screen.findByLabelText("Message");
    fireEvent.change(box, { target: { value: "  See you at 10.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.sent).toEqual(["See you at 10."]));
    state.sendError = Object.assign(new Error("A phone number in the message. Keep contact details and payment out of the chat."), { code: "23514" });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "call me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // AUD31-11: said under the box (the draft stays), never a toast over it.
    const said = await screen.findByRole("alert");
    expect(said.textContent).toContain("phone number");
    expect(screen.getByLabelText("Message")).toHaveValue("call me");
    expect(screen.getByLabelText("Message").getAttribute("aria-describedby")).toBe(said.id);
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "see you at 10" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // AUD31-13 (audit 2026-10-31): the sheet said only "Message the seller", not which item.
  // @mutate src/components/declutter/DeclutterOrderTalk.tsx | {itemTitle && <p className="mt-1 truncate text-ds-14 text-muted-foreground" data-order-talk-item="">About &ldquo;{itemTitle}&rdquo;</p>} | {null}
  // @mutate src/components/declutter/DeclutterOrderTalk.tsx |     onError: (err) => setRefusal(declutterErrorMessage(err)), |     onError: () => {},
  it("the chat names the item it is about; with no title known it says nothing extra", async () => {
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    expect((await screen.findByText(/About “Oak rocking chair”/)).getAttribute("data-order-talk-item")).toBe("");
    expect(screen.getByRole("heading", { name: "Message the seller" })).toBeTruthy();
  });

  // AUD31-31 (audit 2026-10-31): an ended chat was still titled "Message the seller", with "This chat has ended."
  // tacked onto the rules box and no date, reason or next step.
  // @mutate src/components/declutter/DeclutterOrderTalk.tsx | open ? `Message the ${other}` : `Your chat with the ${other}` | `Message the ${other}`
  // @mutate src/components/declutter/DeclutterOrderTalk.tsx | `This chat ended ${when(endedAt)}, 48 hours after the handover.` | "This chat has ended."
  it("an ended chat is titled as a record, and says when it ended, why, and where to go for a problem", async () => {
    state.open = false;
    state.openUntil = "2026-10-29T12:00:00Z";
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    expect(await screen.findByRole("heading", { name: "Your chat with the seller" })).toBeTruthy();
    const ended = document.querySelector("[data-order-talk-ended]")!;
    expect(ended.textContent).toMatch(/^This chat ended .+, 48 hours after the handover\. You can still read it\. For a problem with this order, use Report a problem on its card\.$/);
    expect(screen.queryByRole("heading", { name: "Message the seller" })).toBeNull();
  });

  it("an ended chat keeps its history with no box and no Send", async () => {
    state.open = false;
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    expect(await screen.findByText("Yes, after 9.")).toBeTruthy();
    expect(screen.getByText(/This chat has ended\./)).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("a link that is not an order id opens nothing", () => {
    renderAt("/declutter?order_talk=not-an-id", <OrderTalkFromLink />);
    expect(screen.queryByRole("list", { name: "Messages" })).toBeNull();
  });
});
