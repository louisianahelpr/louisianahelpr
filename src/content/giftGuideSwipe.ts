/**
 * Swipe to find gifts, the plain deck (owner 2026-11-21 evening: Swipe matches the quiz): its budgets and its cards,
 * read from the quiz (giftQuiz.ts). Its own module, imported only by the swipe page (fun/SwipeGifts.tsx): in
 * giftGuideFun1120.ts (the public-page-reads chunk, on /sponsor and every guide page) the giftQuiz import put the gift
 * guides' catalog chunk on /sponsor's critical path (255 -> 333 KB gz, train 1121j build) and the quiz back on the guide
 * pages' path. Guards: src/test/swipeWho1121.test.tsx, src/test/giftGuideFun1120.test.tsx.
 */
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { SWIPE_ROUND, type SwipeWho } from "@/content/giftGuideFun1120";
import { QUIZ_BUDGETS, quizInBudget, quizPool, quizRanked, type QuizAge, type QuizBudget } from "@/content/giftQuiz";

/** A budget shows on the swipe page only with at least this many picks for the person (and the kid's age). */
const SWIPE_MIN = 3;

/**
 * The budgets worth offering one person (and a kid's age): the quiz's bands (the guides' price sections) with at least
 * SWIPE_MIN picks. QUIZ_BUDGETS is read on use, never copied into a module-level constant (a load-time copy was
 * undefined when this code sat in giftGuideFun1120.ts, whose chunk and giftQuiz.ts's imported each other: the swipe
 * page crashed on "Kids" in a vite build 2026-11-21).
 */
export function swipeBudgets<T extends CatalogPick>(pool: readonly T[], a: { who: SwipeWho; age?: QuizAge }): { id: QuizBudget; label: string }[] {
  const people = quizPool(pool, a);
  return QUIZ_BUDGETS.filter((b) => people.filter((p) => quizInBudget(p, b.id)).length >= SWIPE_MIN);
}

/**
 * A plain deck (owner 2026-11-21 evening: Swipe matches the quiz): only this person's picks (and the kid's age band),
 * only inside the chosen budget band, in the quiz's order (the owner's Top 10, then clicks, then the price that fits
 * the band best; at most two of a brand), none already seen this visit, at most SWIPE_ROUND.
 */
export function swipeDeck<T extends CatalogPick>(pool: readonly T[], a: { who: SwipeWho; age?: QuizAge; budget: QuizBudget }, seen: ReadonlySet<string>): T[] {
  const fit = quizPool(pool, a).filter((p) => !!p.href && !!p.name && !seen.has(p.href) && quizInBudget(p, a.budget));
  return quizRanked(fit, a.budget).slice(0, SWIPE_ROUND);
}
