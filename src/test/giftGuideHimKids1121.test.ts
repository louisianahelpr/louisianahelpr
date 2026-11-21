/**
 * For Him and For Kids are the owner's own Amazon saves (owner 2026-11-21: "i also added the mens stuff to the amazon
 * men list", "i did kids too in amazon list", "add all oft he things to the guides. fix them how you see fit. launch the
 * 3 guides"). Each page is ONE flat list, cheapest first, with at most 2 of a brand and 2 of an item type, every pick an
 * Amazon link with her tag and no price on the site, except the commission switches (11-21, owner: "if the items on the
 * guides can we fund at another place for higher commison just change the link"): the same item at the same price at a
 * better-paying store, a ShopMy link that shows its checked price and a transparent cutout of that store's own photo;
 * and her own ShopMy saves for men and kids (11-21: "i also added some man and kids stuff in shop my"; "the him and kids
 * need gifts on their covers"), shown the same way.
 * @mutate scripts/giftGuideHimKids1121.mjs | pageList[slug] = picks; | void picks;
 * @mutate scripts/giftGuideHimKids1121.mjs |     const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: slug, priceRank }; |     const p = { ...rest, image: r.image, ownerPick: true, from: slug, priceRank };
 * @mutate scripts/giftGuideHimKids1121.mjs |     const shown = isAmazon(r) ? r.sortPrice : price; |     const shown = isAmazon(r) ? r.sortPrice : undefined;
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIM_1121, HIM_KIDS_PRICE_AT, HIM_KIDS_STORES, HIM_SHOPMY_1121, KIDS_1121, KIDS_SHOPMY_1121, applyHimKids1121, him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";

type Pick = { name: string; brand?: string; href: string; image: string; store: string; type?: string; price?: unknown; priceAt?: unknown; sortPrice?: unknown; rels?: string[] };
/**
 * The commission switches, copied from the Desktop note Commission-switches-1121.md (not from the module): LaCrosse
 * Grange (Amazon B001DPHF4U, 4%) -> Dillard's 8%; Theragun Prime 6th Gen (Amazon B0FKCJNHWB, 1%) -> Exclusive Beauty
 * Club 16%. Kids has none.
 */
const SWITCHED: Record<string, Record<string, string>> = {
  him: { "https://go.shopmy.us/p-108736038": "store-dillards", "https://go.shopmy.us/p-108734364": "store-exclusive-beauty-club" },
  kids: {},
};
/**
 * Her ShopMy saves kept on each page (11-21), copied from the Desktop notes Him-saved-shopmy-1121.md and
 * Kids-saved-shopmy-1121.md (pin -> the store it goes to), not from the module. The rest were left out by her rules:
 * a third of one brand (Smathers & Branson, Melissa & Doug), a third of one item type, LSU, or out of stock on 11-21.
 */
const sm = (pins: string[], store: string) => Object.fromEntries(pins.map((p) => [`https://go.shopmy.us/p-${p}`, store]));
const SAVES: Record<string, Record<string, string>> = {
  him: {
    ...sm(["108628349"], "store-smathers-and-branson"), ...sm(["108628518"], "store-duck-head"),
    ...sm(["108626053", "108626008", "108626036", "108625988"], "store-grove"), ...sm(["108625882", "108625877"], "store-clinique"),
    // Owner 11-21 ("Him = ALL of her men's saves"): every other in-stock, non-LSU Smathers & Branson save, two more Dr. Squatch.
    ...sm(["108628554", "108628535", "108628533", "108628457", "108628432", "108628429", "108628421", "108628411", "108628379", "108628348", "108628058", "108628052", "108628047"], "store-smathers-and-branson"),
    ...sm(["108626037", "108625979"], "store-grove"),
  },
  kids: {
    ...sm(["108632461", "108632432", "108632392", "108632273", "108632257", "108632317", "108632251", "108632230", "108632184", "108632365", "108632379", "108632481", "108632592"], "store-maisonette"),
    ...sm(["108632104"], "store-grove"), ...sm(["108632077", "108632046"], "store-wayfair"),
    // Owner 11-21 ("same for the kids, add all items i had on the things"): every other kids save still sold.
    ...sm(["108632430", "108632133"], "store-maisonette"), ...sm(["108632086", "108632059"], "store-wayfair"),
    ...sm(["108632004", "108631991", "108631978"], "store-macys"),
  },
};
const notAmazon = (slug: string): Record<string, string> => ({ ...SWITCHED[slug], ...SAVES[slug] });
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const most = (xs: string[]) => Math.max(0, ...Object.values(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})));

describe.each([
  ["him", [...HIM_1121], him1121Picks() as Pick[]],
  ["kids", [...KIDS_1121], kids1121Picks() as Pick[]],
])("For %s is the owner's Amazon and ShopMy saves (11-21)", (slug, rows, built) => {
  const page = chunk(slug);

  it("the live page is exactly the module's list, in order", () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(page.length).toBe(rows.length);
    expect(page.map((p) => p.href)).toEqual(built.map((p) => p.href));
    expect(new Set(page.map((p) => p.href)).size).toBe(page.length);
  });

  // Owner 2026-11-21 ~12:05 PM: "each item also needs a price"; she chose "Show Amazon prices anyway" after the pop-up
  // warning that Amazon allows prices only from its PA-API feed (Associates risk). An Amazon pick now shows EXACTLY the
  // price captured from her saved list (its row's sortPrice), dated 11-21; this guard used to assert no Amazon price.
  it("every pick is an Amazon link with her tag, Amazon's own photo and its captured price, except the switches and her ShopMy saves", () => {
    const switched = notAmazon(slug);
    expect(page.filter((p) => switched[p.href]).length).toBe(Object.keys(switched).length);
    const captured = new Map(rows.map((r) => [r.href, r.sortPrice]));
    for (const p of page) {
      expect(p.sortPrice).toBeUndefined();
      if (switched[p.href]) continue;
      expect(p.href).toMatch(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=louisianahelpr-20$/);
      expect(p.image).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
      expect(p.store).toBe("store-amazon");
      expect(p.price, p.name).toBe(captured.get(p.href));
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toBe("2026-11-21");
    }
  });

  it("a switched pick or ShopMy save shows its checked price and a transparent cutout of the store's photo, never Amazon's", () => {
    const shop = notAmazon(slug);
    // Both the generated page and what the module builds now (so a module change shows before the page is regenerated).
    expect(page.filter((x) => shop[x.href])).toEqual(built.filter((x) => shop[x.href]));
    for (const p of [...page, ...built].filter((x) => shop[x.href])) {
      expect(p.store, p.name).toBe(shop[p.href]);
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.image.startsWith(CUTOUT_BASE), `${p.name}: ${p.image}`).toBe(true);
      const file = `public/gift-guides/cutouts/${p.image.slice(CUTOUT_BASE.length)}`;
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 32);
      expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${file} has no alpha`).toBe(true);
    }
  });

  it("is cheapest first", () => {
    const sorted = [...rows].sort((a, b) => a.sortPrice - b.sortPrice);
    expect((sorted as unknown as Pick[]).map((r) => r.href)).toEqual(page.map((p) => p.href));
  });

  // Owner 2026-11-21: "Him = ALL of her men's saves" and "same for the kids": brand and type caps off for her own picks
  // (each page held at most 2 of a brand and 2 of a type until then), so a brand she saved many of shows many times.
  it("holds every save of a brand she saved many of (the 2-per-brand cap is off for her own picks)", () => {
    expect(most(page.map((p) => p.brand ?? "").filter(Boolean))).toBeGreaterThan(2);
  });

  it("shows as one flat owner list (no chips, no codes box)", () => {
    expect(isOwnerList(slug)).toBe(true);
  });
});

describe("her ShopMy saves for Him and Kids (11-21)", () => {
  it("every kept save is on its page with the price checked 11-21, and its store has a shown name", () => {
    for (const [slug, rows] of [["him", HIM_SHOPMY_1121], ["kids", KIDS_SHOPMY_1121]] as const) {
      expect(new Set(rows.map((r) => r.href)), slug).toEqual(new Set(Object.keys(SAVES[slug])));
      const page = chunk(slug);
      for (const r of rows) {
        const p = page.find((x) => x.href === r.href);
        expect(p, r.name).toBeDefined();
        expect(p?.price, r.name).toBe(r.price);
        expect(p?.priceAt, r.name).toBe(HIM_KIDS_PRICE_AT);
        expect(HIM_KIDS_STORES[r.store], r.store).toBeTruthy();
        expect(r.brand.toLowerCase(), r.name).not.toMatch(/vineyard vines|lilly pulitzer/);
        expect(r.name, r.name).not.toMatch(/\bLSU\b/);
      }
    }
    expect(HIM_SHOPMY_1121.length).toBe(23);
    expect(KIDS_SHOPMY_1121.length).toBe(23);
  });
});

describe("For Him holds every one of her men's saves (owner 11-21)", () => {
  it("116 of the 122 Amazon rows in Him-saved-amazon-1121.md are on the page, with the six left out named", () => {
    // Left out, 2026-11-21: B001DPHF4U LaCrosse Grange and B0FKCJNHWB Theragun Prime (on the page at their better-paying
    // stores, above), B0002A7GMS / B07M9LRQ4J / B0FDXLSNN1 (second listings of the same items), B09ZYT939N YETI
    // Crossroads Backpack (Amazon showed no price).
    const amazon = chunk("him").filter((p) => p.store === "store-amazon").map((p) => /\/dp\/([A-Z0-9]{10})/.exec(p.href)![1]);
    expect(amazon.length).toBe(116);
    for (const asin of ["B001DPHF4U", "B0FKCJNHWB", "B0002A7GMS", "B07M9LRQ4J", "B0FDXLSNN1", "B09ZYT939N"]) expect(amazon, asin).not.toContain(asin);
    for (const asin of ["B0H7CRMDKS", "B0F22HTHMJ", "B0CQ4QM7Q2", "B0FR98X1DZ", "B0FT97QYYZ", "B0D31TCLN2"]) expect(amazon, asin).toContain(asin);
  });
});

describe("For Kids holds every one of her kids' Amazon saves (owner 11-21)", () => {
  it("all 58 Amazon rows in Kids-saved-amazon-1121.md are on the page", () => {
    const amazon = chunk("kids").filter((p) => p.store === "store-amazon");
    expect(amazon.length).toBe(58);
    for (const asin of ["B0F3GWXLTS", "B0BFJWCYTL", "B0FJ2ZHPDY", "B0CT2WN59R", "B0D6RMZ3D1", "B0DDLZV8YM"]) expect(amazon.some((p) => p.href.includes(asin)), asin).toBe(true);
  });
});

describe("the generator sets Him and Kids last", () => {
  it("applyHimKids1121 replaces both pages and names any store a switched pick goes to", () => {
    const pages: Record<string, unknown[]> = { him: [{ name: "old" }], kids: [], her: [{ name: "keep" }] };
    const stores: Record<string, { name: string; hosts: string[] }> = { "store-dillards": { name: "Dillard's", hosts: ["www.dillards.com"] } };
    const out = applyHimKids1121(pages, stores);
    expect(out.him).toEqual({ before: 1, after: HIM_1121.length });
    expect(pages.kids.length).toBe(KIDS_1121.length);
    expect(pages.her).toEqual([{ name: "keep" }]);
    expect(stores["store-dillards"]).toEqual({ name: "Dillard's", hosts: ["go.shopmy.us", "www.dillards.com"] });
    expect(stores["store-exclusive-beauty-club"]).toEqual({ name: "Exclusive Beauty Club", hosts: ["go.shopmy.us"] });
  });

  it("runs after the final sweep and before the pages are written", () => {
    const src = readFileSync("scripts/gift-guide-picks.mjs", "utf8");
    const sweep = src.indexOf("console.log(`gift-guide-picks: final sweep");
    const apply = src.lastIndexOf("applyHimKids1121(pageList, storeList)");
    const write = src.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(sweep).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(sweep);
    expect(write).toBeGreaterThan(apply);
  });

  it("men's picks keep relationship tags so /dad and /husband still build", () => {
    const him = chunk("him");
    for (const rel of ["dad", "husband", "boyfriend", "brother"]) expect(him.filter((p) => p.rels?.includes(rel)).length).toBeGreaterThan(10);
  });
});
