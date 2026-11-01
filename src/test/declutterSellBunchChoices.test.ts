/**
 * Sell a bunch audit, finding 9: a bunch listing gets the same choices as the single form. Lowering the price and
 * Keep it up start from the seller's remembered choices (both ON by default), and an item can be given away free.
 * Before this every bunch item was saved with its lowest price = its price (it never dropped) and without Keep it up,
 * and a price under $1 was refused, so nothing could be given away.
 *
 * Lead 11-01 ("The Sell a bunch bug: it never applies the seller's make it free after N days"): each priced item gets
 * the seller's saved day count, a free one does not, Never sets nothing, and a refusal never stops the listing.
 * @mutate src/lib/declutter/bunch.ts |           await deps.setAutoFreeDays(draftId, choices.freeAfterDays); |           void choices.freeAfterDays;
 * @mutate src/lib/declutter/bunch.ts |         if (it.free \|\| choices.freeAfterDays == null) return; |         if (choices.freeAfterDays == null) return;
 * @mutate src/components/declutter/BunchChoices.tsx | acceptsOffers: row.acceptsOffers, freeAfterDays: row.freeAfterDays }); | acceptsOffers: row.acceptsOffers });
 * @mutate src/lib/declutter/bunch.ts |         if (!it.free) await deps.setDropPct(draftId, choice.dropPct); |         void choice.dropPct;
 * @mutate src/lib/declutter/bunch.ts |         if (!choices.keepUp) return false; |         if (true) return false;
 * @mutate src/lib/declutter/bunch.ts |         await deps.setHandovers(draftId, it.free ? ["porch"] : ways); |         await deps.setHandovers(draftId, ways);
 * @mutate src/lib/declutter/bunch.ts |   const row = moveRowProblem({ title: it.title, price: it.free ? "1" : it.price, floor: "" }) |   const row = moveRowProblem({ title: it.title, price: it.price, floor: "" })
 * @mutate src/lib/declutter/bunch.ts | floor: floorFromPct(dollars, choices.floorPct) | floor: dollars
 * @mutate src/lib/declutter/bunch.ts |           console.warn("[declutter] could not turn on Keep it up", err);\n          return true; |           console.warn("[declutter] could not turn on Keep it up", err);\n          return false;
 */
import { describe, expect, it, vi } from "vitest";
import { blankItem, bunchItemProblem, bunchListable, listBunch, type BunchChoices, type BunchItem, type ListDeps } from "@/lib/declutter/bunch";

const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
const ON: BunchChoices = { keepUp: true, drops: true, dropPct: 10, floorPct: 50 };
const OFF: BunchChoices = { keepUp: false, drops: false, dropPct: 10, floorPct: 50 };

function item(extra: Partial<BunchItem>): BunchItem {
  return { ...blankItem(["p1", "p2"]), title: "Oak chair", description: "Solid.", category: "furniture", price: "40", sizeUnknown: false, ...extra };
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
    publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
    ...over,
  };
}
const photos = new Map(["p1", "p2"].map((k) => [k, new File([k], `${k}.jpg`, { type: "image/jpeg" })]));
const run = (items: BunchItem[], d: ListDeps, choices: BunchChoices, ways: ("porch" | "meetup")[] = ["porch", "meetup"]) =>
  listBunch("seller", items, photos, place, ways, () => {}, d, undefined, choices);

describe("while the setup fee is due", () => {
  const ready = (over: Partial<BunchItem>): BunchItem => ({ ...blankItem(["a"]), title: "Rug", price: "20", sizeUnknown: false, ...over });
  it("only free items go; a priced one and an unready one do not, and with no fee due every ready item goes", () => {
    const free = ready({ key: "free", free: true, price: "" });
    const priced = ready({ key: "priced" });
    const unnamed = ready({ key: "unnamed", free: true, title: "" });
    expect(bunchListable([free, priced, unnamed], true).map((i) => i.key)).toEqual(["free"]);
    expect(bunchListable([free, priced, unnamed], false).map((i) => i.key)).toEqual(["free", "priced"]);
  });
});

describe("Sell a bunch: the batch's choices reach each item", () => {
  it("drops on: the lowest price is the seller's share of the price, and the step is saved", async () => {
    const d = deps();
    await run([item({ price: "$1,000" })], d, ON);
    expect(d.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 100_000, floorPriceCents: 50_000 }), expect.any(String));
    expect(d.setDropPct).toHaveBeenCalledWith("id1", 10);
  });

  it("drops off: the lowest price is the price, and the step is 0", async () => {
    const d = deps();
    await run([item({})], d, OFF);
    expect(d.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 4000, floorPriceCents: 4000 }), expect.any(String));
    expect(d.setDropPct).toHaveBeenCalledWith("id1", 0);
  });

  it("a $1 item has nothing lower to drop to: it lists with no drops", async () => {
    const d = deps();
    const out = await run([item({ price: "1" })], d, ON);
    expect(d.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 100, floorPriceCents: 100 }), expect.any(String));
    expect(d.setDropPct).toHaveBeenCalledWith("id1", 0);
    expect(out[0]).toMatchObject({ status: "live" });
  });

  it("Keep it up goes on each item only when it's on", async () => {
    const on = deps();
    await run([item({}), item({})], on, ON);
    expect(on.setKeepUp).toHaveBeenCalledTimes(2);
    expect(on.setKeepUp).toHaveBeenCalledWith("id2", true);
    const off = deps();
    await run([item({})], off, OFF);
    expect(off.setKeepUp).not.toHaveBeenCalled();
  });

  it("Keep it up failing never stops the listing, and the outcome says so", async () => {
    const d = deps({ setKeepUp: vi.fn(async () => { throw new Error("nope"); }) });
    const out = await run([item({})], d, ON);
    expect(out[0]).toMatchObject({ status: "live", keepUpFailed: true });
    expect(d.publishMany).toHaveBeenCalledWith(["id1"], expect.any(Function));
  });

  it("a free item: price and lowest price 0, porch pickup only, no drop step, still lists", async () => {
    const d = deps();
    const out = await run([item({ free: true, price: "" })], d, ON);
    expect(d.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 0, floorPriceCents: 0 }), expect.any(String));
    expect(d.setHandovers).toHaveBeenCalledWith("id1", ["porch"]);
    expect(d.setDropPct).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ status: "live" });
  });

  it("a priced item beside it keeps the batch's ways", async () => {
    const d = deps();
    await run([item({ free: true }), item({})], d, ON);
    expect(d.setHandovers).toHaveBeenCalledWith("id2", ["porch", "meetup"]);
  });
});

describe("Sell a bunch: what makes an item ready", () => {
  it("a free item needs no price; a priced one still does", () => {
    expect(bunchItemProblem(item({ free: true, price: "" }))).toBeNull();
    expect(bunchItemProblem(item({ price: "" }))).toMatch(/price/);
  });
  it("a free item still needs a name", () => {
    expect(bunchItemProblem(item({ free: true, price: "", title: "" }))).toMatch(/name/);
  });
});

describe("Sell a bunch: make it free after N days (lead 11-01)", () => {
  it("a priced item gets the saved day count; a free one does not; Never sets nothing", async () => {
    const d = deps();
    await run([item({ key: "a" }), item({ key: "b", free: true, price: "" })], d, { ...ON, freeAfterDays: 14 });
    expect(d.setAutoFreeDays).toHaveBeenCalledTimes(1);
    expect(d.setAutoFreeDays).toHaveBeenCalledWith("id1", 14);
    const never = deps();
    await run([item({})], never, { ...ON, freeAfterDays: null });
    expect(never.setAutoFreeDays).not.toHaveBeenCalled();
  });

  it("a refused day count never stops the item listing", async () => {
    const d = deps({ setAutoFreeDays: vi.fn(async () => { throw new Error("nope"); }) });
    const out = await run([item({})], d, { ...ON, freeAfterDays: 7 });
    expect([...out.values()].map((o) => ("status" in o ? o.status : "error"))).toEqual(["live"]);
  });
});
