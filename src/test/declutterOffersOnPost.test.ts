/**
 * LEAD-OFFERS-CHOICE part (2) (owner, 2026-10-31): a new listing's "Accept offers", on the one-item form and per item
 * in Sell a bunch, starts from the saved default and is saved with the item when it posts (declutter_set_offer_rules
 * on the draft, which 20261031201036 allows; before that is live, again once the item is up).
 *
 * @mutate src/lib/declutter/offersOnPost.ts |     if (String((err as Error)?.message ?? "").includes("item_not_editable")) return "after"; |     if (false) return "after";
 * @mutate src/lib/declutter/offersOnPost.ts |   if (status !== "live") throw | if (false) throw
 * @mutate src/lib/declutter/bunch.ts |   return !it.free && (it.acceptsOffers ?? choices.acceptsOffers ?? true); |   return !it.free && (it.acceptsOffers ?? true);
 * @mutate src/lib/declutter/bunch.ts |         if (it.free \|\| bunchItemTakesOffers(it, choices)) return "done"; |         if (bunchItemTakesOffers(it, choices)) return "done";
 * @mutate src/lib/declutter/bunch.ts |       if (p.offersAfter) { |       if (false) {
 * @mutate src/lib/declutter/bunch.ts | ...(offersFailed ? { offersFailed: true } : {}) | ...{}
 * @mutate src/lib/declutter/bunch.ts |       const offersFailed = offers.status === "fulfilled" && offers.value === "failed"; |       const offersFailed = false;
 */
import { describe, expect, it, vi } from "vitest";
import { blankItem, bunchItemTakesOffers, listBunch, type BunchChoices, type BunchItem, type ListDeps } from "@/lib/declutter/bunch";
import { offersOffAfterPublish, offersOffOnDraft } from "@/lib/declutter/offersOnPost";

const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
const CHOICES: BunchChoices = { keepUp: false, drops: false, dropPct: 10, floorPct: 50 };
const photos = new Map(["p1"].map((k) => [k, new File([k], `${k}.jpg`, { type: "image/jpeg" })]));

function item(key: string, extra: Partial<BunchItem> = {}): BunchItem {
  return { ...blankItem(["p1"]), key, title: `Chair ${key}`, description: "Solid.", category: "furniture", price: "40", sizeUnknown: false, ...extra };
}

/** The server's calls, in the order they happened. */
function deps(log: string[], over: Partial<ListDeps> = {}): ListDeps {
  let n = 0;
  return {
    createMoveDraft: vi.fn(async () => "moved"),
    createDraft: vi.fn(async () => `id${++n}`),
    updateDraft: vi.fn(async (id: string) => id),
    removePhoto: vi.fn(async () => {}),
    itemStatuses: vi.fn(async () => new Map()),
    withdrawItem: vi.fn(async () => {}),
    addPhoto: vi.fn(async () => ({}) as never),
    setHandovers: vi.fn(async (_id, w) => w),
    setDropPct: vi.fn(async (_id, p) => p),
    setKeepUp: vi.fn(async (_id, on) => on),
    setOfferRules: vi.fn(async (id: string, accepts: boolean, auto: boolean) => void log.push(`offers ${id} ${accepts} ${auto}`)),
    publishMany: vi.fn(async (ids: string[]) => {
      log.push(`publish ${ids.join(",")}`);
      return ids.map((id) => ({ id, status: "live" as const }));
    }),
    ...over,
  };
}
const run = (items: BunchItem[], d: ListDeps, choices: BunchChoices = CHOICES) =>
  listBunch("seller", items, photos, place, ["porch"], () => {}, d, undefined, choices);

describe("offersOffOnDraft / offersOffAfterPublish", () => {
  it("sends offers off (and auto off) for the draft", async () => {
    const set = vi.fn(async () => {});
    expect(await offersOffOnDraft("d1", set)).toBe("done");
    expect(set).toHaveBeenCalledWith("d1", false, false);
  });
  it("a server that can't change a draft yet answers 'after'; any other refusal is thrown", async () => {
    expect(await offersOffOnDraft("d1", async () => { throw new Error("item_not_editable"); })).toBe("after");
    await expect(offersOffOnDraft("d1", async () => { throw new Error("account_restricted"); })).rejects.toThrow("account_restricted");
  });
  it("after publish: sent for a live item; one held for a check is said, never sent", async () => {
    const set = vi.fn(async () => {});
    await offersOffAfterPublish("d1", "live", set);
    expect(set).toHaveBeenCalledWith("d1", false, false);
    set.mockClear();
    await expect(offersOffAfterPublish("d1", "pending_review", set)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });
});

describe("Sell a bunch: each item's Accept offers", () => {
  it("follows the saved default unless the item has its own; a free item never takes offers", () => {
    expect(bunchItemTakesOffers({}, {})).toBe(true);
    expect(bunchItemTakesOffers({}, { acceptsOffers: false })).toBe(false);
    expect(bunchItemTakesOffers({ acceptsOffers: true }, { acceptsOffers: false })).toBe(true);
    expect(bunchItemTakesOffers({ acceptsOffers: false }, { acceptsOffers: true })).toBe(false);
    expect(bunchItemTakesOffers({ free: true }, { acceptsOffers: true })).toBe(false);
  });

  it("an item turned off is saved off on its draft BEFORE it is listed; the others are left as the server makes them", async () => {
    const log: string[] = [];
    const out = await run([item("a", { acceptsOffers: false }), item("b"), item("c", { free: true, price: "" })], deps(log));
    expect(out.map((o) => ("status" in o ? o.status : "error"))).toEqual(["live", "live", "live"]);
    expect(log).toEqual(["offers id1 false false", "publish id1,id2,id3"]);
  });

  it("the saved default off turns offers off on every priced item without its own choice", async () => {
    const log: string[] = [];
    await run([item("a"), item("b", { acceptsOffers: true })], deps(log), { ...CHOICES, acceptsOffers: false });
    expect(log).toEqual(["offers id1 false false", "publish id1,id2"]);
  });

  it("before 20261031201036 is live (item_not_editable on a draft): sent again once the item is up", async () => {
    const log: string[] = [];
    let tries = 0;
    const d = deps(log, {
      setOfferRules: vi.fn(async (id: string) => {
        tries += 1;
        if (tries === 1) throw new Error("item_not_editable");
        log.push(`offers ${id} after`);
      }),
    });
    const out = await run([item("a", { acceptsOffers: false })], d);
    expect(log).toEqual(["publish id1", "offers id1 after"]);
    expect(out[0]).not.toHaveProperty("offersFailed");
  });

  it("offers that could not be turned off are said on the result, and the item still lists", async () => {
    const d = deps([], { setOfferRules: vi.fn(async () => { throw new Error("network_error"); }) });
    const out = await run([item("a", { acceptsOffers: false })], d);
    expect(out[0]).toMatchObject({ status: "live", offersFailed: true });
  });
});
