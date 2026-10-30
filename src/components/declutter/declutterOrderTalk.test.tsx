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
 *
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |   const orderId = params.get("order_talk"); |   const orderId = params.get("talk");
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | {side === "buyer" ? "Message the seller" : "Message the buyer"} | {"Message the seller"}
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | {m.mine ? "You" : `The ${other}`} | {m.mine ? `The ${other}` : "You"}
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |     mutationFn: () => sendOrderMessage(orderId, draft.trim()), |     mutationFn: () => sendOrderMessage(orderId, draft),
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |     onError: (err) => toast.error(declutterErrorMessage(err)), |     onError: () => toast.error("Something went wrong."),
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
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/lib/declutter/orderTalk", () => ({
  fetchOrderTalk: async (id: string) => ({
    order_id: id,
    side: state.side,
    open: state.open,
    open_until: null,
    messages: [
      { id: "m1", mine: true, body: "Is Saturday ok?", created_at: "2026-10-29T10:00:00Z" },
      { id: "m2", mine: false, body: "Yes, after 9.", created_at: "2026-10-29T10:05:00Z" },
    ],
  }),
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
  state.side = "buyer";
  state.open = true;
  state.sent = [];
  state.sendError = null;
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

  it("Send posts the trimmed words; a refusal shows the server's words", async () => {
    renderAt(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    const box = await screen.findByLabelText("Message");
    fireEvent.change(box, { target: { value: "  See you at 10.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.sent).toEqual(["See you at 10."]));
    state.sendError = Object.assign(new Error("A phone number in the message. Keep contact details and payment out of the chat."), { code: "23514" });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "call me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("phone number")));
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
