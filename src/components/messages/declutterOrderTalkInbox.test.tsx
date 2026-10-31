/**
 * Messages -> Declutter lists the member's order chats (audit 1028 part 2, D2-1; server declutter_my_order_talks,
 * proven in src/test/pglite/declutterOrderTalk.pglite.mjs). Before: the Declutter chip said "your chats with the other
 * person will show up here" and showed none; a paid order's chat was reachable only from its card or a notice.
 *
 * What the list must do, each shown red by the @mutate below it:
 *   1. one row per chat: the item, "You bought this" / "You sold this", who sent the last message, "Ended" once closed;
 *   2. with chats, the chip's empty state is not shown; with none, it is (and not before the answer is in);
 *   3. tapping a row opens that order's chat over Messages (?order_talk=<order id>).
 * The hook keeping the chip with Declutter off, and the list sitting above threads, are in messagesSectionTabs.test.tsx.
 *
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   return row.last_mine ? "You wrote |   return !row.last_mine ? "You wrote
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-order-talk-line="" | text-muted-foreground truncate" data-order-talk-line=""
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | {row.side === "buyer" ? "You bought this" : "You sold this"} | {"You bought this"}
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |                   {!row.open && <span |                   {false && <span
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   if (rows.length === 0) return <>{empty}</>; |   if (rows.length === 0) return null;
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   if (talks.isPending) return null; |   if (talks.isPending) return <>{empty}</>;
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |     next.set("order_talk", orderId); |     next.set("talk", orderId);
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |       <OrderTalkFromLink />\n |       {null}\n
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const state = { rows: [] as OrderTalkListRow[], gate: null as Promise<void> | null };

vi.mock("@/lib/declutter/orderTalk", () => ({
  MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"],
  fetchMyOrderTalks: async () => { if (state.gate) await state.gate; return state.rows; },
}));
// The chat sheet itself is DeclutterOrderTalk's (declutterOrderTalk.test.tsx); here, only that it opens for the row.
vi.mock("@/components/declutter/DeclutterOrderTalk", () => ({
  OrderTalkFromLink: function Stub() {
    const [p] = useSearchParams();
    return p.get("order_talk") ? <div data-testid="order-talk-sheet">{p.get("order_talk")}</div> : null;
  },
}));

import { DeclutterOrderTalkRows, orderTalkRowLine } from "./DeclutterOrderTalkInbox";

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}

function show(empty: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/messages?section=declutter"]}>
        <DeclutterOrderTalkRows empty={empty} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (o: Partial<OrderTalkListRow>): OrderTalkListRow => ({
  order_id: A, side: "buyer", title: "Brass lamp", last_at: new Date().toISOString(), last_mine: false, open: true, ...o,
});

afterEach(() => {
  cleanup();
  state.rows = [];
  state.gate = null;
});

describe("Messages -> Declutter: the order chats", () => {
  it("one row per chat: the item, your side, who sent the last message, Ended once closed; no empty state", async () => {
    state.rows = [row({}), row({ order_id: B, side: "seller", title: "Oak chair", last_mine: true, open: false })];
    show(<p>EMPTY STATE</p>);
    const rows = await screen.findAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Brass lamp");
    expect(rows[0].textContent).toContain("You bought this · The seller wrote last");
    expect(rows[0].textContent).not.toContain("Ended");
    expect(rows[1].textContent).toContain("Oak chair");
    expect(rows[1].textContent).toContain("You sold this · You wrote last");
    expect(rows[1].textContent).toContain("Ended");
    expect(screen.queryByText("EMPTY STATE")).toBeNull();
  });

  it("AUD31-14: the who-wrote-last line is short and may wrap, never cut at 375", async () => {
    state.rows = [row({})];
    const { container } = show(<p>EMPTY STATE</p>);
    await screen.findAllByRole("button");
    const l = container.querySelector("[data-order-talk-line]")!;
    expect(l.className).not.toContain("truncate");
    expect(l.className).toContain("line-clamp-2");
    for (const side of ["buyer", "seller"] as const) for (const last_mine of [true, false]) {
      const words = `${side === "buyer" ? "You bought this" : "You sold this"} · ${orderTalkRowLine({ side, last_mine })}`;
      expect(words.length, words).toBeLessThanOrEqual(40); // "· The seller sent the last message" was 50
    }
  });

  it("the row line names the other side by role only", () => {
    expect(orderTalkRowLine({ side: "seller", last_mine: false })).toBe("The buyer wrote last");
    expect(orderTalkRowLine({ side: "buyer", last_mine: true })).toBe("You wrote last");
  });

  it("no chats: the chip's own empty state, and not before the answer is in", async () => {
    let release: () => void = () => {};
    state.gate = new Promise<void>((r) => { release = r; });
    show(<p>EMPTY STATE</p>);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("EMPTY STATE"), "shown while still loading").toBeNull();
    release();
    expect(await screen.findByText("EMPTY STATE")).toBeInTheDocument();
  });

  it("tapping a row opens that order's chat over Messages", async () => {
    state.rows = [row({}), row({ order_id: B, title: "Oak chair" })];
    show(null);
    fireEvent.click((await screen.findAllByRole("button"))[1]);
    expect(screen.getByTestId("where").textContent).toContain(`order_talk=${B}`);
    expect(screen.getByTestId("where").textContent).toContain("section=declutter");
    expect(screen.getByTestId("order-talk-sheet").textContent).toBe(B);
  });
});
