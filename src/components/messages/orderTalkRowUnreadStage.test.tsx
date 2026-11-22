/**
 * Audit 1122 #138: Messages -> Declutter rows had no unread state and no order status: a buyer's message about a paid
 * pickup never read as unread, never counted on the Unread chip and never listed under it, and a paid order waiting for
 * its handover looked like any other. declutter_my_order_talks now returns `unread` (the caller's own read mark) and
 * `stage` (migration 20261122153901, PGlite declutterOrderTalksUnreadStage.pglite.mjs). CLASS CHECK: the row shows the
 * job row's unread mark and a stage chip; the Unread chip counts unread order chats and lists them.
 *
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |       {row.unread && <span | {false && <span
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   if (!row.open \|\| !row.stage) return null; |   return null;
 * @mutate src/pages/messages/useMessageSections.tsx | + shopUnread + orderTalkUnread.length; | + shopUnread;
 * @mutate src/pages/messages/useMessageSections.tsx |       : section === "unread" && orderTalkUnread.length > 0 |       : false
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrderTalkRow, orderTalkStageWords } from "./DeclutterOrderTalkInbox";
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";
import { unreadOrderTalks } from "@/lib/declutter/orderTalkUnread";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(cleanup);

const row = (over: Partial<OrderTalkListRow> = {}): OrderTalkListRow => ({
  order_id: "o1", side: "seller", title: "Oak chair", photo_path: null, last_at: "2026-11-22T10:00:00Z", last_mine: false, open: true, ...over,
});
const show = (r: OrderTalkListRow) => render(<MemoryRouter><OrderTalkRow row={r} /></MemoryRouter>);

describe("Declutter order-chat rows say unread and where the order stands (#138)", () => {
  it("an unread row wears the unread mark and a bold title; a read one does not", () => {
    show(row({ unread: true }));
    expect(screen.getByRole("status", { name: "Unread message" })).toBeInTheDocument();
    expect(screen.getByText("Oak chair").className).toMatch(/font-bold/);
    cleanup();
    show(row({ unread: false }));
    expect(screen.queryByRole("status", { name: "Unread message" })).toBeNull();
    expect(screen.getByText("Oak chair").className).not.toMatch(/font-bold/);
  });

  it("a paid order's open chat says Paid; handed over and refunded say so; an ended chat says Ended, not a stage", () => {
    show(row({ stage: "paid" }));
    expect(document.querySelector("[data-order-talk-stage=paid]")?.textContent).toBe("Paid");
    expect(orderTalkStageWords(row({ stage: "handed_over" }))).toBe("Handed over");
    expect(orderTalkStageWords(row({ stage: "refunded" }))).toBe("Refunded");
    expect(orderTalkStageWords(row({ stage: "paid", open: false }))).toBeNull();
    expect(orderTalkStageWords(row({ stage: undefined }))).toBeNull(); // before the migration deploys
  });

  it("only unread rows count; a row from before the deploy (no field) is not unread", () => {
    const rows = [row({ order_id: "a", unread: true }), row({ order_id: "b", unread: false }), row({ order_id: "c" })];
    expect(unreadOrderTalks(rows).map((r) => r.order_id)).toEqual(["a"]);
  });

  it("the Unread chip counts unread order chats and Unread lists them", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../pages/messages/useMessageSections.tsx"), "utf8"));
    expect(src).toMatch(/const orderTalkUnread = unreadOrderTalks\(orderTalks\.data \?\? \[\]\);/);
    expect(src).toMatch(/const unread = [^;]*\+ orderTalkUnread\.length;/);
    expect(src).toMatch(/section === "unread" && orderTalkUnread\.length > 0\s*\?\s*\{ rows: orderTalkUnread/);
    expect(src).toMatch(/section === "unread" && shown\.length === 0 && orderTalkUnread\.length === 0/);
  });
});
