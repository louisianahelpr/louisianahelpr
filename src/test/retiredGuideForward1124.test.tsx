/**
 * Lead 11-24: retired guide links that still get visits open the search page that honestly matches them
 * (src/content/retiredGuideForward.ts), in the page (newSlugFor -> GiftGuides.tsx) and as a 301 from the server
 * (seoData `moved` -> api/share.ts). Every other retired guide still opens the landing; mom/dad still open Her/Him.
 *
 * @mutate src/content/giftGuideCatalog.ts |   return !isLiveGuide(s) && Object.prototype.hasOwnProperty.call(RETIRED_TO_SEARCH_PAGE, s) ? RETIRED_TO_SEARCH_PAGE[s] : null; |   return null;
 * @mutate src/prerender/seoData.ts | ...RETIRED_SLUGS(), ...Object.keys(RETIRED_TO_SEARCH_PAGE)])) { | ...RETIRED_SLUGS()])) {
 * @mutate src/content/retiredGuideForward.ts |   hunters: "hunting-gifts-for-men", |   hunters: "hunting-gifts-for-man",
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import GiftGuides from "@/pages/info/GiftGuides";
import { RETIRED_TO_SEARCH_PAGE } from "@/content/retiredGuideForward";
import { SEARCH_PAGES } from "@/content/guideSearchPages.mjs";
import { GUIDES, RETIRED_SLUGS, newSlugFor } from "@/content/giftGuideCatalog";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import { RELATION_PAGES } from "@/content/giftGuidePeople.mjs";
import { buildSeoData } from "@/prerender/seoData";

afterEach(cleanup);

function Where() {
  const { pathname } = useLocation();
  return <p data-test-where="">{pathname}</p>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

const MAP = Object.entries(RETIRED_TO_SEARCH_PAGE);
const SEARCH = new Set(SEARCH_PAGES.map((p) => p.slug));

describe("retired guide links open their search page (lead 11-24)", () => {
  it("every key is a retired slug (never a live guide, search page or relationship page) and every value a real search page", () => {
    expect(MAP.length).toBeGreaterThan(20);
    const retired = new Set(RETIRED_SLUGS());
    for (const [from, to] of MAP) {
      expect(SEARCH.has(to), `${from} -> ${to}`).toBe(true);
      expect(isLiveGuide(from), from).toBe(false);
      expect(SEARCH.has(from), from).toBe(false);
      expect(GUIDES.some((g) => g.slug === from), from).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(RELATION_PAGES, from), from).toBe(false);
      // Every key but the never-built address the lead named (/toddlers) is a guide that once had a page.
      if (from !== "toddlers") expect(retired.has(from), from).toBe(true);
    }
  });

  it("the named links land where the lead asked; mom and dad still open Her and Him; an unmatched one still opens the landing", () => {
    const want: Record<string, string | null> = {
      "stocking-stuffers": "stocking-stuffers-under-10",
      teachers: "gifts-for-coworkers-under-15",
      coworkers: "gifts-for-coworkers-under-15",
      "secret-santa": "secret-santa-gifts-under-25",
      "white-elephant": "secret-santa-gifts-under-25",
      "louisiana-made": "louisiana-christmas-gifts",
      toddlers: "gifts-for-toddlers",
      teens: "gifts-for-teens",
      hunters: "hunting-gifts-for-men",
      fishermen: "fishing-gifts-for-men",
      "for-hunters": "hunting-gifts-for-men",
      mom: "her",
      dad: "him",
      golfer: null,
      "horse-lover": null,
    };
    for (const [from, to] of Object.entries(want)) expect(newSlugFor(from), from).toBe(to);
  });

  it("the server answers a 301 to the same page for every key (seoData moved)", async () => {
    const d = await buildSeoData();
    for (const [from, to] of MAP) expect(d.moved[from], from).toBe(to);
    expect(d.moved.mom).toBe("her");
    expect(d.moved.golfer).toBe("");
  });

  it("the page forwards an old link to its search page", async () => {
    for (const [from, to] of [["hunters", "hunting-gifts-for-men"], ["stocking-stuffers", "stocking-stuffers-under-10"], ["golfer", null]] as const) {
      const { container } = renderAt(`/gift-guides/${from}`);
      await waitFor(() => expect(container.querySelector("[data-test-where]")?.textContent, from).toBe(to ? `/gift-guides/${to}` : "/gift-guides"));
      cleanup();
    }
  });
});
