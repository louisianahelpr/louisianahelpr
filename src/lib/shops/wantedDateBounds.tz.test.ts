// @mutate src/components/shops/ShopCustomRequestSheet.tsx |   const [y, m, d] = louisianaToday(now.getTime()).split("-").map(Number); |   const [y, m, d] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
/*
 * TZ SWEEP (Shops launch pass 1): a custom request's "Need it by" bounds are tomorrow to 180 days out in Louisiana's
 * day, as shops_send_custom_request checks them. They used the device's day, so a phone in another zone offered a
 * date the server refuses (invalid_wanted_date) or hid one it takes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { wantedDateBounds } from "@/components/shops/ShopCustomRequestSheet";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("the Need-it-by bounds follow Louisiana's day in every device zone", () => {
  for (const tz of ["America/Chicago", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      // 11:30 PM CST on Nov 12 (05:30Z on the 13th): Louisiana's today is still Nov 12.
      expect(wantedDateBounds(new Date("2026-11-13T05:30:00Z"))).toEqual({ min: "2026-11-13", max: "2027-05-11" });
    });
  }
});
