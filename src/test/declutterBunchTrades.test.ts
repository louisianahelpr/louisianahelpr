/**
 * Declutter trades item 4 (lead 11-06 12:15: the Trades switch in Sell a bunch ONLY; the one-item form keeps its six
 * fields and the saved default): each priced bunch item goes up "Open to trades" when its own switch says so, else
 * when the seller's saved default does (off when nothing is saved). Only ON is sent (a new item takes no trades), on
 * the draft, and a refusal never stops the listing: the results screen names it.
 *
 * @mutate src/lib/declutter/bunch.ts |   return !it.free && (it.acceptsTrades ?? choices.acceptsTrades ?? false); |   return !it.free && (choices.acceptsTrades ?? false);
 * @mutate src/lib/declutter/bunch.ts |   return !it.free && (it.acceptsTrades ?? choices.acceptsTrades ?? false); |   return it.acceptsTrades ?? choices.acceptsTrades ?? false;
 * @mutate src/lib/declutter/bunch.ts |           await deps.setTradeRules(draftId, true); |           void draftId;
 * @mutate src/lib/declutter/bunch.ts |           console.warn("[declutter] could not turn on Open to trades", err);\n          return true; |           console.warn("[declutter] could not turn on Open to trades", err);\n          return false;
 * @mutate src/lib/declutter/bunch.ts | ...(p.tradesFailed ? { tradesFailed: true } : {}) }); | });
 */
import { describe, expect, it, vi } from "vitest";
import { blankItem, bunchItemTakesTrades, listBunch, type BunchChoices, type BunchItem, type ListDeps } from "@/lib/declutter/bunch";

const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
const BASE: BunchChoices = { keepUp: false, drops: false, dropPct: 10, floorPct: 50 };

function item(key: string, extra: Partial<BunchItem> = {}): BunchItem {
  return { ...blankItem(["p1"]), key, title: `Chair ${key}`, description: "Solid.", category: "furniture", price: "40", sizeUnknown: false, ...extra };
}
function deps(over: Partial<ListDeps> = {}): ListDeps {
  let n = 0;
  return {
    createMoveDraft: vi.fn(async () => "moved"),
    createDraft: vi.fn(async () => `id${++n}`),
    updateDraft: vi.fn(async (id: string) => id),
    removePhoto: vi.fn(async () => {}),
    itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
    withdrawItem: vi.fn(async () => {}),
    addPhoto: vi.fn(async () => ({}) as never),
    setHandovers: vi.fn(async (_id, w) => w),
    setDropPct: vi.fn(async (_id, p) => p),
    setKeepUp: vi.fn(async (_id, on) => on),
    setAutoFreeDays: vi.fn(async (_id: string, d: number | null) => d),
    setOfferRules: vi.fn(async () => {}),
    setTradeRules: vi.fn(async () => {}),
    publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
    ...over,
  };
}
const photos = new Map([["p1", new File(["p1"], "p1.jpg", { type: "image/jpeg" })]]);
const run = (items: BunchItem[], d: ListDeps, choices: BunchChoices) =>
  listBunch("seller", items, photos, place, ["porch"], () => {}, d, undefined, choices);

describe("Sell a bunch: Open to trades per item", () => {
  it("an item's own switch wins, else the saved default, else off; a free item is never traded", () => {
    expect(bunchItemTakesTrades({}, {})).toBe(false);
    expect(bunchItemTakesTrades({}, { acceptsTrades: true })).toBe(true);
    expect(bunchItemTakesTrades({ acceptsTrades: false }, { acceptsTrades: true })).toBe(false);
    expect(bunchItemTakesTrades({ acceptsTrades: true }, {})).toBe(true);
    expect(bunchItemTakesTrades({ free: true, acceptsTrades: true }, { acceptsTrades: true })).toBe(false);
  });

  it("only the items that take trades get it turned on, on their own draft", async () => {
    const d = deps();
    const out = await run([
      item("a", { acceptsTrades: true }),
      item("b"),
      item("c", { acceptsTrades: false }),
      item("d", { free: true, price: "", acceptsTrades: true }),
    ], d, { ...BASE, acceptsTrades: true });
    // a: its own ON; b: follows the saved ON; c: its own OFF; d: free.
    expect(d.setTradeRules).toHaveBeenCalledTimes(2);
    expect(d.setTradeRules).toHaveBeenCalledWith("id1", true);
    expect(d.setTradeRules).toHaveBeenCalledWith("id2", true);
    expect(out.every((o) => "status" in o && !("tradesFailed" in o))).toBe(true);
  });

  it("nothing saved and no switch flipped: nothing is sent", async () => {
    const d = deps();
    await run([item("a"), item("b")], d, BASE);
    expect(d.setTradeRules).not.toHaveBeenCalled();
  });

  it("a refusal never stops the listing, and the item says trades didn't turn on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({ setTradeRules: vi.fn(async () => { throw new Error("network_error"); }) });
    const out = await run([item("a", { acceptsTrades: true }), item("b")], d, BASE);
    expect(out.map((o) => ("status" in o ? o.status : "error"))).toEqual(["live", "live"]);
    expect(out.map((o) => ("tradesFailed" in o ? o.tradesFailed : false))).toEqual([true, false]);
    expect(warn).toHaveBeenCalledWith("[declutter] could not turn on Open to trades", expect.any(Error));
    warn.mockRestore();
  });
});
