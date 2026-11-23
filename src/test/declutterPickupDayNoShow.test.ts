/**
 * App audit 11-23 DB1: after the buyer reported that the seller didn't show, Buying's "Your pickup today" card still
 * offered "I'm on my way" for a pickup time that had passed, right above the order card saying "You reported the seller
 * didn't show." The pickup-day card now leaves out an order whose no-show report is waiting, as it already left out an
 * order on hold.
 *
 * @mutate src/components/declutter/BuyingOrders.tsx |   for (const [id, v] of views) if (v.facts.problem \|\| v.noShow) out.add(id); |   for (const [id, v] of views) if (v.facts.problem) out.add(id);
 * @mutate src/components/declutter/BuyingOrders.tsx |       noShow: !!noShow, |       noShow: false,
 * @mutate src/components/declutter/DeclutterBuyingViews.tsx | held={pickupDayHeld(trk.views)} /> | held={new Set(trk.live.filter((o) => trk.views.get(o.orderId)?.facts.problem).map((o) => o.orderId))} />
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { pickupDayHeld } from "@/components/declutter/BuyingOrders";
import type { OrderFacts } from "@/components/declutter/OrderSteps";

const facts = (problem: boolean) => ({ problem }) as OrderFacts;
const src = (f: string) => blankComments(readFileSync(resolve(__dirname, "../components/declutter", f), "utf8"));

describe("DB1: the pickup-day card skips a reported no-show", () => {
  it("held = on hold or no-show reported; a plain booked order stays", () => {
    const views = new Map([
      ["plain", { facts: facts(false), noShow: false }],
      ["hold", { facts: facts(true), noShow: false }],
      ["noshow", { facts: facts(false), noShow: true }],
    ]);
    const held = pickupDayHeld(views);
    expect(held.size).toBeGreaterThan(1);
    expect([...held].sort()).toEqual(["hold", "noshow"]);
  });

  it("the tracker sets noShow from buyerNoShowStep, and Buying feeds pickupDayHeld to the card", () => {
    const orders = src("BuyingOrders.tsx");
    expect(orders).toMatch(/const noShow = buyerNoShowStep\(facts,[^\n]*\n[\s\S]{0,1600}?noShow: !!noShow,/);
    expect(src("DeclutterBuyingViews.tsx")).toContain("<PickupDayCard orders={trk.live} bookings={trk.bookings} held={pickupDayHeld(trk.views)} />");
  });
});
