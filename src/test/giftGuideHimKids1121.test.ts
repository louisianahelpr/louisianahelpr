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
import { HIM_1121, HIM_POPULAR_1122, KIDS_POPULAR_1122, HIM_KIDS_PRICE_AT, HIM_KIDS_STORES, HIM_SHOPMY_1121, KIDS_1121, KIDS_SHOPMY_1121, applyHimKids1121, him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { HIM_ADDS_1122, KIDS_ADDS_1122 } from "../../scripts/giftGuideOwnerAdds1122.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";

type Pick = { name: string; brand?: string; href: string; image: string; store: string; type?: string; price?: unknown; priceAt?: unknown; sortPrice?: unknown; rels?: string[] };
/**
 * The commission switches, copied from the Desktop note Commission-switches-1121.md (not from the module): LaCrosse
 * Grange (Amazon B001DPHF4U, 4%) -> Dillard's 8%; Theragun Prime 6th Gen (Amazon B0FKCJNHWB, 1%) -> Exclusive Beauty
 * Club 16%; XTRATUF Ankle Deck Boot (Amazon B08Q1RN656, Duck Camo, 4%) -> xtratuf.com through CJ 15% (owner 2026-11-21
 * ~10 PM, via lead: "xtratuf in the guide"; ~10:15 PM "do a different color for the boot because the cup is the same
 * print": the classic Chocolate/Tan, style 22734, $115 there, code XT25 on the card through Nov 29); Turtlebox Ranger,
 * Tan (Amazon B0F2JHSGCJ, 3%) -> Onward Reserve 15% at $250 (11-21 night, owner-approved). Kids has none.
 */
const SWITCHED: Record<string, Record<string, string>> = {
  him: { "https://go.shopmy.us/p-108736038": "store-dillards", "https://go.shopmy.us/p-108734364": "store-exclusive-beauty-club", "https://go.shopmy.us/p-108736312": "store-onward-reserve", 
    // Night links 11-21 (Commission-links-1121-night.md; owner: "switch all 3 to the higher commission"):
    "https://go.shopmy.us/p-108999848": "store-onward-reserve", "https://go.shopmy.us/p-109000336": "store-l-l-bean", "https://go.shopmy.us/p-109001581": "store-yeti", "https://go.shopmy.us/p-109003412": "store-yeti", "https://go.shopmy.us/p-109003630": "store-yeti", "https://go.shopmy.us/p-109003793": "store-yeti", "https://go.shopmy.us/p-109003951": "store-yeti", "https://go.shopmy.us/p-109004058": "store-yeti", "https://go.shopmy.us/p-109004159": "store-yeti", "https://go.shopmy.us/p-109004254": "store-yeti", "https://go.shopmy.us/p-109004991": "store-tractor-supply", "https://go.shopmy.us/p-109005400": "store-tractor-supply",
    "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2F22734": "store-xtratuf",
    // Rate switches 11-21 night (Commission-rates-search-1121-night.md): 3 XTRATUF at xtratuf.com via CJ 15% (XT25), TNF beanie at
    // JD Sports 15%, Burlebo hoodie and cap at burlebo.com 12%.
    "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxmabmob": "store-xtratuf",
    "https://go.shopmy.us/p-109003932": "store-jd-sports", "https://go.shopmy.us/p-109005228": "store-burlebo", "https://go.shopmy.us/p-109005373": "store-burlebo",
    // Launch day 11-22 (Owner-adds-1122.md): her older Lake Pajamas pins, sent for Him.
    "https://go.shopmy.us/p-103892269": "store-lake-pajamas", "https://go.shopmy.us/p-104054474": "store-lake-pajamas",
    // Batch 1 for Him 11-22: her Nov 19 pins (prices as checked 11-20).
    "https://go.shopmy.us/p-107850277": "store-l-l-bean", "https://go.shopmy.us/p-107837448": "store-l-l-bean", "https://go.shopmy.us/p-107881822": "store-the-warming-store",
    "https://go.shopmy.us/p-107847793": "store-cavenders", "https://go.shopmy.us/p-107895312": "store-tractor-supply", "https://go.shopmy.us/p-109208695": "store-smathers-and-branson",
    "https://go.shopmy.us/p-109208941": "store-marley-lilly",
    "https://go.shopmy.us/p-107895486": "store-tractor-supply",
    // builder-guide-links 11-22.
    "https://go.shopmy.us/p-109199365": "store-saks-fifth-avenue", "https://go.shopmy.us/p-109203985": "store-st-bernard", "https://go.shopmy.us/p-109204287": "store-dsw",
    // Batch 3 11-22.
    "https://go.shopmy.us/p-108089555": "store-jomashop", "https://go.shopmy.us/p-108090009": "store-duck-head", "https://go.shopmy.us/p-108089972": "store-st-bernard", "https://go.shopmy.us/p-108094779": "store-l-l-bean" },
  // Rate switch 11-21 night: Segway Ninebot S2 (Amazon B0CT2WN59R, 3%) -> Tractor Supply 8% at $484.99.
  kids: { "https://go.shopmy.us/p-109001528": "store-tractor-supply",
    // Launch day 11-22 (Owner-adds-1122.md): her two Camp Snap 2 colors, pinned at The Swank Company (p-109142125,
    // p-109142226, $69.99), are on her Camp Snap direct pins instead (owner 11-22: the $59.99 sale and her code LEXILOMBAS7).
    "https://go.shopmy.us/p-107929152": "store-camp-snap", "https://go.shopmy.us/p-104219842": "store-camp-snap",
    // Owner via the lead, 11-22: her EADEM New Classics Set pin goes on Kids.
    "https://go.shopmy.us/p-109155269": "store-eadem",
    // Owner via the lead, 11-22: both Yoto 4th Gen bundles (Ms. Rachel, Bluey).
    "https://go.shopmy.us/p-109156467": "store-yoto", "https://go.shopmy.us/p-109156399": "store-yoto",
    "https://go.shopmy.us/p-109208209": "store-crunchlabs", "https://go.shopmy.us/p-103757260": "store-maisonette" },
};
/**
 * Her ShopMy saves kept on each page (11-21), copied from the Desktop notes Him-saved-shopmy-1121.md and
 * Kids-saved-shopmy-1121.md (pin -> the store it goes to), not from the module. The rest were left out by her rules:
 * a third of one brand (Smathers & Branson, Melissa & Doug), a third of one item type, LSU (until the owner's 11-21 PM
 * "You can list LSU stuff"), or out of stock on 11-21.
 */
const sm = (pins: string[], store: string) => Object.fromEntries(pins.map((p) => [`https://go.shopmy.us/p-${p}`, store]));
const SAVES: Record<string, Record<string, string>> = {
  him: {
    ...sm(["108628349"], "store-smathers-and-branson"), ...sm(["108628518"], "store-duck-head"),
    ...sm(["108626053", "108626036", "108625988"], "store-grove"), ...sm(["108625882", "108625877"], "store-clinique"),
    // Owner 2026-11-22 ("remove"): the Dr. Squatch Fresh Falls Bar Soap (108626008) is off.
    // Owner 11-21 ("Him = ALL of her men's saves"): every other in-stock, non-LSU Smathers & Branson save, two more Dr. Squatch.
    ...sm(["108628554", "108628535", "108628533", "108628457", "108628432", "108628429", "108628421", "108628411", "108628379", "108628348", "108628058", "108628052", "108628047"], "store-smathers-and-branson"),
    ...sm(["108626037", "108625979"], "store-grove"),
    // Owner 2026-11-21 PM ("You can list LSU stuff"): her in-stock LSU saves (the sunglass strap and luggage tag were sold out).
    ...sm(["108628318", "108628311", "108628309", "108628296", "108628280", "108628276", "108628274", "108628018"], "store-smathers-and-branson"),
    // Owner 2026-11-21 PM ("Find a replacement for the yeti backpack one with a price"): the same Crossroads backpack on her YETI pin.
    ...sm(["107838580"], "store-yeti"),
    // Owner 11-22 him picks (builder-guide-him): Smathers & Branson Tervis, can cooler, card wallet, toiletry bag.
    ...sm(["108101578", "108104267", "108108365", "108101625", "108108555"], "store-smathers-and-branson"),
  },
  kids: {
    ...sm(["108632461", "108632432", "108632392", "108632273", "108632257", "108632317", "108632251", "108632230", "108632184", "108632365", "108632379", "108632481", "108632592"], "store-maisonette"),
    ...sm(["108632104"], "store-grove"), ...sm(["108632077", "108632046"], "store-wayfair"),
    // Owner 11-21 ("same for the kids, add all items i had on the things"): every other kids save still sold.
    ...sm(["108632430", "108632133"], "store-maisonette"), ...sm(["108632059"], "store-wayfair"),
    ...sm(["108632004", "108631991", "108631978"], "store-macys"),
    // Rate switch 11-21 night: the Jumbo Cardboard Blocks moved from Wayfair p-108632086 (11%) to Macy's p-109002741 (16%), $32.99.
    ...sm(["109002741"], "store-macys"),
  },
};
const notAmazon = (slug: string): Record<string, string> => ({ ...SWITCHED[slug], ...SAVES[slug] });
const popular = new Set([...HIM_POPULAR_1122, ...KIDS_POPULAR_1122].map((r) => r.href));
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const most = (xs: string[]) => Math.max(0, ...Object.values(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})));

describe.each([
  ["him", [...HIM_1121, ...HIM_ADDS_1122, ...HIM_POPULAR_1122], him1121Picks() as Pick[]],
  ["kids", [...KIDS_1121, ...KIDS_ADDS_1122, ...KIDS_POPULAR_1122], kids1121Picks() as Pick[]],
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
      // Captured from her saved lists 11-21; the Battery Daddy she asked for on launch day and the Dad fill-in book (owner
      // 11-22 screenshot list, B0GWXJ3PYM) and the popular adds (builder-guide-popular) and the GE Opal Mini (builder-guide-him, 2026-11-22) were priced 11-22.
      expect(p.priceAt, p.name).toBe(p.href.includes("B089F9YDFC") || p.href.includes("B0GWXJ3PYM") || p.href.includes("B0H51ZX6SB") || popular.has(p.href) ? "2026-11-22" : "2026-11-21");
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
    // Owner 2026-11-22 ("put the ducks designs together ..."): only ties may move, a same-brand same-design row next to
    // its group (src/test/giftGuideSameDesignTogether1122.test.ts); the prices in order and the rows are exactly these.
    const price = new Map(rows.map((r) => [r.href, r.sortPrice]));
    expect(page.map((p) => price.get(p.href))).toEqual(sorted.map((r) => r.sortPrice));
    expect([...page.map((p) => p.href)].sort()).toEqual([...(sorted as unknown as Pick[]).map((r) => r.href)].sort());
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
      }
    }
    expect(HIM_SHOPMY_1121.length).toBe(36);
    expect(KIDS_SHOPMY_1121.length).toBe(23);
  });
});

describe("For Him holds every one of her men's saves (owner 11-21)", () => {
  it("91 of the 122 Amazon rows in Him-saved-amazon-1121.md are on the page, with the 31 left out named", () => {
    // Owner 2026-11-22: B09R5TGLFR Chemical Guys Car Cleaning Kit ($31.90) is off too; the Wontolf kit is the only car wash kit.
    // Owner 2026-11-22 ("remove"): B0CQ4QM7Q2 Men's Fuzzy Cloud Socks are off. Owner 2026-11-22 ("only keep the one with
    // the higher commission"): B0732FCCL4 Armor All Ultimate Car Cleaning Kit (3% x $38.91) is off; the Wontolf kit (3% x $40.79) stays.
    // Left out, 2026-11-21: B001DPHF4U LaCrosse Grange, B0FKCJNHWB Theragun Prime and B08Q1RN656 XTRATUF Ankle Deck Boot, B0F2JHSGCJ Turtlebox Ranger and the 14 night links 11-21
    // (Turtlebox Gen 3, Roadie 32, 9 YETI at YETI US, 3 Wetlands Camo YETI at Tractor Supply)
    // (on the page at their better-paying
    // stores, above), B0002A7GMS / B07M9LRQ4J / B0FDXLSNN1 (second listings of the same items), B09ZYT939N YETI
    // Crossroads Backpack (Amazon showed no price), and the 6 rate switches 11-21 night (3 XTRATUF, TNF beanie, Burlebo hoodie + cap).
    // Plus the Battery Daddy (B089F9YDFC), which the owner asked for on 11-22, and B0GWXJ3PYM, the Dad fill-in book (owner
    // via the lead 11-22, her screenshot list), and Him batch 2's GE Opal Mini: none is from her saved list.
    const amazon = chunk("him").filter((p) => p.store === "store-amazon").map((p) => /\/dp\/([A-Z0-9]{10})/.exec(p.href)![1]).filter((a) => a !== "B089F9YDFC" && a !== "B0GWXJ3PYM" && a !== "B0H51ZX6SB");
    expect(amazon.length).toBe(97); // 91, minus the 2 dupe removals (GoBox Collection, RAK tool), plus 3 owner-approved adds (Banded handwarmer, Klola mat, and the MVP PRO men's 2-pack B0D9PX9RBD: the brown listing was women's), plus the 5 popular adds of 11-22 (AirPods, AirTags, Bose, Garmin, Gozney)
    expect(chunk("him").filter((p) => p.href.includes("B089F9YDFC")).length).toBe(1);
    expect(chunk("him").filter((p) => p.href.includes("B0GWXJ3PYM")).length).toBe(1);
    for (const asin of ["B001DPHF4U", "B0FKCJNHWB", "B08Q1RN656", "B0F2JHSGCJ", "B0F22HTHMJ", "B0D1RJZCWZ", "B0H7CRMDKS", "B0DVM13SRM", "B0DVM24NF8", "B0B64CJZQQ", "B0D9QXT97F", "B0DHHK1YP7", "B0D9QX9F67", "B0H7CNPH2S", "B0H7DRWL2T", "B0FDYG11V3", "B0FDYD1C2N", "B0FDY7G84C", "B0002A7GMS", "B07M9LRQ4J", "B0FDXLSNN1", "B09ZYT939N", "B0998FYXLS", "B082JHQP7N", "B0GV4BKM4W", "B0DQF73JH4", "B0FT97QYYZ", "B08P2C446P", "B0CQ4QM7Q2", "B0732FCCL4", "B09R5TGLFR"]) expect(amazon, asin).not.toContain(asin);
    for (const asin of ["B0F2K9B696", "B0F53HMTX5", "B0FR98X1DZ", "B0D31TCLN2", "B0FKN7JH1D"]) expect(amazon, asin).toContain(asin);
  });
});

describe("For Kids holds every one of her kids' Amazon saves (owner 11-21)", () => {
  it("55 of the 58 Amazon rows in Kids-saved-amazon-1121.md are on the page (Segway S2 is at Tractor Supply; 11-22 the Switch with Joy-Con, the C2 Lite and C2 Pro, the Amazon S2 and the mini CreateOn tiles went as duplicates; the Quest 3S, iPad and JLab kids headphones were added)", () => {
    const amazon = chunk("kids").filter((p) => p.store === "store-amazon");
    expect(amazon.length).toBe(64); // 55 after the duplicate removals + the 9 popular adds of 11-22
    for (const asin of ["B0F3GWXLTS", "B0FJ2ZHPDY", "B0D6RMZ3D1", "B0DDLZV8YM"]) expect(amazon.some((p) => p.href.includes(asin)), asin).toBe(true);
    expect(amazon.some((p) => p.href.includes("B0CT2WN59R"))).toBe(false);
  });
});

describe("the generator sets Him and Kids last", () => {
  it("applyHimKids1121 replaces both pages and names any store a switched pick goes to", () => {
    const pages: Record<string, unknown[]> = { him: [{ name: "old" }], kids: [], her: [{ name: "keep" }] };
    const stores: Record<string, { name: string; hosts: string[] }> = { "store-dillards": { name: "Dillard's", hosts: ["www.dillards.com"] } };
    const out = applyHimKids1121(pages, stores);
    expect(out.him).toEqual({ before: 1, after: HIM_1121.length + HIM_ADDS_1122.length + HIM_POPULAR_1122.length });
    expect(pages.kids.length).toBe(KIDS_1121.length + KIDS_ADDS_1122.length + KIDS_POPULAR_1122.length);
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

/**
 * A code rides WITH its item (owner 2026-11-21 ~10 PM, via lead: "you can put the code with the item but no we dont need
 * a long list of codes on each guide only if we have a code should you put it with the items"): the XTRATUF Ankle Deck
 * Boots at xtratuf.com (the Chocolate/Tan Ankle Deck Boot, and since the 11-21 night rate switches the Mossy Oak Bottomland,
 * Wheelhouse and Fleece Lined boots) carry XT25 with its last day (the card hides the chip after Nov 29); no other Him
 * pick carries a code, and on Kids only the two Camp Snap 2 rows (11-22) carry her Camp Snap code LEXILOMBAS7.
 * @mutate scripts/giftGuideHimKids1121.mjs | sortPrice: 115, price: 115, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29" } | sortPrice: 115, price: 115, commission: 15, type: "boots" }
 */
describe("the XTRATUF code chip on For Him (owner 11-21)", () => {
  it("every xtratuf.com boot carries XT25, ending Nov 29, on the page and in the module, and nothing else does", () => {
    type Coded = Pick & { code?: string; codeEnds?: string };
    for (const list of [chunk("him") as Coded[], him1121Picks() as Coded[]]) {
      const coded = list.filter((p) => p.code);
      expect(coded.map((p) => [p.name, p.store, p.code, p.codeEnds, p.price]).sort()).toEqual([
        ["XTRATUF Ankle Deck Boot", "store-xtratuf", "XT25", "2026-11-29", 115],
        ["XTRATUF Mossy Oak Bottomland Ankle Deck Boot", "store-xtratuf", "XT25", "2026-11-29", 125],
      ]);
      expect(list.filter((p) => p.store === "store-xtratuf").length).toBe(coded.length);
      for (const p of coded) {
        expect(new URL(p.href).hostname).toBe("www.anrdoezrs.net");
        expect(decodeURIComponent(p.href)).toMatch(/^https:\/\/www\.anrdoezrs\.net\/click-101930553-15735628\?url=https:\/\/xtratuf\.com\/products\/(22734|xmabmob)$/);
      }
    }
    // Kids: only the two Camp Snap 2 colors (11-22, campsnapphoto.com), with her Camp Snap code (no end date).
    expect((chunk("kids") as Coded[]).filter((p) => p.code).map((p) => [p.store, p.code, p.codeEnds])).toEqual([["store-camp-snap", "LEXILOMBAS7", undefined], ["store-camp-snap", "LEXILOMBAS7", undefined]]);
  });
});
