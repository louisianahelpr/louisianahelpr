/**
 * Messages: the member's Declutter order chats are inbox rows (F420, whole-app audit 2026-11-10; before it D2-1,
 * audit 1028 part 2, put them in a block above the threads that only the Declutter chip showed). Server:
 * declutter_my_order_talks, proven in src/test/pglite/declutterOrderTalk.pglite.mjs.
 *
 * F420: "All shows only job chats; Declutter order chats only under the Declutter pill" -> "Show every conversation
 * under All, newest first, with job and Declutter rows mixed. Keep Jobs / Declutter as filters."
 *
 * What the list must do, each shown red by an @mutate below:
 *   1. job threads and order chats are ONE list, newest first (pinned threads still lead it);
 *   2. one row per chat: the item, "You bought this" / "You sold this", who wrote last, "Ended" once closed;
 *   3. the order rows follow the same controls as the threads: Active hides ended orders, search matches the item,
 *      and they are not drawn in select mode or under Pinned / Recently deleted;
 *   4. with order chats and no threads the rows show, not "No messages yet"; with neither, the empty state waits
 *      for the order-chat answer; a failed order-chat read says so above the threads with a retry;
 *   5. the "Show all N conversations" fold counts both kinds; tapping a row opens that order's chat over Messages
 *      (?order_talk=<order id>).
 * Which chips carry the rows (All and Declutter, not Unread / Jobs) is in src/test/messagesSectionTabs.test.tsx.
 *
 * @mutate src/components/messages/inboxItems.ts |   ].sort((a, b) => itemAt(b) - itemAt(a)); |   ];
 * @mutate src/components/messages/inboxItems.ts |     if (c.otherUserId === null \|\| !pinned.has(pinKeyOf(c.jobId, c.otherUserId))) break; |     break;
 * @mutate src/components/messages/ConversationListBody.tsx |                       if (it.kind === "order") return <OrderTalkRow row={it.row} />; |                       if (it.kind === "order") return null;
 * @mutate src/components/messages/inboxItems.ts |   const byTab = view.inboxTab === "active" ? orderTalks.rows.filter((r) => r.open) : orderTalks.rows; |   const byTab = orderTalks.rows;
 * @mutate src/components/messages/inboxItems.ts |   return q ? byTab.filter((r) => orderTalkRowTitle(r).toLowerCase().includes(q)) : byTab; |   return byTab;
 * @mutate src/components/messages/inboxItems.ts |   if (!orderTalks \|\| view.selectMode \|\| view.isSpecialFilterView) return []; |   if (!orderTalks) return [];
 * @mutate src/components/messages/ConversationListBody.tsx | !isSpecialFilterView && orderTalkRows.length === 0 && !orderTalksComing ? ( | !isSpecialFilterView ? (
 * @mutate src/components/messages/ConversationListBody.tsx |   const nothingToList = noTabMatches && orderTalkRows.length === 0; |   const nothingToList = noTabMatches;
 * @mutate src/components/messages/ConversationListBody.tsx |   const nothingFound = noSearchMatches && orderTalkRows.length === 0; |   const nothingFound = noSearchMatches;
 * @mutate src/components/messages/ConversationListBody.tsx |               {orderTalks && orderTalks.error != null && !selectMode && !isSpecialFilterView && ( |               {false && (
 * @mutate src/components/messages/ConversationListBody.tsx |               {orderTalks && <OrderTalkFromLink />} |               {null}
 * @mutate src/components/messages/ConversationListBody.tsx |               {!showAllConvos && items.length > CONVO_LIMIT && ( |               {!showAllConvos && filteredConversations.length > CONVO_LIMIT && (
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   if (row.last_mine) return t("msg.ot.youLast"); |   if (!row.last_mine) return t("msg.ot.youLast");
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-order-talk-line="" | text-muted-foreground truncate" data-order-talk-line=""
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | {row.side === "buyer" ? t("msg.ot.bought") : t("msg.ot.sold")} | {t("msg.ot.bought")}
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |                   {!row.open && <span |                   {false && <span
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |     next.set("order_talk", orderId); |     next.set("talk", orderId);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";
import type { Conversation } from "@/components/messages/types";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// jsdom has no layout, so the real virtualizer draws no rows; draw them all, flat, so ORDER can be read.
vi.mock("@/components/VirtualList", () => ({
  VirtualList: <T,>({ items, getKey, renderItem }: {
    items: T[]; getKey: (item: T, i: number) => string; renderItem: (item: T, i: number) => import("react").ReactNode;
  }) => <div data-testid="inbox-rows">{items.map((it, i) => <div key={getKey(it, i)}>{renderItem(it, i)}</div>)}</div>,
}));
// No network (Q55a): pins and archives come from here. A test pins a thread by adding its key to `pinned`.
const pinned = new Set<string>();
vi.mock("@/lib/pinnedConversations", async (io) => {
  const actual = await io<typeof import("@/lib/pinnedConversations")>();
  return { ...actual, loadPins: async () => pinned, getPinnedSet: () => pinned };
});
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title, search }: { title?: string; search?: import("react").ReactNode }) => <header data-testid="app-top-bar"><h1>{title}</h1>{search}</header>,
}));
// The chat sheet itself is DeclutterOrderTalk's (declutterOrderTalk.test.tsx); here, only that it opens for the row.
vi.mock("@/components/declutter/DeclutterOrderTalk", () => ({
  OrderTalkFromLink: function Stub() {
    const [p] = useSearchParams();
    return p.get("order_talk") ? <div data-testid="order-talk-sheet">{p.get("order_talk")}</div> : null;
  },
}));

import { ConversationList } from "@/components/messages/ConversationList";
import { mixInboxItems } from "@/components/messages/inboxItems";
import { orderTalkRowLine, type OrderTalkInbox } from "./DeclutterOrderTalkInbox";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const at = (h: number) => `2026-11-10T${String(h).padStart(2, "0")}:00:00Z`;

const convo = (over: Partial<Conversation> & { jobId: string }): Conversation => ({
  otherUserId: `u-${over.jobId}`, otherUserName: `Person ${over.jobId}`, jobTitle: `Job ${over.jobId}`,
  jobStatus: "in_progress", lastMessage: "(words)", lastAt: at(10), unread: 0, ...over,
}) as Conversation;
const row = (o: Partial<OrderTalkListRow>): OrderTalkListRow => ({
  order_id: A, side: "buyer", title: "Brass lamp", last_at: at(9), last_mine: false, open: true, ...o,
});
const talks = (rows: OrderTalkListRow[], more: Partial<OrderTalkInbox> = {}): OrderTalkInbox =>
  ({ rows, pending: false, error: null, reload: vi.fn(), ...more });

/** Two threads (10:00, 08:00) and two order chats (09:00, 07:00; the chair's order has ended). */
const THREADS = [convo({ jobId: "ten", lastAt: at(10) }), convo({ jobId: "eight", lastAt: at(8) })];
const TALKS = [row({}), row({ order_id: B, side: "seller", title: "Oak chair", last_at: at(7), last_mine: true, open: false })];

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}

function show(conversations: Conversation[], orderTalks: OrderTalkInbox | null, more: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/messages"]}>
      <ConversationList conversations={conversations} loading={false} loadError={false} retryInbox={vi.fn()} userId="user-1"
        loadConversations={vi.fn(async () => {})} openConvo={vi.fn()} setDeleteConvoConfirm={vi.fn()} onBatchArchive={vi.fn()}
        orderTalks={orderTalks} {...more} />
      <Where />
    </MemoryRouter>,
  );
}

/** The drawn rows, top to bottom, named by thread job or order item. */
function drawn(): string[] {
  const box = screen.queryByTestId("inbox-rows");
  if (!box) return [];
  return Array.from(box.children).map((el) => {
    const order = el.querySelector("[data-order-talk-row]");
    if (order) return `order:${order.querySelector("[title]")?.getAttribute("title")}`;
    // Owner 11-11 (F421): a thread row is title first; its headline is the job title.
    const m = /^Job ([a-z0-9-]+)$/.exec(el.querySelector('[data-testid="row-title"]')?.textContent ?? "");
    return `thread:${m?.[1] ?? "?"}`;
  });
}

/** Radix's menus open on a keyboard Enter in jsdom (no pointer events). */
function pickMenuItem(menuLabel: string, item: string, role: "menuitem" | "menuitemradio" = "menuitem") {
  const trigger = screen.getByRole("button", { name: menuLabel });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const el = screen.getAllByRole(role).find((e) => (e.textContent ?? "").trim() === item);
  if (!el) throw new Error(`no ${item} in ${menuLabel}`);
  fireEvent.click(el);
}

afterEach(() => {
  cleanup();
  pinned.clear();
});

describe("F420: order chats are inbox rows, mixed with the threads", () => {
  it("All: job threads and order chats are one list, newest first", async () => {
    show(THREADS, talks(TALKS));
    await screen.findAllByText(/wrote last/);
    expect(drawn()).toEqual(["thread:ten", "order:Brass lamp", "thread:eight", "order:Oak chair"]);
  });

  it("mixInboxItems: no order chats draws the threads exactly as before; pinned threads lead the mixed list", () => {
    const plain = mixInboxItems(THREADS, [], new Set());
    expect(plain.map((it) => (it.kind === "thread" ? it.c.jobId : "order"))).toEqual(["ten", "eight"]);
    const mixed = mixInboxItems([THREADS[1], THREADS[0]], TALKS, new Set(["eight_u-eight"]));
    expect(mixed.map((it) => (it.kind === "thread" ? it.c.jobId : it.row.title))).toEqual(["eight", "ten", "Brass lamp", "Oak chair"]);
  });

  it("a pinned thread stays at the top, above a newer order chat", async () => {
    pinned.add("eight_u-eight");
    show(THREADS, talks(TALKS));
    await screen.findAllByText(/wrote last/);
    expect(drawn()).toEqual(["thread:eight", "thread:ten", "order:Brass lamp", "order:Oak chair"]);
  });

  it("one row per chat: the item, your side, who wrote last, Ended once closed", async () => {
    show(THREADS, talks(TALKS));
    const lamp = (await screen.findByText("Brass lamp")).closest("[data-order-talk-row]")!;
    expect(lamp.textContent).toContain("You bought this · The seller wrote last");
    expect(lamp.textContent).not.toContain("Ended");
    const chair = screen.getByText("Oak chair").closest("[data-order-talk-row]")!;
    expect(chair.textContent).toContain("You sold this · You wrote last");
    expect(chair.textContent).toContain("Ended");
    // AUD31-14: the who-wrote-last line is short and may wrap, never cut at 375.
    const l = lamp.querySelector("[data-order-talk-line]")!;
    expect(l.className).not.toContain("truncate");
    expect(l.className).toContain("line-clamp-2");
    for (const side of ["buyer", "seller"] as const) for (const last_mine of [true, false]) {
      const words = `${side === "buyer" ? "You bought this" : "You sold this"} · ${orderTalkRowLine({ side, last_mine })}`;
      expect(words.length, words).toBeLessThanOrEqual(40);
    }
    expect(orderTalkRowLine({ side: "seller", last_mine: false })).toBe("The buyer wrote last");
  });

  it("tapping an order row opens that order's chat over Messages (?order_talk=)", async () => {
    show(THREADS, talks(TALKS));
    fireEvent.click((await screen.findByText("Oak chair")).closest("[data-order-talk-row]")!);
    expect(screen.getByTestId("where").textContent).toContain(`order_talk=${B}`);
    expect(screen.getByTestId("order-talk-sheet").textContent).toBe(B);
  });

  it("Active hides an ended order's chat, like a finished job's thread; an open one stays even with no live thread", async () => {
    show([convo({ jobId: "posted", jobStatus: "open", lastAt: at(10) })], talks(TALKS));
    await screen.findAllByText(/wrote last/);
    pickMenuItem("Inbox views and options", "Active", "menuitemradio");
    expect(drawn()).toEqual(["order:Brass lamp"]);
    expect(screen.queryByText(/Nothing running|No active/i)).toBeNull();
  });

  it("search matches an order chat by its item; a hit among the order chats is not 'no results'", async () => {
    show(THREADS, talks(TALKS));
    await screen.findAllByText(/wrote last/);
    fireEvent.change(document.querySelector("[role=search] input")!, { target: { value: "lamp" } });
    expect(drawn()).toEqual(["order:Brass lamp"]);
    expect(screen.queryByText(/no conversations match|no results/i)).toBeNull();
  });

  it("select mode and the Pinned view draw no order rows (nothing to pin, hide or delete on them)", async () => {
    show(THREADS, talks(TALKS));
    await screen.findAllByText(/wrote last/);
    pickMenuItem("Inbox views and options", "Select messages");
    expect(drawn()).toEqual(["thread:ten", "thread:eight"]);
    fireEvent.click(screen.getByRole("button", { name: /cancel|done/i }));
    pickMenuItem("Inbox views and options", "Pinned");
    expect(drawn()).toEqual([]);
    expect(screen.queryByText("Brass lamp")).toBeNull();
  });

  it("order chats and no threads: the rows, not 'No messages yet'; neither: the empty state waits for the answer", async () => {
    const { unmount } = show([], talks(TALKS));
    expect(await screen.findByText("Brass lamp")).toBeInTheDocument();
    expect(screen.queryByText(/No messages yet/)).toBeNull();
    unmount();
    const { rerender } = render(
      <MemoryRouter><ConversationList conversations={[]} loading={false} loadError={false} retryInbox={vi.fn()} userId="user-1"
        loadConversations={vi.fn(async () => {})} openConvo={vi.fn()} setDeleteConvoConfirm={vi.fn()} onBatchArchive={vi.fn()}
        orderTalks={talks([], { pending: true })} /></MemoryRouter>,
    );
    expect(screen.queryByText(/No messages yet/), "shown while the order chats are still loading").toBeNull();
    rerender(
      <MemoryRouter><ConversationList conversations={[]} loading={false} loadError={false} retryInbox={vi.fn()} userId="user-1"
        loadConversations={vi.fn(async () => {})} openConvo={vi.fn()} setDeleteConvoConfirm={vi.fn()} onBatchArchive={vi.fn()}
        orderTalks={talks([])} /></MemoryRouter>,
    );
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("a failed order-chat read says so above the threads, with a retry; the threads still show", async () => {
    const retry = vi.fn();
    show(THREADS, talks([], { error: new Error("boom"), reload: retry }));
    expect(await screen.findByText("We couldn't load your order chats.")).toBeInTheDocument();
    expect(drawn()).toEqual(["thread:ten", "thread:eight"]);
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("the 'Show all N conversations' fold counts threads and order chats together", async () => {
    const many = Array.from({ length: 50 }, (_, i) => convo({ jobId: `j${i}`, lastAt: at(10) }));
    show(many, talks([row({ last_at: at(1) })]));
    await screen.findByText(/Show all 51 conversations/);
    expect(drawn()).toHaveLength(50);
    expect(drawn()).not.toContain("order:Brass lamp");
  });
});
