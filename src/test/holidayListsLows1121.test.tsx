/**
 * Holiday audit 1121, gift lists area (Audit-Holiday-wishlist-planner-1121.json), Lows #10 to #17 (#13 and #18: see the
 * branch report):
 *   #10 the My lists pill left "Me" out (the heart counted only Me): the pill now counts every list, Me included.
 *   #11 Add with no name (planner, Save for someone) or at the 50-person limit did nothing and said nothing.
 *   #12 the heart's note said different words on a phone and a desktop; now one phrase, short only at 340 and under.
 *   #14 the planner's Shop link was 42x28: it is 44 high.
 *   #15 "Sent" floated mid-row on the last draw: it sits right after the name.
 *   #16 a failed share's error stayed after the list changed.
 *   #17 the planner's budget and price boxes showed bare numbers: a $ sits inside each.
 *
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |   const total = { gifts: others.gifts + me.gifts, | const total = { gifts: others.gifts,
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |     if (!name.trim()) return setAddErr(LISTS.nameFirst); |     if (!name.trim()) return;
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |     if (!A.addPerson(name.trim())) return setAddErr(LISTS.peopleFull); |     A.addPerson(name.trim());
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |     if (!name.trim()) return setErr(LISTS.nameFirst); |     if (!name.trim()) return;
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | @media (max-width:340px){ | @media (max-width:400px){
 * @mutate src/content/giftWishListCore.ts |   seeList: "View list", |   seeList: "See my list",
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-plan-shop{display:inline-flex;align-items:center;min-height:44px; | .gg-plan-shop{display:inline-flex;align-items:center;min-height:28px;
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |                   {done.sent.includes(i) && <span className="gg-fun-note m-0" data-santa-sent={i}>{W.santaSent}</span>}\n                </span> |                 </span>\n                  {done.sent.includes(i) && <span className="gg-fun-note m-0" data-santa-sent={i}>{W.santaSent}</span>}
 * @mutate src/pages/info/giftGuides/GiftWishShare.tsx |     if (state === "failed") { |     if (state === "never") {
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |         <span className="gg-money-box gg-plan-budget"><span className="gg-money-sign" aria-hidden="true">$</span> |         <span className="gg-money-box gg-plan-budget"><span className="gg-money-sign" aria-hidden="true"></span>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A share keeps a token to stop its link (giftWishListOwnApi.ts, wishListDelete1121.test.tsx); here it never reaches a server.
vi.mock("@/lib/giftWishListOwnApi", async (orig) => ({ ...(await orig<typeof import("@/lib/giftWishListOwnApi")>()), claimShare: vi.fn(async () => undefined) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/nativeShare", () => ({ copyToClipboard: vi.fn(async () => true), shareNative: vi.fn().mockResolvedValue("shared") }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(),
  setSecretSantaWishList: vi.fn(),
  createSecretSanta: vi.fn(async () => ({ code: "abcdef0123", tokens: ["a", "b", "c"].map((c) => c.repeat(64)) })),
  cancelSecretSanta: vi.fn(async () => true),
  SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(async () => null),
  saveAccountPlan: vi.fn(async () => undefined),
}));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  shareGiftLists: vi.fn(async () => "abcdef123456"),
  getSharedList: vi.fn(async () => null),
  getMyWishList: vi.fn(async () => null),
  saveWishList: vi.fn(async () => "abcdef123456"),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import SecretSanta from "@/pages/info/giftGuides/fun/SecretSanta";
import { GiftWishShare } from "@/pages/info/giftGuides/GiftWishShare";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { PLAN_MAX_PEOPLE, cleanPlan } from "@/content/giftGuideFun1120";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { HINTS, WISH } from "@/content/giftWishList";
import { LISTS } from "@/content/giftListsManage";
import { GIFT_WISH_CSS } from "@/pages/info/giftGuides/giftWishStyles";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { resetGiftListForTests, togglePick } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetFirstHeartForTests } from "@/pages/info/giftGuides/GiftGuideHints";
import { shownDollars } from "@/lib/pickPriceShown.mjs";

const HER = JSON.parse(readFileSync(join(process.cwd(), "src/content/giftGuidePicks/her.json"), "utf8")) as { picks: { priceAt?: string }[] };
const CHECK_DAY = HER.picks.find((p) => p.priceAt)?.priceAt ?? "2026-11-21";

await loadAllGuidePicks();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${CHECK_DAY}T18:00:00Z`));
  window.localStorage.clear();
  resetPlanStoreForTests();
  resetGiftListForTests();
  resetHintsForTests();
  resetFirstHeartForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const guidePage = () => render(
  <MemoryRouter initialEntries={["/gift-guides/her"]}>
    <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
  </MemoryRouter>,
);

describe("holiday audit 1121: gift lists Lows", () => {
  it("#10: the My lists pill counts My Wish List too", async () => {
    setPlanViewer(null);
    const her = guideBySlug("her")!.picks;
    // Inventory floor: For Her holds 36 picks today.
    expect(her.length).toBeGreaterThan(20);
    const priced = her.find((p) => p.price !== undefined)!;
    togglePick({ href: priced.href, name: priced.name, guide: "her" });
    guidePage();
    await waitFor(() => expect(document.querySelector("[data-savefor-ready]")).not.toBeNull());
    // Only Me has a gift: the pill still shows it.
    const pillText = () => document.querySelector("[data-mylists-pill-total]")?.textContent;
    await waitFor(() => expect(pillText()).toBe(`1 gift · $${shownDollars(priced.price)}`));
    // Mom's $12 mug adds to it.
    const mom = planActions.addPerson("Mom")!;
    planActions.addIdea(mom, { name: "Mug", href: "https://www.etsy.com/listing/1", price: 12 });
    await waitFor(() => expect(pillText()).toBe(`2 gifts · $${shownDollars(priced.price) + 12}`));
  });

  it("#11: Add with no name, or at the 50-person limit, says why (planner and Save for someone)", async () => {
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    const c = view.container;
    const nameBox = c.querySelector<HTMLInputElement>("[data-plan-new-name]")!;
    fireEvent.click(c.querySelector("[data-plan-add-person]")!);
    expect(c.querySelector("[data-plan-add-err]")!.textContent).toBe(LISTS.nameFirst);
    expect(nameBox.getAttribute("aria-invalid")).toBe("true");
    expect(nameBox.getAttribute("aria-describedby")).toBe("gg-plan-add-err");
    fireEvent.change(nameBox, { target: { value: "M" } });
    expect(c.querySelector("[data-plan-add-err]")).toBeNull();
    // Full: the 51st person is refused, with a reason.
    for (let k = 0; k < PLAN_MAX_PEOPLE; k++) planActions.addPerson(`P${k}`);
    fireEvent.change(nameBox, { target: { value: "One more" } });
    fireEvent.click(c.querySelector("[data-plan-add-person]")!);
    expect(c.querySelector("[data-plan-add-err]")!.textContent).toBe(LISTS.peopleFull);
    view.unmount();

    // Save for someone's Add a person.
    resetPlanStoreForTests();
    window.localStorage.clear();
    const page = guidePage();
    await waitFor(() => expect(document.querySelector("[data-savefor-ready]")).not.toBeNull());
    fireEvent.click(page.container.querySelector<HTMLButtonElement>("[data-gift-pick] [data-gift-heart]")!);
    const addBtn = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>("[data-savefor-add]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(addBtn);
    fireEvent.click(document.querySelector("[data-savefor-add-submit]")!);
    expect(document.querySelector("[data-savefor-add-err]")!.textContent).toBe(LISTS.nameFirst);
    expect(document.querySelector("[data-savefor-name]")!.getAttribute("aria-invalid")).toBe("true");
  });

  it("#12: the heart's note says the same words on a phone and a desktop; short words only at 340 and under", () => {
    expect(GIFT_WISH_CSS).toMatch(/@media \(max-width:340px\)\{\.gg-toast \.gg-toast-long\{display:none\}\.gg-toast \.gg-toast-short\{display:inline\}\}/);
    expect(GIFT_WISH_CSS).not.toMatch(/@media \(max-width:400px\)\{[^}]*\{[^}]*\}[^}]*gg-toast-short/);
    // The link says what the Done note's link says.
    expect(HINTS.seeList).toBe(WISH.viewList);
    expect(HINTS.seeListShort).toBe(HINTS.seeList);
  });

  it("#14 + #17: the planner's Shop link is 44 high; its budget and price boxes carry a $", async () => {
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    const c = view.container;
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(css).toMatch(/\.gg-plan-shop\{[^}]*min-height:44px/);
    fireEvent.change(c.querySelector("[data-plan-new-name]")!, { target: { value: "Mom" } });
    fireEvent.click(c.querySelector("[data-plan-add-person]")!);
    const budget = await waitFor(() => {
      const b = c.querySelector<HTMLInputElement>("[data-plan-budget]");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(budget.closest(".gg-money-box")!.querySelector(".gg-money-sign")!.textContent).toBe("$");
    const [mom] = cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan).people;
    planActions.addIdea(mom.id, { name: "Mug", price: 4.77 });
    const price = await waitFor(() => {
      const p = c.querySelector<HTMLInputElement>("[data-plan-price]");
      expect(p).not.toBeNull();
      return p!;
    });
    expect(price.value).toBe("4.77");
    expect(price.closest(".gg-money-box")!.querySelector(".gg-money-sign")!.textContent).toBe("$");
  });

  it("#15: Sent sits right after the name it belongs to", async () => {
    const { container } = render(<MemoryRouter><SecretSanta /></MemoryRouter>);
    ["Ann", "Ben", "Cal"].forEach((n, i) => fireEvent.change(container.querySelector(`[data-santa-name="${i}"]`)!, { target: { value: n } }));
    fireEvent.click(container.querySelector("[data-santa-draw]")!);
    await waitFor(() => expect(container.querySelector("[data-santa-done]")).not.toBeNull());
    fireEvent.click(container.querySelector('[data-santa-send="1"]')!);
    const sent = await waitFor(() => {
      const s = container.querySelector('[data-santa-sent="1"]');
      expect(s).not.toBeNull();
      return s!;
    });
    const who = sent.closest("[data-santa-who]")!;
    expect(who).not.toBeNull();
    expect(who.querySelector("b")!.textContent).toBe("Ben");
    expect(sent.previousElementSibling?.tagName).toBe("B");
  });

  it("#16: a failed share's error goes once the list changes", async () => {
    const save = vi.fn(async () => {
      throw new Error("network");
    });
    const refs = [{ g: "her", i: "abc1" }, { g: "her", i: "abc2" }];
    const view = render(<MemoryRouter><GiftWishShare name="Mom" refs={refs} save={save} /></MemoryRouter>);
    fireEvent.click(view.container.querySelector("[data-gift-wish-share-btn]")!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-share-failed]")).not.toBeNull());
    // The same list again: the error stays (it is still true).
    view.rerender(<MemoryRouter><GiftWishShare name="Mom" refs={[...refs]} save={save} /></MemoryRouter>);
    expect(view.container.querySelector("[data-gift-wish-share-failed]")).not.toBeNull();
    // A gift removed: the error was about the old list, so it goes; Share is ready again.
    view.rerender(<MemoryRouter><GiftWishShare name="Mom" refs={refs.slice(0, 1)} save={save} /></MemoryRouter>);
    expect(view.container.querySelector("[data-gift-wish-share-failed]")).toBeNull();
    expect(view.container.querySelector<HTMLButtonElement>("[data-gift-wish-share-btn]")!.disabled).toBe(false);
  });
});
