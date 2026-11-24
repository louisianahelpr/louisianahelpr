/**
 * THE KIDS PAGE'S THEMED GUIDES ROW + THE KIDS ITEMS MOVED TO THEIR THEME (owner 2026-11-24 ~2:05 PM: "Each of these new
 * covers should be here and scroll left to right and then the other items will go below like the items that are
 * already there. And if we have any items in kids guide that fits into the new guides like bluey etc then move those
 * into the new page for it ... The new guides should be green under this red one.").
 *
 *  - the row: on /gift-guides/kids only, right under the red banner and before the gifts; one tile per
 *    THEME_GUIDES_1124 entry in order, each linking /gift-guides/<slug> and showing that guide's own green square cover
 *    (sized, so nothing jumps); the first two covers load at once, the rest lazily;
 *  - the moves (scripts/giftGuideKidsThemeMoves1124.mjs): a move whose theme is live and holds its row id is off Kids
 *    and on that theme's page; a move still waiting (theme not live, no row yet, or held) stays on Kids;
 *  - the Yoto Bluey bundle moved WITH its approved dupe (owner 11-24 via the lead): the Bluey page shows that one
 *    "shop similar" on that one row and no other; Kids no longer lists the bundle.
 *
 * @mutate src/pages/info/GiftGuides.tsx |               {guide?.slug === KIDS_FILTER_GUIDE && <GiftGuideThemeRow />} |               {null}
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx |   const guides = THEME_GUIDES_1124.map((slug) => guideBySlug(slug)).filter((g) => g !== undefined); |   const guides = THEME_GUIDES_1124.slice(1).map((slug) => guideBySlug(slug)).filter((g) => g !== undefined);
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx | priority={i < EAGER_COVERS} | priority
 * @mutate scripts/giftGuideHimKids1121.mjs |   return build(rows.filter((r) => !moved.has(r.href)), KIDS_GUIDE, null); |   return build(rows, KIDS_GUIDE, null);
 * @mutate src/content/giftGuideCatalog.ts | dupeEntries.filter((d) => d.guide === slug) | dupeEntries.filter(() => false)
 * @mutate scripts/giftGuideThemes1124.mjs |   KIDS_THEME_MOVES_1124.filter(([, , to, id, held]) => !held && id && themeRows1124(to).some((r) => r.id === id)) |   KIDS_THEME_MOVES_1124.filter(([, , to]) => to)
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { KIDS_THEME_MOVES_1124 } from "../../scripts/giftGuideKidsThemeMoves1124.mjs";
import { kidsThemeMovesLive1124, themeRows1124 } from "../../scripts/giftGuideThemes1124.mjs";
import { kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";

await loadAllGuidePicks();
afterEach(() => cleanup());

const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: { href: string; name: string }[] }).picks;

const renderAt = async (url: string) => {
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

describe("the Kids page's themed guides row (owner 2026-11-24)", () => {
  it("lists every THEME_GUIDES_1124 entry, in order, each linking its page with its own green cover", async () => {
    const c = await renderAt("/gift-guides/kids");
    const row = c.querySelector("[data-gift-theme-row]");
    expect(row).toBeTruthy();
    const tiles = [...row!.querySelectorAll("a[data-gift-tile]")];
    // Inventory floor: Monster Jam, Bluey, Marvel, KPop Demon Hunters at least.
    expect(THEME_GUIDES_1124.length).toBeGreaterThan(3);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(THEME_GUIDES_1124.map((s) => `/gift-guides/${s}`));
    tiles.forEach((a, i) => {
      const slug = THEME_GUIDES_1124[i];
      expect(guideBySlug(slug)?.tint, slug).toBe("green");
      const img = a.querySelector("img[data-gift-cover]");
      expect(img, slug).toBeTruthy();
      expect(img!.getAttribute("src"), slug).toBe(guideBySlug(slug)!.cover);
      expect(img!.getAttribute("src"), slug).toMatch(new RegExp(`^/gift-guides/covers/${slug}\\.webp`));
      // Sized, so the row keeps its space before a cover loads.
      expect([img!.getAttribute("width"), img!.getAttribute("height")]).toEqual(["480", "480"]);
      expect(img!.getAttribute("loading"), slug).toBe(i < 2 ? "eager" : "lazy");
      // The cover prints the guide's name; the link still has one for screen readers.
      expect(a.textContent, slug).toContain(guideBySlug(slug)!.title);
    });
  });

  it("sits right under the red banner, before the gifts", async () => {
    const c = await renderAt("/gift-guides/kids");
    const banner = c.querySelector("[data-gift-banner]");
    const row = c.querySelector("[data-gift-theme-row]");
    const firstGift = c.querySelector("[data-gift-guide]");
    expect(banner?.getAttribute("data-gift-banner")).toBe("red");
    expect(banner!.nextElementSibling).toBe(row);
    expect(row!.compareDocumentPosition(firstGift!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is on the Kids page only", async () => {
    for (const slug of ["her", "him", ...THEME_GUIDES_1124]) {
      const c = await renderAt(`/gift-guides/${slug}`);
      expect(c.querySelector("[data-gift-guide]"), slug).toBeTruthy();
      expect(c.querySelector("[data-gift-theme-row]"), slug).toBeNull();
      cleanup();
    }
  });
});

describe("Kids items moved to their themed guide (owner 2026-11-24)", () => {
  const kids = chunk("kids");
  const kidsHrefs = new Set(kids.map((p) => p.href));
  const live = kidsThemeMovesLive1124();

  it("every live move is off Kids and its product is on its theme page", () => {
    // Inventory floor: 13 moved on 11-24.
    expect(live.length).toBeGreaterThan(12);
    for (const m of live) {
      expect(kidsHrefs.has(m.href), m.name).toBe(false);
      expect(THEME_GUIDES_1124, m.name).toContain(m.to);
      expect(themeRows1124(m.to).some((r: { id: string }) => r.id === m.id), m.name).toBe(true);
    }
  });

  it("a waiting move (theme not live, no theme row yet, or held for the owner) stays on Kids", () => {
    const waiting = KIDS_THEME_MOVES_1124.filter(([href]) => !live.some((m) => m.href === href));
    expect(waiting.length).toBeGreaterThan(0);
    for (const [href, name] of waiting) expect(kidsHrefs.has(href), name).toBe(true);
  });

  it("the Kids chunk is the build (moves applied), each move listed once", () => {
    expect(kids).toEqual(JSON.parse(JSON.stringify(kids1121Picks())));
    expect(new Set(KIDS_THEME_MOVES_1124.map(([href]) => href)).size).toBe(KIDS_THEME_MOVES_1124.length);
  });
});

describe("the Yoto Bluey bundle moved to Bluey with its approved dupe (owner 2026-11-24)", () => {
  const YOTO = "https://go.shopmy.us/p-109156399";

  it("is off Kids and on Bluey", () => {
    expect(chunk("kids").some((p) => p.href === YOTO)).toBe(false);
    expect(chunk("bluey").filter((p) => p.href === YOTO)).toHaveLength(1);
  });

  it("the Bluey page shows exactly one shop similar, on the Yoto row", async () => {
    const c = await renderAt("/gift-guides/bluey");
    const words = [...c.querySelectorAll("[data-gift-dupe]")];
    expect(words).toHaveLength(1);
    expect(words[0].closest("li")?.textContent).toContain("Yoto Player 4th Gen + Bluey Adventure Bundle");
  });

  it("the Kids page no longer lists it", async () => {
    const c = await renderAt("/gift-guides/kids");
    expect(c.querySelector("[data-gift-guide]")?.textContent).not.toContain("Yoto Player 4th Gen + Bluey Adventure Bundle");
  });
});
