/**
 * Holiday gift guides audit 1121, polish batch 5 (Audit-Holiday-Guides-PARTIAL-1121.json findings #11, #13, #20, #21,
 * #22, #24, #27, #49; #40/#78 live in src/components/ScrollToTop.button.test.tsx). One guard per class, each shown red
 * on the broken state:
 *   - a swipe round fills from a capped store once the other stores run out (Him dealt 15, Her under $25 6 of 12);
 *   - the swipe card shows the price only (no store line) and Swipe lists people in the finder's order;
 *   - the fun pages carry the guides' frame: head row (search, My list heart, Share) and the left menu;
 *   - search results close on a tap outside and the field is a combobox that says so;
 *   - the Share menu takes focus, moves with the arrow keys, and Escape hands focus back to Share;
 *   - the page comes before the menu in the code, and the disclosures come last;
 *   - Her, Him and Kids link the free printables;
 *   - an old ?group= link opens the landing (src/test/giftGuidesPage.test.tsx "every old group link opens the landing");
 *   - a Small Business Saturday card names the business (no person in brackets), a town (no area code), and never says
 *     a place you visit "Ships";
 *
 * @mutate src/content/giftGuideFun1120.ts |   for (const rest of from) { |   for (const rest of [] as T[]) {
 * @mutate src/content/giftGuideSwipe.ts | const SWIPE_MIN = 3; | const SWIPE_MIN = 3; const SWIPE_BANDS = QUIZ_BUDGETS;
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | <p className="gg-swipe-meta m-0"><PickPrice pick={card} /></p> | <p className="gg-swipe-meta m-0"><span>{card.store}</span><PickPrice pick={card} /></p>
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |         <GiftGuidesSidebar active={null} page={path} /> |         {null}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | tools={<GiftGuideTools path={path} title={title} />} | tools={null}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <li key={t.to}><Link to={t.to} {...current(t.to)} | <li key={t.to}><Link to={t.to}
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       if (!searchBox.current?.contains(e.target as Node)) setResultsOpen(false); |       if (!searchBox.current?.contains(e.target as Node)) return;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       button.current?.focus(); |       void 0;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |     menuItems(menu.current)[0]?.focus(); |     void 0;
 * @mutate src/content/printables.ts |     guides: ["gift-wrap-and-cards"], |     guides: ["gift-wrap-and-cards", "her", "him", "kids"],
 * @mutate src/content/giftGuideSmallBiz.json | "name":"Bake & Brush", | "name":"Bake & Brush (Holli M. Landry)",
 * @mutate src/content/giftGuideSmallBiz.json | "name":"Breads and Sweets by Babs","town":"Acadiana" | "name":"Breads and Sweets by Babs","town":"Acadiana (337)"
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | [data-gift-guide="25-days-sponsors"] .gg-nm-name{-webkit-line-clamp:3} | [data-gift-guide="25-days-sponsors"] .gg-nm-name{}
 * @mutate src/pages/info/giftGuides/SmallBizFeatureCta.tsx |     requestAnimationFrame(() => openButton.current?.focus()); |     void 0;
 * @mutate src/pages/info/giftGuides/SmallBizFeatureCta.tsx |       {Form && <div hidden={!open} data-gift-sbs-form-wrap=""><Form onClose={close} /></div>} |       {Form && open && <div data-gift-sbs-form-wrap=""><Form onClose={close} /></div>}
 * @mutate src/pages/info/giftGuides/SmallBizSubmitForm.tsx | .gg-sbs-cta p.gg-sbs-err{color:hsl(var(--destructive-ink));margin:0} | .gg-sbs-cta p.gg-sbs-x{}
 * @mutate src/content/giftGuideFun1120.ts |   finderWho("her", "Her", ["her"], "Her"), |   { id: "her", label: "Her", guides: finderGuides("her"), forName: "Her" },
 * @mutate scripts/gift-guide-small-biz.mjs | export const shipsFor = (b) => (VISIT_CATEGORIES.has(b.category) \|\| VENUE_SLUGS.has(b.slug) ? "local" : shipsOf(b.shipping)); | export const shipsFor = (b) => shipsOf(b.shipping);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { SWIPE_ROUND, SWIPE_WHO, borrowFits, seededRandom, swipePool, swipeRound } from "@/content/giftGuideFun1120";
import { FINDER_WHO } from "@/content/giftGuideExtras1120";
import { BUDGET_GUIDES, fitsBudget } from "@/content/giftPickBand";
import { printablesForGuide } from "@/content/printables";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import { cardName, cardTown, shipsFor } from "../../scripts/gift-guide-small-biz.mjs";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// /shop-small's free listings read the live table; none in a unit test (sbs_public_featured held 0 on 2026-11-21).
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: vi.fn(async () => []),
  sbsLogoUrl: (id: string) => `https://x.invalid/logo?${id}`,
  sbsDeviceId: () => "test-device-0001",
  submitFeaturedLocal: vi.fn(async () => ({ ok: true })),
}));
import GiftGuides from "@/pages/info/GiftGuides";
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { GiftGuideTools } from "@/pages/info/giftGuides/GiftGuideShare";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

const pick = (i: number, store: string): CatalogPick => ({ name: `Gift ${i}`, href: `https://example.com/${i}`, store, band: 25 });

describe("a swipe round fills from a capped store once the others run out (holiday audit 1121 #11)", () => {
  it("12 fitting picks, 10 of them at one store, deal 12 cards, not 7", () => {
    const pool = [...Array.from({ length: 10 }, (_, i) => pick(i, "amazon")), pick(10, "grove"), pick(11, "target")];
    expect(swipeRound(pool, 25, new Set(), seededRandom(1)).length).toBe(12);
    // The cap still spreads a round across stores while they last: 30 Amazon + 20 others lead with the others.
    const big = [...Array.from({ length: 30 }, (_, i) => pick(i, "amazon")), ...Array.from({ length: 20 }, (_, i) => pick(100 + i, `s${i}`))];
    const r = swipeRound(big, 25, new Set(), seededRandom(2));
    expect(r.length).toBe(SWIPE_ROUND);
    expect(r.filter((p) => p.store === "amazon").length).toBe(5);
  });

  it("on the real guides every round is full, or holds every fitting pick (so 'Only N gifts' is true)", async () => {
    await loadAllGuidePicks();
    const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];
    const live = SWIPE_WHO.filter((w) => w.guides.every((g) => guideBySlug(g.slug)));
    // Owner 11-21 evening: Her, Him and Kids only (no Me, Mom or Dad). swipeRound is the Secret Santa round's deal now
    // (a plain deck is swipeDeck, src/test/swipeWho1121.test.tsx); its budgets are the group's dollar limits.
    expect(live.length).toBeGreaterThan(2); // inventory floor: her, him, kids on 2026-11-21
    const short: string[] = [];
    for (const w of live) for (const budget of [25, 50, 100, 0] as const) {
      const borrow = budget ? BUDGET_GUIDES.flatMap((g) => picksOf(g).filter((p) => borrowFits(w.id, p))) : [];
      const pool = swipePool(w.id, picksOf);
      const fitting = new Set([...pool, ...borrow].filter((p) => p.href && p.name && fitsBudget(p, budget)).map((p) => p.href)).size;
      const n = swipeRound(pool, budget, new Set(), seededRandom(1), borrow).length;
      if (n !== Math.min(SWIPE_ROUND, fitting)) short.push(`${w.id}/${budget}: ${n} of ${fitting}`);
    }
    expect(short).toEqual([]);
  });
});

describe("the swipe card and its people (holiday audit 1121 #24)", () => {
  // Owner 2026-11-21 evening ("I tapped Me and the first thing that came up was stuff for hunting but I'm a girl?"):
  // Swipe offers the quiz's people, Her, Him and Kids, in that order; no Me, Mom or Dad.
  it("Swipe lists Her, Him and Kids, in the quiz's order", () => {
    const quiz: string[] = FINDER_WHO.map((w) => w.id as string).filter((id) => ["her", "him", "kids"].includes(id));
    expect(SWIPE_WHO.map((w) => w.id)).toEqual(quiz);
  });

  it("a dealt card shows its price, never its store", async () => {
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    fireEvent.click(container.querySelector('[data-swipe-who="her"]')!);
    await waitFor(() => expect(container.querySelector('[data-swipe-budget="under-25"]')).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(container.querySelector('[data-swipe-budget="under-25"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    const meta = container.querySelector(".gg-swipe-meta")!;
    const href = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")!;
    const card = (guideBySlug("her")?.picks ?? []).find((p) => p.href === href)!;
    expect(card).toBeTruthy();
    expect(card.store.length).toBeGreaterThan(2);
    expect(meta.textContent?.toLowerCase()).not.toContain(card.store.toLowerCase());
  });
});

describe("the fun pages carry the guides' frame (holiday audit 1121 #13)", () => {
  it("head row with search, the My list heart and Share, and the left menu marking the open tool", () => {
    const { container } = render(<MemoryRouter><FunBody title="Swipe to find gifts" path="/gift-guides/swipe"><p data-deck="">deck</p></FunBody></MemoryRouter>);
    // Owner 11-22 #13: the h1 is the page's banner (its lead, read once, then the title).
    expect(container.querySelector("[data-gift-banner] h1")?.textContent).toBe("make it fun Swipe to Find Gifts");
    expect(container.querySelector("[data-gift-headrow] [data-gift-search-button]")).not.toBeNull();
    expect(container.querySelector("[data-gift-headrow] [data-gift-my-list-link]")).not.toBeNull();
    expect(container.querySelector("[data-gift-headrow] [data-gift-share]")).not.toBeNull();
    expect(container.querySelector("[data-gift-sidebar]")).not.toBeNull();
    expect([...container.querySelectorAll('[data-gift-sidebar] a[aria-current="page"]')].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/swipe"]);
    expect(container.querySelector(".gg-main [data-deck]")).not.toBeNull();
  });
});

describe("search results close on a tap outside (holiday audit 1121 #20)", () => {
  it("typing opens them, a tap outside closes them, focusing the field opens them again", async () => {
    const { container } = render(<MemoryRouter><p data-outside="">x</p><GiftGuideTools path="/gift-guides" title="Gift guides" many /></MemoryRouter>);
    // Owner 11-21 ("make search an icon always"): the field opens from the magnifier.
    fireEvent.click(container.querySelector("[data-gift-search-button]")!);
    const input = container.querySelector<HTMLInputElement>("[data-gift-search]")!;
    expect(input.getAttribute("role")).toBe("combobox");
    fireEvent.change(input, { target: { value: "her" } });
    expect(container.querySelector("[data-gift-search-results]")).not.toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(container.querySelector("[data-gift-search-results]")!.id);
    fireEvent.pointerDown(container.querySelector("[data-outside]")!);
    expect(container.querySelector("[data-gift-search-results]")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.focus(input);
    expect(container.querySelector("[data-gift-search-results]")).not.toBeNull();
  });
});

describe("the Share menu's keyboard (holiday audit 1121 #21)", () => {
  it("opening moves focus in, arrows move through it, Escape hands focus back to Share", () => {
    const { container } = render(<MemoryRouter><GiftGuideTools path="/gift-guides/her" title="Gifts for Her" /></MemoryRouter>);
    const share = container.querySelector<HTMLButtonElement>("[data-gift-share]")!;
    act(() => share.click());
    const items = [...container.querySelectorAll<HTMLElement>("[data-gift-share-menu] [role=menuitem]")];
    expect(items.length).toBeGreaterThan(2);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-gift-share-menu]")).toBeNull();
    expect(document.activeElement).toBe(share);
  });
});

describe("page, then menu, then disclosures in the code (holiday audit 1121 #22 / #27)", () => {
  const order = (c: HTMLElement) => [...c.querySelector(".gg-layout")!.children].map((el) => (el.classList.contains("gg-main") ? "main" : el.hasAttribute("data-gift-sidebar") ? "menu" : el.classList.contains("gg-disc") ? "disclosures" : el.tagName));
  it("on a guide, the landing and a fun page", () => {
    for (const url of ["/gift-guides/her", "/gift-guides"]) {
      const { container } = render(
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/gift-guides" element={<GiftGuides />} />
            <Route path="/gift-guides/:slug" element={<GiftGuides />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(order(container), url).toEqual(["main", "menu", "disclosures"]);
      cleanup();
    }
    const { container } = render(<MemoryRouter><FunBody title="Swipe" path="/gift-guides/swipe"><p>deck</p></FunBody></MemoryRouter>);
    expect(order(container)).toEqual(["main", "menu", "disclosures"]);
  });
});

describe("Her, Him and Kids carry no printables (owner 2026-11-21, reversing holiday audit 1121 #49)", () => {
  it("no live guide links a printable; they live under Free printables in the menu", () => {
    // Owner 2026-11-21: "remove from her, they already have their own section."
    for (const slug of ["her", "him", "kids"]) expect(printablesForGuide(slug).map((p) => p.id), slug).toEqual([]);
    expect(printablesForGuide("gift-wrap-and-cards").map((p) => p.id)).toEqual(["gift-tags"]);
  });
});

describe("Small Business Saturday cards (holiday audit 1121 #58)", () => {
  const cards = SMALL_BIZ as { slug: string; name: string; town: string; category: string; ships: string; gift?: string }[];
  it("name the business, give a town, and never say a place you visit ships", () => {
    expect(cards.length).toBeGreaterThan(30); // inventory floor: 37 confirmed Louisiana sponsors on 2026-11-21
    expect(cards.filter((c) => /\(.*\)\s*$/.test(c.name)).map((c) => c.name)).toEqual([]);
    expect(cards.filter((c) => /\b\d{3}\b/.test(c.town)).map((c) => c.town)).toEqual([]);
    const visits = cards.filter((c) => ["Experiences & Tours", "Services", "Beauty & Wellness"].includes(c.category));
    expect(visits.length).toBeGreaterThan(5);
    expect(visits.filter((c) => c.ships === "ships").map((c) => c.name)).toEqual([]);
    // A tracker aside about the owner reads as a note, not a gift ("gift certificate (she emails them digitally)").
    expect(cards.filter((c) => /\((she|he|they) /.test(c.gift ?? "")).map((c) => c.gift)).toEqual([]);
  });
  it("the generator's own rules (so a regenerated file keeps them)", () => {
    expect(cardName("Bake & Brush (Holli M. Landry)")).toBe("Bake & Brush");
    expect(cardTown("Lafayette (serves 337 and 225)")).toBe("Lafayette");
    expect(cardTown("New Orleans (Mid-City)")).toBe("New Orleans (Mid-City)");
    expect(shipsFor({ slug: "creole-queen", category: "Experiences & Tours", shipping: "Tickets online" })).toBe("local");
    expect(shipsFor({ slug: "zydeco-chop-chop", category: "Food & Sweets", shipping: "Ships nationwide" })).toBe("ships");
  });
});

describe("sponsor names keep their meaningful end (holiday audit 1121 #67)", () => {
  it("the sponsors page lets a row name run to three lines (the show or product comes last)", () => {
    const rule = GIFT_GUIDES_CSS.match(/\[data-gift-guide="25-days-sponsors"\] \.gg-nm-name\{([^}]*)\}/);
    expect(rule?.[1]).toContain("-webkit-line-clamp:3");
  });
});

describe("the Small Business Saturday sign-up form (holiday audit 1121 #76)", () => {
  it("Close hands focus back to the open button, and reopening keeps what was typed", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    // The sign-up card is swapped for the listings module once it loads; wait for that so the click lands on the final card.
    await waitFor(() => expect([...container.querySelectorAll("style")].some((st) => st.textContent?.includes(".gg-sbs-local"))).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(container.querySelector("[data-gift-sbs-open]")).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(container.querySelector("[data-gift-sbs-open]")!);
    await waitFor(() => expect(container.querySelector("[data-gift-sbs-form] input")).not.toBeNull(), { timeout: 5000 });
    const name = container.querySelector<HTMLInputElement>("[data-gift-sbs-form] input")!;
    expect(name.getAttribute("autocapitalize")).toBe("words");
    fireEvent.change(name, { target: { value: "Bayou Candle Co" } });
    const close = [...container.querySelectorAll<HTMLButtonElement>("[data-gift-sbs-form] button")].find((b) => b.textContent === SBS_WORDS.cancel)!;
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement?.hasAttribute("data-gift-sbs-open")).toBe(true));
    fireEvent.click(container.querySelector("[data-gift-sbs-open]")!);
    expect(container.querySelector<HTMLInputElement>("[data-gift-sbs-form] input")!.value).toBe("Bayou Candle Co");
  });
  it("the form's problem line is red like the field errors (the card's own p colour won), and the link example reads as an example", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    // The sign-up card is swapped for the listings module once it loads; wait for that so the click lands on the final card.
    await waitFor(() => expect([...container.querySelectorAll("style")].some((st) => st.textContent?.includes(".gg-sbs-local"))).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(container.querySelector("[data-gift-sbs-open]")).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(container.querySelector("[data-gift-sbs-open]")!);
    await waitFor(() => expect(container.querySelector("[data-gift-sbs-form] style")).not.toBeNull(), { timeout: 5000 });
    const css = container.querySelector("[data-gift-sbs-form] style")!.textContent!;
    expect(css).toMatch(/\.gg-sbs-cta p\.gg-sbs-err\{color:hsl\(var\(--destructive-ink\)\)/);
    expect(css).toMatch(/\[aria-invalid="true"\]\{border-color:hsl\(var\(--destructive-ink\)\)/);
    expect(container.querySelector('[data-gift-sbs-form] input[type="url"]')?.getAttribute("placeholder")).toMatch(/^e\.g\. /);
  });
});

describe("the swipe people read the finder's lists on first use, not at load (holiday audit 1121 #13)", () => {
  it("no module-level call reads FINDER_WHO (the build puts the two modules in chunks that import each other)", () => {
    const src = blankComments(readFileSync("src/content/giftGuideFun1120.ts", "utf8"));
    const whoBlock = src.slice(src.indexOf("export const SWIPE_WHO"), src.indexOf("export const SWIPE_ROUND"));
    expect(whoBlock.length).toBeGreaterThan(200);
    expect(whoBlock).not.toMatch(/finderGuides\(|FINDER_WHO/);
    // The same trap with the quiz's chunk (owner 11-21 evening, Swipe matches the quiz): no module-level copy of a
    // giftQuiz.ts value; a load-time SWIPE_BUDGETS = QUIZ_BUDGETS was undefined in the build and crashed "Kids".
    const moduleLevel = src.split("\n").filter((l) => /^(export )?const /.test(l) && /\bQUIZ_[A-Z]+\b/.test(l));
    expect(moduleLevel).toEqual([]);
    expect((whoBlock.match(/finderWho\(/g) ?? []).length).toBeGreaterThan(2); // Her, Him, Kids (owner 11-21 evening)
    // The lists still resolve on use.
    expect(SWIPE_WHO.find((w) => w.id === "her")!.guides.length).toBeGreaterThan(0);
  });
});
