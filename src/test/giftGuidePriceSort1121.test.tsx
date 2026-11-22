/**
 * Her, Him and Kids sort by price (owner 2026-11-21: "the guides should be able to be sorted by price"). Each pick in
 * the three chunks carries `priceRank`, its place in the cheapest-first order (scripts/giftGuidePriceRank1121.mjs); a
 * pick with no usable price gets null and stays last in both orders (src/content/giftGuidePriceSort.ts). The page shows
 * "Price: low to high" (the imported order, the default) and "Price: high to low" above the list, on the three guides
 * and on their relationship views (/gift-guides/mom). The rank is a position, never a price: an Amazon row still shows
 * no price in either order (Associates rule).
 *
 * Owner 11-21 (later): "add the filter button up with the search icons": the sort is a 44px "Sort by price" icon in
 * the header's tool row that opens a menu (menuitemradio "Price: low to high", the default, and "Price: high to low");
 * and "they all need to be sorted in sections by price": the rows sit in price sections (Under $25, $25 to $50, $50
 * to $75, $75 to $100, $100 and up; "Price coming soon" last), each a labelled section with its count, reversed for high to low.
 *
 * Lead 11-21 (earn order): the menu's first choice is "Recommended", the default, which on an EMPTY click-rank map is
 * exactly low to high. This file mocks the map empty so it stays a pure price guard; the click order itself is guarded
 * by src/test/giftGuideEarnOrder1121.test.tsx.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const sectioned = sortable ? priceSections(sortByPrice(inBudget, order === "high" ? "high" : "low")) : inBudget; | const sectioned = sortable ? sortByPrice(inBudget, order === "high" ? "high" : "low") : inBudget;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   return PRICE_SECTIONS.find((s) => dollars < s.max)!.id; |   return PRICE_SECTIONS.find((s) => dollars <= s.max)!.id;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {sort && <GiftGuideSort order={sort.order} onChange={sort.onChange} />} |       {null}
 * @mutate src/content/giftGuidePriceSort.ts | return [...known, ...unknown]; | return [...unknown, ...known];
 * @mutate scripts/giftGuidePriceRank1121.mjs | priceRank: known ? ++rank : null | priceRank: ++rank
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <PickPrice pick={pick} /></small> | <PickPrice pick={pick} />{pick.priceRank}</small>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/content/giftGuideEarnRank.json", () => ({ default: { ranks: {} } }));

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";
import { sortByPrice } from "@/content/giftGuidePriceSort";
import { rankByPrice } from "../../scripts/giftGuidePriceRank1121.mjs";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";
import { openPriceSections, sectionTitle } from "./helpers/openPriceSections";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Row = { name: string; href: string; store?: string; price?: number; priceRank?: number | null; rels?: string[] };
const CHUNKS: Record<string, Row[]> = { her: her.picks as Row[], him: him.picks as Row[], kids: kids.picks as Row[] };
const isAmazon = (href: string) => /(^|\.)amazon\.com$/.test(new URL(href).hostname);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
/** The names of the rows on screen, top to bottom. */
/** Every row's name, after opening every "Show more" (the page shows 50 at a time; Him holds 141 since 11-21). */
const shownNames = (c: HTMLElement) => {
  openPriceSections(c);
  return [...c.querySelectorAll("[data-gift-pick] .gg-nm-name")].map((n) => n.textContent);
};

describe("the price sort key in the three chunks (owner 11-21)", () => {
  it("every pick has an integer priceRank, 1..n in the list's cheapest-first order", () => {
    for (const [slug, rows] of Object.entries(CHUNKS)) {
      expect(rows.length, slug).toBeGreaterThan(30); // her 36, him 39, kids 40 measured 2026-11-21
      expect(rows.map((r) => r.priceRank), slug).toEqual(rows.map((_, i) => i + 1));
    }
  });

  it("the import puts an unknown price after every known one, with no rank, and orders the rest cheapest first", () => {
    const out = rankByPrice([
      { name: "b", sortPrice: 20 }, { name: "x" }, { name: "a", sortPrice: 5 }, { name: "y", sortPrice: Number.NaN }, { name: "c", sortPrice: 20 }, { name: "z", sortPrice: 0 },
    ]);
    expect(out.map((o) => o.row.name)).toEqual(["a", "b", "c", "x", "y", "z"]);
    expect(out.map((o) => o.priceRank)).toEqual([1, 2, 3, null, null, null]);
  });

  it("the page sort keeps unknown prices last in both orders", () => {
    const rows = [{ n: "u1", priceRank: null }, { n: "r2", priceRank: 2 }, { n: "u2" }, { n: "r1", priceRank: 1 }, { n: "r3", priceRank: 3 }];
    expect(sortByPrice(rows, "low").map((r) => r.n)).toEqual(["r1", "r2", "r3", "u1", "u2"]);
    expect(sortByPrice(rows, "high").map((r) => r.n)).toEqual(["r3", "r2", "r1", "u1", "u2"]);
    expect(rows.map((r) => r.n)).toEqual(["u1", "r2", "u2", "r1", "r3"]); // input untouched
  });
});

/**
 * The header's Sort by price icon. Its name says which order is on (guides audit 1122 #21): "Sort by price" on
 * Recommended, "Sort by price, Price: high to low" after that choice. getByRole still fails when the button is gone.
 */
const sortButton = () => screen.getByRole("button", { name: (n) => n === G.sortLabel || n.startsWith(`${G.sortLabel}, `) });
/** Choose an order in the header's Sort by price menu; returns the chosen item's aria-checked after reopening. */
const choose = (label: string) => {
  fireEvent.click(sortButton());
  fireEvent.click(within(screen.getByRole("menu", { name: G.sortLabel })).getByRole("menuitemradio", { name: new RegExp(label.replace(/[$:]/g, ".")) }));
};
const checked = () => {
  const button = sortButton();
  fireEvent.click(button);
  const on = within(screen.getByRole("menu", { name: G.sortLabel })).getAllByRole("menuitemradio").filter((m) => m.getAttribute("aria-checked") === "true").map((m) => m.textContent?.replace("✓", ""));
  fireEvent.keyDown(document, { key: "Escape" });
  // The icon's name names the order that is on (audit 1122 #21), so it always matches the checked item.
  expect(button.getAttribute("aria-label")).toBe(on[0] === G.sortTop ? G.sortLabel : G.sortLabelActive(on[0] ?? ""));
  return on;
};

describe("the sort control on the page (owner 11-21)", () => {
  it.each(["her", "him", "kids", "mom", "dad"])("/gift-guides/%s opens on Recommended (low to high with no clicks) and flips to high to low", async (slug) => {
    await act(async () => { await loadGuidePicks(slug); });
    const { container } = renderAt(`/gift-guides/${slug}`);
    // No big two-button toggle above the list any more; the menu lives in the header's tool row.
    expect(screen.queryByRole("radiogroup", { name: G.sortLabel })).toBeNull();
    expect(container.querySelector("[data-gift-headrow] [data-gift-sort-button]")).not.toBeNull();
    expect(checked()).toEqual([G.sortTop]);
    const base = slug === "mom" ? "her" : slug === "dad" ? "him" : slug;
    const expected = CHUNKS[base].filter((r) => base === slug || r.rels?.includes(slug)).map((r) => r.name);
    expect(expected.length, slug).toBeGreaterThan(5);
    expect(shownNames(container)).toEqual(expected);
    choose(G.sortHighLow);
    expect(checked()).toEqual([G.sortHighLow]);
    expect(shownNames(container)).toEqual([...expected].reverse());
    choose(G.sortLowHigh);
    expect(checked()).toEqual([G.sortLowHigh]);
    expect(shownNames(container)).toEqual(expected);
  });

  // Owner 2026-11-21 ~12:05 PM: "each item also needs a price" (she chose "Show Amazon prices anyway" after the warning
  // that Amazon allows prices only from its PA-API feed); then "all items need a price, then their default can be sorted
  // low price to high". This guard used to assert NO Amazon row showed a price; now every row shows one, Amazon too,
  // and the default order (low to high) follows the shown prices.
  it("every row shows its price in either order, Amazon rows too, and the default order is the shown prices low to high", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z")); // the launch-day adds were priced 11-22
    await act(async () => { await loadGuidePicks("her"); });
    const { container } = renderAt("/gift-guides/her");
    const dollars = () => [...openPriceSections(container).querySelectorAll<HTMLElement>("[data-gift-pick]")].map((li) => Number((li.querySelector("[data-gift-price]")?.textContent ?? "").replace(/^(~|from )\$/, "")));
    // The default, before any tap, is low to high.
    const first = dollars();
    expect(first).toEqual([...first].sort((a, b) => a - b));
    for (const name of [G.sortLowHigh, G.sortHighLow]) {
      choose(name);
      const rows = [...openPriceSections(container).querySelectorAll<HTMLElement>("[data-gift-pick]")];
      expect(rows.length).toBe(CHUNKS.her.length);
      let amazon = 0;
      for (const li of rows) {
        const href = li.querySelector<HTMLAnchorElement>("a[data-gift-out]")!.href;
        // A pick priced by size shows its lowest as "from $85" (11-22: the Serta pad, priceFrom).
        expect(li.querySelector("[data-gift-price]")?.textContent ?? "", href).toMatch(/^(~|from )\$\d+$/);
        if (isAmazon(href)) amazon += 1;
      }
      expect(amazon).toBeGreaterThan(15); // 20 Amazon rows on Her, 2026-11-21
      const d = dollars();
      expect(d).toEqual([...d].sort((a, b) => (name === G.sortLowHigh ? a - b : b - a)));
    }
    vi.useRealTimers();
  });
});

describe("price sections (owner 11-21: \"they all need to be sorted in sections by price\")", () => {
  const sections = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("section[data-gift-section]")].map((sec) => ({
    title: sectionTitle(sec),
    count: sec.querySelector("[data-gift-section-count]")?.textContent ?? "",
    labelled: sec.getAttribute("aria-labelledby") === sec.querySelector("h2")?.id,
    dollars: [...sec.querySelectorAll("[data-gift-price]")].map((p) => Number(p.textContent!.replace(/^(~|from )\$/, ""))),
  }));
  it.each(["him", "kids", "her"])("/gift-guides/%s: Under $25, $25 to $50, $50 to $75, $75 to $100, $100 and up, each labelled with its count; reversed high to low", async (slug) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z")); // the launch-day adds were priced 11-22
    await act(async () => { await loadGuidePicks(slug); });
    const { container } = renderAt(`/gift-guides/${slug}`);
    // Every "Show more" (50 at a time; Him holds 141 of her saves since 11-21).
    openPriceSections(container);
    const low = sections(container);
    // Owner 11-21: "Each guide should have sections that go by price 25 50 75 100+".
    const order = ["Under $25", "$25 to $50", "$50 to $75", "$75 to $100", "$100 and up"];
    expect(low.length, slug).toBeGreaterThan(2);
    expect(low.map((x) => x.title), slug).toEqual(order.filter((t) => low.some((x) => x.title === t)));
    const bounds: Record<string, [number, number]> = { "Under $25": [1, 24], "$25 to $50": [25, 49], "$50 to $75": [50, 74], "$75 to $100": [75, 99], "$100 and up": [100, 1e9] };
    for (const x of low) {
      expect(x.labelled, x.title).toBe(true);
      expect(x.count, x.title).toBe(` (${x.dollars.length})`);
      for (const d of x.dollars) expect(d >= bounds[x.title][0] && d <= bounds[x.title][1], `${x.title}: ${d}`).toBe(true);
      expect(x.dollars, x.title).toEqual([...x.dollars].sort((a, b) => a - b));
    }
    choose(G.sortHighLow);
    // Every "Show more" (50 at a time; Him holds 141 of her saves since 11-21).
    openPriceSections(container);
    const high = sections(container);
    expect(high.map((x) => x.title), slug).toEqual([...low.map((x) => x.title)].reverse());
    for (const x of high) expect(x.dollars, x.title).toEqual([...x.dollars].sort((a, b) => b - a));
    expect(high.reduce((n, x) => n + x.dollars.length, 0)).toBe(CHUNKS[slug].length);
    // Counts per band, measured 2026-11-21 from the shown (rounded) prices (all of her saves: Him 150 with her LSU picks, Kids 81, Her 47): exact, so a moved boundary shows.
    const COUNTS: Record<string, Record<string, number>> = {
      // 11-22 (train 1121j): the store switches moved two Him picks from $75-$100 to $100 and up (the XTRATUF Ankle and
      // Mossy Oak deck boots at xtratuf.com, $115 and $125, were Amazon $93.75) and one Her pick from $75-$100 to $25-$50
      // (Crocs Dylan at crocs.com $35, was $99).
      // 11-22 (owner edits): Him lost the Dr. Squatch Fresh Falls soap and Men's Fuzzy Cloud Socks (under $25) and the
      // Armor All and Chemical Guys car kits ($25-$50); Her lost the Floral Mama quarter zip (under $25).
      // 11-22 (owner 11-22 screenshot list, builder-guide-adds-2): Him gained the Dad fill-in book ($18).
      // 11-22 popular approved (builder-guide-popular): Kids + 9, Her + 5, Him + 5 (AirPods Pro 3, AirTags, Bose, Garmin, Gozney).
      // Train e (11-22): Him also gained Smathers & Branson picks, the Banded and Klola adds and the men's MVP 2-pack, and lost
      // its duplicates (XTRATUF boots, GoBox 60 and Collection, the RAK tool).
      // Train f: Him batch 1 (Solo Stove, Roadie 8, Muck, Carhartt jacket, 2 Duck Commander calls; the Roadie 15 is off)
      // and batch 2 (S&B wallet, Marley Lilly cooler, GE Opal Mini).
      // builder-guide-links (11-22): Him + Le Labo, Patagonia duffel, Steve Madden loafer (all $100 and up).
      // Him batch 3 (11-22): the L.L.Bean waterfowl sweater ($130) and Costa Sullivan sunglasses ($262); the Duck Head rope hat
      // stays off (sold out at the 11-20 audit) and the Duck Camp hat waits for its own cutout source.
      // Owner 11-22 PM, "add all items" (builder-guide-louisiana): Zatarain's and Talk About Good II (under $25), Tony's,
      // the '47 Saints cap and the boil paddle ($25-$50), the cast net ($69), Toups and Lodge ($80-$90), the jambalaya pot,
      // Mignon Faget cufflinks and KREWE ($100 and up).
      him: { "Under $25": 45, "$25 to $50": 48, "$50 to $75": 26, "$75 to $100": 13, "$100 and up": 50 },
      // 11-22 (owner adds, scripts/giftGuideOwnerAdds1122.mjs): Kids gained the two Camp Snap 2 colors ($60); Her gained
      // EADEM ($24), Crown Affair and Camp Snap 2 ($59, $60), CS-Pro, Serta and Aera ($79, from $85, $98), CS-8, Coravin
      // and Sleep Crown ($159, $199, $289). Batch 2: Her + 3 STIL under $25, Lemme, Nest, STIL binder and Emi Jay ($25-$50),
      // Eleven Eleven ($158); Him + 2 Lake ($108, $138); Kids + EADEM set ($58). Batch 2b: Her + CFUNIQ ($15), Sleepy Tie,
      // Foton and Astercook knives ($30-$37), Astercook pans ($57), CASABREWS, Lake, BISSELL, eto, Ozlo ($112-$237); Him +
      // Battery Daddy ($20); Kids + both Yoto bundles ($164, $166).
      // Train e (11-22): Kids gained the 9 popular adds, the Quest 3S, iPad and JLab headphones, and lost its duplicate
      // Switch, Segway and tile rows.
      // builder-guide-links (11-22): Kids + CrunchLabs Crunchinator ($35), Tamagotchi Paradise ($45) and Stickerbox ($130).
      // Her play saves (builder-guide-adds-kids, owner: "Keep all (my saves)"): the Step2 and Wayfair backyard sets and the
      // Macy's hoop; kids2: the Step2 water table, Burt's Bees Little Ducks, Angel Dear duck PJs and a Duck Commander call.
      // Owner 11-22 PM (builder-guide-emibauble): Kids lost the EADEM set ($58, to Her) and the Melissa & Doug Club Chair
      // ($75) and gained the Pottery Barn Kids Anywhere Chair (from $119).
      // Owner 11-22 PM, "add all items" (builder-guide-louisiana): three books, the pelican and the Duck Commander tee (under
      // $25), Mike the Tiger (~$25), the Saints jersey, Toups baby set, XTRATUF and LSU cheer dress ($25-$50), the Southern
      // Marsh chino ($59).
      kids: { "Under $25": 41, "$25 to $50": 33, "$50 to $75": 11, "$75 to $100": 9, "$100 and up": 27 },
      // Batch 2c: Her + Good Molecules ($18), BISSELL Little Green Mini, Drowsy, Diptyque ($80-$90), Madewell, Oura ($158, $399).
      // 11-22 (owner 11-22 screenshot list, builder-guide-adds-2): Her + Pilot G2, the L'Oreal mask, the Mom book, Loop,
      // Mrs. Meyer's, Downy, Scrub Mommy, the croc makeup bag, Anker, the Stanley food jar, Dae, Touchland and the LUSH bar
      // (under $25); Comrad, JAANUU, Stoggles, the Boat and Tote and the lululemon belt bag ($25-$50); Pura 4, Kerastase and
      // the towel warmer ($50-$75); the Littmann ($92); the UGG Scuffette ($100 shown), Kindle, Daisy Love, Skylight, the
      // Braun IPL, the XTRATUF boot, the L.L.Bean sweater and barn coat and the HOKA Bondi 9 ($100 and up).
      // Train e (11-22): Her also gained the 5 popular adds and her3b's PR picks (Beekman, Glow Recipe, Eberjey, Beis,
      // Case-Mate, Naturium, Makeup by Mario, YTTP), and lost the Amazon Essentials flannel pajamas (owner: "Lake + Eberjey").
      // Train f: the links made in her ShopMy 11-22: the CALPAK lunch bag ($38), OOFOS slide ($70), Slip and Crown Affair
      // pillowcases, the OOFOS leopard clog and the Smathers & Branson tray ($84-$95), the Patchology hand mask ($11) and the
      // BaubleBar spaced-letter necklace ($148).
      // builder-guide-links (11-22): Her + the Esker bubble soak ($75); builder-guide-adds-2: her Capri Blue Volcano capiz jar
      // pin (from $22).
      // builder-guide-her4 block 2 (11-22): 10 Amazon picks from her screenshots (HydroJugs, She's Birdie, CRZ YOGA pants
      // and bra, Lemon Grace cards, Bose QC Ultra Earbuds, two personalized bags, YETI Daytrip lunch bag).
      // Batch 2 (11-22): vest, sweatshirt, sherpa, Kitsch, HydroJug tortoise, gift bags and tags, card holder, pouch.
      // Owner 11-22 PM (builder-guide-emibauble): Her lost Mrs. Meyer's and Downy (under $25), Comrad, JAANUU, Stoggles and
      // the CS-8 Micro ($25-$50), the CS-Pro ($79) and the CS-8 camcorder ($159); then gained the Gaoye glasses ($13), the
      // BaubleBar brush ($48) and the EADEM set from Kids ($58).
      // Owner 11-22 PM, "add all items" (builder-guide-louisiana): Community Coffee, the map board and the pelican ornament
      // (under $25); the cookbook (~$25), Desden, Toups and Match South ($25-$50); the Cafe Du Monde box, the SCL Saints hat,
      // the Katie Kime tray and Haydel's ($50-$75); the Mignon Faget pendant (from $75); the oyster earrings and KREWE.
      her: { "Under $25": 47, "$25 to $50": 46, "$50 to $75": 15, "$75 to $100": 14, "$100 and up": 38 },
    };
    expect(Object.fromEntries(low.map((x) => [x.title, x.dollars.length])), slug).toEqual(COUNTS[slug]);
  });
});
