/**
 * THE MONSTER JAM GIFT GUIDE (owner 2026-11-24: "lets put together a monster jam gift guide that i can share on
 * facebook"; she chose a site page AND a ready-to-post Facebook picture collage, "with every item we can find").
 *
 *  - the data: the page's chunk (src/content/giftGuidePicks/monster-jam.json) is exactly the rows file's picks
 *    (scripts/gift-guide-themes/monster-jam.json via scripts/giftGuideMonsterJam1124.mjs), every row with a price, a
 *    price day, a photo and a known store; a row the research marked out of stock stays on (owner 11-24 ~9:30 PM);
 *  - the page: /gift-guides/monster-jam renders "Monster Jam Gift Guide" with one row per pick, in the main guides' price
 *    sections (owner 11-24 ~7 PM: "sorted like the main 3 guides"; src/test/giftGuideThemeLayout1124.test.tsx), every
 *    section open on arrival, and no "shop similar" link even on a pick that has one;
 *  - the way in: it is live (LIVE_GUIDES_1121), a landing tile and a menu row, indexed (GIFT_GUIDE_SEO, sitemap,
 *    llms.txt) under a sentence-case title, and its shared link shows its own 1200x630 card;
 *  - the collage: no Amazon item on any picture (Facebook rule), checked two-way against the manifest the collage
 *    script writes (scripts/gift-guide-monster-jam-collage-1124.json).
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const sortable = isOwnerList(guide.slug) \|\| isThemeGuide(guide.slug); |   const sortable = isOwnerList(guide.slug);
 * @mutate src/content/giftGuideCatalog.ts |     const entries = isThemeGuide(slug) ? dupeEntries.filter((d) => d.guide === slug) : dupeEntries; |     const entries = dupeEntries;
 * @mutate src/content/giftGuideLive.mjs | export const THEME_GUIDE_NAMES_1124 = { "monster-jam": "Monster Jam" | export const THEME_GUIDE_NAMES_1124 = { "monster-jam-off": "Monster Jam"
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   ...Object.entries(THEME_GUIDE_NAMES_1124).map(([slug, label]) => ({ slug, dot: "green" as const, label })), |   // no theme rows
 * @mutate scripts/giftGuideMonsterJam1124.mjs | export const collageRows1124 = (rows = MONSTER_JAM_ROWS_1124) => rows.filter((r) => !isAmazonRow(r)); | export const collageRows1124 = (rows = MONSTER_JAM_ROWS_1124) => rows;
 * @mutate src/lib/giftGuidePageMeta.mjs |     ogTitle: /gift guide$/i.test(name) ? `${name} 2026` : `${name}: holiday gift guide 2026`, |     ogTitle: `${name}: holiday gift guide 2026`,
 * @mutate api/share.ts |   "gift-guides/monster-jam": "monster-jam", |   "gift-guides/monster-jam-off": "monster-jam",
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { MONSTER_JAM_GUIDE, MONSTER_JAM_ROWS_1124, collageRows1124, isAmazonRow, monsterJamPicks1124 } from "../../scripts/giftGuideMonsterJam1124.mjs";

const ROWS_FILE = JSON.parse(readFileSync("scripts/gift-guide-themes/monster-jam.json", "utf8")) as { rows: { id: string; href: string }[]; skipped: { id: string; why: string[] }[] };
const FIRST = MONSTER_JAM_ROWS_1124[0];
// One Monster Jam pick gets an approved "shop similar" here, so the page has one to leave out.
vi.mock("@/content/giftGuideDupes.json", async () => {
  const rows = JSON.parse((await import("node:fs")).readFileSync("scripts/gift-guide-themes/monster-jam.json", "utf8")).rows;
  return { default: { dupes: [{ for: { href: rows[0].href }, guide: "kids", original: rows[0].name, dupes: [{ name: "A lookalike truck", price: 5, priceAt: "2026-11-24", href: "https://www.amazon.com/dp/B000000000?tag=louisianahelpr-20", kind: "similar" }] }] } };
});

import GiftGuides from "@/pages/info/GiftGuides";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { CHUNK_PICK_COUNTS, CHUNK_SLUGS, RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { COVER_SLUGS } from "@/content/giftGuideCoverSlugs";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { priceSectionId } from "@/lib/pickPriceShown.mjs";

await loadAllGuidePicks();
afterEach(() => { cleanup(); vi.useRealTimers(); });

type Pick = { name: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; line: string; section?: string; sectionId?: string };
const chunk = (JSON.parse(readFileSync("src/content/giftGuidePicks/monster-jam.json", "utf8")) as { picks: Pick[] }).picks;

const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

describe("the Monster Jam gift guide's data (owner 2026-11-24)", () => {
  it("the page's chunk is exactly the rows file's picks, and the counts agree", () => {
    expect(MONSTER_JAM_GUIDE).toBe("monster-jam");
    expect(chunk).toEqual(JSON.parse(JSON.stringify(monsterJamPicks1124())));
    expect(chunk.length).toBe(MONSTER_JAM_ROWS_1124.length);
    expect(CHUNK_PICK_COUNTS["monster-jam"]).toBe(chunk.length);
    expect(CHUNK_SLUGS).toContain("monster-jam");
    // Inventory floor: the owner asked for every Monster Jam item we could find.
    expect(chunk.length).toBeGreaterThan(30);
  });

  it("every pick shows a photo and a price, links an https store page we know, and carries no category section", () => {
    for (const p of chunk) {
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^2026-\d\d-\d\d$/);
      expect(p.image, p.name).toMatch(/^https:\/\//);
      expect(p.href, p.name).toMatch(/^https:\/\//);
      expect(Object.prototype.hasOwnProperty.call(RESEARCHED_STORES, p.store ?? ""), `${p.name} ${p.store}`).toBe(true);
      expect(p.section, p.name).toBeUndefined();
      expect(p.sectionId, p.name).toBeUndefined();
      expect(p.line, p.name).not.toMatch(/\$\d/);
      // A cutout we host must be in public/ (a missing file is a blank tile on the live page).
      if (p.image?.startsWith("https://www.louisianahelpr.com/")) expect(existsSync(`public/${p.image.split("louisianahelpr.com/")[1]}`), p.image).toBe(true);
    }
  });

  // Owner 11-24 ~9:30 PM: "No leave the sold out stuff on." Her own pick MJO42 (sold out at Walmart) and the research's
  // sold-out rows are on the page; the importer skips a row only for no price, link, photo or a style rule.
  it("sold-out items stay on the page (her pick MJO42 included)", () => {
    expect(ROWS_FILE.skipped.filter((s) => s.why.includes("out of stock"))).toEqual([]);
    const ids = new Set(MONSTER_JAM_ROWS_1124.map((r) => r.id));
    for (const id of ["MJO42", "MJ60", "MJ62", "MJ67"]) expect(ids.has(id), id).toBe(true);
    // MJ66 is the same Walmart product as her MJO42 (one place per item): held, not lost. Lander3 11-25: A2's Kohl's
    // sweep rows MJS65 + MJS66 (pajama cap, owner 11-20) and MJS132 (site jigsaw cap, owner 11-19) are held too.
    expect(ROWS_FILE.skipped.map((s) => s.id).sort()).toEqual(["MJ66", "MJS132", "MJS65", "MJS66"]);
    expect(chunk.some((p) => p.href === "https://walmrt.us/4j3ikWo")).toBe(true);
  });

  it("the picks run cheapest first, so Stocking stuffers under $10 opens the page", () => {
    const order = [...new Set(chunk.map((p) => priceSectionId(p.price)))];
    expect(order[0]).toBe("stocking-stuffers");
    expect(order.length).toBeGreaterThan(3);
  });
});

describe("the Monster Jam page (owner 2026-11-24)", () => {
  it("renders its title, one row per pick, every section open, and no shop similar", async () => {
    const c = await renderAt("/gift-guides/monster-jam");
    expect(c.textContent).toContain("Monster Jam Gift Guide");
    expect(c.querySelectorAll("li[data-gift-pick]").length).toBe(chunk.length);
    const toggles = [...c.querySelectorAll<HTMLButtonElement>("[data-gift-section-toggle]")];
    expect(toggles.map((t) => t.getAttribute("data-gift-section-toggle"))).toEqual([...new Set(chunk.map((p) => priceSectionId(p.price)))]);
    expect(toggles[0].textContent).toContain("Stocking stuffers under $10");
    for (const t of toggles) expect(t.getAttribute("aria-expanded"), t.textContent ?? "").toBe("true");
    // The first pick has an approved dupe in this test's dupes file; the Monster Jam page never shows it.
    const first = [...c.querySelectorAll("li[data-gift-pick]")].find((li) => li.textContent?.includes(FIRST.name));
    expect(first).toBeTruthy();
    expect(c.querySelectorAll("[data-gift-dupe]").length).toBe(0);
  });

  it("is NOT a landing tile (owner 11-24 6:54 PM: theme guides only inside Kids) but is a row in the guides menu", async () => {
    expect(LIVE_GUIDES_1121).toContain("monster-jam");
    const c = await renderAt("/gift-guides");
    expect(c.querySelector('[data-gift-live-guides] a[href="/gift-guides/monster-jam"]')).toBeNull();
    const menu = c.querySelector("[data-gift-sidebar]") as HTMLElement;
    expect(within(menu).getByText("Monster Jam")).toBeTruthy();
    expect(menu.querySelector('[data-gift-side="monster-jam"]')).not.toBeNull();
    expect(COVER_SLUGS).toContain("monster-jam");
  });
});

describe("the Monster Jam page's head and share card", () => {
  it("is indexed under a sentence-case title that says gift guide once", () => {
    expect(GIFT_GUIDE_SEO["monster-jam"]).toBe("Monster Jam gift guide");
    const meta = giftGuidePageMeta("monster-jam", "Monster Jam Gift Guide", chunk.map((p) => p.name), chunk.length);
    expect(meta.title).toBe("Monster Jam gift guide — Helpr");
    expect(meta.ogTitle).toBe("Monster Jam gift guide 2026");
    expect("robots" in meta).toBe(false);
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain("<loc>https://www.louisianahelpr.com/gift-guides/monster-jam</loc>");
    expect(readFileSync("public/llms.txt", "utf8")).toContain("(https://www.louisianahelpr.com/gift-guides/monster-jam)");
  });

  it("its shared link shows its own 1200x630 card", () => {
    expect(WIDE_OG_VERSIONS["monster-jam" as keyof typeof WIDE_OG_VERSIONS]).toMatch(/^[0-9a-f]{8}$/);
    expect(existsSync("public/gift-guides/og-wide/monster-jam.jpg")).toBe(true);
    expect(readFileSync("api/share.ts", "utf8")).toMatch(/"gift-guides\/monster-jam": "monster-jam",/);
  });
});

describe("the Monster Jam Facebook collage (owner 2026-11-24)", () => {
  const manifest = JSON.parse(readFileSync("scripts/gift-guide-monster-jam-collage-1124.json", "utf8")) as { pictures: { file: string; ids: string[] }[] };
  const onPictures = manifest.pictures.flatMap((p) => p.ids);

  it("never puts an Amazon item on a picture (Facebook rule)", () => {
    expect(isAmazonRow({ store: "store-amazon", href: "https://www.amazon.com/dp/B0?tag=louisianahelpr-20" })).toBe(true);
    expect(isAmazonRow({ store: "store-walmart", href: "https://amzn.to/3abc" })).toBe(true);
    expect(isAmazonRow({ store: "store-walmart", href: "https://walmrt.us/4AV89ea" })).toBe(false);
    const mixed = [{ store: "store-amazon", href: "https://www.amazon.com/dp/B0?tag=louisianahelpr-20" }, { store: "store-walmart", href: "https://walmrt.us/4AV89ea" }];
    expect(collageRows1124(mixed)).toEqual([mixed[1]]);
    const byId = new Map(MONSTER_JAM_ROWS_1124.map((r) => [r.id, r]));
    for (const id of onPictures) {
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(isAmazonRow(r!), id).toBe(false);
    }
  });

  it("puts every non-Amazon item on a picture, once, and only those", () => {
    expect(onPictures).toEqual(collageRows1124().map((r) => r.id));
    expect(new Set(onPictures).size).toBe(onPictures.length);
    expect(manifest.pictures.length).toBeGreaterThan(1);
  });
});
