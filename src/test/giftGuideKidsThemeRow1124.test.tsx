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
 *    "shop similar" on that one row and no other; Kids no longer lists the bundle. The Melissa & Doug Wood Furnished
 *    Mansion likewise (lead 11-24 ~11:40 PM, the owner's Yoto precedent): one "shop similar" on Melissa & Doug, its row.
 *
 * @mutate src/content/giftGuideDupes.json |    "guide": "melissa-and-doug", |    "guide": "kids",
 * @mutate src/pages/info/GiftGuides.tsx |               {guide?.slug === KIDS_FILTER_GUIDE && <LazyThemeRow />} |               {null}
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx |   const guides = THEME_GUIDES_1124.map((slug) => guideBySlug(slug)).filter((g) => g !== undefined); |   const guides = THEME_GUIDES_1124.slice(1).map((slug) => guideBySlug(slug)).filter((g) => g !== undefined);
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx | priority={i < EAGER_COVERS} | priority
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx | const THEME_ROW_CSS = `.gg-themes-row{overflow-y:hidden; | const THEME_ROW_CSS = `.gg-themes-row{
 * @mutate src/pages/info/giftGuides/GiftGuideThemeRow.tsx | .gg-themes-row .gg-name{top:0} | .gg-themes-row .gg-name{}
 * @mutate src/pages/info/GiftGuides.tsx |         <ul className="gg-row gg-themes-row invisible"> |         <ul className="gg-row invisible">
 * @mutate src/pages/info/GiftGuides.tsx |   const phone = usePhoneWidth(); |   const phone = useState(false)[0];
 * @mutate scripts/giftGuideHimKids1121.mjs |   return build(rows.filter((r) => !moved.has(r.href)), KIDS_GUIDE, null); |   return build(rows, KIDS_GUIDE, null);
 * @mutate src/content/giftGuideCatalog.ts | dupeEntries.filter((d) => d.guide === slug) | dupeEntries.filter(() => false)
 * @mutate scripts/giftGuideThemes1124.mjs |   KIDS_THEME_MOVES_1124.filter(([, , to, id, held]) => !held && id && themeRows1124(to).some((r) => r.id === id)) |   KIDS_THEME_MOVES_1124.filter(([, , to]) => to)
 */
import { readFileSync } from "node:fs";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
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
/**
 * The page as its FIRST commit drew it, before any effect ran (a layout effect of a later sibling runs after the page's
 * DOM is in and before any passive effect, such as one that flips a hook's first value): what the first paint shows.
 */
const renderFirstCommit = async (url: string) => {
  let first: HTMLElement | null = null;
  const Snap = () => {
    useLayoutEffect(() => {
      if (!first) first = (document.querySelector("[data-gift-guides]")?.cloneNode(true) as HTMLElement | undefined) ?? null;
    }, []);
    return null;
  };
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides/:slug" element={<><GiftGuides /><Snap /></>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  expect(first, "the page drew on its first commit").toBeTruthy();
  return { first: first as unknown as HTMLElement, c: out.container };
};
/** The Kids page, once the cover row's own chunk is in (it loads after the page draws; a same-height stand-in first). */
const renderKids = async () => {
  const c = await renderAt("/gift-guides/kids");
  await waitFor(() => expect(c.querySelector("[data-gift-theme-row]")).toBeTruthy());
  expect(c.querySelector("[data-gift-theme-row-wait]")).toBeNull();
  return c;
};

describe("the Kids page's themed guides row (owner 2026-11-24)", () => {
  it("lists every THEME_GUIDES_1124 entry, in order, each linking its page with its own green cover", async () => {
    const c = await renderKids();
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

  it("sits right under the red banner and the menu tip, before the gifts", async () => {
    const c = await renderKids();
    const banner = c.querySelector("[data-gift-banner]");
    const row = c.querySelector("[data-gift-theme-row]");
    const firstGift = c.querySelector("[data-gift-guide]");
    expect(banner?.getAttribute("data-gift-banner")).toBe("red");
    // Owner 11-24 8:23 PM: the "Tap the menu" tip sits between the banner and the row ("above the new guides").
    const hint = banner!.nextElementSibling;
    expect(hint?.hasAttribute("data-gift-menu-hint")).toBe(true);
    expect(hint!.nextElementSibling).toBe(row);
    expect(row!.compareDocumentPosition(firstGift!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds its place with a same-size stand-in until its chunk is in, then is the row (not on the page's first chunk)", async () => {
    const src = readFileSync("src/pages/info/GiftGuides.tsx", "utf8");
    expect(src).toContain('loadModule(() => import("./giftGuides/GiftGuideThemeRow"))');
    expect(src).not.toMatch(/^import [^;]*GiftGuideThemeRow/m);
    const c = await renderKids();
    expect(c.querySelectorAll("[data-gift-theme-row]")).toHaveLength(1);
  });

  it("moves sideways only: no tile part overflows the row's height and the row never scrolls up or down (owner 11-24 ~7 PM)", async () => {
    // The owner's phone screenshot: the row dragged up, the covers' tops cut off, an empty band under them ("It shouldn't
    // move like this"). Measured on prod (WebKit and Chromium, 430): scrollHeight 164 > clientHeight 162, because each
    // tile's screen-reader name sat 8px under its cover; overflow-x:auto made overflow-y auto, so a swipe moved it.
    const c = await renderKids();
    const css = [...c.querySelectorAll("[data-gift-theme-row] style")].map((s) => s.textContent ?? "").join("\n");
    const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");
    expect(rule(".gg-themes-row")).toMatch(/(^|;)overflow-y:hidden(;|$)/);
    expect(rule(".gg-themes-row .gg-name")).toMatch(/(^|;)top:0(;|$)/);
    // Every tile's name is the screen-reader-only kind the rule above pins (a visible name or age line would add height).
    const tiles = [...c.querySelectorAll("[data-gift-theme-row] li")];
    expect(tiles.length).toBeGreaterThan(3);
    for (const li of tiles) {
      const extra = [...li.querySelectorAll("a > :not(img)")];
      expect(extra.map((e) => e.className), li.textContent ?? "").toEqual(["gg-name sr-only"]);
    }
  });

  it("the stand-in's box is the row's box: same row classes, one cover-sized square, and no size rule only the row's chunk has", async () => {
    const { first, c } = await renderFirstCommit("/gift-guides/kids");
    // First paint: the stand-in (the row's chunk is not in yet).
    const wait = first.querySelector("[data-gift-theme-row-wait]");
    const waitUl = wait?.querySelector("ul");
    expect(waitUl?.className.replace(/\binvisible\b/, "").trim()).toBe("gg-row gg-themes-row");
    expect([...waitUl!.querySelectorAll("li > *")].map((e) => e.className)).toEqual(["gg-cover"]);
    await waitFor(() => expect(c.querySelector("[data-gift-theme-row]")).toBeTruthy());
    expect(wait!.className).toBe(c.querySelector("[data-gift-theme-row]")!.className);
    expect(c.querySelector("[data-gift-theme-row] ul")!.className).toBe("gg-row gg-themes-row");
    // The row's own chunk CSS sets no box size (width/height/padding/margin/gap/aspect/flex/font): those live in the
    // page's GIFT_GUIDES_CSS, which the stand-in has too, so its height is the row's at every width.
    const css = [...c.querySelectorAll("[data-gift-theme-row] style")].map((st) => st.textContent ?? "").join("\n");
    expect(css).toContain(".gg-themes-row{");
    // (the scrollbar pseudo-element's display:none takes no room in the box, so ::selectors are left out)
    const sizing = [...css.matchAll(/\.gg-themes-row([^{]*)\{([^}]*)\}/g)].filter((m) => !m[1].includes("::")).flatMap((m) => m[2].split(";")).filter((d) => /^(width|height|min-|max-|padding|margin|gap|aspect-ratio|flex|font|line-height|display)/.test(d.trim()));
    expect(sizing).toEqual([]);
  });

  it("a phone draws the count row under the cover row on its FIRST paint, so the gifts never drop 54px after it", async () => {
    const was = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 375 });
      const { first } = await renderFirstCommit("/gift-guides/kids");
      const wait = first.querySelector("[data-gift-theme-row-wait]");
      expect(wait).toBeTruthy();
      expect(wait!.nextElementSibling?.hasAttribute("data-gift-countrow")).toBe(true);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: was });
    }
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

describe("the Melissa & Doug Wood Furnished Mansion moved WITH its approved dupe (lead 11-24, the owner's Yoto precedent)", () => {
  const MANSION = "https://go.shopmy.us/p-108632077";

  it("is off Kids and on Melissa & Doug", () => {
    expect(chunk("kids").some((p) => p.href === MANSION)).toBe(false);
    expect(chunk("melissa-and-doug").filter((p) => p.href === MANSION)).toHaveLength(1);
  });

  it("the Melissa & Doug page shows exactly one shop similar, on the Mansion row", async () => {
    const c = await renderAt("/gift-guides/melissa-and-doug");
    const words = [...c.querySelectorAll("[data-gift-dupe]")];
    expect(words).toHaveLength(1);
    expect(words[0].closest("li")?.textContent).toContain("Melissa & Doug Wood Furnished Mansion");
  });
});
