// useHelprActivity: the poster's "Helprs who've worked in <Parish>" line. Honesty over coverage: no parish, an RPC
// error, no matching row or a thin count all show nothing; only a real count of 3+ in the poster's parish shows.
// Its Browse caller went away with the shared empty-Browse layout (#4022), so the hook is tested on its own here.
// @mutate src/hooks/useHelprActivity.ts | if (!row \|\| count < MIN_MEANINGFUL_COUNT) { | if (!row) {
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { useHelprActivity } from "./useHelprActivity";

beforeEach(() => rpc.mockReset());

describe("useHelprActivity", () => {
  it("no parish: no signal and no request", () => {
    const { result } = renderHook(() => useHelprActivity(null));
    expect(result.current).toEqual({ activity: null, loading: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a real count in the poster's parish (any case) shows, with the RPC's parish name", async () => {
    rpc.mockResolvedValue({ data: [{ parish: "Orleans", helper_count: 7 }, { parish: "Jefferson", helper_count: 12 }], error: null });
    const { result } = renderHook(() => useHelprActivity("orleans"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activity).toEqual({ count: 7, parish: "Orleans" });
    expect(rpc).toHaveBeenCalledWith("get_parish_activity", { p_limit: 64 });
  });

  it("a thin count, no matching row or an RPC error all show nothing", async () => {
    for (const answer of [
      () => rpc.mockResolvedValue({ data: [{ parish: "Orleans", helper_count: 2 }], error: null }),
      () => rpc.mockResolvedValue({ data: [{ parish: "Jefferson", helper_count: 9 }], error: null }),
      () => rpc.mockResolvedValue({ data: null, error: { message: "gone" } }),
    ]) {
      rpc.mockReset();
      answer();
      const { result, unmount } = renderHook(() => useHelprActivity("Orleans"));
      await waitFor(() => expect(rpc).toHaveBeenCalled());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.activity).toBeNull();
      unmount();
    }
  });
});
