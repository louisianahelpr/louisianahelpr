/**
 * Gift guides fun features (owner approved all four in a pop-up, 2026-11-20):
 *   - Secret Santa: the draw never self-matches, never draws anyone twice, respects every "can't draw" pair, finds a
 *     draw whenever one exists, and says none when none does; a reveal link holds the code and token only (no name);
 *     the server function answers only the token's own row (newest migration, read here; behaviour proven in
 *     src/test/pglite/giftGuideSecretSanta.pglite.mjs);
 *   - Swipe: a round is at most 20 cards within the budget, each link once, at most 5 per store, none already seen;
 *     Save puts the card on the wish list, Skip does not;
 *   - Planner: spent vs budget per person and in total, over budget, typed amounts, junk dropped from storage;
 *   - Countdown + Gift of the Day: Louisiana days to Dec 25 (eve, the day, after it, from Jan 1), one curated pick per
 *     day, the 25 Days link only Dec 1-25 and only with its flag on.
 *
 * @mutate src/content/giftGuideFun1120.ts |       if (taken[r] \|\| blocked[giver].has(r)) continue; |       if (taken[r]) continue;
 * @mutate src/content/giftGuideFun1120.ts |       blocked[b].add(a); |       blocked[b].add(b);
 * @mutate src/content/giftGuideFun1120.ts |     if (!p.href \|\| !p.name \|\| !fits(p) \|\| seen.has(p.href) \|\| used.has(p.href)) continue; |     if (!p.href \|\| !p.name \|\| !fits(p) \|\| used.has(p.href)) continue;
 * @mutate src/content/giftGuideFun1120.ts |   const spent = sum(p.ideas.filter((i) => i.bought)); |   const spent = sum(p.ideas);
 * @mutate src/content/giftGuideFun1120.ts |   if (md > "12-25") return { kind: "after" }; |   if (md > "12-26") return { kind: "after" };
 * @mutate src/content/giftGuideFun1120.ts |   return flagOn && md >= "12-01" && md <= "12-25"; |   return md >= "12-01" && md <= "12-25";
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |     if (keep && addToWishList( |     if (false && addToWishList(
 * @mutate supabase/migrations/20261120062334_gift_guide_secret_santa_planner.sql |      AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now()\n$fn$; |      AND g.expires_at > now()\n$fn$;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { blankSqlComments } from "./helpers/blankNonCode";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { guideBySlug, topPicks } from "@/content/giftGuideCatalog";
import {
  SWIPE_PER_STORE, SWIPE_ROUND, christmasCountdown, cleanPlan, dollars, drawIsValid, drawSecretSanta, giftOfTheDay, giveawayTieInOn, parseDollars,
  SANTA_PATH, personMoney, planMoney, revealPath, seededRandom, swipeRound, type GiftPlan,
} from "@/content/giftGuideFun1120";
import { showsPrice } from "@/components/giftGuides/PickPrice";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const reveal = vi.fn();
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: (...a: unknown[]) => reveal(...a),
  setSecretSantaWishList: vi.fn(),
  createSecretSanta: vi.fn(),
  SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(),
  saveAccountPlan: vi.fn(),
}));
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import SecretSantaReveal from "@/pages/info/giftGuides/fun/SecretSantaReveal";
import { GiftCountdown } from "@/pages/info/giftGuides/fun/GiftCountdown";
import { giftListNow, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom storage always works; nothing to clear otherwise.
  }
});
afterEach(() => {
  cleanup();
  resetGiftListForTests();
  resetHintsForTests();
  reveal.mockReset();
});

// Louisiana is UTC-6 in winter: noon there is 18:00Z.
const la = (ymd: string, hour = 12) => new Date(Date.parse(`${ymd}T00:00:00Z`) + (hour + 6) * 3600000);

describe("Secret Santa draw", () => {
  it("never self-matches and never draws anyone twice, for every group size and many draws", () => {
    let draws = 0;
    for (let n = 3; n <= 30; n++) {
      for (let s = 0; s < 40; s++) {
        const d = drawSecretSanta(n, [], seededRandom(n * 1000 + s))!;
        expect(d, `n=${n}`).not.toBeNull();
        expect(drawIsValid(d), `n=${n} ${d.join(",")}`).toBe(true);
        expect(d.every((r, i) => r !== i)).toBe(true);
        expect(new Set(d).size).toBe(n);
        draws++;
      }
    }
    expect(draws).toBeGreaterThan(1000);
  });

  it("respects every can't-draw pair, both ways round", () => {
    const pairs: [number, number][] = [[0, 1], [2, 3], [4, 5], [1, 4]];
    for (let s = 0; s < 300; s++) {
      const d = drawSecretSanta(8, pairs, seededRandom(s))!;
      expect(d).not.toBeNull();
      for (const [a, b] of pairs) {
        expect(d[a], `seed ${s}`).not.toBe(b);
        expect(d[b], `seed ${s}`).not.toBe(a);
      }
    }
  });

  it("finds the only draw a tight group has, and says none when none exists", () => {
    // 4 people; Ann (0) can't draw or be drawn by Ben (1) or Cal (2): Ann gives to Dee (3), Dee gives to Ann, and Ben and
    // Cal draw each other. The only valid draw.
    for (let s = 0; s < 100; s++) expect(drawSecretSanta(4, [[0, 1], [0, 2]], seededRandom(s))).toEqual([3, 2, 1, 0]);
    // 3 people where two can't draw each other: no valid draw (both 3-cycles use that pair).
    expect(drawSecretSanta(3, [[0, 1]])).toBeNull();
    // Ann can draw nobody.
    expect(drawSecretSanta(3, [[0, 1], [0, 2]])).toBeNull();
    expect(drawSecretSanta(1)).toBeNull();
  });

  it("drawIsValid catches each bad draw", () => {
    expect(drawIsValid([1, 2, 0])).toBe(true);
    expect(drawIsValid([0, 2, 1])).toBe(false);
    expect(drawIsValid([1, 0, 0])).toBe(false);
    expect(drawIsValid([1, 2, 0], [[0, 1]])).toBe(false);
    expect(drawIsValid([1, 2, 0], [[1, 0]])).toBe(false);
  });

  it("the drawer never takes the Secret Santa gift guide's own address", () => {
    expect(SANTA_PATH).not.toBe("/gift-guides/secret-santa");
    expect(guideBySlug(SANTA_PATH.replace("/gift-guides/", ""))).toBeUndefined();
    for (const p of ["swipe", "planner"]) expect(guideBySlug(p)).toBeUndefined();
  });

  it("a reveal link holds the group code and the token, never a name", () => {
    const p = revealPath("abcdef0123", "f".repeat(64));
    expect(p).toBe(`/gift-guides/secret-santa/abcdef0123/${"f".repeat(64)}`);
  });

  it("the reveal function answers only the row the token's hash opens (newest definition)", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let body = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
      for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.secret_santa_reveal\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi)) body = m[2];
    }
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/me\.token_hash\s*=\s*encode\(sha256\(convert_to\(p_token/);
    expect(body).toMatch(/me\.group_code\s*=\s*p_code/);
    expect(body).toMatch(/g\.expires_at\s*>\s*now\(\)/);
    // Only the person's own name and their match's: no aggregate over the group.
    expect(body).not.toMatch(/jsonb_agg|array_agg|string_agg/);
  });

  it("the reveal page shows the match, the budget and the match's wish list link", async () => {
    reveal.mockResolvedValue({ name: "Ann", match: "Ben", budget: 25, exchangeOn: "2026-12-20", size: 4, matchWishList: "abcde12345", myWishList: null });
    const { container } = render(
      <MemoryRouter initialEntries={[revealPath("abcdef0123", "a".repeat(64))]}>
        <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-reveal-match]")?.textContent).toBe("Ben"));
    expect(reveal).toHaveBeenCalledWith("abcdef0123", "a".repeat(64));
    expect(container.querySelector("[data-reveal-budget]")?.textContent).toContain("$25");
    expect(container.querySelector("[data-reveal-their-list]")?.getAttribute("href")).toBe("/gift-guides/list/abcde12345");
  });

  it("a wrong link says so", async () => {
    reveal.mockResolvedValue(null);
    const { container } = render(
      <MemoryRouter initialEntries={[revealPath("abcdef0123", "b".repeat(64))]}>
        <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-reveal-missing]")).not.toBeNull());
    expect(container.querySelector("[data-reveal-match]")).toBeNull();
  });
});

const pick = (i: number, over: Partial<CatalogPick> = {}): CatalogPick => ({ name: `Gift ${i}`, href: `https://example.com/${i}`, store: `store-${i % 7}`, band: 25, ...over });

describe("swipe rounds", () => {
  const pool = Array.from({ length: 80 }, (_, i) => pick(i, { band: i % 3 === 0 ? 100 : 25 }));
  it("is at most 20 cards, each link once, at most 5 per store, within the budget", () => {
    const r = swipeRound([...pool, ...pool], 25, new Set(), seededRandom(1));
    expect(r.length).toBe(SWIPE_ROUND);
    expect(new Set(r.map((p) => p.href)).size).toBe(r.length);
    const per = new Map<string, number>();
    for (const p of r) per.set(p.store, (per.get(p.store) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(SWIPE_PER_STORE);
    for (const p of r) expect(p.band).toBeLessThanOrEqual(25);
  });
  it("leaves out what was already seen, and Amazon picks (no band) only come with Any budget", () => {
    const first = swipeRound(pool, 0, new Set(), seededRandom(2));
    const second = swipeRound(pool, 0, new Set(first.map((p) => p.href)), seededRandom(3));
    expect(second.some((p) => first.some((q) => q.href === p.href))).toBe(false);
    const amazon = [pick(1, { store: "amazon", band: undefined })];
    expect(swipeRound(amazon, 25, new Set())).toEqual([]);
    expect(swipeRound(amazon, 0, new Set()).length).toBe(1);
  });

  it("Save puts the card on the wish list; Skip does not", async () => {
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    fireEvent.click(container.querySelector('[data-swipe-who="louisiana"]')!);
    fireEvent.click(container.querySelector('[data-swipe-budget="0"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    const first = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    fireEvent.click(container.querySelector("[data-swipe-skip]")!);
    expect(giftListNow().picks.length).toBe(0);
    const second = container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    expect(second).not.toBe(first);
    fireEvent.click(container.querySelector("[data-swipe-save]")!);
    expect(giftListNow().picks.map((p) => p.href)).toEqual([second]);
    expect(giftListNow().picks[0].guide).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("gift planner money", () => {
  const plan: GiftPlan = {
    updatedAt: 1,
    people: [
      { id: "a", name: "Mom", budget: 100, ideas: [{ id: "1", name: "Robe", price: 60, bought: true }, { id: "2", name: "Mug", price: 15.5, bought: false }] },
      { id: "b", name: "Dad", budget: 50, ideas: [{ id: "3", name: "Yeti", price: 45, bought: true }, { id: "4", name: "Knife", price: 20, bought: true }] },
      { id: "c", name: "Kid", ideas: [{ id: "5", name: "Toy", price: 12, bought: true }] },
    ],
  };
  it("spent counts bought ideas only; left and over per person", () => {
    expect(personMoney(plan.people[0])).toEqual({ budget: 100, planned: 75.5, spent: 60, left: 40, over: false });
    expect(personMoney(plan.people[1])).toEqual({ budget: 50, planned: 65, spent: 65, left: -15, over: true });
    expect(personMoney(plan.people[2]).over).toBe(false);
  });
  it("totals add up", () => {
    expect(planMoney(plan)).toEqual({ budget: 150, planned: 152.5, spent: 137, left: 13, over: false, bought: 4, ideas: 5 });
    expect(dollars(1234)).toBe("$1,234");
    expect(dollars(12.5)).toBe("$12.50");
    expect(dollars(-15)).toBe("-$15");
  });
  it("reads typed amounts and drops anything not ours from storage", () => {
    expect(parseDollars("$25")).toBe(25);
    expect(parseDollars("1,000.50")).toBe(1000.5);
    expect(parseDollars("abc")).toBeUndefined();
    expect(parseDollars("-5")).toBeUndefined();
    expect(cleanPlan({ people: [{ id: "x", name: "A", budget: -5, ideas: [{ id: "i", name: "N", price: "9", href: "javascript:alert(1)", bought: "yes" }] }, null, 7] })).toEqual({
      people: [{ id: "x", name: "A", ideas: [{ id: "i", name: "N", bought: false }] }], updatedAt: 0,
    });
    expect(cleanPlan("nope")).toEqual({ people: [], updatedAt: 0 });
  });
});

describe("Christmas countdown and Gift of the Day", () => {
  it("counts Louisiana days to Dec 25, then eve, the day, and rests after it", () => {
    expect(christmasCountdown(la("2026-11-20"))).toEqual({ kind: "days", days: 35 });
    expect(christmasCountdown(la("2026-12-23"))).toEqual({ kind: "days", days: 2 });
    expect(christmasCountdown(la("2026-12-24"))).toEqual({ kind: "eve" });
    expect(christmasCountdown(la("2026-12-25"))).toEqual({ kind: "today" });
    expect(christmasCountdown(la("2026-12-26"))).toEqual({ kind: "after" });
    expect(christmasCountdown(la("2026-12-31", 23))).toEqual({ kind: "after" });
    expect(christmasCountdown(la("2027-01-01"))).toEqual({ kind: "days", days: 358 });
    // 11 PM on Dec 24 in Louisiana is already Dec 25 in UTC: still Christmas Eve here.
    expect(christmasCountdown(new Date("2026-12-25T05:00:00Z"))).toEqual({ kind: "eve" });
  });
  it("one curated pick per day, the same all day, a different one the next", () => {
    const top = topPicks();
    expect(top.length).toBeGreaterThan(3);
    const a = giftOfTheDay(top, la("2026-12-01", 1));
    expect(giftOfTheDay(top, la("2026-12-01", 22))).toBe(a);
    expect(giftOfTheDay(top, la("2026-12-02"))).not.toBe(a);
    expect(giftOfTheDay([], la("2026-12-02"))).toBeNull();
    // No Amazon price ever (PickPrice's own rule).
    for (let d = 1; d <= 25; d++) {
      const g = giftOfTheDay(top, la(`2026-12-${String(d).padStart(2, "0")}`))!;
      if (g.store === "amazon" || g.store === "store-amazon") expect(showsPrice(g)).toBe(false);
    }
  });
  it("the 25 Days link shows Dec 1-25 only, and only with its flag on", () => {
    expect(giveawayTieInOn(la("2026-12-10"), false)).toBe(false);
    expect(giveawayTieInOn(la("2026-12-10"), true)).toBe(true);
    expect(giveawayTieInOn(la("2026-11-30"), true)).toBe(false);
    expect(giveawayTieInOn(la("2026-12-26"), true)).toBe(false);
  });
  it("the landing card shows the days, the gift, and the three tools; no 25 Days link while the flag is off", () => {
    const { container } = render(<MemoryRouter><GiftCountdown now={la("2026-12-10")} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-countdown-days]")?.getAttribute("data-gift-countdown-days")).toBe("15");
    expect(container.querySelector("[data-gift-of-the-day]")).not.toBeNull();
    expect([...container.querySelectorAll("[data-gift-fun-tool]")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner"]);
    expect(container.querySelector("[data-gift-giveaway-on]")).toBeNull();
    act(() => cleanup());
    const after = render(<MemoryRouter><GiftCountdown now={la("2026-12-27")} /></MemoryRouter>);
    expect(after.container.querySelector("[data-gift-countdown-days]")).toBeNull();
    expect(after.container.querySelector("[data-gift-of-the-day]")).not.toBeNull();
  });
});
