/**
 * Save for someone, My lists and sharing every list (owner 2026-11-21: "they should also be able to save items per
 * person, like add a list or something, and it shows the total amount they have added, and they can add/remove stuff
 * as they are browsing the guides"; "they should also be able to share all lists").
 *   - A guide card's heart opens the picker: "Me" (My Wish List, as before) and each planner person with their total;
 *     a tap adds the gift to that person's list (name, photo, shown price, link, guide) and a second tap takes it off.
 *   - "Add a person" (a name, an optional budget) adds someone and saves the gift for them.
 *   - The heart is filled while the gift is on anyone's list; the My lists pill shows the total across lists and its
 *     panel each list, its total, its budget and remove buttons; the gift planner shows the same gifts.
 *   - Sharing: a list (or every list) goes to gift_wish_lists_share as names + refs only (no budget, price or Bought
 *     mark; typed ideas stay private); a shared page shows each person's list with its total; an old single wish list
 *     link still opens as before.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const saved = isSaved(wish, itemId(pick.href)) \|\| onAnyList(plan, pick.href); |   const saved = isSaved(wish, itemId(pick.href));
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | onToggle={() => { if (!requestSaveFor(saveItemOf(pick, guide))) heartTapped( | onToggle={() => { if (true) heartTapped(
 * @mutate src/pages/info/giftGuides/saveForPeople.ts |   if (have) {\n    planActions.removeIdea(personId, have.id);\n    return "removed";\n  } |   if (have) {\n    return "removed";\n  }
 * @mutate src/pages/info/giftGuides/saveForPeople.ts |   amount: Math.round(p.ideas.reduce((t, i) => t + (i.price ?? 0), 0) * 100) / 100, |   amount: 0,
 * @mutate src/pages/info/giftGuides/saveForPeople.ts | (i): ShareRef[] => (i.guide && i.href ? [{ g: i.guide, i: itemId(i.href) }] | (i): ShareRef[] => (i.href ? [{ g: i.guide ?? "", i: itemId(i.href) }]
 * @mutate src/pages/info/giftGuides/saveForPeople.ts | export const saveItemOf = (p: CatalogPick, guide?: string): SaveItem => {\n  const price = plannerPrice(p); | export const saveItemOf = (p: CatalogPick, guide?: string): SaveItem => {\n  const price = undefined;
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |     if (b !== undefined) planActions.setBudget(id, b); |     void b;
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |   const ready = isReady && (!user \|\| sync !== "device"); |   const ready = isReady;
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx |       ) : many ? ( |       ) : false ? (
 * @mutate src/lib/giftWishListApi.ts |     ? raw.flatMap((l): SharedPersonList[] => { |     ? [].flatMap((l): SharedPersonList[] => {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));
const loadAccountPlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(),
  setSecretSantaWishList: vi.fn(),
  createSecretSanta: vi.fn(),
  SantaSaveError: class extends Error {},
  loadAccountPlan: (...a: unknown[]) => loadAccountPlan(...a),
  saveAccountPlan: vi.fn(async () => undefined),
}));
const shareGiftLists = vi.hoisted(() => vi.fn(async (_l: unknown) => "abcdef123456"));
const getSharedList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  // A share now keeps a token to stop its link (wishListDelete1121.test.tsx); here it never reaches a server.
  claimShare: vi.fn(async () => undefined),
  shareGiftLists: (l: unknown) => shareGiftLists(l),
  getSharedList: (c: string) => getSharedList(c),
  getMyWishList: vi.fn(async () => null),
  saveWishList: vi.fn(async () => "abcdef123456"),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { cleanPlan } from "@/content/giftGuideFun1120";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { giftListNow, itemId, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetFirstHeartForTests } from "@/pages/info/giftGuides/GiftGuideHints";
import { shareListOf } from "@/pages/info/giftGuides/saveForPeople";
import { asSharedList } from "@/lib/giftWishListApi";
import { shownDollars } from "@/lib/pickPriceShown.mjs";

const HER = JSON.parse(readFileSync(join(process.cwd(), "src/content/giftGuidePicks/her.json"), "utf8")) as { picks: { priceAt?: string }[] };
const CHECK_DAY = HER.picks.find((p) => p.priceAt)?.priceAt ?? "2026-11-21";

await loadAllGuidePicks();

const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      <Route path="/gift-guides/planner" element={<GiftPlanner />} />
    </Routes>
  </MemoryRouter>,
);
const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);
const picker = () => document.querySelector<HTMLElement>("[data-savefor-picker]");
/** The picker's chunk loads after the guide draws (off the critical path); a heart before that saves to My Wish List. */
const pickerLoaded = () => waitFor(() => expect(document.querySelector("[data-savefor-ready]")).not.toBeNull());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${CHECK_DAY}T18:00:00Z`));
  window.localStorage.clear();
  resetPlanStoreForTests();
  resetGiftListForTests();
  resetHintsForTests();
  resetFirstHeartForTests();
  auth.user = null;
  shareGiftLists.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("save for someone from a guide", () => {
  it("the heart opens the picker; a person tap adds (name, photo, price, link), a second tap removes; totals and the heart follow", async () => {
    setPlanViewer(null);
    const mom = planActions.addPerson("Mom")!;
    planActions.setBudget(mom, 75);
    const her = guideBySlug("her")!.picks;
    // Inventory floor: For Her holds 36 picks today.
    expect(her.length).toBeGreaterThan(20);
    const view = renderAt("/gift-guides/her");
    await pickerLoaded();
    const heart = view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!;
    expect(heart.getAttribute("aria-label")).toBe(`Save ${her[0].name} for someone`);
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heart);
    const sheet = picker()!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector("[data-savefor-gift]")!.textContent).toBe(her[0].name);
    expect(sheet.querySelector("[data-savefor-me]")).not.toBeNull();
    const row = await waitFor(() => {
      const r = sheet.querySelector<HTMLButtonElement>(`[data-savefor-person="${mom}"]`)!;
      expect(r.disabled).toBe(false);
      return r;
    });
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(sheet.querySelector(`[data-savefor-total="${mom}"]`)!.textContent).toBe("0 gifts · $75 left");

    fireEvent.click(row);
    const idea = stored().people[0].ideas[0];
    // Holiday audit 1121: the list adds the price the card shows, rounded the same way (~$5 adds $5).
    expect(idea).toMatchObject({ name: her[0].name, href: her[0].href, price: shownDollars(her[0].price), image: her[0].image, guide: "her", bought: false });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    // Owner 11-21: the row also says where Mom's $75 budget stands (saveForManage1121.test.tsx has the exact words).
    expect(sheet.querySelector(`[data-savefor-total="${mom}"]`)!.textContent).toMatch(new RegExp(`^1 gift · \\$${shownDollars(her[0].price)} · \\$[0-9.,]+ (left|over)$`));
    // Not on My Wish List: saving for Mom never touches the wish list.
    expect(giftListNow().picks).toHaveLength(0);
    // The heart is filled while the gift is on anyone's list.
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    // The My lists pill shows the total.
    const pill = document.querySelector<HTMLButtonElement>("[data-mylists-pill]")!;
    expect(pill.querySelector("[data-mylists-pill-total]")!.textContent).toBe(`1 gift · $${shownDollars(her[0].price)}`);

    // A second tap takes it off.
    fireEvent.click(row);
    expect(stored().people[0].ideas).toHaveLength(0);
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-mylists-pill]")).toBeNull();
  });

  it("Add a person adds someone with a budget and saves the gift for them; the panel shows the list, total, budget and remove", async () => {
    setPlanViewer(null);
    const view = renderAt("/gift-guides/her");
    await pickerLoaded();
    const her = guideBySlug("her")!.picks;
    const hearts = view.container.querySelectorAll<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]");
    fireEvent.click(hearts[0]);
    fireEvent.click(await waitFor(() => {
      const b = picker()!.querySelector<HTMLButtonElement>("[data-savefor-add]")!;
      expect(b.disabled).toBe(false);
      return b;
    }));
    fireEvent.change(picker()!.querySelector("[data-savefor-name]")!, { target: { value: "Aunt Claire" } });
    fireEvent.change(picker()!.querySelector("[data-savefor-budget]")!, { target: { value: "50" } });
    fireEvent.click(picker()!.querySelector("[data-savefor-add-submit]")!);
    const p = stored().people[0];
    expect(p).toMatchObject({ name: "Aunt Claire", budget: 50 });
    expect(p.ideas.map((i) => i.href)).toEqual([her[0].href]);
    // A second gift for her, from another card.
    fireEvent.click(picker()!.querySelector("[data-savefor-done]")!);
    fireEvent.click(hearts[1]);
    fireEvent.click(picker()!.querySelector(`[data-savefor-person="${p.id}"]`)!);
    fireEvent.click(picker()!.querySelector("[data-savefor-done]")!);
    const total = shownDollars(her[0].price) + shownDollars(her[1].price);
    const money = `$${Number.isInteger(total) ? total : total.toFixed(2)}`;

    fireEvent.click(document.querySelector("[data-mylists-pill]")!);
    const panel = document.querySelector<HTMLElement>("[data-mylists-panel]")!;
    expect(panel.querySelector(`[data-mylists-total="${p.id}"]`)!.textContent).toMatch(new RegExp(`^2 gifts · \\$${money.replace("$", "")} · \\$[0-9.,]+ (left|over)$`));
    expect(panel.querySelectorAll(`[data-mylists-person="${p.id}"] [data-mylists-item]`)).toHaveLength(2);
    expect(within(panel).getByText("Open planner ›").getAttribute("href")).toBe("/gift-guides/planner");
    // Remove one from the panel.
    fireEvent.click(panel.querySelector<HTMLButtonElement>("[data-mylists-remove]")!);
    expect(stored().people[0].ideas.map((i) => i.href)).toEqual([her[1].href]);
  });

  it("Me still saves to My Wish List (the heart's old job), so wish list links keep working", async () => {
    setPlanViewer(null);
    const view = renderAt("/gift-guides/her");
    await pickerLoaded();
    const her = guideBySlug("her")!.picks;
    fireEvent.click(view.container.querySelector("[data-gift-pick] [data-gift-heart]")!);
    fireEvent.click(picker()!.querySelector("[data-savefor-me]")!);
    expect(giftListNow().picks.map((p) => p.href)).toEqual([her[0].href]);
    expect(stored().people).toHaveLength(0);
  });

  it("signed in, nothing is saved for a person before the account's planner is loaded", async () => {
    auth.user = { id: "u1" };
    let release: (v: null) => void = () => {};
    loadAccountPlan.mockImplementation(() => new Promise((r) => { release = r; }));
    const view = renderAt("/gift-guides/her");
    await pickerLoaded();
    fireEvent.click(view.container.querySelector("[data-gift-pick] [data-gift-heart]")!);
    expect(picker()!.querySelector<HTMLButtonElement>("[data-savefor-add]")!.disabled).toBe(true);
    release(null);
    await waitFor(() => expect(picker()!.querySelector<HTMLButtonElement>("[data-savefor-add]")!.disabled).toBe(false));
  });
});

describe("the planner shows the same lists, and every list can be shared", () => {
  it("a gift saved from a guide shows in the planner with its photo and Shop; Share all sends names + refs only", async () => {
    setPlanViewer(null);
    const her = guideBySlug("her")!.picks;
    const kids = guideBySlug("kids")!.picks;
    const mom = planActions.addPerson("Mom")!;
    planActions.setBudget(mom, 75);
    planActions.addIdea(mom, { name: her[0].name, href: her[0].href, guide: "her", price: her[0].price, image: her[0].image });
    planActions.addIdea(mom, { name: "Typed idea", price: 10 });
    // A linked idea with no guide (an old wish list save) has no ref: it stays private too.
    planActions.addIdea(mom, { name: "Linked idea", href: "https://www.example.com/x" });
    planActions.setIdea(mom, stored().people[0].ideas[0].id, { bought: true });
    const jake = planActions.addPerson("Jake")!;
    planActions.addIdea(jake, { name: kids[0].name, href: kids[0].href, guide: "kids", image: kids[0].image });

    const view = renderAt("/gift-guides/planner");
    const li = view.container.querySelector<HTMLElement>(`[data-plan-idea="${stored().people[0].ideas[0].id}"]`)!;
    expect(li.querySelector("img")?.getAttribute("src")).toBe(her[0].image);
    expect(li.querySelector("[data-plan-shop]")!.closest("a")!.getAttribute("href")).toBe(her[0].href);

    const all = view.container.querySelector<HTMLElement>("[data-share-all-lists]")!;
    expect(all.textContent).toContain("2 gifts you typed in stay private");
    fireEvent.click(within(all).getByText("Share all my lists"));
    await waitFor(() => expect(shareGiftLists).toHaveBeenCalledTimes(1));
    const sent = shareGiftLists.mock.calls[0][0] as { n: string; items: { g: string; i: string }[] }[];
    expect(sent).toEqual([
      { n: "Mom", items: [{ g: "her", i: itemId(her[0].href) }] },
      { n: "Jake", items: [{ g: "kids", i: itemId(kids[0].href) }] },
    ]);
    // Never a budget, a price or a Bought mark.
    expect(JSON.stringify(sent)).not.toMatch(/budget|price|bought|75/);
    expect(shareListOf(stored().people[0])).toEqual(sent[0]);
  });

  it("a shared lists link shows each person's list with its total; an old single wish list link still opens as before", async () => {
    const her = guideBySlug("her")!.picks;
    const read = vi.fn(async (code: string) => code === "aaaaaaaaaaaa"
      ? { name: "Gift lists", items: [], lists: [{ name: "Mom", items: [{ g: "her", i: itemId(her[0].href) }, { g: "her", i: itemId(her[1].href) }] }, { name: "Jake", items: [{ g: "her", i: itemId(her[2].href) }] }] }
      : { name: "Lexi's list", items: [{ g: "her", i: itemId(her[0].href) }] });
    const many = render(<MemoryRouter><GiftGuideSharedList code="aaaaaaaaaaaa" read={read} /></MemoryRouter>);
    await waitFor(() => expect(many.container.querySelectorAll("[data-gift-shared-person]")).toHaveLength(2));
    expect(many.container.querySelector("[data-gift-shared-title]")!.textContent).toBe("Gift lists");
    const mom = many.container.querySelector<HTMLElement>('[data-gift-shared-person="Mom"]')!;
    await waitFor(() => expect(mom.querySelectorAll("[data-gift-wish-item]")).toHaveLength(2));
    const sum = Math.round(her[0].price! + her[1].price!);
    expect(mom.querySelector("[data-gift-shared-person-total]")!.textContent).toBe(`2 gifts · about $${sum}`);
    expect(mom.querySelector("a.gg-item")!.getAttribute("href")).toBe(`https://${her[0].href.replace(/^https:\/\//, "")}`);
    cleanup();
    // The server's answer is read into lists (names + refs only); an old answer has none.
    expect(asSharedList({ name: "Gift lists", items: [], lists: [{ n: "Mom", items: [{ g: "her", i: "abc1", x: 1 }, { g: "her", i: "BAD!" }] }, { n: 5, items: [] }] }))
      .toEqual({ name: "Gift lists", items: [], lists: [{ name: "Mom", items: [{ g: "her", i: "abc1", x: 1 }] }] });
    expect(asSharedList({ name: "Lexi's list", items: [{ g: "her", i: "abc1" }] })).toEqual({ name: "Lexi's list", items: [{ g: "her", i: "abc1" }] });
    const one = render(<MemoryRouter><GiftGuideSharedList code="bbbbbbbbbbbb" read={read} /></MemoryRouter>);
    await waitFor(() => expect(one.container.querySelectorAll("[data-gift-wish-item]")).toHaveLength(1));
    expect(one.container.querySelector("[data-gift-shared-title]")!.textContent).toBe("Lexi's list");
    expect(one.container.querySelector("[data-gift-shared-person]")).toBeNull();
  });
});
