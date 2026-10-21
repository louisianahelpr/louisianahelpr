/**
 * Q2269: the moving sale's dates line and the seller's "name the sale" call.
 *
 * @mutate src/lib/declutter/movingSale.ts |   return `${short(startsOn)} – ${short(moveOutOn)} · ${items}`; |   return `${short(moveOutOn)} · ${items}`;
 * @mutate src/lib/declutter/moves.ts |   if (error && isMissingRpcNamed(error, "declutter_set_moving_sale")) return "not_deployed"; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ next: { data: null as unknown, error: null as unknown }, calls: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (...a: unknown[]) => { h.calls.push(a); return h.next; } },
}));

import { movingSaleLine, movingSaleWhen } from "./movingSale";
import { setMovingSale } from "./moves";

beforeEach(() => { h.calls.length = 0; h.next = { data: null, error: null }; });

describe("Q2269 moving sale name and dates", () => {
  it("with a start date: 'Oct 30 – Nov 1 · 2 items for sale'; without one: the move-out line as before", () => {
    expect(movingSaleWhen("2026-10-30", "2026-11-01", 2, "2026-10-20")).toBe("Oct 30 – Nov 1 · 2 items for sale");
    expect(movingSaleWhen("2026-10-30", "2026-11-01", 1, "2026-10-20", true)).toBe("Oct 30 – Nov 1 · 1+ items for sale");
    expect(movingSaleWhen(null, "2026-11-01", 2, "2026-10-20")).toBe(movingSaleLine("2026-11-01", 2, "2026-10-20"));
  });

  it("setMovingSale sends the name and start; before the migration it answers not_deployed; a refusal throws", async () => {
    h.next = { data: 3, error: null };
    expect(await setMovingSale("Moving to Lafayette", "2026-10-30")).toBe(3);
    expect(h.calls[0]).toEqual(["declutter_set_moving_sale", { p_name: "Moving to Lafayette", p_starts_on: "2026-10-30" }]);
    h.next = { data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_set_moving_sale(p_name, p_starts_on) in the schema cache", hint: null } };
    expect(await setMovingSale("x", null)).toBe("not_deployed");
    h.next = { data: null, error: { code: "23514", message: "sale_name_contact_info" } };
    await expect(setMovingSale("call 555-1234", null)).rejects.toThrow();
  });
});
