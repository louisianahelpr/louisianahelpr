/**
 * Owner pop-up, Mon 2026-11-23 ~10:55 AM: the For Kids guide gets filters, "Age + price + girls/boys".
 *  - Age: Baby (0-2), 3-5, 6-8, 9-12, Teens; a gift can be in more than one band; the age is the maker's or listing's own
 *    (src/content/giftGuideKidsTags.json, each with its source), never guessed: no stated age = in no age chip.
 *  - Price: under $10, $10-$25, $25-$50, $50+, by the price the card shows (rounded dollars).
 *  - Girls / Boys / Everyone: an "Everyone" gift shows under Girls AND under Boys; Girls/Boys only with a listing source.
 * The chips live in the guide's existing Filter (the sliders icon; on Kids it also holds the sort), multi-select, with a
 * live count and Clear; filters only on Kids.
 *
 * @mutate src/content/giftGuideKidsFilter.ts | const ok = sel.genders.includes(g) \|\| (g === "everyone" && (sel.genders.includes("girls") \|\| sel.genders.includes("boys"))); | const ok = sel.genders.includes(g);
 * @mutate src/content/giftGuideKidsFilter.ts | return first < 0 ? [] : KID_AGES.slice(first, first + 2).map((b) => b.id); | return first < 0 ? [] : KID_AGES.slice(first, first + 1).map((b) => b.id);
 * @mutate src/content/giftGuideKidsFilter.ts | return KID_PRICES.find((b) => d >= b.lo && d < b.hi)?.id ?? null; | return KID_PRICES.find((b) => (pick.price ?? 0) >= b.lo && (pick.price ?? 0) < b.hi)?.id ?? null;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const inBudget = kids ? filterKids(withinBudget(guide.picks, budget), kids.sel, kids.tags, louisianaToday(new Date())) : withinBudget(guide.picks, budget); |   const inBudget = withinBudget(guide.picks, budget);
 * @mutate src/pages/info/GiftGuides.tsx | image={guide.cover} sort={kidsTools ? undefined : sort} filter={toolsFilter} /> | image={guide.cover} sort={sort} filter={toolsFilter} />
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | <ToggleChip key={c.value} pressed={on} role="menuitemcheckbox" aria-checked={on} | <ToggleChip key={c.value} pressed={on} role="menuitemcheckbox" aria-checked={false}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import kidsChunk from "@/content/giftGuidePicks/kids.json";
import tagFile from "@/content/giftGuideKidsTags.json";
import { ageBands, filterKids, matchesKids, priceBand, tagKey, type KidTag, type KidTags, type KidsSelection } from "@/content/giftGuideKidsFilter";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";

const TAGS = (tagFile as unknown as { tags: KidTags }).tags;
const PICKS = (kidsChunk as { picks: { name: string; href: string; price?: number; priceAt?: string }[] }).picks;
const TODAY = "2026-11-23";
const sel = (s: Partial<KidsSelection>): KidsSelection => ({ ages: [], prices: [], genders: [], ...s });

describe("the Kids tag file covers every pick, and every age says where it came from", () => {
  it("every current Kids pick has a tag with a gender; Girls/Boys carry their listing source", () => {
    expect(PICKS.length).toBeGreaterThan(100);
    const missing = PICKS.filter((p) => !TAGS[tagKey(p.href)]).map((p) => p.name);
    expect(missing).toEqual([]);
    for (const [k, t] of Object.entries(TAGS)) {
      expect(["girls", "boys", "everyone"], k).toContain(t.gender);
      if (t.gender !== "everyone") expect(t.genderSource, k).toMatch(/^.{12,}$/);
    }
  });

  it("the 16 new Amazon kids picks the owner kept (owner-keeps-1123) are tagged by ASIN, so they match once they land", () => {
    const keeps = Object.entries(TAGS).filter(([, t]) => (t as KidTag & { list?: string }).list === "owner-keeps-1123");
    expect(keeps.length).toBe(21); // 22 until the Burt's Bees Baby Christmas pajamas came off Kids in the owner's 11-24 trim (its tag went with it; 2026-11-24)
    expect(keeps.filter(([k]) => k.startsWith("amazon:")).length).toBe(16);
  });

  it("an age is never guessed: every ageMin has a source, and a range runs low to high", () => {
    const aged = Object.entries(TAGS).filter(([, t]) => typeof t.ageMin === "number");
    expect(aged.length).toBeGreaterThan(90);
    for (const [k, t] of aged) {
      expect(t.ageSource, k).toMatch(/^.{12,}$/);
      if (typeof t.ageMax === "number") expect(t.ageMax, k).toBeGreaterThanOrEqual(t.ageMin!);
    }
    // A tag with no age has no stray source or max either.
    for (const [k, t] of Object.entries(TAGS).filter(([, x]) => typeof x.ageMin !== "number")) expect([t.ageMax, t.ageSource], k).toEqual([undefined, undefined]);
  });

  it("tagKey matches an Amazon product by ASIN whatever its link, and other links by host and path", () => {
    expect(tagKey("https://www.amazon.com/dp/B000FGECAI?tag=louisianahelpr-20")).toBe("amazon:B000FGECAI");
    expect(tagKey("https://www.amazon.com/Kanoodle-Puzzle/dp/B000FGECAI/ref=x")).toBe("amazon:B000FGECAI");
    expect(tagKey("https://www.amazon.com/dp/B000FGECAI")).toBe("amazon:B000FGECAI");
    expect(tagKey("https://go.shopmy.us/p-108632432")).toBe("go.shopmy.us/p-108632432");
    expect(tagKey("https://www.maisonette.com/products/pink-confetti-cape/?x=1#y")).toBe("maisonette.com/products/pink-confetti-cape");
  });
});

describe("the filter logic", () => {
  it("ages: a stated range covers every band it touches; an open 'N and up' covers N's band and the next", () => {
    expect(ageBands({ ageMin: 3 })).toEqual(["3-5", "6-8"]);
    expect(ageBands({ ageMin: 1.5 })).toEqual(["baby", "3-5"]);
    expect(ageBands({ ageMin: 0, ageMax: 9 })).toEqual(["baby", "3-5", "6-8", "9-12"]);
    expect(ageBands({ ageMin: 8, ageMax: 15 })).toEqual(["6-8", "9-12", "teens"]);
    expect(ageBands({ ageMin: 14 })).toEqual(["teens"]);
    expect(ageBands({ ageMin: 2, ageMax: 3 })).toEqual(["baby", "3-5"]);
    expect(ageBands({})).toEqual([]);
  });

  it("price bands read the shown (rounded) dollars; a gift with no shown price is in none", () => {
    expect(priceBand({ price: 9.4, priceAt: TODAY }, TODAY)).toBe("under-10");
    expect(priceBand({ price: 9.6, priceAt: TODAY }, TODAY)).toBe("10-25"); // reads "~$10"
    expect(priceBand({ price: 24.49, priceAt: TODAY }, TODAY)).toBe("10-25");
    expect(priceBand({ price: 24.5, priceAt: TODAY }, TODAY)).toBe("25-50"); // reads "~$25", as the price sections do
    expect(priceBand({ price: 49.99, priceAt: TODAY }, TODAY)).toBe("50-up");
    expect(priceBand({ price: 499, priceAt: TODAY }, TODAY)).toBe("50-up");
    expect(priceBand({ price: 12 }, TODAY)).toBeNull();
    expect(priceBand({ price: 12, priceAt: "2026-09-01" }, TODAY)).toBeNull();
  });

  const tags: KidTags = {
    "amazon:AAAAAAAAAA": { name: "Bow", gender: "girls", genderSource: "Listing: hair bow for girls", ageMin: 3 },
    "amazon:BBBBBBBBBB": { name: "Truck", gender: "boys", genderSource: "Listing: truck for boys", ageMin: 9, ageMax: 14 },
    "amazon:CCCCCCCCCC": { name: "Blocks", gender: "everyone", ageMin: 1 },
    "amazon:DDDDDDDDDD": { name: "Tablet", gender: "everyone" },
  };
  const pick = (asin: string, price: number) => ({ href: `https://www.amazon.com/dp/${asin}`, price, priceAt: TODAY });
  const bow = pick("AAAAAAAAAA", 8);
  const truck = pick("BBBBBBBBBB", 30);
  const blocks = pick("CCCCCCCCCC", 18);
  const tablet = pick("DDDDDDDDDD", 399);
  const all = [bow, truck, blocks, tablet];

  it("Everyone shows under Girls and under Boys; a Girls gift never under Boys", () => {
    expect(filterKids(all, sel({ genders: ["girls"] }), tags, TODAY)).toEqual([bow, blocks, tablet]);
    expect(filterKids(all, sel({ genders: ["boys"] }), tags, TODAY)).toEqual([truck, blocks, tablet]);
    expect(filterKids(all, sel({ genders: ["everyone"] }), tags, TODAY)).toEqual([blocks, tablet]);
    expect(filterKids(all, sel({ genders: ["girls", "boys"] }), tags, TODAY)).toEqual(all);
    // An untagged pick counts as Everyone (never guessed toward one).
    expect(matchesKids(pick("ZZZZZZZZZZ", 5), sel({ genders: ["boys"] }), tags, TODAY)).toBe(true);
  });

  it("a gift sits in more than one age band; chips in a group add up, groups narrow; no stated age = in no age chip", () => {
    expect(filterKids(all, sel({ ages: ["6-8"] }), tags, TODAY)).toEqual([bow]);
    expect(filterKids(all, sel({ ages: ["3-5"] }), tags, TODAY)).toEqual([bow, blocks]);
    expect(filterKids(all, sel({ ages: ["teens"] }), tags, TODAY)).toEqual([truck]);
    expect(filterKids(all, sel({ ages: ["baby", "teens"] }), tags, TODAY)).toEqual([truck, blocks]);
    expect(filterKids(all, sel({ ages: ["3-5"], prices: ["10-25"] }), tags, TODAY)).toEqual([blocks]);
    expect(filterKids(all, sel({ prices: ["under-10", "50-up"] }), tags, TODAY)).toEqual([bow, tablet]);
    expect(filterKids(all, sel({ ages: ["baby", "3-5", "6-8", "9-12", "teens"] }), tags, TODAY)).not.toContain(tablet);
    expect(filterKids(all, sel({}), tags, TODAY)).toBe(all);
  });

  it("on the real tag file every age band, price band and Girls/Everyone chip holds gifts", () => {
    for (const a of ["baby", "3-5", "6-8", "9-12", "teens"] as const) expect(filterKids(PICKS, sel({ ages: [a] }), TAGS, TODAY).length, a).toBeGreaterThan(0);
    for (const p of ["under-10", "10-25", "25-50", "50-up"] as const) expect(filterKids(PICKS, sel({ prices: [p] }), TAGS, TODAY).length, p).toBeGreaterThan(0);
    const girls = filterKids(PICKS, sel({ genders: ["girls"] }), TAGS, TODAY).length;
    const everyone = filterKids(PICKS, sel({ genders: ["everyone"] }), TAGS, TODAY).length;
    expect(girls).toBeGreaterThan(everyone);
  });
});

await loadAllGuidePicks();
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};
const rows = (c: HTMLElement) => c.querySelectorAll(".gg-main [data-gift-list] [data-gift-pick]").length;

describe("the Kids page: the chips in its Filter", () => {
  it("one sliders icon (Filter) holds Sort, Age, Price and For; picking chips narrows the list, counts live, and Clear resets", async () => {
    const c = await renderAt("/gift-guides/kids");
    const quick = c.querySelector("[data-gift-quick]")!;
    expect(quick.querySelector("[data-gift-sort-button]")).toBeNull();
    const button = quick.querySelector<HTMLButtonElement>("[data-gift-filter-button]")!;
    expect(button.getAttribute("aria-label")).toBe("Filter");
    const total = rows(c);
    expect(total).toBe(PICKS.length);
    act(() => { fireEvent.click(button); });
    await waitFor(() => expect(c.querySelector("[data-gift-filter-group='age']")).not.toBeNull());
    const groups = [...c.querySelectorAll("[data-gift-filter-panel] [role='group']")].map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Sort", "Age", "Price", "For"]);
    const chip = (id: string) => c.querySelector<HTMLButtonElement>(`[data-gift-filter-chip='${id}']`)!;
    for (const b of c.querySelectorAll("[data-gift-filter-chip]")) expect(b.getAttribute("role")).toBe("menuitemcheckbox");

    act(() => { fireEvent.click(chip("price:under-10")); });
    const under10 = filterKids(PICKS, sel({ prices: ["under-10"] }), TAGS, TODAY).length;
    expect(under10).toBeGreaterThan(0);
    expect(chip("price:under-10").getAttribute("aria-checked")).toBe("true");
    expect(rows(c)).toBe(under10);
    expect(c.querySelector("[data-gift-filter-live]")?.textContent).toBe(`${under10} of ${total} gifts`);
    expect(c.querySelector("[data-gift-kids-note]")?.textContent).toMatch(new RegExp(`^${under10} gifts? match`));
    expect(button.getAttribute("aria-label")).toBe("Filter, 1 on");

    act(() => { fireEvent.click(chip("for:girls")); });
    expect(rows(c)).toBe(filterKids(PICKS, sel({ prices: ["under-10"], genders: ["girls"] }), TAGS, TODAY).length);
    act(() => { fireEvent.click(chip("age:teens")); });
    expect(rows(c)).toBe(filterKids(PICKS, sel({ prices: ["under-10"], genders: ["girls"], ages: ["teens"] }), TAGS, TODAY).length);

    act(() => { fireEvent.click(c.querySelector<HTMLButtonElement>("[data-gift-filter-clear]")!); });
    expect(rows(c)).toBe(total);
    expect(c.querySelector("[data-gift-kids-note]")).toBeNull();
    expect(chip("price:under-10").getAttribute("aria-checked")).toBe("false");
  });

  it("filters only on Kids: Her keeps its own Sort icon and has no chips", async () => {
    const c = await renderAt("/gift-guides/her");
    expect(c.querySelector("[data-gift-quick] [data-gift-sort-button]")).not.toBeNull();
    expect(c.querySelector("[data-gift-quick] [data-gift-filter-button]")).toBeNull();
  });
});

// Flow audit 11-23 (B5): "Girls" showed 140 of 140 and looked broken. The tag file has no Boys-only picks, so Girls
// honestly hides nothing; each For chip now names its count so the shopper sees that up front.
// @mutate src/pages/info/GiftGuides.tsx | label: `${g.label} (${n[g.id]})` | label: g.label
describe("the Kids page: the For chips name their counts (B5)", () => {
  it("Girls / Boys / Everyone each show how many gifts they would list, matching the filter", async () => {
    const c = await renderAt("/gift-guides/kids");
    act(() => { fireEvent.click(c.querySelector<HTMLButtonElement>("[data-gift-quick] [data-gift-filter-button]")!); });
    await waitFor(() => expect(c.querySelector("[data-gift-filter-group='for']")).not.toBeNull());
    const labels: string[] = [];
    for (const g of ["girls", "boys", "everyone"] as const) {
      const n = filterKids(PICKS, sel({ genders: [g] }), TAGS, TODAY).length;
      const text = c.querySelector(`[data-gift-filter-chip='for:${g}']`)?.textContent ?? "";
      expect(text).toBe(`${g[0].toUpperCase()}${g.slice(1)} (${n})`);
      labels.push(text);
    }
    expect(labels.length).toBeGreaterThan(2);
    // With a price chip on, the counts follow the other groups.
    act(() => { fireEvent.click(c.querySelector<HTMLButtonElement>("[data-gift-filter-chip='price:under-10']")!); });
    const n = filterKids(PICKS, sel({ prices: ["under-10"], genders: ["boys"] }), TAGS, TODAY).length;
    expect(c.querySelector("[data-gift-filter-chip='for:boys']")?.textContent).toBe(`Boys (${n})`);
  });
});
