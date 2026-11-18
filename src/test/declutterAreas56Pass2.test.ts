/**
 * Design audit 11-18, Declutter buying (area 05) + selling (area 06), pass 2.
 *   - 05 #16: an accepted offer whose checkout time ran out reads "Expired", not "Accepted" (offerLapsed).
 *   - 05 #20: "Book a pickup time" opens Details AT the time picker, even when the picker loads after the body opens
 *     (goToOrderControl waits for [data-booking-picker]).
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { offerLapsed } from "@/components/declutter/DeclutterOffersSection";
import { BOOKING_ACTIONS, goToOrderControl } from "@/components/declutter/orderControlScroll";

describe("05 #16: a lapsed accepted offer", () => {
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | return mine.length > 0 && mine.every((l) => l.status === "missed"); | return false;
  it("is lapsed only when every cart line for it ran out; open, paid or unread is not", () => {
    const o = { status: "accepted" as const, item_id: "i1", my_side: "buyer" as const };
    const cases: [string, boolean, boolean][] = [
      ["missed", offerLapsed(o, [{ item_id: "i1", my_side: "buyer", status: "missed" }]), true],
      ["in cart", offerLapsed(o, [{ item_id: "i1", my_side: "buyer", status: "in_cart" }]), false],
      ["paid", offerLapsed(o, [{ item_id: "i1", my_side: "buyer", status: "paid" }]), false],
      ["other item", offerLapsed(o, [{ item_id: "i2", my_side: "buyer", status: "missed" }]), false],
      ["unread", offerLapsed(o, undefined), false],
      ["declined", offerLapsed({ ...o, status: "declined" as never }, [{ item_id: "i1", my_side: "buyer", status: "missed" }]), false],
    ];
    expect(cases.map(([k, got]) => `${k}: ${got}`)).toEqual(cases.map(([k, , want]) => `${k}: ${want}`));
    expect(cases.length).toBeGreaterThan(4);
  });
});

describe("05 #20: Book a pickup time goes to the picker", () => {
  // @mutate src/components/declutter/orderControlScroll.ts | const picker = body.querySelector<HTMLElement>("[data-booking-picker]"); | const picker = body.querySelector<HTMLElement>(".btn-grad-primary:not([disabled])");
  it("scrolls to the picker once it renders, and the booking actions are the card's three", async () => {
    expect([...BOOKING_ACTIONS].sort()).toEqual(["Book a pickup time", "Book a time to meet", "Pick a pickup time"]);
    const body = document.createElement("div");
    document.body.appendChild(body);
    const stop = goToOrderControl(body, true);
    expect(typeof stop).toBe("function");
    const picker = document.createElement("div");
    picker.setAttribute("data-booking-picker", "");
    picker.tabIndex = -1;
    const scrolled = vi.fn();
    picker.scrollIntoView = scrolled;
    body.appendChild(picker);
    await new Promise((r) => setTimeout(r, 0));
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(picker);
    stop?.();
    body.remove();
  });
});
