/**
 * Guide dupes (owner 2026-11-23 ~1:05 PM approved 69 cheaper lookalikes; "for the ones with dupes we will just add the
 * word dupe to the left of the cart, no circle around it"; ~1:07 PM "those don't show on the main list, only when they
 * click dupe next to the cart will it show"). The data (src/content/giftGuideDupes.json) holds only plain Amazon
 * product links with our tag and a checked price, one or more per gift (owner ~1:50 PM: the UGG Evelina has three); a
 * pick with dupes draws the plain words "shop similar" (owner ~3:25 PM; it was "dupe") right before its cart (in the cart's place when it has none), with no
 * circle, border or fill; a pick without one draws nothing; a dupe is never a row or a count on the page and shows only
 * in the panel the word opens, as the guide's own rows ("list the dupes the same way the other layout is for the
 * guides"), with Escape / X closing it and focus going back to the word.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {similar && pick.dupes?.length ? <DupeLink dupes={pick.dupes} of={pick.name} solo={!cart} /> : null} | {null}
 * @mutate src/content/giftGuideCatalog.ts | return d.length ? { ...p, dupes: d } : p; | return p;
 * @mutate src/pages/info/giftGuides/DupePanel.tsx | {picks.map((p) => <PickRow key={p.href} pick={p} />)} | {picks.slice(0, 1).map((p) => <PickRow key={p.href} pick={p} />)}
 * @mutate src/content/giftGuideDupes.ts | ("href" in d.for ? d.for.href === pick.href : pick.brand === d.for.brand && pick.name.includes(d.for.nameHas)) | ("href" in d.for ? d.for.href === pick.href : false)
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | border:0;border-radius:0;background:transparent;box-shadow:none;font:inherit;font-size:12px | border:1px solid;border-radius:999px;background:#eee;box-shadow:none;font:inherit;font-size:12px
 * @mutate src/pages/info/giftGuides/DupePanel.tsx |     anchor.current?.focus(); |     void 0;
 * @mutate src/pages/info/giftGuides/DupeLink.tsx | {`: ${DUPE.count(dupes.length)}`} | {""}
 * @mutate src/pages/info/giftGuides/GiftGuideTop10.tsx | rank={i + 1} similar={false} /> | rank={i + 1} />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PickChunk } from "@/content/giftGuidePicks";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { dupesFor, type DupeEntry, type GuideDupe } from "@/content/giftGuideDupes";
import DUPES_FILE from "@/content/giftGuideDupes.json";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { openPriceSections } from "./helpers/openPriceSections";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const RECORDS = (DUPES_FILE as { dupes: DupeEntry[] }).dupes;
const DUPES = RECORDS.flatMap((r) => r.dupes);
const CHUNKS: Record<string, PickChunk["picks"]> = Object.fromEntries(
  Object.entries(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" }))
    .map(([f, c]) => [f.replace(/^.*\/|\.json$/g, ""), c.picks] as const),
);
// Owner 11-24: a pick moved from Kids to its themed guide keeps its approved dupe there (the Yoto Bluey bundle).
const OWNER_GUIDES = ["her", "him", "kids", ...THEME_GUIDES_1124];
const AMAZON_DP = /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=louisianahelpr-20$/;

describe("dupes data: plain Amazon tag links with a checked price, each on one of the owner's picks", () => {
  it("every entry is an https Amazon product link with our tag, a price, a check day, an Amazon photo and a rating", () => {
    // Inventory floor: 72 dupes on 70 picks on 2026-11-23 (57 of round 1's 69, 12 of round 2's 16, the Evelina's 3).
    expect(DUPES.length).toBeGreaterThan(65);
    expect(RECORDS.every((r) => r.dupes.length > 0)).toBe(true);
    for (const d of DUPES) {
      expect(d.href, d.name).toMatch(AMAZON_DP);
      expect(d.price, d.name).toBeGreaterThan(0);
      expect(d.priceAt, d.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.image, d.name).toMatch(/^https:\/\/m\.media-amazon\.com\/images\//);
      expect(d.rating, d.name).toBeGreaterThan(0);
      expect(d.reviewCount, d.name).toBeGreaterThan(0);
    }
  });

  it("each record attaches to exactly one pick on Her, Him, Kids or a themed guide, one record per pick, every dupe cheaper than it", () => {
    const owner = OWNER_GUIDES.flatMap((g) => CHUNKS[g].map((p) => ({ ...p, guide: g })));
    for (const r of RECORDS) {
      const hits = owner.filter((p) => p.guide === r.guide && dupesFor(p, [r]).length > 0);
      expect(hits.map((p) => p.name), r.original).toHaveLength(1);
      for (const d of r.dupes) expect(d.price, d.name).toBeLessThan(hits[0].price ?? Infinity);
    }
    const keys = RECORDS.map((r) => JSON.stringify(r.for));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a gift can carry several dupes: the UGG Evelina's three, in the order the owner gave them", () => {
    const evelina = CHUNKS.her.find((p) => p.name === "UGG Goldenstar Evelina Clog, Beige")!;
    expect(dupesFor(evelina, RECORDS).map((d) => d.href)).toEqual([
      "https://www.amazon.com/dp/B0H7TCQNZ9?tag=louisianahelpr-20",
      "https://www.amazon.com/dp/B0H7TBK3H7?tag=louisianahelpr-20",
      "https://www.amazon.com/dp/B0HJQQLYH5?tag=louisianahelpr-20",
    ]);
  });

  it("the Braun entry matches by brand + model, so it still attaches after the pick is relinked to the IPL-only listing", () => {
    const braun = RECORDS.find((d) => "brand" in d.for);
    expect(braun?.for).toEqual({ brand: "Braun", nameHas: "Silk-expert Pro 5" });
    const relinked = { name: "Braun Silk-expert Pro 5 IPL Hair Removal Device", brand: "Braun", href: "https://www.amazon.com/dp/B0XXXXXXXX?tag=louisianahelpr-20" };
    expect(dupesFor(relinked, RECORDS).map((d) => d.name)).toEqual(braun?.dupes.map((d) => d.name));
    expect(dupesFor({ ...relinked, brand: "Philips" }, RECORDS)).toEqual([]);
  });

  it("a dupe is never added as a pick: the only dupe link that is also a row is one the owner already kept on her own (exact)", () => {
    const pickHrefs = new Set(Object.values(CHUNKS).flat().map((p) => p.href));
    // KastKing Polarized Sunglasses is one of her own Him keeps (him.json, $23.99) AND the approved dupe for Costa Sullivan.
    expect(DUPES.filter((d) => pickHrefs.has(d.href)).map((d) => d.name)).toEqual(["KastKing Polarized Sport Sunglasses"]);
  });
});

const amazonPick: CatalogPick = { name: "Original Amazon Thing", href: "https://www.amazon.com/dp/B000000001?tag=louisianahelpr-20", store: "amazon", price: 300, priceAt: "2026-11-23" };
const shopmyPick: CatalogPick = { name: "Original ShopMy Thing", href: "https://go.shopmy.us/p-1", store: "shopmy", brand: "Brand", price: 300, priceAt: "2026-11-23" };
const dupe: GuideDupe = { name: "Lookalike Thing", price: 49.99, priceAt: "2026-11-23", href: "https://www.amazon.com/dp/B000000002?tag=louisianahelpr-20", image: "https://m.media-amazon.com/images/I/x.jpg", rating: 4.4, reviewCount: 1234, kind: "dupe" };
const dupes = [dupe];
const three: GuideDupe[] = [dupe, { ...dupe, name: "Second Thing", href: "https://www.amazon.com/dp/B000000003?tag=louisianahelpr-20", price: 39.5 }, { ...dupe, name: "Third Thing", href: "https://www.amazon.com/dp/B000000004?tag=louisianahelpr-20", price: 20 }];
const row = (pick: CatalogPick) => render(<MemoryRouter><style>{GIFT_GUIDES_CSS}</style><ol className="gg gg-list"><PickRow pick={pick} guide="her" /></ol></MemoryRouter>).container;
/** A row's shape: every element's tag and classes, in order (text and links aside). */
const shape = (el: Element): string => `${el.tagName}.${[...el.classList].sort().join(".")}(${[...el.children].map(shape).join(",")})`;
/** The guide's own row for a dupe, drawn as the guide draws an Amazon pick. */
const guideRowShape = (d: GuideDupe) => {
  const { container } = render(<MemoryRouter><ol className="gg-list"><PickRow pick={{ name: d.name, href: d.href, store: "amazon", price: d.price, priceAt: d.priceAt, image: d.image }} /></ol></MemoryRouter>);
  const s = shape(container.querySelector("li[data-gift-pick]")!);
  cleanup();
  return s;
};

describe("the card's plain 'dupe' word", () => {
  it("sits right before the cart on an Amazon pick, in the cart's place on a pick with no cart, and nowhere without a dupe", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
    const a = row({ ...amazonPick, dupes });
    const word = a.querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
    // The visible words are "shop similar" (owner 11-23 ~3:25 PM; the count is screen-reader only), and they start the
    // accessible name (WCAG 2.5.3).
    expect(word.firstChild?.textContent).toBe("shop similar");
    expect(word.querySelector(".sr-only")?.textContent).toBe(": 1 similar item");
    expect(word.nextElementSibling?.classList.contains("gg-cart")).toBe(true);
    expect(word.hasAttribute("aria-label")).toBe(false);
    expect(screen.getByRole("button", { name: "shop similar: 1 similar item" })).toBe(word);
    expect(word.getAttribute("aria-haspopup")).toBe("dialog");
    expect(word.classList.contains("gg-dupe-solo")).toBe(false);
    cleanup();
    const s = row({ ...shopmyPick, dupes });
    expect(s.querySelector(".gg-cart")).toBeNull();
    expect(s.querySelector("[data-gift-dupe]")?.classList.contains("gg-dupe-solo")).toBe(true);
    cleanup();
    expect(row(amazonPick).querySelector("[data-gift-dupe]")).toBeNull();
  });

  it("has no circle, pill, border or fill (computed), is a 44px box, and the phone/desktop rules put it left of the cart", () => {
    const word = row({ ...amazonPick, dupes }).querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
    const cs = getComputedStyle(word);
    expect(cs.borderTopWidth === "0px" || cs.borderTopStyle === "none" || cs.borderTopStyle === "").toBe(true);
    expect(["0", "0px"]).toContain(cs.borderRadius);
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(cs.backgroundColor);
    expect(cs.boxShadow).toBe("none");
    expect(cs.height).toBe("44px");
    expect(cs.minWidth).toBe("44px");
    expect(cs.fontSize).toBe("12px");
    // "shop similar" stays on one line (owner 11-23 ~3:25 PM; checked at 320 px by screenshot, 2026-11-23).
    expect(cs.whiteSpace).toBe("nowrap");
    // No rule anywhere gives the word itself a border, radius, fill or shadow.
    const wordRules = [...GIFT_GUIDES_CSS.matchAll(/([^{}]*\.gg-dupe(?:-solo)?(?::hover|:focus-visible)?)\{([^}]*)\}/g)];
    expect(wordRules.length).toBeGreaterThan(5);
    for (const [, , body] of wordRules) {
      expect(body).not.toMatch(/(^|;)(border(-width|-style)?:(?!0(;|$))|border-radius:(?!0(;|$))|background(-color)?:(?!transparent)|box-shadow:(?!none))/);
    }
    // Phone: one 44px box left of the cart (cart right:44px, heart right:0); computer: beside the cart on the photo.
    expect(GIFT_GUIDES_CSS).toContain(".gg-list>:where([data-gift-pick])>.gg-dupe{bottom:0;right:88px}");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list>:where([data-gift-pick])>.gg-dupe-solo{right:44px}");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-dupe{top:46px;left:auto;right:46px;justify-content:center}");
    // The Top 10 card draws no words at all (owner 2026-11-24 10:36 AM: "Shop similar should only be in the guides not
    // the top 10"), so no rule places them there and no strip waits for them under the price.
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-top10[^{}]*\.gg-dupe/);
  });

  it("opens the panel on tap (desktop popover): the dupe as the guide's own row (photo, name, ~price, cart, tag link); Escape closes it, focus returns", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
    const expected = guideRowShape(dupe);
    const c = row({ ...amazonPick, dupes });
    expect(document.querySelector("[data-gift-dupe-panel]")).toBeNull();
    const word = c.querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
    act(() => { word.focus(); fireEvent.click(word); });
    const panel = await screen.findByRole("dialog", { name: "Shop similar for Original Amazon Thing" });
    expect(word.getAttribute("aria-expanded")).toBe("true");
    expect(panel.textContent).toContain("Shop similar");
    const list = panel.querySelector("ol.gg-list[data-gift-dupe-list]")!;
    const rows = [...list.querySelectorAll(":scope > li[data-gift-pick]")];
    expect(rows).toHaveLength(1);
    expect(shape(rows[0])).toBe(expected);
    const link = rows[0].querySelector<HTMLAnchorElement>("a.gg-item")!;
    expect(link.getAttribute("href")).toBe(dupe.href);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("sponsored noopener");
    expect(rows[0].querySelector(".gg-nm-name")?.textContent).toBe("Lookalike Thing");
    expect(rows[0].querySelector("[data-gift-price]")?.textContent).toBe("~$50");
    expect(rows[0].querySelector("img.gg-thumb")?.getAttribute("src")).toBe(dupe.image);
    expect(rows[0].querySelector(".gg-cart")).not.toBeNull();
    expect(panel.querySelectorAll("[data-gift-prices-as-of]")).toHaveLength(1);
    act(() => { fireEvent.keyDown(panel, { key: "Escape" }); });
    // Wait for the positive end state (focus back on the words, which happens once the panel has closed), then the panel is gone.
    await waitFor(() => expect(document.activeElement).toBe(word));
    expect(document.querySelector("[data-gift-dupe-panel]")).toBeNull();
    expect(word.getAttribute("aria-expanded")).toBe("false");
  });

  it("on a phone the panel is the bottom sheet, closed by its X with focus back on the word", async () => {
    const was = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const c = row({ ...amazonPick, dupes });
      const word = c.querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
      act(() => { word.focus(); fireEvent.click(word); });
      const panel = await waitFor(() => {
        const p = document.querySelector<HTMLElement>("[data-gift-dupe-panel]");
        expect(p).not.toBeNull();
        return p!;
      });
      expect(panel.getAttribute("role")).toBe("dialog");
      expect(panel.querySelector("li[data-gift-pick] a.gg-item")?.getAttribute("href")).toBe(dupe.href);
      const x = screen.getByRole("button", { name: /close/i });
      act(() => { fireEvent.click(x); });
      // Wait for the positive end state (focus back on the words, once the sheet has closed), then the sheet is gone.
      await waitFor(() => expect(document.activeElement).toBe(word));
      expect(document.querySelector("[data-gift-dupe-panel]")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: was });
    }
  });
});

describe("several dupes on one gift", () => {
  it("the word counts them, and the panel lists one guide row per dupe, side by side on a computer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
    const shapes = three.map(guideRowShape);
    const c = row({ ...shopmyPick, dupes: three });
    const word = c.querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
    expect(screen.getByRole("button", { name: "shop similar: 3 similar items" })).toBe(word);
    act(() => { word.focus(); fireEvent.click(word); });
    const panel = await screen.findByRole("dialog", { name: "Shop similar for Original ShopMy Thing" });
    expect(panel.textContent).toContain("Shop similar");
    const rows = [...panel.querySelectorAll("ol.gg-list > li[data-gift-pick]")];
    expect(rows.map((r) => r.querySelector("a.gg-item")?.getAttribute("href"))).toEqual(three.map((d) => d.href));
    expect(rows.map(shape)).toEqual(shapes);
    expect(rows.map((r) => r.querySelector("[data-gift-price]")?.textContent)).toEqual(["~$50", "~$40", "~$20"]);
    expect(panel.querySelectorAll("[data-gift-prices-as-of]")).toHaveLength(1);
    expect(panel.style.getPropertyValue("--gg-dupe-cols")).toBe("3");
    expect(GIFT_GUIDES_CSS).toContain(".gg-dupe-pop .gg-list{margin:0;grid-template-columns:repeat(var(--gg-dupe-cols,1),minmax(0,1fr))}");
  });
});

describe("only the guide pages say 'shop similar' (owner 2026-11-24 10:36 AM: \"only in the guides not the top 10\")", () => {
  it("the landing's Top 10 draws zero, though it holds picks with similar items; a guide row with the same pick draws it", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides"]}>
        <Routes><Route path="/gift-guides" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    const cards = [...container.querySelectorAll<HTMLElement>("[data-gift-top10] li[data-gift-pick]")];
    expect(cards).toHaveLength(10);
    const pool = new Map(["her", "him", "kids"].flatMap((g) => guideBySlug(g)!.picks.map((p) => [p.href, p] as const)));
    const similar = cards.map((li) => pool.get(li.querySelector("a.gg-item")!.getAttribute("href")!)!).filter((p) => p.dupes?.length);
    expect(similar.length).toBeGreaterThan(2);
    expect(container.querySelectorAll("[data-gift-top10] [data-gift-dupe]")).toHaveLength(0);
    expect(container.querySelector("[data-gift-top10]")?.textContent ?? "").not.toMatch(/shop similar/i);
    cleanup();
    // The same picks, as guide rows, keep the words.
    for (const p of similar) {
      expect(row(p).querySelector("[data-gift-dupe]")?.firstChild?.textContent, p.name).toBe("shop similar");
      cleanup();
    }
  });
});

describe("a real guide page: dupes ride their picks, never the list", () => {
  it("For Her: every row is a pick from the chunk (no dupe rows, same count), and each pick with a dupe shows the word", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
    const her = guideBySlug("her")!;
    const withDupe = her.picks.filter((p) => p.dupes?.length);
    expect(withDupe.length).toBeGreaterThan(15);
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides/her"]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findAllByText(/^~\$\d+$/);
    for (let b = screen.queryByRole("button", { name: /^Show more/ }); b; b = screen.queryByRole("button", { name: /^Show more/ })) {
      const more = b;
      act(() => { fireEvent.click(more); });
    }
    openPriceSections(container);
    const rows = [...container.querySelectorAll("li[data-gift-pick]")];
    expect(rows.length).toBe(CHUNKS.her.length);
    expect(container.querySelector("[data-gift-item-count]")?.textContent ?? "").not.toContain(String(CHUNKS.her.length + withDupe.length));
    expect(container.querySelectorAll("[data-gift-dupe]").length).toBe(withDupe.length);
    // Visible text only: the word's screen-reader name (data-gift-dupe-sr) says the dupe's name on purpose.
    const seen = container.cloneNode(true) as HTMLElement;
    seen.querySelectorAll("[data-gift-dupe-sr]").forEach((n) => n.remove());
    const text = seen.textContent ?? "";
    expect(withDupe.flatMap((p) => p.dupes!).filter((d) => text.includes(d.name)).map((d) => d.name)).toEqual([]);
    expect(her.picks.find((p) => p.name === "UGG Goldenstar Evelina Clog, Beige")?.dupes).toHaveLength(3);
  });
});

/**
 * Shop similar (owner 2026-11-23 ~2:40 PM: "some of them aren't dupes, they are just similar", then ~3:25 PM "actually
 * just do shop similar instead of dupe"). Every record still says in the data whether it is a true lookalike ("dupe") or
 * just "similar", but the page shows no split: every card with any shows the same plain words "shop similar", the panel
 * is titled "Shop similar", and the screen reader hears "shop similar: <n> similar items".
 *
 * @mutate src/content/giftGuideDupes.ts |   word: "shop similar", |   word: "dupe",
 * @mutate src/content/giftGuideDupes.ts |   title: "Shop similar", |   title: "Cheaper lookalikes",
 * @mutate src/content/giftGuideDupes.ts | count: (n: number) => `${n} similar item${n === 1 ? "" : "s"}`, | count: (n: number) => `${n} cheaper lookalikes`,
 */
describe("shop similar (owner 11-23 ~3:25 PM)", () => {
  const similar: GuideDupe = { ...dupe, kind: "similar" };
  it("the data keeps each one's kind (dupe or similar), with both kinds used", () => {
    const kinds = DUPES.map((d) => d.kind);
    expect(kinds.filter((k) => k !== "dupe" && k !== "similar")).toEqual([]);
    expect(kinds.filter((k) => k === "dupe").length).toBeGreaterThan(20);
    expect(kinds.filter((k) => k === "similar").length).toBeGreaterThan(40);
  });

  it("a card shows 'shop similar' whatever the kinds, and the panel is 'Shop similar' for all", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
    for (const list of [[similar], [dupe], [similar, { ...dupe, name: "True Twin", href: "https://www.amazon.com/dp/B000000008?tag=louisianahelpr-20" }]]) {
      const c = row({ ...amazonPick, dupes: list });
      const word = c.querySelector<HTMLButtonElement>("[data-gift-dupe]")!;
      expect(word.firstChild?.textContent).toBe("shop similar");
      expect(screen.getByRole("button", { name: `shop similar: ${list.length} similar item${list.length === 1 ? "" : "s"}` })).toBe(word);
      act(() => { fireEvent.click(word); });
      const panel = await screen.findByRole("dialog", { name: "Shop similar for Original Amazon Thing" });
      expect(panel.querySelector(".gg-dupe-note")?.textContent).toBe("Shop similar");
      expect(panel.textContent).not.toMatch(/Cheaper lookalike|Similar for less/);
      cleanup();
    }
  });

  it("on the real pages the YETI Hopper (For Him, a similar) and the Evelina (For Her, dupes) both say 'shop similar'", async () => {
    await loadAllGuidePicks();
    const hopper = guideBySlug("him")!.picks.find((p) => /YETI Hopper Flip 12/.test(p.name))!;
    const evelina = guideBySlug("her")!.picks.find((p) => /Evelina/.test(p.name))!;
    expect(row(hopper).querySelector("[data-gift-dupe]")?.firstChild?.textContent).toBe("shop similar");
    cleanup();
    expect(row(evelina).querySelector("[data-gift-dupe]")?.firstChild?.textContent).toBe("shop similar");
  });
});
