/**
 * The gift guides' extras (owner 2026-11-18): the date-driven shipping banner, the sidebar search, the hearts / My
 * list and the merged discount codes. The main page guard is src/test/giftGuidesPage.test.tsx.
 *
 * @mutate src/content/giftGuideShipping.ts |   if (month === 11 \|\| (month === 12 && day < 15)) return SHIP_LINES.early; |   if (month === 11 \|\| (month === 12 && day <= 15)) return SHIP_LINES.early;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 20) return SHIP_LINES.late; |   if (day < 20) return SHIP_LINES.late;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 25) return SHIP_LINES.instant; |   if (day <= 31) return SHIP_LINES.instant;
 * @mutate src/content/giftGuideShipping.ts | timeZone: "America/Chicago" | timeZone: "UTC"
 * @mutate src/content/giftGuideCatalog.ts |   ...(flags.louisianaFit && brand && LOUISIANA_MADE_BRANDS.includes(brand) ? (["louisiana-made"] as const) : []), |   ...(brand && LOUISIANA_MADE_BRANDS.includes(brand) ? (["louisiana-made"] as const) : []),
 * @mutate src/content/giftGuideCatalog.ts |   ...(flags.sponsor \|\| (brand && SPONSOR_BRANDS.includes(brand)) ? (["sponsor"] as const) : []), |   ...(brand && SPONSOR_BRANDS.includes(brand) ? (["sponsor"] as const) : []),
 * @mutate src/content/giftGuideCatalog.ts | store === "louisiana" && !badges.includes("louisiana-made") ? [...badges, "shop-louisiana"] : badges | false ? [...badges, "shop-louisiana"] : badges
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | if (pick.image && !failed) { | if (pick.image) {
 * @mutate scripts/gift-guide-picks.mjs | if (!nameOnly(slug, p)) add(slug, p, file); | add(slug, p, file);
 * @mutate src/pages/info/giftGuides/giftList.tsx | aria-pressed={saved} | aria-pressed={false}
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx |         {g.age && <span className="gg-count">{g.age}</span>} |         {g.age && <span className="gg-count">{g.age}</span>}<button type="button" data-gift-heart="" aria-label="Save" />
 * @mutate src/pages/info/giftGuides/giftList.tsx |     window.localStorage.setItem(KEY, JSON.stringify(next)); |     window.localStorage.setItem(KEY, "{}");
 * @mutate src/content/giftGuideCatalog.ts |   ...(flags.shipsFast ? (["ships-fast"] as const) : []), |   ...(flags.trending ? (["ships-fast"] as const) : []),
 * @mutate src/pages/info/giftGuides/GiftGuideHelpr.tsx | t: "Gift wrapping" }) | t: "Gift wrap" })
 * @mutate src/content/giftGuideCatalog.ts | return rest.every((w) => hasWordStart(hay, w) \|\| | return rest.some((w) => hasWordStart(hay, w) \|\|
 * @mutate src/content/giftGuideCatalog.ts | hasWordStart(hay, w) \|\| (label.get(g.row) ?? []).includes(w)); | hasWordStart(hay, w));
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |         {showResults && ( |         {false && (
 * @mutate src/content/giftGuideCatalog.ts |   loaded.set(slug, { picks: chunk.picks.map(toPick), | loaded.set(slug, { picks: [],
 */
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SHIP_LINES, shippingLine } from "@/content/giftGuideShipping";
import type { PickChunk } from "@/content/giftGuidePicks";
import { LOUISIANA_MADE_BRANDS, SPONSOR_BRANDS, giftGuides } from "@/content/giftGuides";
import { badgesFor, guideBySlug, loadAllGuidePicks, searchGuides } from "@/content/giftGuideCatalog";

// The guides record views and taps (src/lib/analytics.ts); here they go nowhere, never to Supabase (prodNetworkGuard).
vi.mock("@/lib/analytics", async (orig) => ({ ...(await orig<object>()), track: vi.fn() }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { storeLabel } from "@/pages/info/giftGuides/GiftGuideView";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { MATCHMAKER_PARAM, readMatchmakerLink } from "@/lib/matchmakerLink";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { PREFILL_OPENS_DETAILS } from "@/pages/post-job/usePrefillOpensDetails";

/**
 * A guide card's heart now asks for whom (owner 2026-11-21, saveForPeople): tap it, then "Me" (My Wish List), then
 * Done. Where no picker is on the page the heart still saves straight to the wish list.
 */
const tapHeart = (heart: Element) => {
  fireEvent.click(heart);
  const me = document.querySelector("[data-savefor-me]");
  if (!me) return;
  fireEvent.click(me);
  const done = document.querySelector("[data-savefor-done]");
  if (done) fireEvent.click(done);
};


afterEach(cleanup);

/** Each guide's researched chunk, as generated (PERF split 11-18: one lazy file per guide), and every chunk loaded. */
const RESEARCHED_PICKS: Record<string, PickChunk["picks"]> = Object.fromEntries(
  Object.entries(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" }))
    .map(([f, c]) => [f.replace(/^.*\/|\.json$/g, ""), c.picks] as const)
    .filter(([, l]) => l.length > 0),
);
/** Pages that list their static picks first and then their chunk's (the Amazon, zChocolat and Diecast store pages). */
const APPENDED = ["store-amazon", "store-zchocolat", "store-diecast-models"];
// Owner 11-21: only the live guides' chunks are loaded (src/content/giftGuideLive.mjs); a retired chunk stays on disk.
const OWN_LIST = Object.entries(RESEARCHED_PICKS).filter(([s]) => !APPENDED.includes(s) && isLiveGuide(s));
await loadAllGuidePicks();
/** Opens every "Show more" under a long list (50 rows at first as of 2026-11-18, design audit #3), so a check sees every row. */
const expandAll = (root: HTMLElement) => {
  for (let b = root.querySelector<HTMLButtonElement>("[data-gift-more-picks]"); b; b = root.querySelector<HTMLButtonElement>("[data-gift-more-picks]")) fireEvent.click(b);
  return root;
};
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("gift guides: the shipping banner follows the date in Louisiana", () => {
  // Noon Chicago time is 18:00Z (CST, UTC-6).
  const at = (iso: string) => new Date(iso);
  it("before Dec 15, Dec 15–20, Dec 21–25, then hidden", () => {
    expect(shippingLine(at("2026-11-18T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-14T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-15T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-20T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-21T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-25T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-26T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2026-12-31T18:00:00Z"))).toBeNull();
    // Holiday audit 1121: hidden from Dec 26 through Oct 31 (it came back every January), back on Nov 1.
    expect(shippingLine(at("2027-01-02T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2027-10-31T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2027-11-01T18:00:00Z"))).toBe(SHIP_LINES.early);
  });
  it("uses Louisiana's date, not UTC: 11 PM Chicago on Dec 14 is 05:00Z Dec 15", () => {
    expect(shippingLine(at("2026-12-15T05:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-26T05:30:00Z"))).toBe(SHIP_LINES.instant);
  });
  it("the exact owner wording", () => {
    expect(Object.values(SHIP_LINES)).toEqual([
      "Order by Dec 15 for Christmas delivery",
      "Last days for Christmas shipping: choose fast shipping",
      // Owner 2026-11-21 (holiday audit 1121, #28): "Just don't mention gift cards." (gift cards left the guides 11-20).
      "Too late to ship? Print a free gift tag or coloring book today",
    ]);
  });
});

describe("gift guides: the researched picks (scripts/gift-guide-picks.mjs -> src/content/giftGuidePicks.ts)", () => {
  const all = Object.values(RESEARCHED_PICKS).flat();
  it("are loaded into their guides, in order", () => {
    expect(Object.keys(RESEARCHED_PICKS).length).toBeGreaterThan(20);
    expect(all.length).toBeGreaterThan(500);
    for (const [slug, list] of OWN_LIST) expect(guideBySlug(slug)?.picks.map((p) => p.href), slug).toEqual(list.map((p) => p.href));
  });
  it("Louisiana-made only when louisianaFit AND a Louisiana brand; sponsors (and every sponsors-guide pick) get 25 Days sponsor", () => {
    const picks = OWN_LIST.flatMap(([s, raw]) => guideBySlug(s)!.picks.map((p, i) => ({ p, raw: raw[i], s })));
    for (const { p, raw, s } of picks) {
      expect(raw.href).toBe(p.href);
      expect(p.badges?.includes("louisiana-made") ?? false, p.name).toBe(!!raw.louisianaFit && LOUISIANA_MADE_BRANDS.includes(p.brand!));
      expect(p.badges?.includes("sponsor") ?? false, p.name).toBe(s === "25-days-sponsors" || !!raw.sponsor || SPONSOR_BRANDS.includes(p.brand!));
      // "Shop Louisiana" (owner 2026-11-18; pre-launch audit 11-18 PM): a Louisiana shop only, unless already Louisiana-made.
      const made = p.badges?.includes("louisiana-made") ?? false;
      expect(p.badges?.includes("shop-louisiana") ?? false, p.name).toBe(!made && p.store === "louisiana");
      if (p.store === "amazon" || p.store === "store-walmart") expect(p.badges?.includes("shop-louisiana") ?? false, p.name).toBe(false);
    }
    // A Louisiana brand's pick not marked louisianaFit gets no Louisiana-made badge.
    expect(badgesFor("TABASCO")).toEqual([]);
    expect(badgesFor("TABASCO", { louisianaFit: true })).toEqual(["louisiana-made"]);
    const sponsors = guideBySlug("25-days-sponsors")!.picks;
    expect(sponsors.length).toBeGreaterThan(20);
    for (const p of sponsors) expect(p.badges, p.name).toContain("sponsor");
    const fitNotMade = all.filter((p) => p.louisianaFit && !LOUISIANA_MADE_BRANDS.includes(p.brand));
    expect(fitNotMade.some((p) => p.brand === "YETI")).toBe(true);
    // Owner 11-21: the Louisiana guides (where the Louisiana-made and Shop Louisiana picks sat) are retired; the live
    // guides' picks still follow the badge rules above, row by row.
    expect(picks.filter(({ p }) => p.badges?.includes("sponsor")).length).toBeGreaterThan(20);
  });
  it("leaves out Hilma's probiotic (health product) but still names Hilma on the sponsors guide", () => {
    expect(guideBySlug("25-days-sponsors")!.picks.some((p) => p.brand === "Hilma" || /probiotic/i.test(p.name))).toBe(false);
    const { container } = renderAt("/gift-guides/25-days-sponsors");
    expect([...container.querySelectorAll("[data-gift-also-sponsoring] [data-gift-also-name]")].map((n) => n.textContent)).toContain("Hilma"); // holiday audit 1121 #77: one chip per name // holiday audit B (11-20): every lineup sponsor without a card is named here
    expect(container.querySelector('a[href*="hilma"]')).toBeNull();
  });
  it("draws the badges on the list, no price but the checked one (owner 11-18), and every Shop link is sponsored + noopener", () => {
    // Owner 11-21: Shop Small Louisiana is retired (src/content/giftGuideLive.mjs); the sponsors page carries badges too.
    const { container } = renderAt("/gift-guides/25-days-sponsors");
    const badges = [...container.querySelectorAll("[data-gift-badge]")].map((b) => b.textContent);
    expect(badges).toContain("25 Days sponsor");
    // The only "$" on the list is a checked price beside Shop (src/test/giftGuidePrices.test.tsx), never in a name, line or badge.
    const list = container.querySelector("[data-gift-list]")!.cloneNode(true) as HTMLElement;
    list.querySelectorAll("[data-gift-price]").forEach((el) => el.remove());
    expect(list.textContent).not.toMatch(/\$\s?\d/);
    const out = [...container.querySelectorAll("[data-gift-list] a:not(.gg-cart)")];
    // The Amazon cart icon (11-21) is its own link beside an Amazon card, counted apart. One link per pick (owner 11-21: "remove the shop at button, when they click the title of the image it will go
    // there"): the photo and name together; the count follows the data.
    expect(out.length).toBe(guideBySlug("25-days-sponsors")!.picks.length);
    expect(out.length).toBeGreaterThan(10); // one guide per product (owner 11-19)
    for (const a of out) expect(a.getAttribute("rel")).toBe("sponsored noopener");
  });
  it("loads the price-verified budget guides like the others (lead 2026-11-18: the hold is released)", () => {
    for (const slug of ["under-20", "under-25", "under-50", "stocking-stuffers"].filter((s) => (RESEARCHED_PICKS[s]?.length ?? 0) >= 6)) {
      expect(RESEARCHED_PICKS[slug]?.length, slug).toBeGreaterThan(5); // one guide per product (owner 11-19)
      expect(guideBySlug(slug)?.picks.map((p) => p.href), slug).toEqual(RESEARCHED_PICKS[slug].map((p) => p.href));
      const { container } = renderAt(`/gift-guides/${slug}`);
      expandAll(container);
      expect(container.querySelector("[data-gift-coming-soon]"), slug).toBeNull();
      expect(container.querySelectorAll("[data-gift-pick]").length, slug).toBe(RESEARCHED_PICKS[slug].length);
      cleanup();
    }
  });
});

describe("gift guides: a pick's photo that fails to load falls back to its initial tile", () => {
  it("swaps a broken photo for the letter tile, never a blank gap", () => {
    const g = guideBySlug("mom")!;
    const withPhoto = g.picks.findIndex((p) => p.image);
    expect(withPhoto).toBeGreaterThanOrEqual(0);
    const { container } = renderAt("/gift-guides/mom");
    const row = container.querySelectorAll("li[data-gift-pick]")[withPhoto];
    const img = row.querySelector("img.gg-thumb")!;
    expect(img.getAttribute("width")).toBe("52");
    fireEvent.error(img);
    expect(row.querySelector("img.gg-thumb")).toBeNull();
    expect(row.querySelector("[data-gift-letter]")?.textContent).toBe(storeLabel(g.picks[withPhoto]));
  });
});

describe("gift guides: the search in the tool row filters guides by title and group", () => {
  it("matches titles and group names, case- and accent-blind; empty words match nothing", () => {
    expect(searchGuides("")).toEqual([]);
    expect(searchGuides("   ")).toEqual([]);
    expect(searchGuides("MOM").map((g) => g.slug)).toEqual(expect.arrayContaining(["mom", "new-mom"].filter((s) => guideBySlug(s) && !guideBySlug(s)!.empty)));
    // By group: "by person" finds the guides in that row (owner 11-21: only Her and Him are live there).
    expect(searchGuides("by person").map((g) => g.slug)).toEqual(expect.arrayContaining(["her", "him"]));
    // The Experiences row is gone (owner 11-18 PM) and the store pages are retired (owner 11-21): none is found.
    expect(searchGuides("experiences").map((g) => g.slug)).not.toContain("spa-days");
    expect(searchGuides("tractor supply")).toEqual([]);
    // Every word must match (one that matches nothing empties the list).
    expect(searchGuides("by person xyzzy").length).toBe(0);
    // Titles and groups only, never a pick's name (Cafe Du Monde's "Coffee and Chicory" is a pick, not a guide).
    expect(searchGuides("chicory").length).toBe(0);
    expect(searchGuides("xyzzy")).toEqual([]);
  });
  it("the box sits in the slim row under the title (owner redesign 11-18 PM); typing lists the matches under it", () => {
    const { container } = renderAt("/gift-guides");
    // Owner 11-21: the tools sit on the row under the header, right of the shipping pill.
    const row = container.querySelector("[data-gift-headrow] [data-gift-quick]")!;
    // Owner 11-21 ("make search an icon always"): a magnifier icon until tapped; then the field is focused.
    expect(row.querySelector("input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search gift guides" }));
    // Holiday audit 1121 #20: the search field is a combobox that opens its results.
    const input = screen.getByRole("combobox", { name: "Search gift guides" });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("placeholder")).toBe("Search guides");
    expect(row.contains(input)).toBe(true);
    expect(container.querySelectorAll("input[data-gift-search]").length).toBe(1);
    expect(row.querySelector("label svg")).not.toBeNull();
    fireEvent.change(input, { target: { value: "kids" } });
    const found = [...row.querySelectorAll("a[data-gift-found]")].map((a) => a.getAttribute("data-gift-found"));
    // Owner 11-21: only Her, Him and Kids are live; "kids" finds Kids.
    expect(found).toContain("kids");
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(row.textContent).toContain("No guides match");
    fireEvent.change(input, { target: { value: "" } });
    expect(row.querySelector("[data-gift-search-results]")).toBeNull();
    // The menu is the guides alone.
    expect(container.querySelector("[data-gift-sidebar] input")).toBeNull();
    // Owner 11-21 ("just do for her, him, kids with their color instead of the filter"): plain links, no groups.
    expect(container.querySelectorAll("[data-gift-sidebar] details").length).toBe(0);
    expect([...container.querySelectorAll("[data-gift-side-guides] a[data-gift-side]")].map((a) => a.getAttribute("data-gift-side"))).toEqual(["", "her", "him", "kids"]);
  });
});

describe("gift guides: hearts save to My list (aria-pressed, never opening the guide)", () => {
  afterEach(() => {
    window.localStorage.clear();
    resetGiftListForTests();
  });
  // Owner 2026-11-21: "they don't need an option to heart the whole guide". No guide tile carries a heart; the items do.
  it("no guide tile has a heart (the landing; the group pages are gone, holiday audit 1121 #14); an item heart counts on the tool row's My list icon", () => {
    window.localStorage.clear();
    resetGiftListForTests();
    for (const url of ["/gift-guides"]) {
      const { container } = renderAt(url);
      const tiles = container.querySelectorAll("li.gg-tile-li");
      expect(tiles.length, url).toBeGreaterThan(1);
      for (const t of tiles) expect(t.querySelector("[data-gift-heart], button"), url).toBeNull();
      cleanup();
    }
    const { container } = renderAt("/gift-guides/him");
    const link = container.querySelector("[data-gift-my-list-link]")!;
    expect(link.getAttribute("aria-label")).toBe("My Wish List, 0 saved");
    // No "0" badge on an empty list (pre-launch audit 11-18 PM).
    expect(link.textContent).toBe("");
    const heart = container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!;
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(heart.closest("a")).toBeNull();
    tapHeart(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    expect(link.getAttribute("aria-label")).toBe("My Wish List, 1 saved");
    expect(link.textContent).toBe("1");
    tapHeart(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(link.getAttribute("aria-label")).toBe("My Wish List, 0 saved");
  });
  it("a pick heart saves the pick; My list shows saved guides and picks", () => {
    const g = guideBySlug("mom")!;
    const view = renderAt("/gift-guides/mom");
    expandAll(view.container);
    const hearts = [...view.container.querySelectorAll("[data-gift-pick] [data-gift-heart]")];
    expect(hearts.length).toBe(g.picks.length);
    for (const h of hearts) expect(h.closest("a")).toBeNull();
    tapHeart(hearts[0]);
    expect(hearts[0].getAttribute("aria-pressed")).toBe("true");
    cleanup();
    const mine = renderAt("/gift-guides?list=mine").container;
    expect(mine.querySelector("[data-gift-my-list]")).not.toBeNull();
    expect(mine.querySelectorAll("[data-gift-my-list] [data-gift-wish-item]").length).toBe(1);
    expect(mine.querySelector("[data-gift-my-list] [data-gift-wish-item]")?.textContent).toContain(g.picks[0].name);
  });
  it("blocked storage still works for the visit", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = renderAt("/gift-guides/him");
    const heart = container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!;
    tapHeart(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    spy.mockRestore();
  });
});

describe("gift guides: pick badges come from optional fields, never a price", () => {
  it("Trending (or Trending on TikTok), Pre-order, Louisiana-made, 25 Days sponsor, Ships fast, Local pickup, in that order", () => {
    expect(badgesFor("TABASCO", { louisianaFit: true, trending: true, shipsFast: true, localPickup: true })).toEqual(["trending", "louisiana-made", "ships-fast", "local-pickup"]);
    // Big batch 1120: a TikTok find wears "Trending on TikTok" in place of Trending; a pre-order says so.
    expect(badgesFor("21 Collective", { trending: true, tiktok: true, preorder: true })).toEqual(["tiktok", "preorder", "sponsor"]); // 21 Collective is a 25 Days sponsor
    expect(badgesFor("Crew Dog")).toEqual(["sponsor"]);
    expect(badgesFor("YETI")).toEqual([]);
    expect(badgesFor(undefined, { localPickup: true })).toEqual(["local-pickup"]);
    expect(Object.values(giftGuides.badges)).toEqual(["Trending", "Trending on TikTok", "Pre-order", "Louisiana-made", "25 Days sponsor", "Ships fast", "Local pickup", "Shop Louisiana"]);
    for (const label of Object.values(giftGuides.badges)) expect(label).not.toMatch(/\$/);
  });
});

describe("gift guides: the Hire-a-Helpr box", () => {
  it("sits at the bottom of every guide, with the exact words (Gift Wrap & Cards, where it sat on top, is retired: owner 11-21)", () => {
    const mom = renderAt("/gift-guides/mom").container;
    const box = mom.querySelector("[data-gift-helpr]")!;
    expect(box.textContent).toBe("No time to wrap?Hire a local Helpr to wrap your gifts, assemble toys or hang the Christmas lights.Post a job");
    const article = mom.querySelector("article[data-gift-guide]")!;
    expect(article.lastElementChild).toBe(box);
  });
  it("Post a job opens the existing pre-filled post flow: title Gift wrapping, an existing category, no new enum", () => {
    const { container } = renderAt("/gift-guides/mom");
    const href = container.querySelector("a[data-gift-helpr-post]")!.getAttribute("href")!;
    expect(href.startsWith("/post-job?")).toBe(true);
    const f = readMatchmakerLink(new URLSearchParams(href.split("?")[1]));
    expect(f?.title).toBe("Gift wrapping");
    expect(["errands", "other"]).toContain(f?.category);
    expect(Object.keys(JOB_CATEGORY_LABELS)).toContain(f?.category);
    expect(PREFILL_OPENS_DETAILS).toContain(MATCHMAKER_PARAM);
  });
});
