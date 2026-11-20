/**
 * My Wish List + Share + how-to hints (owner 2026-11-20: "add something that they can add to their list and send their
 * list to someone"; "add hints or things so they know how to use everything").
 *   - hearts persist (localStorage) and one heart covers the same gift on every guide (item id = its link's hash);
 *   - deal cards and Small Business cards heart too, and come back on My Wish List from their refs;
 *   - My Wish List: editable name (never required), Shop with OUR link, Remove, the empty state, Share;
 *   - a shared list (/gift-guides/list/<code>) renders for a guest from refs alone, with our affiliate links;
 *   - the share sends only refs (guide slug + item id) and the list name; the link carries only the code;
 *   - every hint is dismissible and stays dismissed; storage that throws never breaks the page.
 * Server side: src/test/pglite/giftWishLists.pglite.mjs.
 *
 * @mutate src/pages/info/giftGuides/giftList.tsx |   if (isSaved(cur, id)) return true; |   if (false) return true;
 * @mutate src/pages/info/giftGuides/giftList.tsx | export const refOf = (p: SavedPick): WishRef \| null => (p.guide ? { g: p.guide, i: pickId(p) } : null); | export const refOf = (p: SavedPick): WishRef \| null => (p.guide ? { g: p.guide, i: p.href } : null);
 * @mutate src/pages/info/giftGuides/GiftHint.tsx |     window.localStorage.setItem(PREFIX + id, "1"); |     void id;
 * @mutate src/pages/info/giftGuides/GiftHint.tsx |   dismissedNow.add(id); |   void dismissedNow;
 * @mutate src/pages/info/giftGuides/wishListItems.ts |   const own = guideBySlug(r.g)?.picks.find((p) => pickItemId(p) === r.i); |   const own = guideBySlug(r.g)?.picks.find((p) => p.name === r.i);
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx | <WishRow key={it.id} item={it} /> | <WishRow key={it.id} item={it} onRemove={() => undefined} />
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       <Heart saved={saved} label={WISH.saveLabel(name)} | {null}<Heart saved={false} label={WISH.saveLabel(name)}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |               {items.map((it) => <WishRow key={it.id} item={it} onRemove={() => removeFromWishList(it.id)} />)} |               {items.map((it) => <WishRow key={it.id} item={it} onRemove={() => undefined} />)}
 * @mutate src/pages/info/GiftGuides.tsx |   if (oldMyList) return <Navigate to={`/gift-guides/${MY_LIST_SLUG}`} replace />; |   if (false) return null;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import deals from "@/content/giftGuideDeals.json";
import smallBiz from "@/content/giftGuideSmallBiz.json";
import { DEALS_SLUG, type Deal } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_SLUG, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { GUIDES, guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { HINTS, WISH } from "@/content/giftWishList";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// Signed out (the guest case); no Supabase client is loaded by these tests.
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
const saveWishList = vi.fn(async (_name: string, _items: unknown[]) => "abc123defg");
const getSharedList = vi.fn();
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  saveWishList: (name: string, items: unknown[]) => saveWishList(name, items),
  getSharedList: (code: string) => getSharedList(code),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import { addToWishList, giftListNow, itemId, listRefs, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetFirstHeartForTests } from "@/pages/info/giftGuides/GiftGuideHints";
import { bizItemId, dealItemId } from "@/pages/info/giftGuides/wishListItems";

await loadAllGuidePicks();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        <Route path="/gift-guides/list/:code" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

const fresh = () => {
  window.localStorage.clear();
  resetGiftListForTests();
  resetHintsForTests();
  resetFirstHeartForTests();
  saveWishList.mockClear();
  getSharedList.mockReset();
};
beforeEach(fresh);
afterEach(() => {
  cleanup();
  fresh();
});

/** A guide whose picks include one also on another guide (one heart covers both). */
const pickedGuides = GUIDES.filter((g) => g.picks.length > 0);

describe("hearts persist and one heart covers the gift everywhere", () => {
  it("has guides with picks to test against", () => {
    expect(pickedGuides.length).toBeGreaterThan(20);
  });

  it("a pick heart writes a ref (guide + item id) to storage, and a fresh read (reload) still has it", () => {
    const g = pickedGuides[0];
    const view = renderAt(`/gift-guides/${g.slug}`);
    const heart = view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!;
    fireEvent.click(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    resetGiftListForTests(); // the in-memory copy forgotten: the next read is storage, as after a reload
    const refs = listRefs(giftListNow());
    expect(refs).toEqual([{ g: g.slug, i: itemId(g.picks[0].href) }]);
    expect(refs[0].i).toMatch(/^[a-z0-9]{1,16}$/);
  });

  it("the same link on two guides is one saved gift (hearted on one, pressed on the other)", () => {
    const seen = new Map<string, string>();
    let pair: [string, string, string] | null = null;
    for (const g of pickedGuides) for (const p of g.picks) {
      const other = seen.get(p.href);
      if (other && other !== g.slug && !pair) pair = [other, g.slug, p.href];
      if (!seen.has(p.href)) seen.set(p.href, g.slug);
    }
    expect(pair).not.toBeNull();
    const [a, b, href] = pair!;
    addToWishList({ href, name: "x", guide: a });
    const view = renderAt(`/gift-guides/${b}`);
    for (let more = view.container.querySelector<HTMLButtonElement>("[data-gift-more-picks]"); more; more = view.container.querySelector("[data-gift-more-picks]")) fireEvent.click(more);
    const row = [...view.container.querySelectorAll("[data-gift-pick]")].find((li) => li.querySelector(`a[href="https://${href.replace(/^https:\/\//, "")}"]`));
    expect(row?.querySelector("[data-gift-heart]")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("an old saved list (before ids and names) still reads, and storage that throws leaves an empty working list", () => {
    window.localStorage.setItem("lh-gift-list", JSON.stringify({ guides: ["mom"], picks: [{ href: pickedGuides[0].picks[0].href, name: "n", guide: pickedGuides[0].slug }] }));
    resetGiftListForTests();
    expect(listRefs(giftListNow())).toEqual([{ g: pickedGuides[0].slug, i: itemId(pickedGuides[0].picks[0].href) }]);
    resetGiftListForTests();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(giftListNow().picks).toEqual([]);
      expect(addToWishList({ href: "https://www.amazon.com/dp/X?tag=louisianahelpr-20", name: "x", guide: "her" })).toBe(true);
      expect(giftListNow().picks.length).toBe(1);
      const view = renderAt("/gift-guides");
      expect(view.container.querySelector("[data-gift-hint='how-to']")).not.toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("deal and Small Business cards heart too, and come back from their refs", () => {
  it("a deal card's heart saves a ref to the deals page; My Wish List shows it with our link", async () => {
    const view = renderAt(`/gift-guides/${DEALS_SLUG}`);
    const heart = await waitFor(() => {
      const h = view.container.querySelector<HTMLButtonElement>("[data-gift-deal] [data-gift-heart]");
      expect(h).not.toBeNull();
      return h!;
    });
    fireEvent.click(heart);
    const ref = listRefs(giftListNow())[0];
    expect(ref.g).toBe(DEALS_SLUG);
    const deal = (deals as Deal[]).find((d) => dealItemId(d) === ref.i);
    expect(deal).toBeDefined();
    cleanup();
    const mine = renderAt("/gift-guides/my-list");
    const row = await waitFor(() => {
      const r = mine.container.querySelector(`[data-gift-wish-item="${ref.i}"]`);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.querySelector("a[data-gift-out]")?.getAttribute("href")).toBe(`https://${deal!.href.replace(/^https:\/\//, "")}`);
    expect(row.querySelector("a[data-gift-out]")?.getAttribute("rel")).toBe("sponsored noopener");
  });

  it("a business card hearts by its slug and comes back as a Visit link", async () => {
    const b = (smallBiz as SmallBiz[]).find((x) => x.href)!;
    expect(b).toBeDefined();
    addToWishList({ href: b.href!, name: b.name, guide: SMALL_BIZ_SLUG, id: bizItemId(b) });
    const mine = renderAt("/gift-guides/my-list");
    const row = await waitFor(() => {
      const r = mine.container.querySelector(`[data-gift-wish-item="${bizItemId(b)}"]`);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.textContent).toContain(b.name);
    expect(row.textContent).toContain(WISH.visit);
  });
});

describe("My Wish List page", () => {
  it("the old ?list=mine address opens /gift-guides/my-list; empty, it says how to fill it", () => {
    const view = renderAt("/gift-guides?list=mine");
    expect(view.container.querySelector("[data-gift-my-list]")).not.toBeNull();
    expect(view.container.querySelector("[data-gift-my-list-empty]")?.textContent).toContain(WISH.empty);
    expect(view.container.querySelector("[data-gift-wish-share-btn]")).toBeNull();
  });

  it("the name is editable and optional, Remove takes a gift off, and Shop is our link", () => {
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    addToWishList({ href: g.picks[1].href, name: g.picks[1].name, guide: g.slug });
    const view = renderAt("/gift-guides/my-list");
    expect(view.container.querySelector("#gift-my-list")?.textContent).toBe(WISH.title);
    const input = view.container.querySelector<HTMLInputElement>("[data-gift-wish-name-input]")!;
    expect(input.required).toBe(false);
    fireEvent.change(input, { target: { value: "Mom's Christmas List" } });
    expect(view.container.querySelector("#gift-my-list")?.textContent).toBe("Mom's Christmas List");
    expect(JSON.parse(window.localStorage.getItem("lh-gift-list")!).name).toBe("Mom's Christmas List");
    const rows = view.container.querySelectorAll("[data-gift-wish-item]");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector("[data-gift-shop]")?.closest("a")?.getAttribute("href")).toBe(`https://${g.picks[0].href.replace(/^https:\/\//, "")}`);
    fireEvent.click(rows[0].querySelector<HTMLButtonElement>("[data-gift-wish-remove]")!);
    expect(view.container.querySelectorAll("[data-gift-wish-item]").length).toBe(1);
    expect(giftListNow().picks.length).toBe(1);
  });

  it("Share sends only the name and refs, and shows a link with only the code (copy, text)", async () => {
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    const view = renderAt("/gift-guides/my-list");
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-share-menu]")).not.toBeNull());
    expect(saveWishList).toHaveBeenCalledWith(WISH.title, [{ g: g.slug, i: itemId(g.picks[0].href) }]);
    const link = view.container.querySelector<HTMLInputElement>("[data-gift-wish-link]")!.value;
    expect(link).toMatch(/\/gift-guides\/list\/abc123defg$/);
    expect(view.container.querySelector("[data-gift-wish-text]")?.getAttribute("href")).toContain(encodeURIComponent(link));
    expect(view.container.querySelector("[data-gift-wish-copy]")).not.toBeNull();
  });

  it("a refused share says so and keeps the button", async () => {
    saveWishList.mockRejectedValueOnce(Object.assign(new Error("x"), { kind: "rateLimited" }));
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    const view = renderAt("/gift-guides/my-list");
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-share-limited]")?.textContent).toBe(WISH.shareRateLimited));
    expect(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!.disabled).toBe(false);
  });
});

describe("a shared list renders for a guest", () => {
  it("renders the list's name and its gifts with our links, from refs alone, no Remove", async () => {
    const g = pickedGuides[1];
    const refs = g.picks.slice(0, 3).map((p) => ({ g: g.slug, i: itemId(p.href) }));
    getSharedList.mockResolvedValue({ name: "Mom's Christmas List", items: [...refs, { g: "her", i: "gone00" }] });
    const view = renderAt("/gift-guides/list/abc123defg");
    await waitFor(() => expect(view.container.querySelectorAll("[data-gift-wish-item]").length).toBe(3));
    expect(getSharedList).toHaveBeenCalledWith("abc123defg");
    expect(view.container.querySelector("#gift-shared-list")?.textContent).toBe("Mom's Christmas List");
    expect(view.container.querySelector("[data-gift-wish-remove]")).toBeNull();
    const first = view.container.querySelector("[data-gift-wish-item] [data-gift-shop]")?.closest("a");
    expect(first?.getAttribute("href")).toBe(`https://${g.picks[0].href.replace(/^https:\/\//, "")}`);
    expect(first?.getAttribute("rel")).toBe("sponsored noopener");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
  });

  it("an unknown code says the list is not there; a failed read offers a retry", async () => {
    const missing = render(<MemoryRouter><GiftGuideSharedList code="zzzzzzzzzz" read={async () => null} /></MemoryRouter>);
    await waitFor(() => expect(missing.container.querySelector("[data-gift-shared-missing]")?.textContent).toBe(WISH.sharedMissing));
    cleanup();
    let n = 0;
    const read = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("offline");
      return { name: "L", items: [] };
    });
    const failing = render(<MemoryRouter><GiftGuideSharedList code="zzzzzzzzzz" read={read} /></MemoryRouter>);
    await waitFor(() => expect(failing.container.querySelector("[data-gift-shared-failed]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: WISH.retry }));
    await waitFor(() => expect(failing.container.querySelector("[data-gift-shared-empty]")).not.toBeNull());
  });
});

describe("how-to hints dismiss and stay dismissed", () => {
  it("the landing's three steps close with × and stay closed after a reload", () => {
    const view = renderAt("/gift-guides");
    const strip = view.container.querySelector("[data-gift-hint='how-to']")!;
    expect([...strip.querySelectorAll("li")].map((l) => l.textContent)).toEqual([...HINTS.steps]);
    fireEvent.click(strip.querySelector<HTMLButtonElement>("[data-gift-hint-close='how-to']")!);
    expect(view.container.querySelector("[data-gift-hint='how-to']")).toBeNull();
    cleanup();
    resetHintsForTests(); // this visit's memory gone: only storage remembers
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-hint='how-to']")).toBeNull();
  });

  it("the quiz, budget and share hints show once and close", () => {
    const view = renderAt("/gift-guides");
    const quiz = view.container.querySelector("[data-gift-hint='quiz']");
    expect(quiz?.textContent).toContain(HINTS.quiz);
    fireEvent.click(quiz!.querySelector("button")!);
    expect(view.container.querySelector("[data-gift-hint='quiz']")).toBeNull();
    cleanup();
    const banded = pickedGuides.find((g) => g.picks.filter((p) => p.band !== undefined).length >= 3)!;
    const guide = renderAt(`/gift-guides/${banded.slug}`);
    expect(guide.container.querySelector("[data-gift-hint='budget']")?.textContent).toContain(HINTS.budget);
    cleanup();
    addToWishList({ href: pickedGuides[0].picks[0].href, name: "n", guide: pickedGuides[0].slug });
    const mine = renderAt("/gift-guides/my-list");
    expect(mine.container.querySelector("[data-gift-hint='share']")?.textContent).toContain(HINTS.share);
    expect(window.localStorage.getItem("lh-gg-hint-quiz")).toBe("1");
  });

  it("the first heart that saves shows 'Saved to your wish list' once, with the way to the list", () => {
    vi.useFakeTimers();
    try {
      const g = pickedGuides[0];
      const view = renderAt(`/gift-guides/${g.slug}`);
      expect(document.body.querySelector("[data-gift-hint='first-heart']")).toBeNull();
      fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
      const note = document.body.querySelector("[data-gift-hint='first-heart']");
      expect(note?.textContent).toContain(HINTS.firstHeart);
      expect(note?.querySelector("a")?.getAttribute("href")).toBe("/gift-guides/my-list");
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(document.body.querySelector("[data-gift-hint='first-heart']")).toBeNull();
      expect(window.localStorage.getItem("lh-gg-hint-first-heart")).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the deals page carries its helper line", async () => {
    const view = renderAt(`/gift-guides/${DEALS_SLUG}`);
    expect(view.container.querySelector("[data-gift-deals-help]")?.textContent).toBe(HINTS.deals);
    expect(guideBySlug(DEALS_SLUG)).toBeUndefined();
  });
});
