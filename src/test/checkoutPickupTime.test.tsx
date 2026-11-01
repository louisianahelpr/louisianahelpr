/**
 * B110 (owner 11-01 11:44 AM; lead 1:14 PM): Buy now / accepted-offer checkout picks the pickup DAY and TIME before
 * paying. Porch = a 2-hour window ("3–5 PM"); a door pickup / meetup = an exact 30-minute time. The checkout sends
 * it (slot_start) to declutter-checkout, which passes it to declutter_start_checkout (20261101191500, PGlite proof
 * src/test/pglite/declutterCheckoutPickupTime.pglite.mjs) and closes an open page first when the time changed.
 * Pay waits on the pick while the seller has a time open; each way's details sit INSIDE its option.
 *
 * @mutate src/lib/declutter/pickupSlots.ts |         spans.set(m, Math.max(spans.get(m) ?? 0, Math.min(m + PORCH_WINDOW_MIN, wEnd))); |         spans.set(m, m + PORCH_WINDOW_MIN);
 * @mutate src/lib/declutter/pickupSlots.ts |       for (let m = minutes(w.starts); m + SLOT_MIN <= wEnd; m += PORCH_WINDOW_MIN) { |       for (let m = minutes(w.starts); m + SLOT_MIN <= wEnd; m += SLOT_MIN) {
 * @mutate src/lib/declutter/api.ts |       : (handover === "porch" \|\| handover === "pickup_home" \|\| handover === "meetup") && slotStart ? { slot_start: slotStart } |       : false ? { slot_start: slotStart }
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const pickupTimeReady = !timedPickup \|\| pickupChoices.length === 0 \|\| pickupStart !== null; |   const pickupTimeReady = true;
 * @mutate supabase/functions/declutter-checkout/index.ts | slotChanged \|\| spotChanged \|\| bundleChanged \|\| pickupChanged)) { | slotChanged \|\| spotChanged \|\| bundleChanged)) {
 * @mutate supabase/functions/declutter-checkout/index.ts |   const slotStart = handover === "seller_delivery" \|\| PICKUP_TIMED.includes(handover) ? isoTime(body.slot_start) : null; |   const slotStart = handover === "seller_delivery" ? isoTime(body.slot_start) : null;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { porchWindowDays, pickupDays, type SellerWindow } from "@/lib/declutter/pickupSlots";
import { CheckoutPickupTime } from "@/components/declutter/CheckoutPickupTime";

const invoke = vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }) => ({ data: { url: "https://checkout.stripe.com/x" }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (fn: string, opts: { body: Record<string, unknown> }) => invoke(fn, opts) } } }));
const lastBody = () => invoke.mock.calls[invoke.mock.calls.length - 1]?.[1].body;

const read = (p: string) => readFileSync(p, "utf8");
// Wed 2026-10-28 08:00 Chicago (CDT, UTC-5) = 13:00Z.
const now = Date.parse("2026-10-28T13:00:00Z");
const wed = (starts: string, ends: string): SellerWindow[] => [{ weekday: 3, starts, ends }];

describe("porchWindowDays: 2-hour porch windows", () => {
  it("steps 2 hours from the window's start and cuts the last one at the window's end", () => {
    const days = porchWindowDays(wed("09:00", "16:00"), now, null);
    expect(days[0].ymd).toBe("2026-10-28");
    expect(days[0].slots.map((s) => s.label)).toEqual(["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–4 PM"]);
    expect(days[0].slots[0].iso).toBe("2026-10-28T14:00:00.000Z");
  });
  it("a door pickup keeps the 30-minute times (more chips than windows)", () => {
    expect(pickupDays(wed("09:00", "16:00"), now, null)[0].slots.length).toBe(14);
    expect(porchWindowDays(wed("09:00", "16:00"), now, null)[0].slots.length).toBeGreaterThan(3);
  });
  it("no window starts in the past", () => {
    const later = Date.parse("2026-10-28T17:30:00Z"); // 12:30 PM Chicago
    expect(porchWindowDays(wed("09:00", "16:00"), later, null)[0].slots.map((s) => s.label)).toEqual(["1–3 PM", "3–4 PM"]);
  });
});

describe("CheckoutPickupTime", () => {
  it("day chips, then that day's window chips; a tap picks the window's start", () => {
    const onPick = vi.fn();
    render(<CheckoutPickupTime days={porchWindowDays(wed("15:00", "17:00"), now, null)} porch value={null} onPick={onPick} />);
    expect(screen.getByText("When you'll pick it up")).toBeTruthy();
    expect(screen.getByText(/leaves it out on the porch/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "3–5 PM" }));
    expect(onPick).toHaveBeenCalledWith("2026-10-28T20:00:00.000Z");
  });
  it("draws nothing when the seller has no time open (the buyer books after paying)", () => {
    const { container } = render(<CheckoutPickupTime days={[]} porch value={null} onPick={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the checkout sends the pick", () => {
  beforeEach(() => invoke.mockClear());
  it("startCheckoutPayment carries slot_start for porch, door and meetup pickups", async () => {
    const { startCheckoutPayment } = await import("@/lib/declutter/api");
    await startCheckoutPayment("s1", "porch", "2026-10-28T20:00:00.000Z");
    expect(lastBody()).toMatchObject({ handover: "porch", slot_start: "2026-10-28T20:00:00.000Z" });
    await startCheckoutPayment("s1", "meetup", "2026-10-28T20:00:00.000Z");
    expect(lastBody()).toMatchObject({ handover: "meetup", slot_start: "2026-10-28T20:00:00.000Z" });
    await startCheckoutPayment("s1", "pickup_home", null);
    expect(lastBody()).not.toHaveProperty("slot_start");
  });
  it("Pay waits on the pick, and each way's details sit inside its option", () => {
    const s = read("src/components/declutter/DeclutterTradeViews.tsx");
    expect(s).toContain("const pickupTimeReady = !timedPickup || pickupChoices.length === 0 || pickupStart !== null;");
    expect(s).toMatch(/!placeReady \|\| !pickupTimeReady\}/);
    const nest = s.indexOf("data-details-under={h}");
    const optionsEnd = s.indexOf("{offered.length === 0 && <NoWayWorks");
    for (const inner of ["<MeetupSpotPicker", "<CheckoutPickupTime", "<SellerDeliveryPicker", "<DropoffAddressField"]) {
      const at = s.indexOf(inner);
      expect(at, inner).toBeGreaterThan(nest);
      expect(at, inner).toBeLessThan(optionsEnd);
    }
  });
  it("declutter-checkout passes the time on and closes an open page when it changed", () => {
    const s = read("supabase/functions/declutter-checkout/index.ts");
    expect(s).toContain('const slotStart = handover === "seller_delivery" || PICKUP_TIMED.includes(handover) ? isoTime(body.slot_start) : null;');
    expect(s).toContain("slotChanged || spotChanged || bundleChanged || pickupChanged)) {");
    expect(s).toContain("? { p_seller_id: sellerId, p_handover: handover, p_slot_start: slotStart }");
  });
});
