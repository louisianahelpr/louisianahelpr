import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LEAD-LIST-FOR-SELLER: a Helpr's deleted draft takes its photo objects with it. They sit in the Helpr's OWN folder
 * (`<helpr>/declutter/<item>/`), so only the Helpr can remove them, and once declutter_helpr_delete_listing has removed
 * the rows nothing else names them (they would stay public until the Helpr's account is deleted).
 *
 * @mutate src/lib/declutter/listForSeller.ts |   const { error: rmErr } = await bucket.remove(paths); |   const rmErr = null as { message: string } \| null;
 * @mutate src/lib/declutter/listForSeller.ts |   const folder = `${helprId}/declutter/${itemId}`; |   const folder = `${itemId}`;
 */
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.rpc, storage: { from: (b: string) => (h.from(b), { list: h.list, remove: h.remove }) } },
}));

import { helprDeleteListing } from "./listForSeller";

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.list.mockResolvedValue({ data: [{ name: "a.jpg" }, { name: "b.jpg" }], error: null });
  h.remove.mockResolvedValue({ data: [], error: null });
});

describe("helprDeleteListing", () => {
  it("deletes the draft, then removes exactly that draft's photos from the Helpr's folder", async () => {
    await helprDeleteListing("helpr-1", "item-1");
    expect(h.rpc).toHaveBeenCalledWith("declutter_helpr_delete_listing", { p_item_id: "item-1" });
    expect(h.from).toHaveBeenCalledWith("job-photos");
    expect(h.list).toHaveBeenCalledWith("helpr-1/declutter/item-1", expect.anything());
    expect(h.remove).toHaveBeenCalledWith(["helpr-1/declutter/item-1/a.jpg", "helpr-1/declutter/item-1/b.jpg"]);
  });

  it("a refused delete touches no object", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "item_not_a_draft", code: "22023" } });
    await expect(helprDeleteListing("helpr-1", "item-1")).rejects.toBeTruthy();
    expect(h.list).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("an object delete that fails after the draft is gone is logged, not thrown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.remove.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(helprDeleteListing("helpr-1", "item-1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
