import { describe, it, expect } from "vitest";
import { formatPriceFloor } from "./format";

describe("formatPriceFloor — a payout may never read above the payout", () => {
  it("floors rather than rounding up", () => {
    // The live case: a $120 job at 12% pays $105.60. Rounding to nearest gives
    // "$106" and promises 40c that never lands.
    expect(formatPriceFloor(105.6)).toBe("105");
    expect(formatPriceFloor(83.6)).toBe("83");
    expect(formatPriceFloor(99.99)).toBe("99");
  });

  it("leaves whole amounts alone", () => {
    expect(formatPriceFloor(132)).toBe("132");
    expect(formatPriceFloor(0)).toBe("0");
  });

  it("never reads higher than formatPriceExact", () => {
    for (const v of [105.6, 83.6, 123.2, 96.8, 74.8, 61.6, 39.6, 0.99]) {
      expect(Number(formatPriceFloor(v).replace(/,/g, ""))).toBeLessThanOrEqual(v);
    }
  });

  it("guards non-finite input like its siblings", () => {
    expect(formatPriceFloor(NaN)).toBe("0");
    expect(formatPriceFloor(Infinity)).toBe("0");
  });
});
