// @mutate src/lib/shops/orders.ts |     const readyStart = louisianaMidnightMs(order.ready_date.split("T")[0] ?? ""); |     const readyStart = new Date(order.ready_date.split("T")[0] + "T00:00:00").getTime();
/*
 * TZ SWEEP (Shops launch pass 1): an accepted order card's "Cancel for a refund until ..." line ends at the
 * ready date's midnight in Louisiana, as the server's shop_order_free_cancel_until does, in every device zone.
 * It used the device's own midnight, so a buyer's phone outside Central time showed the wrong cutoff.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { orderCancelLine } = await import("./orders");

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const order = {
  status: "accepted", handed_over_at: null, preorder_item_id: null,
  cancel_policy: "until_handover", ready_tap_cancel: "never_shortens", ready_date: "2026-11-20",
} as const;

describe("the order card's cancel cutoff is Louisiana midnight in every device zone", () => {
  for (const tz of ["America/Chicago", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      // 11:30 PM CST on Nov 19 (05:30Z): still open. 12:30 AM CST on Nov 20 (06:30Z): ended.
      expect(orderCancelLine(order, new Date("2026-11-20T05:30:00Z"))).toBe("Cancel for a refund until your ready date.");
      expect(orderCancelLine(order, new Date("2026-11-20T06:30:00Z"))).toBe("The cancel-for-a-refund time has ended.");
    });
  }
});
