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
 * Owner 11-21: the deals and Small Business Saturday pages are retired (src/content/giftGuideLive.mjs), so their
 * card-heart, helper-line and colour tests are gone; a saved deal ref still reads back (the store keeps it).
 *
 * @mutate src/pages/info/giftGuides/giftList.tsx | export function addToWishList(pick: SavedPick): boolean {\n  const cur = read();\n  const id = pickId(pick);\n  if (isSaved(cur, id)) return true; | export function addToWishList(pick: SavedPick): boolean {\n  const cur = read();\n  const id = pickId(pick);\n  if (false) return true;
 * @mutate src/pages/info/giftGuides/giftList.tsx | const refOf = (p: SavedPick): WishRef \| null => (p.guide ? { g: p.guide, i: pickId(p) } : null); | const refOf = (p: SavedPick): WishRef \| null => (p.guide ? { g: p.guide, i: p.href } : null);
 * @mutate src/pages/info/giftGuides/GiftHint.tsx |     window.localStorage.setItem(PREFIX + id, "1"); |     void id;
 * @mutate src/pages/info/giftGuides/GiftHint.tsx |   dismissedNow.add(id); |   void dismissedNow;
 * @mutate src/pages/info/giftGuides/wishListItems.ts | const pickItemId = (p: { href: string }) => itemId(p.href); | const pickItemId = (p: { href: string }) => itemId(`${p.href}#`);
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx | <WishRow key={it.id} item={it} /> | <WishRow key={it.id} item={it} heart={{ saved: true, onToggle: () => undefined }} />
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |     if (!putBackInWishList(g.pick, g.index)) return; |     return;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       <Heart saved={saved} label={WISH.saveForLabel(name)} | {null}<Heart saved={false} label={WISH.saveForLabel(name)}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |     removeFromWishList(it.id); |     void it;
 * @mutate src/pages/info/GiftGuides.tsx |   if (oldMyList) return <Navigate to={`/gift-guides/${MY_LIST_SLUG}`} replace />; |   if (false) return null;
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-toast .gg-toast-long{display:none}.gg-toast .gg-toast-short{display:inline} | .gg-toast-x{}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |     if (!giftNameProblem(v)) setListName(v); |     setListName(v);
 * @mutate src/pages/info/giftGuides/wishListSync.ts |       if (!l.synced && l.picks.length === 0 && !l.name.trim()) return; |       void 0;
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx | {user && syncProblem | {false && syncProblem
 * @mutate src/lib/giftNameClean.ts | \|\b[a-z0-9-]+\.[a-z]{2,}\b)/i | )/i
 * @mutate src/pages/info/giftGuides/giftList.tsx |   const cur = mine.owner !== null && mine.owner !== uid ? EMPTY : mine; |   const cur = mine;
 * @mutate src/pages/info/giftGuides/giftList.tsx | const kept = remoteItems.filter((r) => !removedHere.has(r.i)).map(fromRemote); | const kept = remoteItems.map(fromRemote);
 * @mutate src/pages/info/giftGuides/giftList.tsx | .filter((r): r is WishRef => r !== null).slice(0, MAX_LIST_ITEMS); | .filter((r): r is WishRef => r !== null);
 * @mutate src/lib/giftNameClean.ts |   return Array.from(visible).slice(0, max).join(""); |   return visible.slice(0, max);
 * @mutate src/pages/info/giftGuides/wishListSync.ts |     if (wasSignedIn.current \|\| giftListNow().owner !== null) clearWishList(); |     if (wasSignedIn.current) clearWishList();
 * @mutate src/pages/info/giftGuides/GiftGuideHints.tsx |   if (result === "full") setNote("full"); |   if (result === "full") void 0;
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |     setGone((xs) => [...xs.filter((x) => x.item.id !== it.id), g]); |     void g;
 * @mutate src/pages/info/giftGuides/wishListItems.ts |   const missingIds = loading ? [] : | const missingIds = true ? [] :
 * @mutate src/content/giftGuideDeals.mjs |   return d.item.toLowerCase().startsWith(d.brand.toLowerCase()) ? d.item : `${d.brand}: ${d.item}`; |   return `${d.brand}: ${d.item}`;
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx | {item.out === "plain" ? item.store : G.onStore(item.store)} | {G.onStore(item.store)}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import smallBiz from "@/content/giftGuideSmallBiz.json";
import { type Deal } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_SLUG, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { GUIDES, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { HINTS, WISH } from "@/content/giftWishList";

// A share keeps a token to stop its link (giftWishListOwnApi.ts, wishListDelete1121.test.tsx); here it never reaches a server.
vi.mock("@/lib/giftWishListOwnApi", async (orig) => ({ ...(await orig<typeof import("@/lib/giftWishListOwnApi")>()), claimShare: vi.fn(async () => undefined) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// Signed out (the guest case); no Supabase client is loaded by these tests.
// Analytics (UX audit L7) are counted, never sent from a unit test.
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ track }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));
const saveWishList = vi.fn(async (_name: string, _items: unknown[]) => "abc123defghi");
const getMyWishList = vi.fn(async (): Promise<{ code: string; name: string; items: { g: string; i: string }[] } | null> => null);
const getSharedList = vi.fn();
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  // A share now keeps a token to stop its link (wishListDelete1121.test.tsx); here it never reaches a server.
  saveWishList: (name: string, items: unknown[]) => saveWishList(name, items),
  getSharedList: (code: string) => getSharedList(code),
  getMyWishList: () => getMyWishList(),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import { addToWishList, cleanListName, clearWishList, giftListNow, itemId, listRefs, markSynced, reconcileWithAccount, removeFromWishList, resetGiftListForTests, setListName, togglePick } from "@/pages/info/giftGuides/giftList";
import { GIFT_WISH_RPC_ERROR_COPY } from "@/lib/giftWishListApi";
import { GIFT_WISH_CSS } from "@/pages/info/giftGuides/giftWishStyles";
import { giftNameProblem } from "@/lib/giftNameClean";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetFirstHeartForTests } from "@/pages/info/giftGuides/GiftGuideHints";
import { bizItemId } from "@/pages/info/giftGuides/wishListItems";
import { dealName } from "@/content/giftGuideDeals.mjs";
import { openPriceSections } from "./helpers/openPriceSections";

/**
 * A guide card's heart now asks for whom (owner 2026-11-21, saveForPeople): tap it, then "Me" (My Wish List), then
 * Done. Where no picker is on the page the heart still saves straight to the wish list.
 */
const tapHeart = (heart: Element) => {
  fireEvent.click(heart);
  const me = document.querySelector("[data-savefor-me]");
  if (!me) return;
  fireEvent.click(me);
  const done = document.querySelector("[data-savefor-done]");
  if (done) fireEvent.click(done);
};


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
// My Wish List loads its own chunk (train 1121i), so wait for it before reading the page.
const renderMine = async (url: string) => {
  const view = renderAt(url);
  await waitFor(() => expect(view.container.querySelector("[data-gift-my-list]")).not.toBeNull());
  return view;
};

const fresh = () => {
  window.localStorage.clear();
  resetGiftListForTests();
  resetHintsForTests();
  resetFirstHeartForTests();
  saveWishList.mockClear();
  getSharedList.mockReset();
  getMyWishList.mockReset();
  getMyWishList.mockResolvedValue(null);
  auth.user = null;
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
    expect(pickedGuides.length).toBeGreaterThan(10); // owner 11-21: Her, Him, Kids, the sponsors page and the relationship pages (14)
  });

  it("a pick heart writes a ref (guide + item id) to storage, and a fresh read (reload) still has it", () => {
    const g = pickedGuides[0];
    const view = renderAt(`/gift-guides/${g.slug}`);
    const heart = view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!;
    tapHeart(heart);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    resetGiftListForTests(); // the in-memory copy forgotten: the next read is storage, as after a reload
    const refs = listRefs(giftListNow());
    expect(refs).toEqual([{ g: g.slug, i: itemId(g.picks[0].href) }]);
    // Adding the same gift again (another page, a swipe) keeps it once.
    expect(addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug })).toBe(true);
    expect(giftListNow().picks.length).toBe(1);
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
    openPriceSections(view.container);
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
      // Blocked storage never breaks the landing (it still draws its rows).
      const view = renderAt("/gift-guides");
      expect(view.container.querySelector("[data-gift-browse]")).not.toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("deal and Small Business cards heart too, and come back from their refs", () => {

  it("a business card hearts by its slug and comes back as a Visit link", async () => {
    const b = (smallBiz as SmallBiz[]).find((x) => x.href)!;
    expect(b).toBeDefined();
    addToWishList({ href: b.href!, name: b.name, guide: SMALL_BIZ_SLUG, id: bizItemId(b) });
    const mine = (await renderMine("/gift-guides/my-list"));
    const row = await waitFor(() => {
      const r = mine.container.querySelector(`[data-gift-wish-item="${bizItemId(b)}"]`);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.textContent).toContain(b.name);
    // Owner 11-21: no "Visit"/"Shop" button; the business's name and photo are the link to its own page.
    expect(row.querySelector("a[data-gift-sb-out] .gg-nm-name")?.textContent).toBe(b.name);
    expect(row.querySelector("[data-gift-shop]")).toBeNull();
  });
});

describe("My Wish List page", () => {
  it("the old ?list=mine address opens /gift-guides/my-list; empty, it says how to fill it", async () => {
    const view = (await renderMine("/gift-guides?list=mine"));
    expect(view.container.querySelector("[data-gift-my-list]")).not.toBeNull();
    expect(view.container.querySelector("[data-gift-my-list-empty]")?.textContent).toContain(WISH.empty);
    expect(view.container.querySelector("[data-gift-wish-share-btn]")).toBeNull();
  });

  it("the name is editable and optional, the heart takes a gift off (Undo puts it back), and Shop is our link", async () => {
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    addToWishList({ href: g.picks[1].href, name: g.picks[1].name, guide: g.slug });
    const view = (await renderMine("/gift-guides/my-list"));
    expect(view.container.querySelector("#gift-my-list")?.textContent).toBe(WISH.title);
    const input = view.container.querySelector<HTMLInputElement>("[data-gift-wish-name-input]")!;
    expect(input.required).toBe(false);
    fireEvent.change(input, { target: { value: "Mom's Christmas List" } });
    expect(view.container.querySelector("#gift-my-list")?.textContent).toBe("Mom's Christmas List");
    expect(JSON.parse(window.localStorage.getItem("lh-gift-list")!).name).toBe("Mom's Christmas List");
    const rows = view.container.querySelectorAll("[data-gift-wish-item]");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".gg-nm-name")?.closest("a")?.getAttribute("href")).toBe(`https://${g.picks[0].href.replace(/^https:\/\//, "")}`);
    // Owner 11-20: no "Remove" text buttons; a filled heart in the card's top-right corner.
    expect(view.container.textContent).not.toMatch(/\bRemove\b/);
    const heart = rows[0].querySelector<HTMLButtonElement>("[data-gift-wish-remove]")!;
    expect(heart.hasAttribute("data-gift-heart")).toBe(true);
    expect(heart.classList.contains("gg-heart-pick")).toBe(true);
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    expect(heart.getAttribute("aria-label")).toBe(WISH.removeLabel(g.picks[0].name));
    fireEvent.click(heart);
    expect(giftListNow().picks.map((p) => p.href)).toEqual([g.picks[1].href]);
    // The row stays this visit, its heart an outline that saves it again; a toast offers Undo.
    const after = view.container.querySelectorAll("[data-gift-wish-item]");
    expect(after.length).toBe(2);
    expect(after[0].hasAttribute("data-gift-wish-removed")).toBe(true);
    const outline = after[0].querySelector<HTMLButtonElement>("[data-gift-wish-remove]")!;
    expect(outline.getAttribute("aria-pressed")).toBe("false");
    expect(outline.getAttribute("aria-label")).toBe(WISH.saveLabel(g.picks[0].name));
    const toast = document.body.querySelector("[data-gift-wish-toast]")!;
    expect(toast.textContent).toContain(WISH.removedToast);
    fireEvent.click(toast.querySelector<HTMLButtonElement>("[data-gift-wish-undo]")!);
    expect(giftListNow().picks.map((p) => p.href)).toEqual([g.picks[0].href, g.picks[1].href]);
    expect(document.body.querySelector("[data-gift-wish-toast]")).toBeNull();
    expect(view.container.querySelector("[data-gift-wish-removed]")).toBeNull();
    // A second tap on an outlined heart saves it again too.
    fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>("[data-gift-wish-remove]")[1]);
    expect(giftListNow().picks.length).toBe(1);
    fireEvent.click(view.container.querySelectorAll<HTMLButtonElement>("[data-gift-wish-remove]")[1]);
    expect(giftListNow().picks.map((p) => p.href)).toEqual([g.picks[0].href, g.picks[1].href]);
  });

  it("Share sends only the name and refs, and shows a link with only the code (copy, text)", async () => {
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    const view = (await renderMine("/gift-guides/my-list"));
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-share-menu]")).not.toBeNull());
    expect(saveWishList).toHaveBeenCalledWith(WISH.title, [{ g: g.slug, i: itemId(g.picks[0].href) }]);
    const link = view.container.querySelector<HTMLInputElement>("[data-gift-wish-link]")!.value;
    expect(link).toMatch(/\/gift-guides\/list\/abc123defghi$/);
    expect(view.container.querySelector("[data-gift-wish-text]")?.getAttribute("href")).toContain(encodeURIComponent(link));
    expect(view.container.querySelector("[data-gift-wish-copy]")).not.toBeNull();
  });

  it("a refused share says so and keeps the button", async () => {
    saveWishList.mockRejectedValueOnce(Object.assign(new Error("rate_limited"), { kind: "rateLimited", copy: GIFT_WISH_RPC_ERROR_COPY.gift_wish_list_save.rate_limited }));
    const g = pickedGuides[0];
    addToWishList({ href: g.picks[0].href, name: g.picks[0].name, guide: g.slug });
    const view = (await renderMine("/gift-guides/my-list"));
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-share-failed]")?.textContent).toBe(GIFT_WISH_RPC_ERROR_COPY.gift_wish_list_save.rate_limited));
    expect(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!.disabled).toBe(false);
  });
});

describe("a shared list renders for a guest", () => {
  it("renders the list's name and its gifts with our links, from refs alone, no Remove", async () => {
    const g = pickedGuides[1];
    const refs = g.picks.slice(0, 3).map((p) => ({ g: g.slug, i: itemId(p.href) }));
    getSharedList.mockResolvedValue({ name: "Mom's Christmas List", items: [...refs, { g: "her", i: "gone00" }] });
    const view = renderAt("/gift-guides/list/abc123defghi");
    await waitFor(() => expect(view.container.querySelectorAll("[data-gift-wish-item]").length).toBe(3));
    expect(getSharedList).toHaveBeenCalledWith("abc123defghi");
    expect(view.container.querySelector("#gift-shared-list")?.textContent).toBe("Mom's Christmas List");
    expect(view.container.querySelector("[data-gift-wish-remove]")).toBeNull();
    const first = view.container.querySelector("[data-gift-wish-item] .gg-nm-name")?.closest("a");
    expect(first?.getAttribute("href")).toBe(`https://${g.picks[0].href.replace(/^https:\/\//, "")}`);
    expect(first?.getAttribute("rel")).toBe("sponsored noopener");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
  });

  it("an unknown code says the list is not there; a failed read offers a retry", async () => {
    const missing = render(<MemoryRouter><GiftGuideSharedList code="zzzzzzzzzzzz" read={async () => null} /></MemoryRouter>);
    await waitFor(() => expect(missing.container.querySelector("[data-gift-shared-missing]")?.textContent).toBe(WISH.sharedMissing));
    cleanup();
    let n = 0;
    const read = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("offline");
      return { name: "L", items: [] };
    });
    const failing = render(<MemoryRouter><GiftGuideSharedList code="zzzzzzzzzzzz" read={read} /></MemoryRouter>);
    await waitFor(() => expect(failing.container.querySelector("[data-gift-shared-failed]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: WISH.retry }));
    await waitFor(() => expect(failing.container.querySelector("[data-gift-shared-empty]")).not.toBeNull());
  });

  it("holiday audit C9: an unnamed or default-named list reads A wish list for you; a missing one, List not found", async () => {
    const missing = render(<MemoryRouter><GiftGuideSharedList code="zzzzzzzzzzzz" read={async () => null} /></MemoryRouter>);
    await waitFor(() => expect(missing.container.querySelector("[data-gift-shared-missing]")).not.toBeNull());
    expect(missing.container.querySelector("[data-gift-shared-title]")?.textContent).toBe("List not found");
    cleanup();
    for (const name of ["", "My Wish List", "  "]) {
      const view = render(<MemoryRouter><GiftGuideSharedList code="abc123defghi" read={async () => ({ name, items: [] })} /></MemoryRouter>);
      await waitFor(() => expect(view.container.querySelector("[data-gift-shared-empty]")).not.toBeNull());
      expect(view.container.querySelector("[data-gift-shared-title]")?.textContent).toBe("A wish list for you");
      expect(document.title).toBe(`${WISH.sharedLead} — Louisiana Helpr`);
      cleanup();
    }
  });
});

describe("how-to hints dismiss and stay dismissed", () => {
  // Owner 11-20 12:30 PM ("very busy and not well organized"): the landing has no how-to box and no tip boxes.
  it("the landing carries no how-to strip and no tip box", () => {
    const view = renderAt("/gift-guides");
    expect(view.container.querySelector("[data-gift-hint='how-to'], [data-gift-hint='quiz'], [data-gift-hint='fun-gotd'], .gg-hint")).toBeNull();
  });

  it("the budget and share hints show once and close", async () => {
    const banded = pickedGuides.find((g) => g.picks.filter((p) => p.band !== undefined).length >= 3)!;
    const guide = renderAt(`/gift-guides/${banded.slug}`);
    expect(guide.container.querySelector("[data-gift-hint='budget']")?.textContent).toContain(HINTS.budget);
    cleanup();
    addToWishList({ href: pickedGuides[0].picks[0].href, name: "n", guide: pickedGuides[0].slug });
    const mine = (await renderMine("/gift-guides/my-list"));
    expect(mine.container.querySelector("[data-gift-hint='share']")?.textContent).toContain(HINTS.share);
  });

  it("the first heart that saves shows 'Saved to your wish list' once, with the way to the list", () => {
    vi.useFakeTimers();
    try {
      const g = pickedGuides[0];
      const view = renderAt(`/gift-guides/${g.slug}`);
      expect(document.body.querySelector("[data-gift-hint='first-heart']")).toBeNull();
      tapHeart(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
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
});

describe("security review 2026-11-20 (findings 2, 3, 6) and the UX audit fixes", () => {
  const g = () => pickedGuides[0];
  const pick = (k: number) => ({ href: g().picks[k].href, name: g().picks[k].name, guide: g().slug });
  const id = (k: number) => itemId(g().picks[k].href);

  it("#2: a list saved under one account is cleared on sign-out, and never merged into another account", async () => {
    addToWishList(pick(0));
    reconcileWithAccount("acct-a", null);
    expect(giftListNow().owner).toBe("acct-a");
    // Another account signs in on the same device: A's gifts are dropped, B gets only its own list.
    reconcileWithAccount("acct-b", { name: "B list", items: [{ g: g().slug, i: id(1) }] });
    expect(giftListNow().picks.map((p) => p.id)).toEqual([id(1)]);
    expect(giftListNow().name).toBe("B list");
    // Signed out on the next visit: the account's list does not stay on the device.
    (await renderMine("/gift-guides/my-list"));
    await waitFor(() => expect(giftListNow().picks).toEqual([]));
    expect(giftListNow().owner).toBeNull();
  });

  it("#2: a guest list is folded into the account that signs in (and stays when nobody is signed in)", async () => {
    addToWishList(pick(0));
    (await renderMine("/gift-guides/my-list"));
    expect(giftListNow().picks.length).toBe(1);
    reconcileWithAccount("acct-a", { name: "My Wish List", items: [{ g: g().slug, i: id(1) }] });
    expect(giftListNow().picks.map((p) => p.id)).toEqual([id(0), id(1)]);
  });

  it("#3: after a sync, a gift removed on another device stays removed; changes made here still apply", () => {
    addToWishList(pick(0));
    addToWishList(pick(1));
    reconcileWithAccount("acct-a", null);
    markSynced("acct-a");
    // Here: gift 2 added, gift 1 removed. Elsewhere: gift 0 removed.
    addToWishList(pick(2));
    removeFromWishList(id(1));
    reconcileWithAccount("acct-a", { name: "My Wish List", items: [{ g: g().slug, i: id(1) }] });
    expect(giftListNow().picks.map((p) => p.id)).toEqual([id(2)]);
  });

  it("#6: a share never sends more than 100 refs, and a name is cut by character, never inside an emoji", () => {
    // A list saved before the 100 cap (11-18 lists had none) can hold more: a share still sends at most 100.
    const old = Array.from({ length: 120 }, (_, k) => ({ href: `https://www.amazon.com/dp/X${k}?tag=louisianahelpr-20`, name: `x${k}`, guide: "her" }));
    window.localStorage.setItem("lh-gift-list", JSON.stringify({ guides: [], picks: old }));
    resetGiftListForTests();
    expect(giftListNow().picks.length).toBe(120);
    expect(listRefs(giftListNow()).length).toBe(100);
    const long = "🎄".repeat(70);
    expect(Array.from(cleanListName(long)).length).toBe(60);
    expect(cleanListName(long)).toBe("🎄".repeat(60));
    expect(cleanListName("Mom\u202e\u200b's list")).toBe("Mom's list");
    setListName("🎁".repeat(61));
    expect(giftListNow().name).toBe("🎁".repeat(60));
  });

  it("M2: the 101st heart says the list is full", () => {
    for (let k = 0; k < 100; k++) addToWishList({ href: `https://www.amazon.com/dp/Y${k}?tag=louisianahelpr-20`, name: `y${k}`, guide: "her" });
    expect(togglePick(pick(0))).toBe("full");
    const view = renderAt(`/gift-guides/${g().slug}`);
    tapHeart(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
    expect(document.body.querySelector("[data-gift-hint='list-full']")?.textContent).toContain(WISH.listFull);
  });

  it("M3: the heart stays in place (so focus does) and the removal is read out", async () => {
    addToWishList(pick(0));
    addToWishList(pick(1));
    const view = (await renderMine("/gift-guides/my-list"));
    const first = view.container.querySelectorAll<HTMLButtonElement>("[data-gift-wish-remove]")[0];
    first.focus();
    fireEvent.click(first);
    expect(document.activeElement?.getAttribute("data-gift-wish-remove")).toBe(id(0));
    expect(view.container.querySelector("[data-gift-wish-announce]")?.textContent).toBe(WISH.removed(g().picks[0].name));
  });

  it("M4 + L5: the list's name is the big title; an empty list has no name field", async () => {
    expect((await renderMine("/gift-guides/my-list")).container.querySelector("[data-gift-wish-name-input]")).toBeNull();
    cleanup();
    addToWishList(pick(0));
    const view = (await renderMine("/gift-guides/my-list"));
    expect(view.container.querySelector("h2#gift-my-list")?.className).toContain("gg-wish-title");
    expect(view.container.querySelector("[data-gift-wish-name-input]")).not.toBeNull();
  });

  it("M7: gifts the guides no longer carry are counted on a shared list, never silently dropped", async () => {
    getSharedList.mockResolvedValue({ name: "L", items: [{ g: g().slug, i: id(0) }, { g: "her", i: "gone00" }, { g: "her", i: "gone01" }] });
    const view = renderAt("/gift-guides/list/abc123defghi");
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-missing]")?.textContent).toBe(WISH.missing(2)));
    // The sender's name is the title, under a line that says it is someone's own list (security review #4).
    expect(view.container.querySelector("[data-gift-shared-lead]")?.textContent).toBe(WISH.sharedLead);
    expect(document.title).toBe("L — Louisiana Helpr");
  });

  it("M6 + L2 + L6: a business shows its town, a deal's name never repeats its brand, a business with no link can be saved", async () => {
    expect(dealName({ brand: "ELEMIS", item: "ELEMIS Pro-Collagen Cleansing Balm", deal: "x" } as Deal)).toBe("ELEMIS Pro-Collagen Cleansing Balm");
    expect(dealName({ brand: "Yoto", item: "Mini player", deal: "x" } as Deal)).toBe("Yoto: Mini player");
    const b = (smallBiz as SmallBiz[]).find((x) => x.href && x.town)!;
    addToWishList({ href: b.href!, name: b.name, guide: SMALL_BIZ_SLUG, id: bizItemId(b) });
    const noLink = (smallBiz as SmallBiz[]).find((x) => !x.href);
    if (noLink) addToWishList({ href: "", name: noLink.name, guide: SMALL_BIZ_SLUG, id: bizItemId(noLink) });
    const view = (await renderMine("/gift-guides/my-list"));
    const row = await waitFor(() => {
      const r = view.container.querySelector(`[data-gift-wish-item="${bizItemId(b)}"]`);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.querySelector(".gg-nm-meta")?.textContent).toBe(b.town);
    if (noLink) {
      const r2 = await waitFor(() => {
        const r = view.container.querySelector(`[data-gift-wish-item="${bizItemId(noLink)}"]`);
        expect(r).not.toBeNull();
        return r!;
      });
      expect(r2.querySelector("a")).toBeNull();
    }
  });

  it("H1 + L1 + L8: the heart's note stays one tidy line, hearts follow the theme", () => {
    expect(GIFT_WISH_CSS).toMatch(/\.gg-toast-text\{flex:1 1 auto;min-width:0/);
    expect(GIFT_WISH_CSS).toMatch(/\.gg-toast\{[^}]*width:max-content;max-width:min\(calc\(100vw - 32px\),30rem\)/);
    expect(GIFT_WISH_CSS).not.toMatch(/gg-heart-sb\{[^}]*background:#fff/);
  });

  it("L7: a heart tap is counted (gift_wish_heart)", () => {
    const view = renderAt(`/gift-guides/${g().slug}`);
    tapHeart(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
    expect(track).toHaveBeenCalledWith("gift_wish_heart", { result: "added" });
  });

  it("verify H1: on a narrow screen (320) the note uses its short words, one line", () => {
    // jsdom has no layout: the rule that applies at 320 is asserted, and both word sets are in the note.
    // Holiday audit 1121 (#12): the short words only at 340 and under (375 and desktop read the same).
    expect(GIFT_WISH_CSS).toMatch(/@media \(max-width:340px\)\{\.gg-toast \.gg-toast-long\{display:none\}\.gg-toast \.gg-toast-short\{display:inline\}\}/);
    expect(HINTS.seeList).toBe(HINTS.seeListShort);
    expect(GIFT_WISH_CSS).toMatch(/\.gg-toast-text,\.gg-toast-link\{white-space:nowrap\}/);
    const view = renderAt(`/gift-guides/${g().slug}`);
    tapHeart(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
    const note = document.body.querySelector("[data-gift-hint='first-heart']")!;
    expect(note.querySelector(".gg-toast-short")?.textContent).toBe(HINTS.firstHeartShort);
    expect(note.querySelector(".gg-toast-link .gg-toast-short")?.textContent).toContain(HINTS.seeListShort);
    expect((HINTS.firstHeartShort + HINTS.seeListShort).length).toBeLessThan(20);
  });

  it("verify L: a name with a link (even a bare domain) or a phone number is flagged and never kept", async () => {
    for (const bad of ["Win at evil.com", "see www.x.org", "evil.co/x", "Call 337-555-1234"]) expect(giftNameProblem(bad), bad).not.toBeNull();
    for (const ok of ["Mom's Christmas List 2026", "St. Mary's list. Thanks!", "Lexi's list"]) expect(giftNameProblem(ok), ok).toBeNull();
    addToWishList(pick(0));
    setListName("Mom's list");
    const view = (await renderMine("/gift-guides/my-list"));
    const input = view.container.querySelector<HTMLInputElement>("[data-gift-wish-name-input]")!;
    fireEvent.change(input, { target: { value: "Win at evil.com" } });
    expect(view.container.querySelector("[data-gift-wish-name-problem]")?.textContent).toBe(WISH.nameProblem);
    expect(giftListNow().name).toBe("Mom's list");
    fireEvent.change(input, { target: { value: "Mom's big list" } });
    expect(view.container.querySelector("[data-gift-wish-name-problem]")).toBeNull();
    expect(giftListNow().name).toBe("Mom's big list");
  });

  it("verify L: a signed-in member who only opens a guide saves no empty list; a refused save is shown, not 'Saved'", async () => {
    auth.user = { id: "acct-z" };
    getMyWishList.mockResolvedValue(null);
    renderAt("/gift-guides");
    await waitFor(() => expect(getMyWishList).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(saveWishList).not.toHaveBeenCalled();
    cleanup();
    saveWishList.mockRejectedValueOnce(Object.assign(new Error("invalid_name"), { copy: GIFT_WISH_RPC_ERROR_COPY.gift_wish_list_save.invalid_name }));
    addToWishList(pick(0));
    const view = (await renderMine("/gift-guides/my-list"));
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-sync-problem]")?.textContent).toBe(GIFT_WISH_RPC_ERROR_COPY.gift_wish_list_save.invalid_name));
    expect(view.container.querySelector("[data-gift-wish-where]")).toBeNull();
  });

  it("L3: the share text is a sentence, never the list name twice", () => {
    expect(WISH.shareMessage).not.toMatch(/My Wish List/);
    clearWishList();
    expect(giftListNow().picks).toEqual([]);
  });
});
