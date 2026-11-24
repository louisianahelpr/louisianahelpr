/**
 * THE THEMED KIDS GIFT GUIDES (owner 2026-11-24: Monster Jam, then "Marvel, Bluey, KPop Demon Hunters, Pokémon,
 * Minecraft, Hot Wheels, Paw Patrol, Stitch/Disney, Sonic, Mario, Barbie, Gabby's Dollhouse, Squishmallows, LEGO", each
 * built exactly like Monster Jam). Every live theme, whichever ones `node scripts/theme-guide-import.mjs` has added:
 *
 *  - live exactly when its rows file exists: scripts/gift-guide-themes/<slug>.json, the registry index.mjs and
 *    THEME_GUIDE_NAMES_1124 agree both ways;
 *  - the data: its chunk is exactly its rows' picks; every row has a price, a price day, a photo (a cutout we host is
 *    in public/), an https link on a store we know (and that store's link host), and a section; no out-of-stock row;
 *    each group in one run; an Amazon row shows Amazon's own photo, never a cutout of ours (Associates terms);
 *  - the page: its title, one row per pick, its groups as band sections all open on arrival, no "shop similar" even on
 *    a pick that has one; a green-dot menu row reading the theme's name; a GUIDE_INDEX entry (For kids, green, "the",
 *    "<Theme> Gift Guide");
 *  - the way in: indexed (GIFT_GUIDE_SEO, sitemap, llms.txt, search index) and its shared link shows its own 1200x630
 *    card (api/share.ts WIDE_CARD_FOR_ID, og-wide/<slug>.jpg measured 1200x630, a green PAGES entry in COVER_KEYS);
 *  - the cover: green (SLUG_TINT), six photos of our own cutouts (no Amazon photo), the file and its cache key present.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const bandHeads = sortable \|\| guide.slug === SPONSORS_PAGE \|\| isThemeGuide(guide.slug); |   const bandHeads = sortable \|\| guide.slug === SPONSORS_PAGE;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | similar={!isThemeGuide(guide.slug)} /> | />
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | ...Object.entries(THEME_GUIDE_NAMES_1124).map(([slug, label]) => ({ slug, dot: "green" as const, label })), | // no theme rows
 * @mutate src/content/giftGuideIndex.ts | ({ group: "For kids", tint: "green" as const, slug, | ({ group: "For kids", tint: "red" as const, slug,
 * @mutate scripts/gift-guide-photo-covers.py | "monster-jam": "green"} | "monster-jam": "red"}
 * @mutate api/share.ts |   "gift-guides/monster-jam": "monster-jam", |   "gift-guides/monster-jam-off": "monster-jam",
 * @mutate scripts/giftGuideThemes1124.mjs |   rows.map(({ id: _id, was: _was, age: _age, ...p }) => ({ ...p, ownerPick: true, from: slug })); |   rows.map(({ id: _id, was: _was, age: _age, ...p }) => ({ ...p, ownerPick: true, from: slug })).slice(1);
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// Each theme's first pick gets an approved "shop similar" here, so every theme page has one to leave out.
vi.mock("@/content/giftGuideDupes.json", async () => {
  const fs = await import("node:fs");
  const { readdirSync: listDir } = await import("./helpers/trackedFiles");
  const dupes = listDir("scripts/gift-guide-themes").filter((f) => f.endsWith(".json")).map((f) => {
    const r = JSON.parse(fs.readFileSync(`scripts/gift-guide-themes/${f}`, "utf8")).rows[0];
    return { for: { href: r.href }, guide: "kids", original: r.name, dupes: [{ name: "A lookalike", price: 5, priceAt: "2026-11-24", href: "https://www.amazon.com/dp/B000000000?tag=louisianahelpr-20", kind: "similar" }] };
  });
  return { default: { dupes } };
});

import { THEME_ROWS_FILES_1124, isAmazonRow, themePicks1124, themeRows1124 } from "../../scripts/giftGuideThemes1124.mjs";
import GiftGuides from "@/pages/info/GiftGuides";
import { LIVE_GUIDES_1121, THEME_GUIDES_1124, THEME_GUIDE_NAMES_1124, isThemeGuide } from "@/content/giftGuideLive.mjs";
import { CHUNK_PICK_COUNTS, CHUNK_SLUGS, RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { COVER_VERSIONS } from "@/lib/giftGuideCoverVersions.mjs";
import { COVER_WEBP_SLUGS } from "@/lib/giftGuideShareImages.mjs";
import { COVER_SLUGS } from "@/content/giftGuideCoverSlugs";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { blankHashComments } from "./helpers/blankNonCode";

await loadAllGuidePicks();
afterEach(() => { cleanup(); vi.useRealTimers(); });

const SITE = "https://www.louisianahelpr.com/";
type Pick = { name: string; href: string; image: string; store: string; price: number; priceAt: string; line: string; section: string; sectionId: string };
const chunkOf = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const hostOf = (u: string) => new URL(u).hostname;
const PICKS_TS = readFileSync("src/content/giftGuidePicks.ts", "utf8");
const SITEMAP = readFileSync("public/sitemap.xml", "utf8");
const LLMS = readFileSync("public/llms.txt", "utf8");
const SHARE = readFileSync("api/share.ts", "utf8");
const SEARCH = JSON.parse(readFileSync("src/content/giftGuideSearchIndex.json", "utf8")) as [string, string, number, string, string][];
const COVERS_PY = blankHashComments(readFileSync("scripts/gift-guide-photo-covers.py", "utf8"));
const WIDE_PY = blankHashComments(readFileSync("scripts/gift-guide-wide-og.py", "utf8"));
const MANIFEST = JSON.parse(readFileSync("scripts/gift-guide-cover-items.json", "utf8")) as Record<string, { section: string; items: { name: string; key: string; image: string }[] }>;

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

describe("the themed kids guides: live exactly when their rows file exists (owner 2026-11-24)", () => {
  it("the rows files, the registry and THEME_GUIDE_NAMES_1124 agree both ways, right after Kids in the live list", () => {
    const files = readdirSync("scripts/gift-guide-themes").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    expect([...THEME_GUIDES_1124].sort()).toEqual(files);
    expect(Object.keys(THEME_ROWS_FILES_1124)).toEqual([...THEME_GUIDES_1124]);
    // Inventory floor: Monster Jam at least.
    expect(THEME_GUIDES_1124.length).toBeGreaterThan(0);
    expect(LIVE_GUIDES_1121.slice(0, 3 + THEME_GUIDES_1124.length)).toEqual(["her", "him", "kids", ...THEME_GUIDES_1124]);
    for (const slug of THEME_GUIDES_1124) {
      expect(isThemeGuide(slug)).toBe(true);
      expect(THEME_ROWS_FILES_1124[slug].slug).toBe(slug);
      expect(THEME_ROWS_FILES_1124[slug].name).toBe(THEME_GUIDE_NAMES_1124[slug]);
    }
  });
});

describe.each([...THEME_GUIDES_1124])("the %s guide", (slug) => {
  const name = THEME_GUIDE_NAMES_1124[slug];
  const rows = themeRows1124(slug);
  const chunk = chunkOf(slug);

  it("its chunk is exactly its rows' picks, and the counts, chunk list and glob agree", () => {
    expect(chunk).toEqual(JSON.parse(JSON.stringify(themePicks1124(slug))));
    expect(chunk.length).toBe(rows.length);
    expect(chunk.length).toBeGreaterThan(5);
    expect(CHUNK_PICK_COUNTS[slug]).toBe(chunk.length);
    expect(CHUNK_SLUGS).toContain(slug);
    expect(PICKS_TS).toContain(`"./giftGuidePicks/${slug}.json"`);
  });

  it("every row shows a photo and a price, links an https page on a store we know, and sits in a section", () => {
    for (const p of chunk) {
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^2026-\d\d-\d\d$/);
      expect(p.image, p.name).toMatch(/^https:\/\//);
      expect(p.href, p.name).toMatch(/^https:\/\//);
      const store = RESEARCHED_STORES[p.store];
      expect(store, `${p.name} ${p.store}`).toBeTruthy();
      expect(store.hosts, `${p.name}: ${hostOf(p.href)} on ${p.store}`).toContain(hostOf(p.href));
      expect(p.section && p.sectionId, p.name).toBeTruthy();
      expect(p.line, p.name).toBeTruthy();
      expect(p.line, p.name).not.toMatch(/\$\d/);
      if (p.image.startsWith(SITE)) expect(existsSync(`public/${p.image.slice(SITE.length)}`), p.image).toBe(true);
      // Amazon photos are never edited (Associates terms): an Amazon row never shows a cutout of ours.
      if (isAmazonRow(p)) expect(p.image.startsWith(`${SITE}gift-guides/cutouts/`), p.name).toBe(false);
    }
  });

  it("no out-of-stock item is on the page, and each group is one run", () => {
    const ids = new Set(rows.map((r) => r.id));
    for (const s of THEME_ROWS_FILES_1124[slug].skipped) if (s.why.includes("out of stock")) expect(ids.has(s.id), s.id).toBe(false);
    const order = [...new Set(chunk.map((p) => p.section))];
    expect(chunk.map((p) => p.section).filter((s, i, a) => i === 0 || a[i - 1] !== s)).toEqual(order);
  });

  it("renders its title, one row per pick, every section open, and no shop similar", async () => {
    const c = await renderAt(`/gift-guides/${slug}`);
    expect(c.textContent).toContain(`${name} Gift Guide`);
    expect(c.querySelectorAll("li[data-gift-pick]").length).toBe(chunk.length);
    const toggles = [...c.querySelectorAll<HTMLButtonElement>("[data-gift-section-toggle]")];
    expect(toggles.map((t) => t.getAttribute("data-gift-section-toggle"))).toEqual([...new Set(chunk.map((p) => p.sectionId))]);
    for (const t of toggles) expect(t.getAttribute("aria-expanded"), t.textContent ?? "").toBe("true");
    expect([...c.querySelectorAll("li[data-gift-pick]")].some((li) => li.textContent?.includes(rows[0].name))).toBe(true);
    expect(c.querySelectorAll("[data-gift-dupe]").length).toBe(0);
  });

  it("has a green-dot menu row reading its name, a landing tile, and its GUIDE_INDEX entry", async () => {
    const c = await renderAt("/gift-guides");
    const row = c.querySelector(`[data-gift-sidebar] [data-gift-side="${slug}"]`);
    expect(row, slug).not.toBeNull();
    expect(row?.querySelector("[data-gift-side-dot]")?.getAttribute("data-gift-side-dot")).toBe("green");
    expect(row?.textContent).toContain(name);
    expect(c.querySelector(`[data-gift-live-guides] a[href="/gift-guides/${slug}"]`)).not.toBeNull();
    expect(GUIDE_INDEX.filter((g) => g.slug === slug)).toEqual([{ group: "For kids", tint: "green", slug, title: `${name} Gift Guide`, lead: "the" }]);
  });

  it("is indexed: SEO title, sitemap, llms.txt and every pick in the search index", () => {
    expect(GIFT_GUIDE_SEO[slug as keyof typeof GIFT_GUIDE_SEO]).toBe(`${name} gift guide`);
    expect(SITEMAP).toContain(`<loc>${SITE}gift-guides/${slug}</loc>`);
    expect(LLMS).toContain(`(${SITE}gift-guides/${slug})`);
    // scripts/gift-guide-search-index.mjs: one row per name, under the first guide (by slug) that lists it.
    const names = new Set(SEARCH.map((e) => e[0].toLowerCase()));
    for (const p of chunk) expect(names.has(p.name.trim().replace(/\s+/g, " ").toLowerCase()), p.name).toBe(true);
  });

  it("its shared link shows its own 1200x630 card, drawn green with its cover's photos", async () => {
    expect(WIDE_OG_VERSIONS[slug as keyof typeof WIDE_OG_VERSIONS]).toMatch(/^[0-9a-f]{8}$/);
    expect(SHARE).toContain(`  "gift-guides/${slug}": "${slug}",`);
    const meta = await sharp(`public/gift-guides/og-wide/${slug}.jpg`).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    expect(WIDE_PY).toContain(`    "${slug}": ("/gift-guides/${slug}", "green", "the", "${name} Gift Guide"),`);
    const keys = WIDE_PY.match(/^COVER_KEYS = \(([^)]*)\)$/m)?.[1] ?? "";
    expect(keys).toContain(`"${slug}"`);
  });

  it("its cover is green with six photos of our own cutouts, none from Amazon", () => {
    expect(COVERS_PY).toMatch(new RegExp(`^SLUG_TINT = \\{.*"${slug}": "green".*\\}$`, "m"));
    expect(COVER_SLUGS).toContain(slug);
    expect(COVER_WEBP_SLUGS.has(slug)).toBe(true);
    expect(existsSync(`public/gift-guides/covers/${slug}.webp`)).toBe(true);
    expect(COVER_VERSIONS[slug as keyof typeof COVER_VERSIONS]).toMatch(/^[0-9a-f]{8}$/);
    const items = MANIFEST[slug]?.items ?? [];
    expect(items.length).toBe(6);
    for (const it of items) {
      expect(it.image.startsWith(`${SITE}gift-guides/cutouts/`), it.image).toBe(true);
      expect(existsSync(`public/${it.image.slice(SITE.length)}`), it.image).toBe(true);
      expect(isAmazonRow({ store: "", href: it.image }), it.image).toBe(false);
    }
  });
});
