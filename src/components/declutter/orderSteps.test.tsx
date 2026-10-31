/**
 * The one Declutter order tracker (OrderSteps.tsx; owner 2026-10-28: "a very organized way to keep track of all
 * their purchases and sells"). Buying and Selling both read an order's steps and its chip from here.
 *
 * Class guard: every handover x side x reachable state gives four named steps, a current step inside them that
 * never goes backwards as the order moves on, exactly one chip from ORDER_BUCKETS, and a free order never says "Paid".
 *
 * @mutate src/components/declutter/OrderSteps.tsx |       return f.pickedUp ? 3 : f.out ? 2 : f.booked ? 1 : 0; |       return f.pickedUp ? 3 : f.booked ? 2 : f.out ? 1 : 0;
 * @mutate src/components/declutter/OrderSteps.tsx |   return f.free ? ["Claimed", ...s.slice(1)] : s; |   return s;
 * @mutate src/components/declutter/OrderSteps.tsx |       return buyer ? !f.booked \|\| (!!f.out && !f.pickedUp) : f.booked && !f.out; |       return buyer ? !f.booked : f.booked && !f.out;
 * @mutate src/components/declutter/OrderSteps.tsx |   if (f.cancelled) return "cancelled"; |   if (false) return "cancelled";
 * @mutate src/components/declutter/OrderSteps.tsx |   return f.booked && !f.pickedUp && !f.delivered ? "upcoming" : "waiting"; |   return f.booked ? "upcoming" : "waiting";
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ORDER_BUCKETS, OrderSteps, orderBucket, orderStepAt, orderStepWords, orderWaitsOnYou,
  type OrderBucket, type OrderFacts, type OrderHandover, type OrderSide,
} from "./OrderSteps";

const HANDOVERS: readonly OrderHandover[] = ["porch", "pickup_home", "meetup", "seller_delivery", "delivery"];
const SIDES: readonly OrderSide[] = ["buyer", "seller"];

/** The order's life, in order, as the real rows fill in (each later state keeps the earlier facts). */
function life(handover: OrderHandover, side: OrderSide, free = false): OrderFacts[] {
  const base: OrderFacts = { handover, side, free, booked: false, done: false };
  const booked = { ...base, booked: true };
  const steps: OrderFacts[] = [base, booked];
  if (handover === "porch") steps.push({ ...booked, out: true }, { ...booked, out: true, pickedUp: true });
  else if (handover === "delivery") steps.push({ ...booked, pickedUp: true }, { ...booked, pickedUp: true, delivered: true });
  else if (handover === "seller_delivery") steps.push({ ...booked, delivered: true });
  else steps.push({ ...booked, pickedUp: true });
  steps.push({ ...steps[steps.length - 1], done: true });
  return steps;
}

describe("OrderSteps: one tracker for every Declutter order", () => {
  it("every handover x side: four named steps, a step that never goes back, one chip each", () => {
    const keys = new Set<OrderBucket>(ORDER_BUCKETS.map((b) => b.key));
    let states = 0;
    for (const h of HANDOVERS) {
      for (const side of SIDES) {
        for (const free of [false, true]) {
          const words = orderStepWords({ handover: h, free });
          expect(words.length).toBe(4);
          expect(new Set(words).size).toBe(4);
          expect(words[0]).toBe(free ? "Claimed" : "Paid");
          if (free) expect(words).not.toContain("Paid");
          let last = -1;
          for (const f of life(h, side, free)) {
            const at = orderStepAt(f);
            expect(at, `${h}/${side}`).toBeGreaterThanOrEqual(last);
            expect(at).toBeLessThan(4);
            last = at;
            expect(keys.has(orderBucket(f))).toBe(true);
            expect(orderBucket({ ...f, cancelled: true })).toBe("cancelled");
            states++;
          }
          expect(last).toBe(3);
        }
      }
    }
    expect(states).toBeGreaterThan(80);
  });

  it("porch: Paid -> Time booked -> On the porch -> Picked up, read from the booking, the porch photo and the pickup", () => {
    const [unbooked, booked, out, picked, done] = life("porch", "buyer");
    expect(orderStepWords(unbooked)).toEqual(["Paid", "Time booked", "On the porch", "Picked up"]);
    expect([unbooked, booked, out, picked, done].map(orderStepAt)).toEqual([0, 1, 2, 3, 3]);
    // The buyer books a time inside the place's hours (LEAD-PLACE-TIMES), waits for the photo (never goes before it), then picks it up.
    expect([unbooked, booked, out, picked, done].map(orderBucket)).toEqual(["needs_you", "upcoming", "needs_you", "waiting", "done"]);
    // The seller: waiting on the buyer's day, then puts it out.
    const seller = life("porch", "seller");
    expect(seller.map(orderBucket)).toEqual(["waiting", "needs_you", "upcoming", "waiting", "done"]);
  });

  it("delivery: the buyer is asked only once it is dropped off", () => {
    const d = life("delivery", "buyer");
    expect(d.map(orderWaitsOnYou)).toEqual([false, false, false, true, false]);
    expect(orderBucket(d[0])).toBe("waiting");
  });

  // Audit 1b D2-2: while a problem is open nothing is asked of either side (booking and a no-show are refused,
  // problem_open), so no order waits on the viewer and it files under Waiting, never Needs you or Upcoming.
  // @mutate src/components/declutter/OrderSteps.tsx |   if (f.done \|\| f.cancelled \|\| f.problem) return false; |   if (f.done \|\| f.cancelled) return false;
  // @mutate src/components/declutter/OrderSteps.tsx |   if (f.problem) return f.problemAwaitsYou ? "needs_you" : "waiting"; |
  it("an open problem: no order waits on either side, and every open state files under Waiting (D2-2)", () => {
    let n = 0;
    for (const handover of HANDOVERS) {
      for (const side of SIDES) {
        for (const f of life(handover, side)) {
          if (f.done) continue;
          const held = { ...f, problem: true };
          expect(orderWaitsOnYou(held), `${handover} ${side}`).toBe(false);
          expect(orderBucket(held), `${handover} ${side}`).toBe("waiting");
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  // NIGHT-BUYINGopenpr-2 (p-buyer-375-00-top): 7 held orders chipped as "Waiting 3, Done 4": the 4 handed over were
  // Done though the money is held, and one waiting on the buyer's own side never reached Needs you.
  // @mutate src/components/declutter/OrderSteps.tsx |   if (f.problem) return f.problemAwaitsYou ? "needs_you" : "waiting"; |   if (f.problem && !f.done) return f.problemAwaitsYou ? "needs_you" : "waiting";
  // @mutate src/components/declutter/OrderSteps.tsx |   if (f.problem) return f.problemAwaitsYou ? "needs_you" : "waiting"; |   if (f.problem) return "waiting";
  it("an open problem is never Done, and one waiting on the viewer's side is Needs you (openpr-2)", () => {
    let n = 0;
    for (const handover of HANDOVERS) {
      for (const side of SIDES) {
        for (const f of life(handover, side)) {
          expect(orderBucket({ ...f, problem: true }), `${handover} ${side} done=${f.done}`).toBe("waiting");
          expect(orderBucket({ ...f, problem: true, problemAwaitsYou: true }), `${handover} ${side} done=${f.done}`).toBe("needs_you");
          expect(orderBucket({ ...f, problem: true, problemAwaitsYou: true, cancelled: true })).toBe("cancelled");
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it("renders the shared bar with this order's words and step", () => {
    const { container } = render(<OrderSteps facts={{ handover: "porch", side: "buyer", booked: true, out: true, done: false }} />);
    expect(container.querySelector('[aria-label="Step 3 of 4: On the porch"]')).not.toBeNull();
    expect(container.querySelector("[data-order-step]")?.getAttribute("data-order-step")).toBe("2");
  });
});
