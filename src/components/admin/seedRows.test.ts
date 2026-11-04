/**
 * Owner 2026-11-04 ("nothing test account should show on any real admin stuff"): withoutTestPeople drops every
 * row that names a test (is_seed) account, keeps the rest, and throws on a failed read (never shows rows untagged).
 * Inventory guard: src/components/admin/adminReadsDropTestRows.test.ts.
 *
 * @mutate src/components/admin/seedRows.ts |   return rows.filter((r) => !people(r).some((id) => !!id && seed.has(id))); |   return rows;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const seedIds = vi.fn<() => Promise<{ data: { user_id: string }[] | null; error: { message: string } | null }>>();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: () => ({ eq: () => seedIds() }) }) }) },
}));

import { withoutTestPeople } from "@/components/admin/seedRows";

beforeEach(() => seedIds.mockReset());

describe("withoutTestPeople", () => {
  const rows = [
    { id: "a", poster: "real-1", helpr: "real-2" },
    { id: "b", poster: "seed-1", helpr: "real-2" },
    { id: "c", poster: "real-1", helpr: "seed-2" },
    { id: "d", poster: null, helpr: "real-3" },
  ];
  it("drops every row that names a test account on either side", async () => {
    seedIds.mockResolvedValue({ data: [{ user_id: "seed-1" }, { user_id: "seed-2" }], error: null });
    const out = await withoutTestPeople(rows, (r) => [r.poster, r.helpr]);
    expect(out.map((r) => r.id)).toEqual(["a", "d"]);
  });
  it("keeps every row when nobody is a test account, and asks nothing for an empty list", async () => {
    seedIds.mockResolvedValue({ data: [], error: null });
    expect((await withoutTestPeople(rows, (r) => [r.poster, r.helpr])).length).toBe(4);
    expect(await withoutTestPeople([], () => ["x"])).toEqual([]);
    expect(seedIds).toHaveBeenCalledTimes(1);
  });
  it("throws on a failed read", async () => {
    seedIds.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(withoutTestPeople(rows, (r) => [r.poster])).rejects.toThrow();
  });
});
