/**
 * Swipe matches the quiz (owner 2026-11-21 evening, on "Swipe to find gifts": "I tapped Me and the first thing that came
 * up was stuff for hunting but I'm a girl? How do we know if me is a girl or boy"). Who is Her, Him or Kids only (no Me,
 * Mom or Dad), Kids then asks the age band, the budgets are the quiz's bands (only those with enough picks), and the deck
 * is that person's picks in that band, ranked as the quiz ranks them. An old link's ?who=mom|dad opens on Her|Him and
 * ?who=me on the start screen.
 *
 * @mutate src/content/giftGuideFun1120.ts |   finderWho("kids", "Kids", ["kids"], "Kids"), |   finderWho("kids", "Kids", ["kids"], "Kids"), finderWho("me" as SwipeWho, "Me", ["her", "him"]),
 * @mutate src/content/giftGuideSwipe.ts |   return QUIZ_BUDGETS.filter((b) => people.filter((p) => quizInBudget(p, b.id)).length >= SWIPE_MIN); |   return [...QUIZ_BUDGETS];
 * @mutate src/content/giftGuideSwipe.ts |   const fit = quizPool(pool, a).filter((p) => !!p.href && !!p.name && !seen.has(p.href) && quizInBudget(p, a.budget)); |   const fit = pool.filter((p) => !!p.href && !!p.name && !seen.has(p.href));
 * @mutate src/content/giftGuideSwipe.ts |   return quizRanked(fit, a.budget).slice(0, SWIPE_ROUND); |   return fit.slice(0, SWIPE_ROUND);
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |           {who === "kids" && <div role="group" aria-label={W.swipeAge} | {false && <div role="group" aria-label={W.swipeAge}
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |   return w === "her" \|\| w === "mom" ? "her" : w === "him" \|\| w === "dad" ? "him" : w === "kids" ? "kids" : null; |   return w === "her" ? "her" : w === "him" ? "him" : w === "kids" ? "kids" : null;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import { loadGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { SWIPE_WHO } from "@/content/giftGuideFun1120";
import { swipeBudgets, swipeDeck } from "@/content/giftGuideSwipe";
import { QUIZ_AGES, QUIZ_BUDGETS, giftQuiz, quizAges, quizBudgets } from "@/content/giftQuiz";
import { TOP10_SLOTS } from "@/content/giftGuideTop10";
import her from "@/content/giftGuidePicks/her.json";
import kids from "@/content/giftGuidePicks/kids.json";

afterEach(cleanup);

const HER = her.picks as CatalogPick[];
const KIDS = kids.picks as CatalogPick[];
const dollars = (p: CatalogPick) => Math.max(1, Math.round(p.price ?? 0));

describe("Swipe's people and budgets are the quiz's", () => {
  it("who is Her, Him and Kids only: no Me, Mom or Dad", () => {
    expect(SWIPE_WHO.map((w) => w.id)).toEqual(["her", "him", "kids"]);
  });

  it("the budgets are the quiz's bands, and only those with enough picks show (the same list the quiz offers)", () => {
    // The quiz has the guides' five bands (guides polish 1122 #23). Her holds 2 picks at $50 to $75 and 1 at $75 to $100
    // (measured 2026-11-22), under the 3-pick minimum, so those two hide; the rest show, in the quiz's order.
    expect(swipeBudgets(HER, { who: "her" }).map((b) => b.id)).toEqual(["under-25", "25-50", "100-plus"]);
    expect(QUIZ_BUDGETS.map((b) => b.id)).toEqual(["under-25", "25-50", "50-75", "75-100", "100-plus"]);
    expect(swipeBudgets(HER, { who: "her" }).map((b) => b.id)).toEqual(quizBudgets(HER, { who: "her" }).map((b) => b.id));
    for (const a of QUIZ_AGES) {
      expect(swipeBudgets(KIDS, { who: "kids", age: a.id }).map((b) => b.id), a.id).toEqual(quizBudgets(KIDS, { who: "kids", age: a.id }).map((b) => b.id));
    }
    // A thin age shows fewer budgets: 0 to 2 has no $100-and-up deck (measured 2026-11-21).
    expect(swipeBudgets(KIDS, { who: "kids", age: "0-2" }).map((b) => b.id)).not.toContain("100-plus");
  });

  it("a deck keeps to the person, the kid's age and the budget band, in the quiz's order", () => {
    const deck = swipeDeck(HER, { who: "her", budget: "100-plus" }, new Set());
    for (const p of deck) expect(dollars(p) >= 100, p.name).toBe(true);
    // The owner's Top 10 leads, as in the quiz (Lola then Depuffi are her Top 10 picks over $100 on Her).
    const top = new Set(TOP10_SLOTS.map((s) => s.href));
    expect(top.has(deck[0].href) && top.has(deck[1].href)).toBe(true);
    expect(deck.slice(0, 2).map((p) => p.href)).toEqual(giftQuiz(HER, { who: "her", budget: "100-plus", into: "any" }).picks.slice(0, 2).map((p) => p.href));
    const little = swipeDeck(KIDS, { who: "kids", age: "0-2", budget: "25-50" }, new Set());
    expect(little.length).toBeGreaterThanOrEqual(3);
    for (const p of little) {
      expect(quizAges(p), p.name).toContain("0-2");
      expect(dollars(p) >= 25 && dollars(p) <= 49, p.name).toBe(true);
    }
    // A second round never repeats a card already seen.
    const seen = new Set(deck.map((p) => p.href));
    for (const p of swipeDeck(HER, { who: "her", budget: "100-plus" }, seen)) expect(seen.has(p.href), p.name).toBe(false);
  });
});

describe("the swipe page", () => {
  it("offers Her, Him and Kids; Kids asks the age before the budget; the budgets follow the answers", async () => {
    await act(async () => { await Promise.all(["her", "him", "kids"].map(loadGuidePicks)); });
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    const ids = (sel: string, attr: string) => [...container.querySelectorAll(sel)].map((b) => b.getAttribute(attr));
    expect(ids("[data-swipe-who]", "data-swipe-who")).toEqual(["her", "him", "kids"]);
    expect(container.querySelector("[data-swipe-budget]")).toBeNull();
    fireEvent.click(container.querySelector('[data-swipe-who="kids"]')!);
    expect(ids("[data-swipe-age]", "data-swipe-age")).toEqual(QUIZ_AGES.map((a) => a.id));
    expect(container.querySelector("[data-swipe-budget]")).toBeNull();
    expect((container.querySelector("[data-swipe-start]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-swipe-age="0-2"]')!);
    await waitFor(() => expect(container.querySelector("[data-swipe-budget]")).not.toBeNull());
    expect(ids("[data-swipe-budget]", "data-swipe-budget")).toEqual(swipeBudgets(KIDS, { who: "kids", age: "0-2" }).map((b) => b.id));
    fireEvent.click(container.querySelector('[data-swipe-budget="25-50"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    const first = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    expect(swipeDeck(KIDS, { who: "kids", age: "0-2", budget: "25-50" }, new Set()).map((p) => p.href)).toContain(first);
  });

  it("an old link: ?who=mom opens on Her, ?who=dad on Him, ?who=me on nobody chosen", async () => {
    await act(async () => { await Promise.all(["her", "him"].map(loadGuidePicks)); });
    const chosen = (url: string) => {
      const { container } = render(<MemoryRouter initialEntries={[url]}><SwipeGifts /></MemoryRouter>);
      const on = container.querySelector('[data-swipe-who][aria-pressed="true"]')?.getAttribute("data-swipe-who") ?? null;
      cleanup();
      return on;
    };
    expect(chosen("/gift-guides/swipe?who=mom")).toBe("her");
    expect(chosen("/gift-guides/swipe?who=dad")).toBe("him");
    expect(chosen("/gift-guides/swipe?who=me")).toBeNull();
    expect(chosen("/gift-guides/swipe?who=kids")).toBe("kids");
  });
});
