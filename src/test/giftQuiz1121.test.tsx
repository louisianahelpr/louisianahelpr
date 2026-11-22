/**
 * The gift quiz (owner 2026-11-21 ~6:15 PM: Mom showed the whole Her list and Dad the whole Him list: "Then it's not
 * really a quiz. It should show like a few things. The whole point of a quiz is to ask questions to narrow down the
 * list"). One question per screen (who; a kid's age; budget; what they are into), then six picks, up to twelve with
 * "Show me more". Every chip offered has at least 3 picks behind it, every result keeps to the budget (and age), and no
 * path is ever empty: a link whose answers no longer fit widens the budget and says so. Rules: src/content/giftQuiz.ts.
 *
 * @mutate src/content/giftQuiz.ts |   return [...chips.filter((c) => c.count >= QUIZ_MIN), { ...ANY, count: fit.length }]; |   return [...chips, { ...ANY, count: fit.length }];
 * @mutate src/content/giftQuiz.ts |   return !!p.price && p.price > 0 && dollars(p) >= band.min && dollars(p) <= band.max; |   return !!p.price && p.price > 0 && dollars(p) <= band.max;
 * @mutate src/content/giftQuiz.ts |   return pool.filter((p) => a.who !== "kids" \|\| !a.age \|\| quizAges(p).includes(a.age)); |   return [...pool];
 * @mutate src/content/giftQuiz.ts |   const key = (p: CatalogPick): [number, number, number] => [top.get(p.href) ?? 99, | const key = (p: CatalogPick): [number, number, number] => [99,
 * @mutate src/content/giftQuiz.ts |   const list = picked.length > 0 ? picked : rank(people, a.budget); |   const list = picked;
 * @mutate src/content/giftQuiz.ts |   const intoIds = who ? [...(who === "kids" ? KIDS_INTO : ADULT_INTO), ANY].map((x) => x.id) : []; |   const intoIds: string[] = [];
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx |     const shown = result.picks.slice(0, more ? result.picks.length : QUIZ_FIRST); |     const shown = result.picks;
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx | } else if (step === "age") { | } else if (step === "age" && false) {
 * @mutate src/content/giftQuiz.ts |     for (const [re, tag] of NAME_TAGS) if (re.test(pick.name) && !(tag === "cozy" && NOT_COZY_TYPES.has(pick.type ?? ""))) tags.add(tag); |     for (const [re, tag] of NAME_TAGS) if (re.test(pick.name)) tags.add(tag);
 * @mutate src/content/giftQuiz.ts |   [/\b(owala\|water bottle)\b/i, "fitness"], |   [/\b(owala\|bottle)\b/i, "fitness"],
 * @mutate src/content/giftGuideExtras1120.ts |   finderTitle: "Find a gift", |   finderTitle: "Find a gift in 3 taps",
 *
 * Lead 11-21 PM: a tag pass by eye over all 269 picks (the ZDEER heated gua sha showed under Cozy & home), and the
 * title is "Find a gift" everywhere (the Kids path is 4 steps).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { EXTRAS_WORDS as W } from "@/content/giftGuideExtras1120";
import {
  QUIZ_AGES, QUIZ_BUDGETS, QUIZ_FIRST, QUIZ_MAX, QUIZ_MIN, giftQuiz, quizAges, quizBudgets, quizIntoChips, quizTags, readQuiz,
  type QuizAge, type QuizBudget, type QuizInto, type QuizWho,
} from "@/content/giftQuiz";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const POOL: Record<QuizWho, CatalogPick[]> = { her: her.picks as CatalogPick[], him: him.picks as CatalogPick[], kids: kids.picks as CatalogPick[] };
const WHO: QuizWho[] = ["her", "him", "kids"];
const dollars = (p: CatalogPick) => Math.max(1, Math.round(p.price ?? 0));
const band = (b: QuizBudget) => QUIZ_BUDGETS.find((x) => x.id === b)!;
/** Every (who, age) a shopper can reach. */
const PEOPLE: { who: QuizWho; age?: QuizAge }[] = [{ who: "her" }, { who: "him" }, ...QUIZ_AGES.map((a) => ({ who: "kids" as const, age: a.id }))];
const ALL_INTO: QuizInto[] = ["cozy", "beauty", "style", "outdoors", "fitness", "tech", "kitchen", "tools", "games", "build", "creative", "active", "pretend", "stocking", "any"];

describe("every live pick is tagged from its own data", () => {
  it("each Her, Him and Kids pick has an interest, and each Kids pick an age band", () => {
    let n = 0;
    for (const who of WHO) for (const p of POOL[who]) { n += 1; expect(quizTags(p, who).length, `${who}: ${p.type} | ${p.name}`).toBeGreaterThan(0); }
    for (const p of POOL.kids) expect(quizAges(p).length, `${p.type} | ${p.name}`).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(200); // 47 + 141 + 81 measured 2026-11-21
  });
});

describe("each result clearly belongs to its chip (tag pass by eye, 11-21 PM)", () => {
  const BEAUTY_TYPES = /^(skincare|lip|makeup|gift-set|fragrance|hair|beauty-device|grooming|soap|body-wash|lotion|shave)$/;
  it("no beauty item is Cozy & home, no shoe or boot is cozy, no bottle opener is fitness, a massage gun is not beauty", () => {
    for (const who of ["her", "him"] as QuizWho[]) for (const p of POOL[who]) {
      const t = quizTags(p, who);
      if (BEAUTY_TYPES.test(p.type ?? "") || /^(shoes|boots)$/.test(p.type ?? "")) expect(t, `${who}: ${p.name}`).not.toContain("cozy");
      if (p.type === "bottle-opener") expect(t, p.name).not.toContain("fitness");
      if (p.type === "massager") expect(t, p.name).not.toContain("beauty");
    }
    const zdeer = POOL.her.find((p) => /ZDEER/.test(p.name))!;
    expect(quizTags(zdeer, "her")).not.toContain("cozy");
    const cozy = giftQuiz(POOL.her, { who: "her", budget: "25-50", into: "cozy" }).picks;
    for (const p of cozy) expect(BEAUTY_TYPES.test(p.type ?? ""), p.name).toBe(false);
  });
  it("the title is Find a gift (the Kids path is 4 steps)", () => {
    expect(W.finderTitle).toBe("Find a gift");
  });
});

describe("the chips narrow, and every chip offered is a real list", () => {
  it("every chip on every path has at least 3 picks, all inside the budget (and the age), at most 12", () => {
    let paths = 0;
    for (const person of PEOPLE) {
      for (const b of quizBudgets(POOL[person.who], person)) {
        const chips = quizIntoChips(POOL[person.who], { ...person, budget: b.id });
        expect(chips[chips.length - 1].id, "Anything comes last").toBe("any");
        for (const c of chips) {
          const r = giftQuiz(POOL[person.who], { ...person, budget: b.id, into: c.id });
          const where = `${person.who} ${person.age ?? ""} ${b.id} ${c.id}`;
          expect(r.picks.length, where).toBeGreaterThanOrEqual(QUIZ_MIN);
          expect(r.picks.length, where).toBeLessThanOrEqual(QUIZ_MAX);
          expect(r.widened, where).toBe(false);
          for (const p of r.picks) {
            expect(dollars(p) >= band(b.id).min && dollars(p) <= band(b.id).max, `${where}: ${p.name} $${dollars(p)}`).toBe(true);
            if (c.id !== "any") expect(quizTags(p, person.who), `${where}: ${p.name}`).toContain(c.id);
            if (person.age) expect(quizAges(p), `${where}: ${p.name}`).toContain(person.age);
          }
          expect(new Set(r.picks.map((p) => p.href)).size, where).toBe(r.picks.length);
          paths += 1;
        }
      }
    }
    expect(paths).toBeGreaterThan(40); // 61 measured 2026-11-21
  });

  it("a chip narrows: Her under $25 offers more than Anything, and Beauty holds only beauty", () => {
    const chips = quizIntoChips(POOL.her, { who: "her", budget: "under-25" }).map((c) => c.id);
    expect(chips.length).toBeGreaterThan(2);
    const any = giftQuiz(POOL.her, { who: "her", budget: "under-25", into: "any" }).picks;
    const beauty = giftQuiz(POOL.her, { who: "her", budget: "under-25", into: "beauty" }).picks;
    expect(beauty.length).toBeLessThan(POOL.her.filter((p) => dollars(p) < 25).length);
    expect(beauty.map((p) => p.href)).not.toEqual(any.map((p) => p.href));
  });

  it("no path is ever empty: a link whose answers no longer fit widens the budget and says so", () => {
    for (const person of PEOPLE) for (const b of QUIZ_BUDGETS) for (const into of ALL_INTO) {
      const r = giftQuiz(POOL[person.who], { ...person, budget: b.id, into });
      expect(r.picks.length, `${person.who} ${person.age ?? ""} ${b.id} ${into}`).toBeGreaterThan(0);
    }
    // Her has no outdoors picks: a shared link asking for them still gets a list, marked as widened.
    const odd = giftQuiz(POOL.her, { who: "her", budget: "50-100", into: "beauty" });
    expect(odd.picks.length).toBeGreaterThan(0);
    expect(odd.widened).toBe(true);
  });

  it("the owner's Top 10 comes first among the matches", () => {
    const r = giftQuiz(POOL.her, { who: "her", budget: "100-plus", into: "any" }).picks.map((p) => p.name);
    expect(r[0]).toMatch(/^Lola Blankets/);
    expect(r[1]).toMatch(/^Shark Depuffi/);
  });

  it("reads a shared link, and Mom and Dad are no longer people of their own", () => {
    expect(readQuiz(new URLSearchParams("who=her&budget=25-50&into=cozy"))).toEqual({ who: "her", budget: "25-50", into: "cozy" });
    expect(readQuiz(new URLSearchParams("who=kids&age=6-8&budget=under-25&into=games"))).toEqual({ who: "kids", age: "6-8", budget: "under-25", into: "games" });
    expect(readQuiz(new URLSearchParams("who=mom&budget=50&vibe=cozy"))).toEqual({});
    expect(readQuiz(new URLSearchParams("who=her&into=games"))).toEqual({ who: "her" });
  });
});

function Where() {
  const { search } = useLocation();
  return <output data-test-search="">{search}</output>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
const answers = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-gift-quiz-answer]")].map((b) => b.getAttribute("data-gift-quiz-answer"));
const tap = (c: HTMLElement, attr: string) => fireEvent.click(c.querySelector(`[data-gift-quiz-answer="${attr}"]`)!);

describe("the quiz on the page: one question per screen, then a short list", () => {
  it("Her: who, budget, interest, then six picks, twelve at most, the whole guide and Start over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await act(async () => { await Promise.all(WHO.map((w) => loadGuidePicks(w))); });
    const { container } = renderAt("/gift-guides#gift-finder");
    expect(answers(container)).toEqual(["who:her", "who:him", "who:kids"]);
    tap(container, "who:her");
    expect(container.querySelector("[data-test-search]")?.textContent).toBe("?who=her");
    expect(answers(container)).toEqual(quizBudgets(POOL.her, { who: "her" }).map((b) => `budget:${b.id}`));
    tap(container, "budget:under-25");
    expect(answers(container)).toEqual(quizIntoChips(POOL.her, { who: "her", budget: "under-25" }).map((c) => `into:${c.id}`));
    tap(container, "into:any");
    expect(container.querySelector("[data-test-search]")?.textContent).toBe("?who=her&budget=under-25&into=any");
    expect(container.querySelector("[data-gift-quiz-result-title]")?.textContent).toBe(W.quizResults("her"));
    expect(container.querySelectorAll("[data-gift-finder-results] [data-gift-pick]")).toHaveLength(QUIZ_FIRST);
    fireEvent.click(screen.getByText(W.quizMore));
    const all = container.querySelectorAll("[data-gift-finder-results] [data-gift-pick]");
    expect(all.length).toBeGreaterThan(QUIZ_FIRST);
    expect(all.length).toBeLessThanOrEqual(QUIZ_MAX);
    expect(container.querySelector("[data-gift-quiz-guide]")?.getAttribute("href")).toBe("/gift-guides/her");
    expect(container.querySelector("[data-gift-finder-again]")?.getAttribute("href")).toBe("/gift-guides#gift-finder");
  });

  it("Kids asks the age first, and its budgets and chips follow that age", async () => {
    await act(async () => { await loadGuidePicks("kids"); });
    const { container } = renderAt("/gift-guides?who=kids#gift-finder");
    expect(answers(container)).toEqual(QUIZ_AGES.map((a) => `age:${a.id}`));
    expect(container.querySelector(".gg-quiz-progress")?.textContent).toBe(W.quizStepOf(2, 4));
    tap(container, "age:0-2");
    expect(answers(container)).toEqual(quizBudgets(POOL.kids, { who: "kids", age: "0-2" }).map((b) => `budget:${b.id}`));
    fireEvent.click(container.querySelector("[data-gift-quiz-back]")!);
    expect(container.querySelector("[data-test-search]")?.textContent).toBe("?who=kids");
  });
});
