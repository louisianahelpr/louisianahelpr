/**
 * A2-13 (audit2 SH2-4): the admin problem card reads its detail from the
 * admin-only declutter_admin_open_problems. Until that function is on prod
 * (PGRST202 with no hint naming it) the card gets what it always got, the
 * problems table rows, with no detail; any other error is a real failure.
 *
 * @mutate src/lib/declutter/handover.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_admin_open_problems")) { |   if (res.error && false) {
 * @mutate src/lib/declutter/handover.ts |   const res = await supabase.rpc("declutter_admin_open_problems", { p_include_test: includeTest }); |   const res = await supabase.rpc("declutter_admin_open_problems");
 * @mutate src/lib/declutter/handover.ts |     id: problem_id, order_id, reporter_side, reason, note, photo_paths: problem_photo_paths, created_at: reported_at, |     id: order_id, order_id, reporter_side, reason, note, photo_paths: problem_photo_paths, created_at: reported_at,
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { rpc: { data: unknown; error: unknown }; table: unknown[]; args: unknown[] } = { rpc: { data: null, error: null }, table: [], args: [] };

vi.mock("@/integrations/supabase/client", () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: state.table, error: null }) };
  return { supabase: { rpc: async (_fn: string, args?: unknown) => { state.args.push(args); return state.rpc; }, from: () => chain } };
});
vi.mock("@/lib/lifecycleErrors", () => ({
  rpcErrorMessage: () => null,
  loadAdminRpcErrorCopy: async () => ({ rpcErrorMessage: () => null }),
}));

import { fetchOpenProblemsWithDetail } from "./handover";

const tableRow = { id: "p1", order_id: "o1", reporter_side: "buyer", reason: "damaged", note: "Broken leg.", photo_paths: [], created_at: "2026-10-16T12:00:00Z" };

beforeEach(() => {
  state.rpc = { data: null, error: null };
  state.table = [tableRow];
  state.args = [];
});

describe("fetchOpenProblemsWithDetail", () => {
  it("falls back to the problems table, with no detail, while the function is not on prod", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_admin_open_problems without parameters", hint: null } };
    expect(await fetchOpenProblemsWithDetail()).toEqual([{ ...tableRow, detail: null }]);
  });

  it("maps the function's rows: the problem's own id, and everything else as detail", async () => {
    state.rpc = {
      error: null,
      data: [{
        problem_id: "p9", order_id: "o9", reporter_side: "seller", reason: "no_show", note: "Never came.", problem_photo_paths: null, reported_at: "2026-10-17T08:00:00Z",
        handover: "pickup_home", items_cents: 1500, bundle_discount_cents: null, delivery_cents: null, premium_cents: 225, tax_cents: 0, total_cents: 1725, paid_at: null,
        item_titles: ["Mug"], item_photo_paths: null, buyer_name: "B", seller_name: "S", set_out_photo_path: null, set_out_at: null,
        picked_up_photo_path: null, picked_up_at: null, picked_up_distance_m: null, confirmed_at: null, confirmed_by: null, helpr_delivery: false,
      }],
    };
    const [p] = await fetchOpenProblemsWithDetail();
    expect(p.id).toBe("p9");
    expect(p.created_at).toBe("2026-10-17T08:00:00Z");
    expect(p.detail?.item_titles).toEqual(["Mug"]);
    expect(p.detail?.item_photo_paths).toEqual([]);
    expect(p.detail?.total_cents).toBe(1725);
  });

  // Audit 1028 part 2, D2-4: the server hides test (is_seed) orders unless asked; "Show test listings" asks.
  it("sends p_include_test: false by default, true when the admin shows test listings (D2-4)", async () => {
    state.rpc = { data: [], error: null };
    await fetchOpenProblemsWithDetail();
    await fetchOpenProblemsWithDetail(true);
    expect(state.args).toEqual([{ p_include_test: false }, { p_include_test: true }]);
  });

  it("any other error is thrown, never read as 'not deployed'", async () => {
    state.rpc = { data: null, error: { code: "42501", message: "not_admin" } };
    await expect(fetchOpenProblemsWithDetail()).rejects.toThrow();
  });
});
