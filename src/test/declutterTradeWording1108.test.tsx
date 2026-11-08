/**
 * Lead 11-08 (Builder 6, trades on the shared order card): a checked-out TRADE order (its $0 cart line reads source
 * "swap", trades 20261108195151) is worded as a trade, never as a free claim or a sale:
 *   - the step bar's first step is "Trade" (not "Claimed" / "Paid");
 *   - the order chat button says "Message about the trade" (not "Message the buyer");
 *   - the seller's listing row says "Traded for <item>" (not "Someone is buying it"), with no payout words;
 *   - the viewer's own listing maps to the item they get, from either side of the trade.
 * Class inventory: every OrderTalkButton call site passes `trade`, so no order card can fall back to buyer/seller words.
 *
 * @mutate src/components/declutter/OrderSteps.tsx |   return f.trade ? ["Trade", ...s.slice(1)] : | return false ? ["Trade", ...s.slice(1)] :
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |       {trade ? "Message about the trade" : | {false ? "Message about the trade" :
 * @mutate src/components/declutter/declutterUi.tsx |   if (tradedFor && (item.status === "reserved" | if (false && (item.status === "reserved"
 * @mutate src/lib/declutter/trades.ts |     const mine = t.my_side === "seller" ? t.item : t.offered; |     const mine = t.item;
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { join, resolve } from "node:path";
import { orderStepWords } from "@/components/declutter/OrderSteps";
import { OrderTalkButton } from "@/components/declutter/DeclutterOrderTalk";
import { sellerStatusLabel } from "@/components/declutter/declutterUi";
import { tradedForMyItems } from "@/lib/declutter/trades";
import { isTradeOrder } from "@/components/declutter/paidOrders";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");

describe("lead 11-08: a trade order reads as a trade", () => {
  it("the first step is Trade, ahead of the free claim's Claimed", () => {
    expect(orderStepWords({ handover: "porch", free: true, trade: true })[0]).toBe("Trade");
    expect(orderStepWords({ handover: "porch", free: true })[0]).toBe("Claimed");
    expect(orderStepWords({ handover: "porch" })[0]).toBe("Paid");
  });

  it("an order with a swap line is a trade order; a plain $0 claim is not", () => {
    expect(isTradeOrder({ lines: [{ source: "swap", price_cents: 0 }] as never })).toBe(true);
    expect(isTradeOrder({ lines: [{ source: "buy", price_cents: 0 }] as never })).toBe(false);
  });

  it("the order chat button says Message about the trade", () => {
    render(<MemoryRouter><OrderTalkButton orderId="o1" side="seller" trade /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Message about the trade" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Message the buyer" })).toBeNull();
  });

  it("a traded listing says Traded for <item>, never Someone is buying it", () => {
    expect(sellerStatusLabel({ status: "reserved", current_price_cents: 500 }, "Blue lamp")).toBe("Traded for Blue lamp");
    expect(sellerStatusLabel({ status: "reserved", current_price_cents: 500 })).toBe("Someone is buying it");
  });

  it("the viewer's own listing maps to the item they get, from either side; open or closed trades map nothing", () => {
    const item = { id: "sellerItem", title: "Oak chair", current_price_cents: 4000 };
    const offered = { id: "buyerItem", title: "Blue lamp", current_price_cents: 2000 };
    expect([...tradedForMyItems([{ status: "accepted", my_side: "seller", item, offered }])]).toEqual([["sellerItem", "Blue lamp"]]);
    expect([...tradedForMyItems([{ status: "completed", my_side: "buyer", item, offered }])]).toEqual([["buyerItem", "Oak chair"]]);
    expect(tradedForMyItems([{ status: "open", my_side: "seller", item, offered }, { status: "declined", my_side: "buyer", item, offered }]).size).toBe(0);
  });

  it("inventory: every OrderTalkButton on an order card passes trade", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const sites: string[] = [];
    const bare: string[] = [];
    for (const f of files) {
      const src = blankComments(readSource(f) ?? "");
      for (const m of src.matchAll(/<OrderTalkButton\b[^>]*\/>/g)) {
        sites.push(f);
        if (!/\btrade=\{/.test(m[0])) bare.push(`${f}: ${m[0]}`);
      }
    }
    expect(sites.length).toBeGreaterThan(2);
    expect(bare).toEqual([]);
  });
});
