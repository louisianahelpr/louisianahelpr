/**
 * Holiday audit 1121, gift lists area (Audit-Holiday-wishlist-planner-1121.json), Mediums #5 to #9:
 *   #5: a saved deal (the deals carry no price) counted as a gift while every total quietly left it out. Totals now say
 *       "+ 1 with no price", and a list row with a store link but no price says "Price at store".
 *   #6: the shared list told the viewer to "Tap Shop", but its gifts have no Shop button (the photo and name are the
 *       link, owner 11-21). The intro names a Shop control only when the page has one.
 *   #7: tapping "Me" in the Save for someone sheet showed the wish list note at the bottom edge, over the sheet's Done
 *       button. The sheet's own check mark says it was saved; the note stays for a plain heart tap.
 *   #9: the planner's x beside the budget box removed the whole person at once, with no Undo; a gift x too. Now the
 *       person's remove is a labelled link under their list, away from the budget, and both removals say
 *       "Removed <name>" with Undo, which puts them back where they were.
 *   #8: the guides' My lists line counted what was ADDED against the budget ("$27 left") while the planner's bar under it
 *       said "$40 left", counting only what was BOUGHT. Now "left"/"over" are the list line's on both screens, the line
 *       adds "· $12 bought" once something is bought, and the planner's bar says "Bought $12" only.
 *
 * @mutate src/pages/info/giftGuides/ManageList.tsx | t.amount > 0 ? dollars(t.amount) : null, t.unpriced) | t.amount > 0 ? dollars(t.amount) : null)
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx | summary(total.gifts, total.amount, total.unpriced) | summary(total.gifts, total.amount, 0)
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx | amount > 0 ? dollars(amount) : null, unpriced) | amount > 0 ? dollars(amount) : null)
 * @mutate src/pages/info/giftGuides/ManageList.tsx |                 : i.href && <span | : false && <span
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx |             : item.out === "affiliate" && <> | : false && <>
 * @mutate src/pages/info/giftGuides/ManageList.tsx |       {t.bought > 0 && <> | {false && <>
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |         <span>{W.plannerBoughtAmount(dollars(m.spent))}</span> | <span>{dollars(m.spent)} of {dollars(m.budget)} · {dollars(m.left)} left</span>
 * @mutate src/content/giftWishList.ts |   sharedIntro: "Tap a gift to see it at the store. | sharedIntro: "Tap Shop to buy any gift.
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |     heartTapped(r, true); |     heartTapped(r);
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |     successToast(WISH.removedGift(p.name), { action: { label: WISH.undo, onClick: () => A.restorePerson(p, index) } }); |     void index;
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |     successToast(WISH.removedGift(idea.name), { action: { label: WISH.undo, onClick: () => A.restoreIdea(p.id, idea, at) } }); |     void at;
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |     write({ ...cur, people: [...cur.people.slice(0, at), person, ...cur.people.slice(at)] }); |     write({ ...cur, people: [...cur.people, person] });
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |           onChange={(e) => typeBudget(e.target.value)} data-plan-budget={p.id} />\n      </div> |           onChange={(e) => typeBudget(e.target.value)} data-plan-budget={p.id} />\n        <button type="button" onClick={removePerson} data-plan-remove={p.id}>x</button>\n      </div>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(),
  setSecretSantaWishList: vi.fn(),
  createSecretSanta: vi.fn(),
  SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(async () => null),
  saveAccountPlan: vi.fn(async () => undefined),
}));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  claimShare: vi.fn(async () => undefined),
  shareGiftLists: vi.fn(async () => "abcdef123456"),
  getSharedList: vi.fn(async () => null),
  getMyWishList: vi.fn(async () => null),
  saveWishList: vi.fn(async () => "abcdef123456"),
}));
type ToastAction = { label: string; onClick: () => void };
const toasts = vi.hoisted(() => [] as { message: string; action?: ToastAction }[]);
vi.mock("@/lib/toast", async (orig) => ({
  ...(await orig<typeof import("@/lib/toast")>()),
  successToast: (message: string, o: { action?: ToastAction } = {}) => {
    toasts.push({ message, action: o.action });
    return 1;
  },
}));

import GiftGuides from "@/pages/info/GiftGuides";
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { cleanPlan } from "@/content/giftGuideFun1120";
import { WISH } from "@/content/giftWishList";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { giftListNow, itemId, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetFirstHeartForTests } from "@/pages/info/giftGuides/GiftGuideHints";

const HER = JSON.parse(readFileSync(join(process.cwd(), "src/content/giftGuidePicks/her.json"), "utf8")) as { picks: { priceAt?: string }[] };
const CHECK_DAY = HER.picks.find((p) => p.priceAt)?.priceAt ?? "2026-11-21";

await loadAllGuidePicks();

const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${CHECK_DAY}T18:00:00Z`));
  window.localStorage.clear();
  resetPlanStoreForTests();
  resetGiftListForTests();
  resetHintsForTests();
  resetFirstHeartForTests();
  toasts.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DEAL = "https://go.shopmy.us/p-107884964";
/** Mom: a $12 mug and a saved deal (no price), budget $40. */
function momWithADeal() {
  setPlanViewer(null);
  const mom = planActions.addPerson("Mom")!;
  planActions.setBudget(mom, 40);
  const mug = planActions.addIdea(mom, { name: "Mug", href: "https://www.etsy.com/listing/1", price: 12 })!;
  planActions.addIdea(mom, { name: "BaubleBar Pisa Custom Bracelet", href: DEAL, guide: "deals" });
  return { mom, mug };
}

describe("holiday audit 1121: gift lists Mediums", () => {
  it("#5: a gift with no price is named in every total and its row says Price at store", async () => {
    const { mom } = momWithADeal();
    const view = render(
      <MemoryRouter initialEntries={["/gift-guides/her"]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector("[data-savefor-ready]")).not.toBeNull());
    const pill = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>("[data-mylists-pill]");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(pill.querySelector("[data-mylists-pill-total]")!.textContent).toBe("2 gifts · $12 + 1 with no price");
    fireEvent.click(pill);
    const panel = document.querySelector<HTMLElement>("[data-mylists-panel]")!;
    expect(panel.querySelector(`[data-mylists-total="${mom}"]`)!.textContent).toBe("2 gifts · $12 + 1 with no price · $28 left");
    const deal = stored().people[0].ideas[1];
    expect(panel.querySelector(`[data-list-no-price="${deal.id}"]`)!.textContent).toBe("Price at store");
    // A priced gift shows its price, never "Price at store".
    expect(panel.querySelectorAll("[data-list-no-price]")).toHaveLength(1);
    view.unmount();

    // A shared list: the guide pick's price, plus the gift from another store, named.
    const her = guideBySlug("her")!.picks;
    const priced = her.find((x) => x.price !== undefined)!;
    const read = vi.fn(async () => ({ name: "Gift lists", items: [], lists: [
      { name: "Mom", items: [{ g: "her", i: itemId(priced.href) }], any: [{ id: "11111111-2222-4333-8444-555555555555", name: "Scarf", href: "https://ours.example.com/scarf?aff=lh" }] },
      { name: "Dad", items: [{ g: "her", i: itemId(priced.href) }] },
    ] }));
    const shared = render(<MemoryRouter><GiftGuideSharedList code="dddddddddddd" read={read} /></MemoryRouter>);
    const momList = await waitFor(() => {
      const m = shared.container.querySelector<HTMLElement>('[data-gift-shared-person="Mom"]');
      expect(m?.querySelectorAll("[data-gift-wish-item]")).toHaveLength(2);
      return m!;
    });
    await waitFor(() => expect(momList.querySelector("[data-gift-shared-person-total]")!.textContent).toBe(`2 gifts · about $${Math.round(priced.price!)} + 1 with no price`));
    expect(shared.container.querySelector('[data-gift-shared-person="Dad"] [data-gift-shared-person-total]')!.textContent).toBe(`1 gift · about $${Math.round(priced.price!)}`);
    // The gift from another store says where its price is; the guide pick shows its own.
    expect(momList.querySelectorAll("[data-gift-wish-no-price]")).toHaveLength(1);
    expect(momList.querySelector("[data-gift-wish-no-price]")!.closest("[data-gift-wish-item]")!.textContent).toContain("Scarf");
  });

  it("#8: the list line and the planner's bar agree: left/over counts what was added, Bought says what was bought", async () => {
    const { mom, mug } = momWithADeal();
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    const c = view.container;
    const line = () => c.querySelector(`[data-plan-list-line="${mom}"]`)!.textContent;
    const bar = () => c.querySelector(`[data-plan-money="${mom}"]`)!.textContent;
    await waitFor(() => expect(line()).toBe("2 gifts · $12 + 1 with no price · $28 left"));
    // The bar's words never carry a second "left" or "over".
    expect(bar()).toBe("Bought $0");
    fireEvent.click(c.querySelector(`[data-plan-bought="${mug}"]`)!);
    await waitFor(() => expect(line()).toBe("2 gifts · $12 + 1 with no price · $28 left · $12 bought"));
    expect(bar()).toBe("Bought $12");
    expect(bar()).not.toMatch(/left|over/);
  });

  it("#6: the shared list's intro names a Shop control only when the page has one", async () => {
    const her = guideBySlug("her")!.picks;
    // Inventory floor: For Her holds 36 picks today.
    expect(her.length).toBeGreaterThan(20);
    const read = vi.fn(async () => ({ name: "Lexi's list", items: her.slice(0, 3).map((p) => ({ g: "her", i: itemId(p.href) })) }));
    const view = render(<MemoryRouter><GiftGuideSharedList code="cccccccccccc" read={read} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelectorAll("[data-gift-wish-item]")).toHaveLength(3));
    const controls = [...view.container.querySelectorAll("a, button")].map((e) => (e.textContent ?? "").trim());
    const hasShop = controls.some((t) => /^Shop\b/.test(t));
    const intro = view.container.querySelector(".gg-price-note")!.textContent!;
    expect(intro).toBe(WISH.sharedIntro);
    expect(/\bShop\b/.test(intro)).toBe(hasShop);
    // Today the photo and name are the link: no Shop button, and the intro says to tap the gift.
    expect(hasShop).toBe(false);
  });

  it("#7: Me in the Save for someone sheet saves without the wish list note over the sheet's Done", async () => {
    setPlanViewer(null);
    planActions.addPerson("Mom");
    const her = guideBySlug("her")!.picks;
    const view = render(
      <MemoryRouter initialEntries={["/gift-guides/her"]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector("[data-savefor-ready]")).not.toBeNull());
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
    const me = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>("[data-savefor-picker] [data-savefor-me]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(me);
    // Saved to My Wish List (the row says so) ...
    expect(giftListNow().picks.map((p) => p.href)).toContain(her[0].href);
    expect(me.getAttribute("aria-pressed")).toBe("true");
    // ... and no bottom-edge note covers the sheet.
    expect(document.querySelector('[data-gift-hint="first-heart"]')).toBeNull();
    expect(document.querySelector("[data-savefor-done]")).not.toBeNull();
  });

  it("#9: the planner's person remove sits away from the budget; person and gift removals say so with Undo, back in place", async () => {
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    const c = view.container;
    for (const n of ["Mom", "Dad", "Jake"]) {
      fireEvent.change(c.querySelector("[data-plan-new-name]")!, { target: { value: n } });
      fireEvent.click(c.querySelector("[data-plan-add-person]")!);
    }
    await waitFor(() => expect(stored().people).toHaveLength(3));
    const dad = stored().people[1];
    planActions.addIdea(dad.id, { name: "Fishing hat" });
    planActions.addIdea(dad.id, { name: "Coffee mug" });
    await waitFor(() => expect(c.querySelectorAll(`[data-plan-person="${dad.id}"] [data-plan-idea]`)).toHaveLength(2));

    // The remove control is a labelled link, never in the row with the name and budget boxes.
    const removeDad = c.querySelector<HTMLButtonElement>(`[data-plan-remove="${dad.id}"]`)!;
    expect(removeDad.textContent).toBe("Remove Dad");
    for (const head of c.querySelectorAll(".gg-plan-head")) expect(head.querySelector("[data-plan-remove]")).toBeNull();

    // A gift: removed, "Removed Fishing hat · Undo", Undo puts it back first.
    const hat = stored().people[1].ideas[0];
    fireEvent.click(c.querySelector(`[data-plan-remove-idea="${hat.id}"]`)!);
    expect(stored().people[1].ideas.map((i) => i.name)).toEqual(["Coffee mug"]);
    expect(toasts.at(-1)!.message).toBe("Removed Fishing hat");
    expect(toasts.at(-1)!.action!.label).toBe(WISH.undo);
    toasts.at(-1)!.action!.onClick();
    expect(stored().people[1].ideas.map((i) => i.name)).toEqual(["Fishing hat", "Coffee mug"]);
    await waitFor(() => expect(c.querySelectorAll(`[data-plan-person="${dad.id}"] [data-plan-idea]`)).toHaveLength(2));

    // A person: removed with their gifts, "Removed Dad · Undo", Undo puts Dad back in the middle with both gifts.
    fireEvent.click(c.querySelector(`[data-plan-remove="${dad.id}"]`)!);
    expect(stored().people.map((p) => p.name)).toEqual(["Mom", "Jake"]);
    expect(toasts.at(-1)!.message).toBe("Removed Dad");
    toasts.at(-1)!.action!.onClick();
    expect(stored().people.map((p) => p.name)).toEqual(["Mom", "Dad", "Jake"]);
    expect(stored().people[1].ideas.map((i) => i.name)).toEqual(["Fishing hat", "Coffee mug"]);
    // A second Undo adds nobody twice.
    toasts.at(-1)!.action!.onClick();
    expect(stored().people).toHaveLength(3);
  });
});
