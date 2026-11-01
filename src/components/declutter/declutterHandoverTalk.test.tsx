/**
 * The handover chat (owner 2026-10-28, Q2462 / issue #3730: "let them chat to figure it out"; server
 * 20261028235249_declutter_handover_talk, proven in src/test/pglite/declutterHandoverChoices.pglite.mjs).
 *
 * What the screen must do, each shown red by the @mutate below it:
 *   1. ?talk=<id> on /declutter opens the chat (the notices and "Message the seller" link there).
 *   2. The whole history shows, oldest first, as "You" and "The seller"/"The buyer", never a name.
 *   3. A message the contact-leak filter refuses says the server's own words (it is not swallowed).
 *   4. Only the seller is offered "Add porch pickup", on the items without it.
 *   5. An ended chat keeps its history and has no message box.
 *
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx |   const talkId = params.get("talk"); |   const talkId = params.get("chat");
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx | {mine ? "You" : `The ${other}`} | {mine ? "You" : m.sender_id}
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx |     onError: (err) => toast.error(declutterErrorMessage(err)),\n  });\n  const t = talk.data?.talk; |     onError: () => toast.error("Something went wrong."),\n  });\n  const t = talk.data?.talk;
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx |             {iAmSeller && !ended && <AddPorchPickup | {!ended && <AddPorchPickup
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx |             {!ended && (\n              <form |             {(\n              <form
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx |           {t && !ended && ( |           {t && (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { HandoverTalkFromLink } from "./DeclutterHandoverTalk";

const BUYER = "00000000-0000-4000-8000-0000000000b1";
const SELLER = "00000000-0000-4000-8000-0000000000a1";

const state = {
  me: BUYER,
  ended: false,
  sent: [] as string[],
  added: [] as string[],
  itemsAsked: 0,
  sendError: null as unknown,
  messages: [] as { id: string; talk_id: string; sender_id: string; body: string; created_at: string }[],
};

// B112: the open chat marks the viewer's side read (declutter_mark_talk_read); stubbed here.
vi.mock("@/lib/declutter/talkRead", () => ({ markTalkRead: async () => undefined }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: state.me } }) }));
vi.mock("@/lib/declutter/handoverTalk", () => ({
  fetchHandoverTalk: async (id: string) => (id !== "t1" ? null : {
    talk: {
      id: "t1", buyer_id: BUYER, seller_id: SELLER, opened_by: BUYER, opened_at: "2026-10-28T10:00:00Z",
      expires_at: state.ended ? "2026-10-28T11:00:00Z" : new Date(Date.now() + 3 * 86_400_000).toISOString(), closed_at: null,
    },
    messages: state.messages,
  }),
  sendHandoverMessage: async (_id: string, body: string) => {
    if (state.sendError) throw state.sendError;
    state.sent.push(body);
    return "m9";
  },
  fetchTalkItems: async () => { state.itemsAsked += 1; return [
    { item_id: "i1", title: "Lamp", handovers: ["meetup"], price_cents: 1000 },
    { item_id: "i2", title: "Rug", handovers: ["porch", "meetup"], price_cents: 2000 },
  ]; },
  addHandover: async (itemId: string) => { state.added.push(itemId); return ["meetup", "porch"]; },
  openHandoverTalk: async () => "t1",
  fetchMyOpenHandoverTalks: async () => [],
}));

function show(entry = "/declutter?tab=buying&talk=t1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <HandoverTalkFromLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = BUYER;
  state.ended = false;
  state.sent = [];
  state.added = [];
  state.itemsAsked = 0;
  state.sendError = null;
  state.messages = [
    { id: "m1", talk_id: "t1", sender_id: BUYER, body: "No spot near me. Porch?", created_at: "2026-10-28T10:01:00Z" },
    { id: "m2", talk_id: "t1", sender_id: SELLER, body: "Sure, I'll add it.", created_at: "2026-10-28T10:05:00Z" },
  ];
  vi.mocked(toast.error).mockClear();
});

describe("the handover chat", () => {
  it("opens only from ?talk=", async () => {
    show("/declutter?tab=buying");
    expect(document.querySelector("[data-handover-talk]")).toBeNull();
    show();
    expect(await screen.findByText("No spot near me. Porch?")).toBeInTheDocument();
  });

  it("shows the whole history oldest first as You and the other side, never a name or id", async () => {
    show();
    const list = await screen.findByRole("list", { name: "Messages" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/^You · .*No spot near me\. Porch\?$/);
    expect(items[1].textContent).toMatch(/^The seller · .*Sure, I'll add it\.$/);
    expect(document.body.textContent).not.toContain(SELLER);
    expect(screen.getByText(/Only you and the seller can read this/)).toBeInTheDocument();
  });

  it("sends a message, and a message the contact-leak filter refuses says the server's words", async () => {
    show();
    const box = await screen.findByLabelText("Message");
    fireEvent.change(box, { target: { value: "Thursday at 5 works" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.sent).toEqual(["Thursday at 5 works"]));
    state.sendError = Object.assign(new Error("A phone number in the message. Keep contact details and payment out of the chat; agree the handover here."), { code: "23514" });
    fireEvent.change(box, { target: { value: "text me 225 555 0142" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A phone number in the message. Keep contact details and payment out of the chat; agree the handover here."));
    expect(state.sent).toHaveLength(1);
  });

  it("only the seller is offered Add porch pickup, on the items without it", async () => {
    show();
    await screen.findByText("No spot near me. Porch?");
    // The buyer's chat never even asks for the items (the panel is the seller's), so no button can follow.
    expect(state.itemsAsked).toBe(0);
    expect(screen.queryByRole("button", { name: /Add porch pickup/ })).toBeNull();
    state.me = SELLER;
    show("/declutter?tab=selling&talk=t1");
    const add = await screen.findByRole("button", { name: "Add porch pickup to Lamp" });
    expect(screen.queryByRole("button", { name: "Add porch pickup to Rug" })).toBeNull();
    fireEvent.click(add);
    await waitFor(() => expect(state.added).toEqual(["i1"]));
  });

  it("an ended chat keeps its history and has no message box", async () => {
    state.ended = true;
    show();
    expect(await screen.findByText("Sure, I'll add it.")).toBeInTheDocument();
    expect(screen.getByText(/This chat has ended\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    // The footer Close and the sheet's X (every sheet has an X since LEAD-SHEET-X-ONLY, owner 10-31).
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
  });
});
