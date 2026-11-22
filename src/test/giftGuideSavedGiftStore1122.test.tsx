/**
 * Live bug 2026-11-22 (owner, iPhone Safari, guest, Her guide): tapping the floating "My lists · 5 gifts · $163.25" pill
 * replaced the page with "This page hit a problem" (she read it as page not found). Sentry JAVASCRIPT-5W: "gift guides:
 * https://go.shopmy.us/p-108632104 is on no store in STORES". A gift she had saved for a person was a Kids ShopMy pick
 * (go.shopmy.us, store page store-grove); the My lists sheet drew its thumbnail with storeOf(), which knows only the
 * fixed stores' hosts and THROWS for any other, so rendering the sheet threw and the route's error boundary took the
 * page. Measured on www before the fix (repro: a guest list for "Mom" holding that pick, tap the pill): the error card,
 * 0 dialogs; after: the dialog with Mom's card, 0 errors.
 *
 * The class: a SAVED gift's link comes from the visitor (any guide, any store, a pasted link), so nothing drawn from it
 * may throw. storeForLink() resolves any store by host and gives "" otherwise; storeLabel() never indexes a missing
 * store; and no render path calls storeOf() (the content check that rightly throws at load time).
 *
 * @mutate src/pages/info/giftGuides/ManageList.tsx | store: storeForLink(href), image }} | store: href ? storeOf(href) : "", image }}
 * @mutate src/content/giftGuideCatalog.ts |     return "";\n  }\n  return (Object.keys(STORES) |     throw new Error("bad link");\n  }\n  return (Object.keys(STORES)
 * @mutate src/content/giftGuideCatalog.ts |   return (Object.keys(STORES) as GiftStore[]).find((s) => STORES[s].hosts.includes(host)) ?? ""; |   return (Object.keys(STORES) as GiftStore[]).find((s) => STORES[s].hosts.includes(host)) ?? storeOf(href);
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   : STORES[pick.store]?.name ?? pick.brand ?? ""; |   : STORES[pick.store].name;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { GUIDES, STORES, loadAllGuidePicks, storeForLink, storeOf } from "@/content/giftGuideCatalog";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import { storeLabel } from "@/pages/info/giftGuides/GiftGuideView";
import { PersonList } from "@/pages/info/giftGuides/ManageList";
import type { PlanPerson } from "@/content/giftGuideFun1120";

afterEach(cleanup);

/** The owner's saved Kids picks from the Sentry event (ShopMy links whose store pages are store-grove / store-maisonette). */
const SHOPMY_KIDS = ["https://go.shopmy.us/p-108632104", "https://go.shopmy.us/p-108632273", "https://go.shopmy.us/p-108632461"];

describe("a saved gift's store never throws (live bug 11-22: the My lists pill crashed the Her page)", () => {
  it("storeOf still throws for those links (it is the load-time content check), storeForLink does not", () => {
    for (const href of SHOPMY_KIDS) {
      expect(() => storeOf(href), href).toThrow(/is on no store in STORES/);
      expect(() => storeForLink(href), href).not.toThrow();
    }
    expect(storeForLink("not a link")).toBe("");
    expect(storeForLink(undefined)).toBe("");
    expect(storeForLink("https://www.amazon.com/dp/B000S5VEA2")).toBe("amazon");
    // A researched store is found by its own hosts too.
    const [slug, st] = Object.entries(STORES).find(([s, v]) => s.startsWith("store-") && v.hosts.length > 0)!;
    expect(storeForLink(`https://${st.hosts[0]}/x`)).toBe(slug);
  });

  it("the fallback tile's label never indexes a missing store", () => {
    expect(() => storeLabel({ name: "x", href: SHOPMY_KIDS[0], store: "" })).not.toThrow();
    expect(storeLabel({ name: "x", href: SHOPMY_KIDS[0], store: "", brand: "PlanToys" })).toBe("PlanToys");
  });

  it("the My lists sheet draws a person's list holding the owner's Kids ShopMy pick (with its photo)", async () => {
    const mom: PlanPerson = { id: "p1", name: "Mom", budget: 100, ideas: SHOPMY_KIDS.map((href, k) => ({
      id: `i${k}`, name: `Kids pick ${k}`, href, bought: false, price: 29.99, guide: "kids",
      image: "https://www.louisianahelpr.com/gift-guides/cutouts/plantoys-dancing-alligator-20c33e.webp",
    })) };
    await act(async () => {
      render(<MemoryRouter><PersonList p={mom} ready /></MemoryRouter>);
    });
    for (let k = 0; k < SHOPMY_KIDS.length; k++) expect(screen.getByText(`Kids pick ${k}`)).toBeTruthy();
  });

  it("every live guide's picks load (the catalog never throws), and each one, saved, resolves and labels without throwing", async () => {
    await expect(loadAllGuidePicks()).resolves.not.toThrow();
    const live = GUIDES.filter((g) => isLiveGuide(g.slug));
    expect(live.length).toBeGreaterThan(2); // Her, Him, Kids (+ the sponsors page) on 2026-11-22
    let picks = 0;
    for (const g of live) for (const pick of g.picks) {
      const store = storeForLink(pick.href);
      expect(() => storeLabel({ name: pick.name, href: pick.href, store, ...(pick.brand ? { brand: pick.brand } : {}) }), pick.href).not.toThrow();
      picks += 1;
    }
    expect(picks).toBeGreaterThan(100); // ~430 live picks on 2026-11-22
    expect(live.flatMap((g) => g.picks).filter((p) => SHOPMY_KIDS.includes(p.href)).length).toBeGreaterThan(0);
  });

  it("no gift guides screen calls storeOf() while rendering (only the catalog's load-time build may)", () => {
    const files = [...readdirSync("src/pages/info/giftGuides", { recursive: true }).map((f) => `src/pages/info/giftGuides/${f}`), "src/pages/info/GiftGuides.tsx"]
      .filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20); // inventory floor: ~50 files under the guides on 2026-11-22
    const callers = files.filter((f) => /\bstoreOf\(/.test(blankComments(readFileSync(f, "utf8"))));
    expect(callers).toEqual([]);
  });
});
