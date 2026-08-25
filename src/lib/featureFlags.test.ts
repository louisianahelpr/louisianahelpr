import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { isIdvRequirementPaused, resetFeatureFlagCache } from "./featureFlags";

beforeEach(() => {
  rpc.mockReset();
  resetFeatureFlagCache();
});

/**
 * These all assert the same property from different angles: the ONLY way this
 * returns true is an explicit `idv_requirement_paused: true`. Everything else
 * — including every way the read can go wrong — must keep identity
 * verification required, because a gate that lifts itself on a network blip is
 * worse than no gate at all (nothing visibly breaks when a gate stops gating,
 * so nobody would notice).
 */
describe("isIdvRequirementPaused", () => {
  it("is true only when an admin explicitly paused the requirement", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: { idv_requirement_paused: true } }], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(true);
  });

  it("stays required when the flag is explicitly false", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: { idv_requirement_paused: false } }], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("stays required when the key is absent", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: {} }], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("stays required before the migration ships, when the column does not exist", async () => {
    rpc.mockResolvedValue({ data: [{ platform_fee_percent: 15 }], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("stays required when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("stays required when the RPC throws", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("stays required when there is no settings row at all", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("does not treat a truthy non-true value as paused", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: { idv_requirement_paused: "yes" } }], error: null });
    await expect(isIdvRequirementPaused()).resolves.toBe(false);
  });

  it("serves the cached answer instead of re-reading on every gate check", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: { idv_requirement_paused: true } }], error: null });
    await isIdvRequirementPaused();
    await isIdvRequirementPaused();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent checks into one read", async () => {
    rpc.mockResolvedValue({ data: [{ feature_flags: { idv_requirement_paused: true } }], error: null });
    const [a, b] = await Promise.all([isIdvRequirementPaused(), isIdvRequirementPaused()]);
    expect([a, b]).toEqual([true, true]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
