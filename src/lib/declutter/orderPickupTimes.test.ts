/**
 * A3-18 / A3-19 (lead 11-01 5:01 PM; A3-50: paid + 7 days): a paid Declutter pickup's next-step line names the time
 * chosen at checkout once it is booked ("Pickup Sat 11/2, 3–5 PM · porch", no "by"), and says "by <book_by>" while
 * nothing is booked, on the buyer's order card (BuyingOrders) and on both sides' sale card (DeclutterPorchHandover).
 * Backend proof (book_by, the paid notice, the reminders): src/test/pglite/declutterBookBy.pglite.mjs.
 */
// @mutate src/components/declutter/BuyingOrders.tsx |       return at === 0 ? you("Pick a pickup time", by) |       return at === 0 ? you("Pick a pickup time")
// @mutate src/components/declutter/BuyingOrders.tsx |         : at === 1 && chosen ? info(`Pickup ${chosen} · porch`) |         : at === 1 && false ? info(`Pickup ${chosen} · porch`)
// @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 0) return you("Book a time to meet at the safe spot", by); |       if (at === 0) return you("Book a time to meet at the safe spot");
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const waiting = (what: string) => them(`${paid} Waiting on ${buyer} to ${what}${by ? "" : "."}`, by); |   const waiting = (what: string) => them(`${paid} Waiting on ${buyer} to ${what}.`);
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |       if (side === "seller" && chosen) return you("Put it out and post the porch photo", `Pickup ${chosen}`); |       if (side === "seller" && chosen) return you("Put it out and post the porch photo");
// @mutate src/lib/declutter/orderPickupTimes.ts |   return { chosen, by: !booked && t.book_by ? bookByWords(t.book_by) : null }; |   return { chosen, by: t.book_by ? bookByWords(t.book_by) : null };
// @mutate src/lib/declutter/orderPickupTimes.ts |     ? `${day(a)}, ${clock(a)}–${clock(b)} ${ampm(b)}` |     ? `${day(a)}, ${clock(a)} ${ampm(a)}`
import { describe, it, expect } from "vitest";
import { bookByWords, orderTimeWords, pickupWhenWords } from "./orderPickupTimes";
import { buyerNextStep } from "@/components/declutter/BuyingOrders";
import { standing } from "@/components/declutter/DeclutterPorchHandover";
import { nextStepWords } from "@/components/ui/NextStep";
import type { OrderFacts } from "@/components/declutter/OrderSteps";

// Sat Nov 7 2026, 3 PM and 5 PM Central (CST, UTC-6); book_by Sun Nov 8, 5:07 PM Central.
const START = "2026-11-07T21:00:00Z";
const END = "2026-11-07T23:00:00Z";
const BOOK_BY = "2026-11-08T23:07:00Z";
const order = (o: Partial<{ book_by: string | null; pickup_slot_start: string | null; pickup_slot_end: string | null }>) =>
  ({ id: "o1", book_by: BOOK_BY, pickup_slot_start: null, pickup_slot_end: null, ...o });
const facts = (handover: OrderFacts["handover"], booked: boolean): OrderFacts => ({ handover, side: "buyer", booked, done: false });

describe("the time words", () => {
  it("a porch window, an exact time, and book_by, in Louisiana time", () => {
    expect(pickupWhenWords(START, END, true)).toBe("Sat 11/7, 3–5 PM");
    expect(pickupWhenWords("2026-11-07T17:00:00Z", "2026-11-07T19:00:00Z", true)).toBe("Sat 11/7, 11 AM–1 PM");
    expect(pickupWhenWords("2026-11-07T21:30:00Z", "2026-11-07T22:00:00Z", false)).toBe("Sat 11/7, 3:30 PM");
    expect(bookByWords(BOOK_BY)).toBe("by Sun 11/8, 5:07 PM");
  });

  it("chosen only when the checkout time is the booked one; by only while nothing is booked", () => {
    expect(orderTimeWords(order({}), "pickup_home", null)).toEqual({ chosen: null, by: "by Sun 11/8, 5:07 PM" });
    expect(orderTimeWords(order({ pickup_slot_start: START, pickup_slot_end: END }), "porch", START)).toEqual({ chosen: "Sat 11/7, 3–5 PM", by: null });
    // Booked at another time (moved, or the checkout time had passed): neither; the booking says its own time.
    expect(orderTimeWords(order({ pickup_slot_start: START, pickup_slot_end: END }), "porch", "2026-11-09T21:00:00Z")).toEqual({ chosen: null, by: null });
    expect(orderTimeWords(null, "porch", null)).toEqual({ chosen: null, by: null });
  });
});

describe("A3-19: the buyer's order card", () => {
  const unbooked = orderTimeWords(order({}), "porch", null);
  const chosen = orderTimeWords(order({ pickup_slot_start: START, pickup_slot_end: END }), "porch", START);
  it("nothing booked: Next: <step> · by <book_by>, for porch, door and meetup", () => {
    expect(nextStepWords(buyerNextStep(facts("porch", false), null, null, null, null, unbooked))).toBe("Next: pick a pickup time · by Sun 11/8, 5:07 PM");
    expect(nextStepWords(buyerNextStep(facts("pickup_home", false), null, null, null, null, unbooked))).toBe("Next: book a pickup time · by Sun 11/8, 5:07 PM");
    expect(nextStepWords(buyerNextStep(facts("meetup", false), null, null, null, null, unbooked))).toMatch(/^Next: book a time to meet.* · by Sun 11\/8, 5:07 PM$/);
  });
  it("the checkout time booked: the time and the way, no by", () => {
    const w = nextStepWords(buyerNextStep(facts("porch", true), null, null, null, null, chosen));
    expect(w).toBe("Pickup Sat 11/7, 3–5 PM · porch");
    const door = orderTimeWords(order({ pickup_slot_start: START, pickup_slot_end: "2026-11-07T21:30:00Z" }), "pickup_home", START);
    expect(nextStepWords(buyerNextStep(facts("pickup_home", true), null, null, null, null, door))).toBe("Pickup Sat 11/7, 3:00 PM · at the door");
  });
});

describe("A3-18: the sale card, both sides", () => {
  const unbooked = orderTimeWords(order({}), "porch", null);
  const chosen = orderTimeWords(order({ pickup_slot_start: START, pickup_slot_end: END }), "porch", START);
  it("nothing booked: the buyer's step and the seller's wait both carry by <book_by>", () => {
    expect(nextStepWords(standing("porch", "buyer", 0, null, false, unbooked))).toBe("Next: pick a time to collect it from the porch · by Sun 11/8, 5:07 PM");
    expect(nextStepWords(standing("porch", "seller", 0, null, false, unbooked))).toBe("Paid. Waiting on the buyer to pick a pickup time · by Sun 11/8, 5:07 PM");
    expect(nextStepWords(standing("meetup", "seller", 0, null, false, unbooked))).toBe("Paid. Waiting on the buyer to book a time to meet · by Sun 11/8, 5:07 PM");
    expect(nextStepWords(standing("pickup_home", "buyer", 0, null, false, unbooked))).toBe("Next: book a pickup time · by Sun 11/8, 5:07 PM");
  });
  it("A3-49: the seller's wait names the buyer, in the one line with by <book_by>", () => {
    expect(nextStepWords(standing("porch", "seller", 0, null, false, { ...unbooked, buyer: "Ann" }))).toBe("Paid. Waiting on Ann to pick a pickup time · by Sun 11/8, 5:07 PM");
  });
  it("the checkout time booked: the seller's step names the window; no by", () => {
    expect(nextStepWords(standing("porch", "seller", 1, null, false, chosen))).toBe("Next: put it out and post the porch photo · Pickup Sat 11/7, 3–5 PM");
    expect(nextStepWords(standing("porch", "buyer", 1, null, false, chosen))).toBe("Not out yet. We'll tell you when it's on the porch · Pickup Sat 11/7, 3–5 PM");
  });
  it("no order times read (old rows): the old words, unchanged", () => {
    expect(nextStepWords(standing("porch", "seller", 0, null, false))).toBe("Paid. Waiting on the buyer to pick a pickup time.");
  });
});
