/**
 * Manager mode: useManagerLabels reads declutter_manager_message_labels ONLY while the declutter_manager switch is on
 * for the viewer and there is something to label (owner: nothing slow for users; no request on every item page while
 * the feature is off), and answers a Map of message id -> "Dana (helping Kaci)".
 *
 * @mutate src/lib/declutter/managerMode.ts |     enabled: on && sorted.length > 0, |     enabled: sorted.length > 0,
 * @mutate src/lib/declutter/managerMode.ts |   return new Map(((data ?? []) as { message_id: string; label: string }[]).map((r) => [r.message_id, r.label])); |   return new Map();
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const st = vi.hoisted(() => ({ on: false, calls: [] as unknown[] }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => st.on }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      st.calls.push([fn, args]);
      return { data: [{ message_id: "q1", label: "Dana (helping Kaci)" }], error: null };
    },
  },
}));
import { useManagerLabels } from "./managerMode";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  st.on = false;
  st.calls = [];
});

describe("useManagerLabels", () => {
  it("makes no request while the switch is off", async () => {
    const { result } = renderHook(() => useManagerLabels("answer", ["q1"]), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 20));
    expect(st.calls).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it("with the switch on, asks once for the ids and answers id -> label", async () => {
    st.on = true;
    const { result } = renderHook(() => useManagerLabels("answer", ["q2", "q1"]), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.get("q1")).toBe("Dana (helping Kaci)"));
    expect(st.calls).toEqual([["declutter_manager_message_labels", { p_kind: "answer", p_ids: ["q1", "q2"] }]]);
  });

  it("nothing to label: no request", async () => {
    st.on = true;
    renderHook(() => useManagerLabels("order_talk", []), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 20));
    expect(st.calls).toHaveLength(0);
  });
});
