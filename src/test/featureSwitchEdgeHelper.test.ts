// @mutate supabase/functions/_shared/featureSwitch.ts |     return data === true; |     return data !== false;
// @mutate supabase/functions/_shared/featureSwitch.ts |   if (!userId) return false; |   if (!userId) return true;
// @mutate supabase/functions/_shared/featureSwitch.ts |     return false;\n  }\n} |     return true;\n  }\n}
/**
 * The edge-function enforcement helper for hidden feature switches fails
 * closed: no verified user, an RPC error, a thrown transport error, or any
 * answer but `true` -> refused with 403 { error: "feature_disabled" }.
 */
import { describe, expect, it, vi } from "vitest";
import { featureEnabledForUser, requireFeature, type FeatureSwitchClient } from "../../supabase/functions/_shared/featureSwitch";

const client = (impl: () => Promise<{ data: unknown; error: { message: string } | null }>) => {
  const rpc = vi.fn(impl);
  return { rpc, c: { rpc } as unknown as FeatureSwitchClient };
};

describe("featureSwitch edge helper", () => {
  it("allows only an exact true for the named user", async () => {
    const { rpc, c } = client(async () => ({ data: true, error: null }));
    expect(await requireFeature(c, "switch_canary", "u1")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("feature_enabled_for_user", { p_key: "switch_canary", p_user_id: "u1" });
  });

  it.each([
    ["false", async () => ({ data: false, error: null })],
    ["null", async () => ({ data: null, error: null })],
    ["a string", async () => ({ data: "true", error: null })],
    ["an RPC error", async () => ({ data: true, error: { message: "boom" } })],
    ["a thrown error", async () => { throw new Error("network"); }],
  ])("refuses on %s", async (_label, impl) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { c } = client(impl as () => Promise<{ data: unknown; error: { message: string } | null }>);
    const res = await requireFeature(c, "switch_canary", "u1", { "Access-Control-Allow-Origin": "*" });
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "feature_disabled" });
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("refuses with no verified user, without asking", async () => {
    const { rpc, c } = client(async () => ({ data: true, error: null }));
    expect(await featureEnabledForUser(c, "switch_canary", null)).toBe(false);
    expect(await featureEnabledForUser(c, "switch_canary", undefined)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
