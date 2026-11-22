/**
 * The landing's "Top 10 gifts" (owner 2026-11-21 ~5:05 PM: "put the top 10 items back when you open the guide. Like
 * Theragun, Lola blanket, Depuffi, and I'll name the rest"; she then named all ten). The ten come from
 * src/content/giftGuideTop10.json in her order, each a real Her/Him/Kids pick drawn with the guides' own card (photo
 * and name one link, price, heart), right under the three tiles. Clicks can take a spot only where she turned
 * `autoReplace` on (default off): then the most-clicked pick with 20+ clicks in 14 days takes it.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <GiftGuideTop10 /> |       {null}
 * @mutate src/content/giftGuideTop10.ts |     const clicked = s.autoReplace ? hot.find((p) => !used.has(p.href)) : undefined; |     const clicked = hot.find((p) => !used.has(p.href));
 * @mutate src/content/giftGuideTop10.ts |     .filter((p) => (clicks[p.href] ?? 0) >= minClicks) |     .filter((p) => (clicks[p.href] ?? 0) > 0)
 * @mutate src/content/giftGuideTop10.ts |     .sort((a, b) => (clicks[b.href] ?? 0) - (clicks[a.href] ?? 0) \|\| | .sort((a, b) => (clicks[a.href] ?? 0) - (clicks[b.href] ?? 0) \|\|
 * @mutate src/pages/info/giftGuides/GiftGuideTop10.tsx |         {top.map((p, i) => <PickRow key={p.href} pick={p} guide={p.guide} rank={i + 1} />)} |         {top.slice(0, 9).map((p, i) => <PickRow key={p.href} pick={p} guide={p.guide} rank={i + 1} />)}
 * @mutate src/pages/info/giftGuides/GiftGuideTop10.tsx |         {top.map((p, i) => <PickRow key={p.href} pick={p} guide={p.guide} rank={i + 1} />)} |         {top.map((p, i) => <PickRow key={p.href} pick={p} guide={p.guide} rank={i} />)}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |         {rank !== undefined && <span className="gg-rank" aria-hidden="true" data-gift-rank={rank}>{rank}</span>} |         {null}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {rank !== undefined && <span className="sr-only">{`${rank}. `}</span>} | {null}
 *
 * Owner 11-21 evening: "put the other Theragun here" (spot 1 is the Her Theragun Mini) and "number the top 10 gifts"
 * (each card wears its rank 1-10 on the photo's corner and says it first, "1. Therabody Theragun Mini").
 * @mutate src/content/giftGuideTop10.json | "https://go.shopmy.us/p-108613356", "guide": "her" | "https://go.shopmy.us/p-0000", "guide": "her"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";
import { TOP10_SLOTS, top10Picks, type Top10Pick, type Top10Slot } from "@/content/giftGuideTop10";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CHUNKS: Record<string, { name: string; href: string; image?: string }[]> = { her: her.picks, him: him.picks, kids: kids.picks };

/** The owner's ten, in her order (11-21 ~5:05 PM), by the start of each pick's name. */
// Owner 11-21 evening: "put the other Theragun here" (spot 1 is the Her Theragun Mini, was the Him Theragun Prime).
const OWNER_TEN = ["Therabody Theragun Mini", "Lola Blankets", "Shark Depuffi", "YETI Camino 35", "Tyler Candle Company Diva", "Camp Snap", "Ember Mug 2", "Hatch Restore 3", "Owala FreeSip", "UGG Goldenstar Evelina"];

describe("the Top 10 list (src/content/giftGuideTop10.json)", () => {
  it("holds the owner's ten in her order, each a real pick with a photo on the guide it names, none auto-replaced", () => {
    expect(TOP10_SLOTS).toHaveLength(10);
    expect(new Set(TOP10_SLOTS.map((s) => s.href)).size).toBe(10);
    TOP10_SLOTS.forEach((s, i) => {
      const pick = CHUNKS[s.guide]?.find((p) => p.href === s.href);
      expect(pick, `${s.guide}: ${s.name}`).toBeDefined();
      expect(pick!.name.startsWith(OWNER_TEN[i]), `${i + 1}: ${pick!.name}`).toBe(true);
      expect(pick!.image, pick!.name).toMatch(/^https:\/\//);
      expect(s.autoReplace ?? false, s.name).toBe(false);
    });
  });
});

describe("top10Picks (unit)", () => {
  const pool: Top10Pick[] = ["a", "b", "c", "d", "e", "f"].map((k) => ({ name: k, href: `https://x.example/${k}`, store: "shopmy", guide: "her" }));
  const slot = (k: string, autoReplace = false): Top10Slot => ({ href: `https://x.example/${k}`, guide: "her", name: k, autoReplace });
  const names = (p: Top10Pick[]) => p.map((x) => x.name);

  it("shows every fixed spot's own item whatever the clicks say", () => {
    expect(names(top10Picks(pool, [slot("a"), slot("b"), slot("c")], { "https://x.example/f": 500 }))).toEqual(["a", "b", "c"]);
  });
  it("gives an auto-replace spot to the most-clicked pick with 20+ clicks, never repeating a shown item", () => {
    const clicks = { "https://x.example/e": 40, "https://x.example/f": 90, "https://x.example/a": 300, "https://x.example/d": 19 };
    // "a" is fixed in spot 1, so the 300 clicks never repeat it; f (90) then e (40) take the two open spots; d (19) is under 20.
    expect(names(top10Picks(pool, [slot("a"), slot("b", true), slot("c"), slot("d", true)], clicks))).toEqual(["a", "f", "c", "e"]);
  });
  it("keeps an auto-replace spot's own item until a pick qualifies, and skips a link no guide holds", () => {
    expect(names(top10Picks(pool, [slot("b", true), slot("zz"), slot("c")], { "https://x.example/e": 5 }))).toEqual(["b", "c"]);
  });
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the landing shows the Top 10 under the three tiles", () => {
  it("draws ten guide cards in the owner's order, each one link (photo + name) with a price and a heart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await act(async () => { await Promise.all(["her", "him", "kids"].map(loadGuidePicks)); });
    const { container } = renderAt("/gift-guides");
    const section = container.querySelector<HTMLElement>("[data-gift-top10]")!;
    expect(section).not.toBeNull();
    expect(section.querySelector("h2")?.textContent).toBe(G.top10Title);
    expect(section.previousElementSibling?.matches("[data-gift-browse]")).toBe(true);
    expect(section.nextElementSibling?.matches("[data-gift-giveaways]")).toBe(true);
    const cards = [...section.querySelectorAll<HTMLElement>("[data-gift-pick]")];
    expect(cards).toHaveLength(10);
    cards.forEach((li, i) => {
      const link = li.querySelector<HTMLAnchorElement>("a[data-gift-out]")!;
      expect(link.href).toBe(TOP10_SLOTS[i].href);
      expect(link.querySelector("img.gg-thumb"), TOP10_SLOTS[i].name).not.toBeNull();
      const name = link.querySelector(".gg-nm-name")?.textContent ?? "";
      expect(name.startsWith(`${i + 1}. ${OWNER_TEN[i]}`), `${i + 1}: ${name}`).toBe(true);
      const badge = link.querySelector<HTMLElement>("[data-gift-rank]");
      expect(badge?.textContent, TOP10_SLOTS[i].name).toBe(String(i + 1));
      expect(badge?.getAttribute("aria-hidden"), "the badge is not read twice").toBe("true");
      expect(li.querySelector("[data-gift-price]")?.textContent, TOP10_SLOTS[i].name).toMatch(/^~\$\d+$/);
      expect(li.querySelector("button.gg-heart-pick"), TOP10_SLOTS[i].name).not.toBeNull();
    });
  });
});
