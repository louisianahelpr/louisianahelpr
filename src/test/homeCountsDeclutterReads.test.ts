/**
 * A3-81 remainder (audit 11-01, HIGH; B124): the two reads Home's to-dos use for a Declutter refund request waiting on
 * the member and the free giver's pick. fetchFreeAsksToPick groups the giver's open asks per item, with the title and
 * how many asked; fetchMyRefundTodos calls declutter_my_refund_todos and, before that read is on the server
 * (PGRST202 naming it), returns none so Home shows what it showed before.
 *
 * @mutate src/lib/declutter/api.ts |     if (had) had.asked++; |     if (had) had.asked += 0;
 * @mutate src/lib/declutter/api.ts |       .eq("seller_id", userId).eq("status", "open").order("created_at", { ascending: true }),\n  ) ?? []) as unknown as { item_id: string; | .eq("seller_id", userId).order("created_at", { ascending: true }),\n  ) ?? []) as unknown as { item_id: string;
 * @mutate src/lib/declutter/refundRequests.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_my_refund_todos")) return []; |   if (false) return [];
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const ops: [string, unknown[]][] = [];
  const rpcs: string[] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    builder[m] = (...a: unknown[]) => {
      ops.push([m, a]);
      return builder;
    };
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const supabase = {
    from: (t: string) => {
      ops.push(["from", [t]]);
      return builder;
    },
    rpc: (name: string) => {
      rpcs.push(name);
      return Promise.resolve(next());
    },
  };
  return { queue, ops, rpcs, supabase };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import { fetchFreeAsksToPick } from "@/lib/declutter/api";
import { fetchMyRefundTodos } from "@/lib/declutter/refundRequests";

describe("Home's Declutter reads (A3-81 remainder)", () => {
  it("fetchFreeAsksToPick: the giver's OPEN asks, grouped per item with the title and how many asked", async () => {
    h.queue.push({
      data: [
        { item_id: "a", created_at: "2026-11-01T10:00:00Z", declutter_items: { title: "Patio chairs" } },
        { item_id: "b", created_at: "2026-11-01T11:00:00Z", declutter_items: { title: "Rug" } },
        { item_id: "a", created_at: "2026-11-01T12:00:00Z", declutter_items: { title: "Patio chairs" } },
      ],
      error: null,
    });
    expect(await fetchFreeAsksToPick("me")).toEqual([
      { item_id: "a", title: "Patio chairs", asked: 2, first_at: "2026-11-01T10:00:00Z" },
      { item_id: "b", title: "Rug", asked: 1, first_at: "2026-11-01T11:00:00Z" },
    ]);
    expect(h.ops).toContainEqual(["from", ["declutter_free_requests"]]);
    expect(h.ops).toContainEqual(["eq", ["seller_id", "me"]]);
    expect(h.ops).toContainEqual(["eq", ["status", "open"]]);
  });

  it("fetchMyRefundTodos: the rows of declutter_my_refund_todos; none before the read is deployed; a real error throws", async () => {
    const row = { request_id: "r1", order_id: "o1", my_side: "seller", status: "open", due_at: "2026-11-02T12:00:00Z", title: "Lamp", item_count: 1 };
    h.queue.push({ data: [row], error: null });
    expect(await fetchMyRefundTodos()).toEqual([row]);
    expect(h.rpcs.at(-1)).toBe("declutter_my_refund_todos");
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_refund_todos without parameters in the schema cache", hint: null } });
    expect(await fetchMyRefundTodos()).toEqual([]);
    h.queue.push({ data: null, error: { code: "42501", message: "not_authenticated" } });
    await expect(fetchMyRefundTodos()).rejects.toBeTruthy();
  });
});
