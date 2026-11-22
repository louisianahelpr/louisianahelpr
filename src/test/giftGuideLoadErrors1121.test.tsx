/**
 * Holiday gift guides audit 1121: a gift guides data file that does not load (offline, a blocked chunk) says so with
 * a Try again, never "Loading…" for good and never a false "nothing here" line. The class: every lazy data file the
 * guides read (a guide's picks, the deals, the Small Business Saturday shops, the search's gift index).
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   if (!ready && failed && onRetry) return <GiftGuideLoadError message={G.picksFailed} onRetry={onRetry} />; |   if (false) return null;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |           {deals === null && failed ? ( |           {false ? (
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx |       {rows === null && failed ? ( |       {false ? (
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |             {itemsFailed && !items && <li | {false && <li
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/loadModule", async (orig) => ({
  ...(await orig<typeof import("@/lib/loadModule")>()),
  loadModule: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
}));
vi.mock("@/content/giftGuideCatalog", async (orig) => {
  const real = await orig<typeof import("@/content/giftGuideCatalog")>();
  return {
    ...real,
    picksReady: () => false,
    loadGuidePicks: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
    loadSearchItems: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  };
});

import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_WORDS } from "@/content/giftGuideSmallBiz.mjs";
import { GiftGuideView } from "@/pages/info/giftGuides/GiftGuideView";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { SmallBizGrid } from "@/pages/info/giftGuides/GiftGuideSmallBiz";
import { GiftGuideTools } from "@/pages/info/giftGuides/GiftGuideShare";

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("a data file that fails shows why and a Try again (holiday audit 1121)", () => {
  it("a guide's picks: the reason and Try again, not 'Loading picks…' for good", async () => {
    inRouter(<GiftGuideView guide={guideBySlug("her")!} />);
    expect(await screen.findByText(G.picksFailed)).toBeTruthy();
    expect(screen.queryByText(G.loadingPicks)).toBeNull();
    expect(screen.getByRole("button", { name: G.loadRetry })).toBeTruthy();
  });

  it("the deals: the reason and Try again, not 'These deals have ended'", async () => {
    const { container } = inRouter(<GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-25T18:00:00Z")} />);
    expect(await screen.findByText(G.dealsFailed)).toBeTruthy();
    expect(container.querySelector("[data-gift-deals-none]")).toBeNull();
  });

  it("the Small Business Saturday shops: the reason and Try again, not the no-shops line", async () => {
    const { container } = inRouter(<SmallBizGrid />);
    expect(await screen.findByText(SMALL_BIZ_WORDS.failed)).toBeTruthy();
    expect(container.querySelector("[data-gift-sb-none]")).toBeNull();
  });

  it("search: gift results that did not load say so, not 'No guides match'", async () => {
    const { container } = inRouter(<GiftGuideTools path="/gift-guides" title="t" many />);
    fireEvent.change(container.querySelector("[data-gift-search]")!, { target: { value: "leggings" } });
    expect(await screen.findByText(G.searchFailed)).toBeTruthy();
    expect(screen.queryByText(G.searchNone)).toBeNull();
  });
});
