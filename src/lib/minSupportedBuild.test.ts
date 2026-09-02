import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  GATE_OFF,
  normalizeMinBuild,
  parseBuildNumber,
  readMinSupportedBuild,
  resetMinSupportedBuildCache,
} from "./minSupportedBuild";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpc.mockReset();
  resetMinSupportedBuildCache();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/**
 * The whole file asserts ONE property from many angles, and it is the inverse
 * of the one lib/featureFlags.test.ts asserts: the only way this returns a
 * blocking threshold is an operator having deliberately stored a positive
 * integer. Every other outcome — including every way the read can go wrong —
 * must return 0 and leave the app usable.
 *
 * The reason is not symmetry, it is asymmetric cost. A gate that fails closed
 * bricks every native install at once, and un-bricking needs App Review, which
 * is the exact situation the gate exists to rescue.
 */
describe("readMinSupportedBuild — fails OPEN", () => {
  it("returns the stored threshold when an operator set one", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(6000);
  });

  it("is off when the stored value is 0, the documented off value", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 0 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off before the migration ships, when the column does not exist", async () => {
    rpc.mockResolvedValue({ data: [{ platform_fee_percent: 15 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when the RPC returns an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("does not drop the Supabase error — it is logged, not swallowed", async () => {
    const error = { message: "permission denied", code: "42501" };
    rpc.mockResolvedValue({ data: null, error });
    await readMinSupportedBuild();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gate stays open"), error);
  });

  it("is off when the RPC throws (network down)", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when there is no settings row at all", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when the value is null", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: null }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when the value is not a number", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: "soon" }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when the value is negative", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: -5 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("is off when the value is absurdly large — the admin input caps at 999,999", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 10_000_000 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(GATE_OFF);
  });

  it("accepts a numeric string, which is how PostgREST may serialise it", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: "6000" }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(6000);
  });

  it("reads the first row when the RPC returns a set", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }, { min_supported_build: 1 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(6000);
  });
});

describe("readMinSupportedBuild — caching", () => {
  it("serves the cached answer instead of re-reading on every check", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    await readMinSupportedBuild();
    await readMinSupportedBuild();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent checks into one read", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    const [a, b] = await Promise.all([readMinSupportedBuild(), readMinSupportedBuild()]);
    expect([a, b]).toEqual([6000, 6000]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("caches the FAILURE too, so an outage is not turned into a request storm", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await readMinSupportedBuild();
    await readMinSupportedBuild();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the cache is dropped, which is what an admin save does", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 0 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(0);
    resetMinSupportedBuildCache();
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    await expect(readMinSupportedBuild()).resolves.toBe(6000);
  });
});

describe("parseBuildNumber", () => {
  it("parses the integer CFBundleVersion this app actually ships", () => {
    expect(parseBuildNumber("5906")).toBe(5906);
  });

  it("accepts a number as well as a string", () => {
    expect(parseBuildNumber(5906)).toBe(5906);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseBuildNumber(" 5906 ")).toBe(5906);
  });

  it.each([
    ["a dotted CFBundleVersion Apple also permits", "1.0.4"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a suffixed build", "5906-beta"],
    ["exponent notation Number() would have accepted", "1e3"],
    ["a signed value Number() would have accepted", "+5906"],
    ["the literal NaN", "NaN"],
    ["a negative build", "-1"],
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
  ])("returns null for %s, so the gate stays open", (_label, input) => {
    expect(parseBuildNumber(input)).toBeNull();
  });

  it("returns null rather than guessing at a dotted build — a guess could block everyone", () => {
    // The admin control stores a single integer, so "1.0.4" has no honest
    // comparison. Turning the gate off is the safe half of that ambiguity.
    expect(normalizeMinBuild("1.0.4")).toBe(GATE_OFF);
  });
});
