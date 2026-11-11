/**
 * F424 (whole-app audit 2026-11-10, Medium): the seller's step line at the top of a Declutter order chat said
 * "Next: have it ready at the pickup time below", but nothing is below it in the chat, only "See the order". On the
 * sale card the booking panel IS below; in the chat it is not. When the booked time is not the checkout time (moved,
 * or an old booking), the chat now says the booking's own time ("Pickup Sat 11/7, 3:30 PM"), never "below".
 * @mutate src/lib/declutter/orderPickupTimes.ts |   return { ...words, chosen: pickupWhenWords(booking.slot_start, booking.slot_end, false) }; |   return words;
 * @mutate src/components/declutter/OrderTalkStep.tsx | { ...chatTimeWords(times.data?.[0], kind, b), | { ...orderTimeWords(times.data?.[0], kind, b?.slot_start ?? null),
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chatTimeWords } from "@/lib/declutter/orderPickupTimes";
import { standing } from "@/components/declutter/DeclutterPorchHandover";
import { blankComments } from "./helpers/blankNonCode";

const BOOKED = "2026-11-07T21:30:00Z"; // Sat 11/7, 3:30 PM Central
const row = { id: "o1", book_by: null, pickup_slot_start: "2026-11-06T21:00:00Z", pickup_slot_end: null };

describe("F424: the order chat names the pickup time instead of pointing below", () => {
  it("a booking at another time than checkout: the chat says the booking's own time", () => {
    const words = chatTimeWords(row, "pickup_home", { slot_start: BOOKED, slot_end: null });
    expect(words.chosen).toBe("Sat 11/7, 3:30 PM");
    const step = standing("pickup_home", "seller", 1, null, false, words);
    expect(step.text).not.toMatch(/below/);
    expect(step).toMatchObject({ who: "you", text: "Have it ready at the door", by: "Pickup Sat 11/7, 3:30 PM" });
  });

  it("same as the card when the checkout time is the booked one, and nothing invented with no booking", () => {
    expect(chatTimeWords({ ...row, pickup_slot_start: BOOKED }, "pickup_home", { slot_start: BOOKED, slot_end: null }).chosen).toBe("Sat 11/7, 3:30 PM");
    expect(chatTimeWords(row, "pickup_home", null).chosen).toBeNull();
    expect(chatTimeWords(undefined, "pickup_home", { slot_start: BOOKED, slot_end: null }).chosen).toBe("Sat 11/7, 3:30 PM");
  });

  it("the chat step line reads its time through chatTimeWords", () => {
    const src = blankComments(readFileSync("src/components/declutter/OrderTalkStep.tsx", "utf8"));
    expect(src).toContain("{ ...chatTimeWords(times.data?.[0], kind, b),");
    expect(src).not.toContain("orderTimeWords(");
  });
});
