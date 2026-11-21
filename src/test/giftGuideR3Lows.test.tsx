/**
 * Gift guides r3 UX audit Lows (~/.lh-shots/design-audit-loop/gg-r3-ux/FINDINGS.md, 2026-11-19):
 *  - #9: a cover's guide name is drawn on two lines at most (scripts/gift-guide-photo-covers.py steps the size down
 *    and, when the word wrap needs three, breaks it into the two most even lines);
 *  - #10: the Girls, Boys and Gender-neutral tiles in For kids carry a visible caption, like the teen tiles;
 *  - #11: a Top 10 card's name drops a trailing "(…)" spec list and may wrap to three lines (#1 was cut off);
 *  - #12: a /gift-guides/<slug> search engines must not list (an emptied store page) is noindex before JS;
 *  - #13: /gift-guides/nurses opens Healthcare, and the search "nurse" lists Healthcare first;
 *  - #15: no guide shows the Kindle photo with the "INSURANCE AVAILABLE" badge, nor the lip-oil photo with price badges;
 *  - #17: the "Kids by age" chip opens the Kids by age block (its anchor), not just the For kids group.
 *
 * @mutate scripts/gift-guide-photo-covers.py |         if (len(lines) <= 2 and all( |         if (len(lines) <= 3 and all(
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | (row === "for-kids" && G.ageHubLabels[g.slug] ? g.title : undefined) | (undefined)
 * @mutate src/lib/giftGuidePageMeta.mjs |   if (gift) { |   if (false) {
 * @mutate api/share.ts |     ...("robots" in page && typeof page.robots === "string" ? { robots: page.robots } : {}), |
 * @mutate src/content/giftGuideCatalog.ts |     const keyword = q !== "" && (SEARCH_KEYWORDS[g.slug] ?? "").split(" ").includes(q); |     const keyword = false;
 * @mutate src/content/giftGuideCatalog.ts |   nurses: ["healthcare"], |   "nurses-gone": ["healthcare"],
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |           {r.row === "for-kids" && <KidsByAge />} |           {null}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks, newSlugFor, searchGuides } from "@/content/giftGuideCatalog";
import { publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { topCardName } from "@/pages/info/giftGuides/GiftGuideLanding";
import { KIDS_BY_AGE_ID } from "@/pages/info/giftGuides/GiftGuideAges";
import { readdirSync } from "./helpers/trackedFiles";

afterEach(cleanup);
await loadAllGuidePicks();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("gift guides r3 UX Lows", () => {
  it("#9: cover names are drawn on two lines at most", () => {
    const py = readFileSync("scripts/gift-guide-photo-covers.py", "utf8");
    expect(py).toContain("if (len(lines) <= 2 and all(");
    expect(py).toContain("if len(lines) > 2:  # a tighter break");
  });

  // Follow-up 1120 (owner 11-20 ~1:10 AM): Girls, Boys and Gender-Neutral are sections of ONE Kids guide, so the For kids
  // row is the Kids tile alone (no hub tiles left to caption).
  it("#10: the For kids row shows the one Kids tile; Girls, Boys and Gender-neutral have no tiles of their own", () => {
    const { container } = renderAt("/gift-guides?group=for-kids");
    const row = container.querySelector("[data-gift-row='for-kids']")!;
    expect([...row.querySelectorAll("[data-gift-tile]")].map((t) => t.getAttribute("data-gift-tile"))).toEqual(["kids", "teens"]); // Teens is its own guide (owner 11-20 evening)
    for (const slug of ["girls", "boys", "gender-neutral"]) expect(row.querySelector(`[data-gift-tile='${slug}']`), slug).toBeNull();
  });

  it("#11: a Top 10 card name drops a trailing spec list, and wraps to three lines", () => {
    expect(topCardName("Anker Zolo Magnetic Power Bank (10K, 30W, Built-in USB-C Cable)")).toBe("Anker Zolo Magnetic Power Bank");
    expect(topCardName("Rambler 20 oz Tumbler")).toBe("Rambler 20 oz Tumbler");
    expect(readFileSync("src/pages/info/giftGuides/giftGuidesStyles.ts", "utf8")).toMatch(/\.gg-topcard-name\{[^}]*-webkit-line-clamp:3/);
  });

  it("#12: a guide slug search engines do not list is noindex before JS, and api/share.ts passes it on", () => {
    expect(Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, "store-yankee-candle")).toBe(false);
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/store-yankee-candle", null)?.robots).toMatch(/noindex/);
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/mom", null)?.robots).toBeUndefined();
    expect(readFileSync("api/share.ts", "utf8")).toContain('...("robots" in page && typeof page.robots === "string" ? { robots: page.robots } : {}),');
  });

  it("#13: /gift-guides/nurses opens Healthcare, and \"nurse\" lists Healthcare first", () => {
    expect(newSlugFor("nurses")).toBe("healthcare");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { redirects: { source: string; destination: string }[] };
    expect(vercel.redirects.find((r) => r.source === "/gift-guides/nurses")?.destination).toBe("/gift-guides/healthcare");
    // (Healthcare hides while under 6 picks after one guide per product, owner 11-19.)
    if (!guideBySlug("healthcare")?.empty) {
      expect(searchGuides("nurse")[0]?.slug).toBe("healthcare");
      expect(searchGuides("nurses")[0]?.slug).toBe("healthcare");
    }
  });

  it("#15: no guide shows the badge photos", () => {
    const dir = "src/content/giftGuidePicks";
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(34); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20
    const hits = files.filter((f) => /b9346480-e5d8-405a-be12-eedecc9dad24|a1cad1c0a8ae4be69efa19221195a9c4/.test(readFileSync(`${dir}/${f}`, "utf8")));
    expect(hits).toEqual([]);
  });

  it("#17: the For kids group's page opens with the Kids by age block (its old landing chip is gone, owner 11-20 PM)", () => {
    const { container } = renderAt(`/gift-guides?group=for-kids#${KIDS_BY_AGE_ID}`);
    expect(container.querySelector(`#${KIDS_BY_AGE_ID}[data-gift-ages]`)).not.toBeNull();
  });
});
