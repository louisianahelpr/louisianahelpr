/**
 * A3-53: checkout's delivery size is the largest of its items, the way the server prices the cart
 * (declutter_delivery_quote, 20261101175628: xl, else large, else small).
 *
 * @mutate src/lib/declutter/checkoutSize.ts |   if (sizes.includes("large")) return "large"; |   if (sizes.includes("large")) return "small";
 */
import { describe, expect, it } from "vitest";
import { largestDeliverySize } from "./checkoutSize";

describe("largestDeliverySize", () => {
  it("xl, else large, else small; null when no size is known", () => {
    expect(largestDeliverySize(["small", "xl", "large"])).toBe("xl");
    expect(largestDeliverySize(["small", "large", null])).toBe("large");
    expect(largestDeliverySize(["small", undefined])).toBe("small");
    expect(largestDeliverySize([null, undefined])).toBeNull();
    expect(largestDeliverySize([])).toBeNull();
  });
});
