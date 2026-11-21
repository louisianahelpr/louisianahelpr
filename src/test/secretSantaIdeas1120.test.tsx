/**
 * Secret Santa gift ideas (owner 11-20, two reports):
 *   - "$25 budget and the gift ideas shown were all expensive gifts": a Secret Santa round holds only picks KNOWN to
 *     cost at most the group's budget (checked price, band, or a budget section; Amazon only by its section, never a
 *     price), closest to the budget first, then under; never a pick with no price and never one over;
 *   - "it also saved the gifts i save for my secret santa to my wish list. thats not my wish list": Save is "Save for
 *     <match>" and files the gift under the match (the gift planner signed in, this device with that Secret Santa
 *     signed out), never on the wish list.
 *
 * @mutate src/content/giftPickBand.ts |   return c !== undefined && c <= budget; |   return true;
 * @mutate src/content/giftGuideFun1120.ts |     .sort((a, b) => (pickCeiling(b.p) ?? 0) - (pickCeiling(a.p) ?? 0) \|\| a.i - b.i); |     ;
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |     if (keep && santa) { |     if (false) {
 * @mutate src/pages/info/giftGuides/fun/santaIdeas.ts |   if (toPlanner && saveIdeaToPlanner(santa.match, santa.budget, card)) return "planner"; |
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |     } else if (keep && forName) { |     } else if (false) {
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |   const plannerReady = isReady && (!user \|\| sync !== "device"); |   const plannerReady = isReady;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { SWIPE_WHO, borrowFits, revealPath, santaRound, swipePool } from "@/content/giftGuideFun1120";
import { BUDGET_GUIDES, fitsBudget, pickCeiling } from "@/content/giftPickBand";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const auth = { user: null as { id: string } | null, isReady: true };
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
const reveal = vi.fn();
const loadAccountPlan = vi.fn();
const saveAccountPlan = vi.fn();
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: (...a: unknown[]) => reveal(...a),
  setSecretSantaWishList: vi.fn(),
  createSecretSanta: vi.fn(),
  SantaSaveError: class extends Error {},
  loadAccountPlan: (...a: unknown[]) => loadAccountPlan(...a),
  saveAccountPlan: (...a: unknown[]) => saveAccountPlan(...a),
}));
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import SecretSantaReveal from "@/pages/info/giftGuides/fun/SecretSantaReveal";
import { giftListNow, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { readPlanForSanta, resetPlanStoreForTests } from "@/pages/info/giftGuides/fun/plannerStore";
import { SANTA_IDEAS_KEY, resetSantaIdeasForTests, santaIdeasOnDevice, type SantaFor } from "@/pages/info/giftGuides/fun/santaIdeas";

await loadAllGuidePicks();
const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];

beforeEach(() => {
  window.localStorage.clear();
  auth.user = null;
  loadAccountPlan.mockResolvedValue(null);
  saveAccountPlan.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  resetGiftListForTests();
  resetHintsForTests();
  resetPlanStoreForTests();
  resetSantaIdeasForTests();
});

const pick = (i: number, over: Partial<CatalogPick> = {}): CatalogPick => ({ name: `Gift ${i}`, href: `https://example.com/${i}`, store: `store-${i}`, ...over });

describe("a Secret Santa round keeps to the group's budget", () => {
  it("only picks known to fit, closest to the budget first; no unknown price, Amazon only by its budget section", () => {
    const pool = [
      pick(1, { price: 24 }), pick(2, { price: 30 }), pick(3, { band: 25 }), pick(4), pick(5, { band: 100 }),
      pick(6, { store: "amazon", sectionId: "under-25", section: "Under $25" }), pick(7, { store: "amazon" }), pick(8, { band: 50, price: 45 }),
    ];
    const at25 = santaRound(pool, [], 25, new Set());
    expect(at25.map((p) => p.name)).toEqual(["Gift 3", "Gift 6", "Gift 1"]);
    const at30 = santaRound(pool, [], 30, new Set());
    expect(at30.map((p) => p.name)).toEqual(["Gift 2", "Gift 3", "Gift 6", "Gift 1"]);
    const at50 = santaRound(pool, [], 50, new Set());
    expect(at50[0].name).toBe("Gift 8");
    expect(at50.some((p) => p.name === "Gift 4" || p.name === "Gift 7" || p.name === "Gift 5")).toBe(false);
  });

  it("$25, $50 and $100 from the real guides: never over, closest first, and a real round for everyone", () => {
    const borrowAll = BUDGET_GUIDES.flatMap(picksOf);
    const thin: string[] = [];
    for (const budget of [25, 50, 100]) for (const w of SWIPE_WHO) {
      const r = santaRound(swipePool(w.id, picksOf), borrowAll.filter((p) => borrowFits(w.id, p)), budget, new Set());
      for (const p of r) expect(fitsBudget(p, budget) && pickCeiling(p)! <= budget, `${w.id} $${budget}: ${p.name}`).toBe(true);
      for (let i = 1; i < r.length; i++) expect(pickCeiling(r[i])!).toBeLessThanOrEqual(pickCeiling(r[i - 1])!);
      for (const p of r) if (p.store === "amazon") expect(p.price).toBeUndefined();
      // Owner 11-20 night: she tapped 26 items off Kids and is choosing every item herself; never padded. Floor 1.
      if (r.length < 1) thin.push(`${w.id} $${budget}: ${r.length}`);
    }
    expect(thin).toEqual([]);
  });
});

const santa: SantaFor = { code: "abcdef0123", match: "Ben", budget: 25, back: revealPath("abcdef0123", "a".repeat(64)) };
const renderSwipe = () =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/gift-guides/swipe", state: { santa } }]}>
      <Routes><Route path="/gift-guides/swipe" element={<SwipeGifts />} /></Routes>
    </MemoryRouter>,
  );
const startAndSave = async (container: HTMLElement) => {
  expect(container.querySelector("[data-swipe-santa]")?.textContent).toContain("Ben");
  // The group's budget is the round's: no budget chips to pick.
  expect(container.querySelector("[data-swipe-budget]")).toBeNull();
  fireEvent.click(container.querySelector('[data-swipe-who="friends"]')!);
  fireEvent.click(container.querySelector("[data-swipe-start]")!);
  await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
  const save = container.querySelector("[data-swipe-save]")!;
  expect(save.textContent).toBe("Save for Ben");
  const href = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")!;
  fireEvent.click(save);
  return href;
};

describe("saving for your Secret Santa match never goes on your wish list", () => {
  it("signed out: kept on this device with that Secret Santa, and the reveal lists it", async () => {
    const { container } = renderSwipe();
    const href = await startAndSave(container);
    expect(giftListNow().picks).toEqual([]);
    expect(santaIdeasOnDevice("abcdef0123").map((i) => i.href)).toEqual([href]);
    expect(JSON.parse(window.localStorage.getItem(SANTA_IDEAS_KEY)!).abcdef0123.match).toBe("Ben");
    cleanup();
    reveal.mockResolvedValue({ name: "Ann", match: "Ben", budget: 25, exchangeOn: null, size: 4, matchWishList: null, myWishList: null });
    const page = render(
      <MemoryRouter initialEntries={[santa.back]}>
        <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(page.container.querySelector("[data-reveal-ideas]")).not.toBeNull());
    expect(page.container.querySelector("[data-reveal-ideas]")!.textContent).toContain("Gift ideas for Ben");
    expect(page.container.querySelector(`[data-reveal-ideas] a[href="${href}"]`)).not.toBeNull();
  });

  it("signed in: an entry for the match in the gift planner, with the group's budget", async () => {
    auth.user = { id: "u1" };
    const { container } = renderSwipe();
    await waitFor(() => expect(loadAccountPlan).toHaveBeenCalledWith("u1"));
    const href = await startAndSave(container);
    expect(giftListNow().picks).toEqual([]);
    const ben = readPlanForSanta().people.find((p) => p.name === "Ben");
    expect(ben?.budget).toBe(25);
    expect(ben?.ideas.map((i) => i.href)).toEqual([href]);
    expect(santaIdeasOnDevice("abcdef0123")).toEqual([]);
  });

  it("the plain swipe page: for Mom, Save is \"Save for Mom\" into the planner (signed out: this device's), never the wish list", async () => {
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    fireEvent.click(container.querySelector('[data-swipe-who="mom"]')!);
    fireEvent.click(container.querySelector('[data-swipe-budget="0"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    const save = container.querySelector("[data-swipe-save]")!;
    expect(save.textContent).toBe("Save for Mom");
    const href = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")!;
    fireEvent.click(save);
    expect(giftListNow().picks).toEqual([]);
    expect(readPlanForSanta().people.find((p) => p.name === "Mom")?.ideas.map((i) => i.href)).toEqual([href]);
  });

  it("the plain swipe page, signed in: Save waits for the account's planner, then files under the person", async () => {
    auth.user = { id: "u1" };
    let answer: (v: null) => void = () => {};
    loadAccountPlan.mockReturnValue(new Promise((r) => { answer = r; }));
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    fireEvent.click(container.querySelector('[data-swipe-who="dad"]')!);
    fireEvent.click(container.querySelector('[data-swipe-budget="0"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    expect((container.querySelector("[data-swipe-save]") as HTMLButtonElement).disabled).toBe(true);
    answer(null);
    await waitFor(() => expect((container.querySelector("[data-swipe-save]") as HTMLButtonElement).disabled).toBe(false));
    const href = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")!;
    fireEvent.click(container.querySelector("[data-swipe-save]")!);
    expect(giftListNow().picks).toEqual([]);
    expect(readPlanForSanta().people.find((p) => p.name === "Dad")?.ideas.map((i) => i.href)).toEqual([href]);
  });

  it("the reveal's Find a gift opens the swipe page for the match, with the budget, and no token in the URL", async () => {
    reveal.mockResolvedValue({ name: "Ann", match: "Ben", budget: 25, exchangeOn: null, size: 4, matchWishList: null, myWishList: null });
    const { container } = render(
      <MemoryRouter initialEntries={[santa.back]}>
        <Routes>
          <Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} />
          <Route path="/gift-guides/swipe" element={<SwipeGifts />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-reveal-find]")).not.toBeNull());
    expect(container.querySelector("[data-reveal-find]")!.getAttribute("href")).toBe("/gift-guides/swipe");
    fireEvent.click(container.querySelector("[data-reveal-find]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-santa]")?.textContent).toBe("Finding a gift for Ben"));
    expect(container.querySelector("[data-swipe-santa-budget]")?.textContent).toContain("$25");
  });
});
