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
 * @mutate src/content/giftGuideFun1120.ts |     if (!p.href \|\| !p.name \|\| seen.has(p.href) \|\| used.has(p.href)) continue; |     if (!p.href \|\| !p.name \|\| used.has(p.href)) continue;
 * @mutate src/content/giftGuideFun1120.ts |   const spent = sum(p.ideas.filter((i) => i.bought)); |   const spent = sum(p.ideas);
 * @mutate src/content/giftGuideFun1120.ts |   if (md > "12-25") return { kind: "after" }; |   if (md > "12-26") return { kind: "after" };
 * @mutate src/content/giftGuideFun1120.ts |   return flagOn && md >= "12-01" && md <= "12-25"; |   return md >= "12-01" && md <= "12-25";
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |     if (keep && addToWishList( |     if (false && addToWishList(
 * @mutate src/content/giftGuideFun1120.ts | export const cleanName = (n: string) => cleanGiftName(n, SANTA_NAME_MAX).trim(); | export const cleanName = (n: string) => n.trim();
 * @mutate src/content/giftGuideFun1120.ts |   LINKISH.test(n) ? "link" : | false ? "link" :
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |   if (viewer === undefined \|\| !copyBelongsTo(c.ownerId, viewer)) return EMPTY_PLAN; |   if (viewer === undefined) return EMPTY_PLAN;
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |         const local = copyBelongsTo(c.ownerId, userId) ? c.plan : EMPTY_PLAN; |         const local = c.plan;
 * @mutate src/lib/giftPlannerDevice.ts |   resets.forEach((fn) => fn()); |   void resets;
 * @mutate src/content/giftGuideFun1120.ts |   for (const p of [...pool.filter(fits), ...pool.filter(unknown)]) { |   for (const p of pool.filter(fits)) {
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-plan-head .gg-plan-budget,.gg-fun-row>.gg-plan-price,.gg-plan-idea .gg-plan-price{flex:0 0 auto} | .gg-plan-budget{flex:none}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | display:grid;grid-template-columns:minmax(0,1fr);gap:8px} | display:grid;gap:8px}
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |  onChange={() => setError(null)} | 
 * @mutate src/pages/info/giftGuides/fun/GiftCountdown.tsx |   return to ? `/gift-guides/${to}` : `/gift-guides#${GOTD_ID}`; |   return `/gift-guides#${GOTD_ID}`;
 * @mutate supabase/migrations/20261120062334_gift_guide_secret_santa_planner.sql |      AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now()\n$fn$; |      AND g.expires_at > now()\n$fn$;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { guideBySlug, loadAllGuidePicks, loadSearchItems, topPicks } from "@/content/giftGuideCatalog";
import {
  SWIPE_BUDGETS, SWIPE_PER_STORE, SWIPE_ROUND, SWIPE_WHO, duplicateName, swipePool, christmasCountdown, cleanPlan, dollars, drawIsValid, drawSecretSanta, giftOfTheDay, giveawayTieInOn, parseDollars,
  SANTA_PATH, cleanName, cleanNames, nameProblem, personMoney, planMoney, revealPath, seededRandom, swipeRound, type GiftPlan,
} from "@/content/giftGuideFun1120";
import { showsPrice } from "@/components/giftGuides/PickPrice";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// The fun pages report usage (UX audit L12); no analytics row leaves a unit test.
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
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
import { GiftCountdown, GiftTools, giftOfTheDayPath } from "@/pages/info/giftGuides/fun/GiftCountdown";
import { giftListNow, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { planActions, resetPlanStoreForTests, setPlanViewer, useAccountSync, usePlan } from "@/pages/info/giftGuides/fun/plannerStore";
import { PLANNER_KEY, clearPlannerDevice } from "@/lib/giftPlannerDevice";
import { renderHook } from "@testing-library/react";

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
  resetPlanStoreForTests();
  loadAccountPlan.mockReset();
  saveAccountPlan.mockReset();
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
    reveal.mockResolvedValue({ name: "Ann", match: "Ben", budget: 25, exchangeOn: "2026-12-20", size: 4, matchWishList: "abcde1234567", myWishList: null });
    const { container } = render(
      <MemoryRouter initialEntries={[revealPath("abcdef0123", "a".repeat(64))]}>
        <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-reveal-match]")?.textContent).toBe("Ben"));
    expect(reveal).toHaveBeenCalledWith("abcdef0123", "a".repeat(64));
    expect(container.querySelector("[data-reveal-budget]")?.textContent).toContain("$25");
    expect(container.querySelector("[data-reveal-their-list]")?.getAttribute("href")).toBe("/gift-guides/list/abcde1234567");
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
  it("leaves out what was already seen; picks with no price band come after the ones known to fit, never one known to cost more", () => {
    const first = swipeRound(pool, 0, new Set(), seededRandom(2));
    const second = swipeRound(pool, 0, new Set(first.map((p) => p.href)), seededRandom(3));
    expect(second.some((p) => first.some((q) => q.href === p.href))).toBe(false);
    const mixed = [pick(1, { store: "amazon", band: undefined }), pick(2, { band: 100 }), pick(3, { band: 25 })];
    const r = swipeRound(mixed, 25, new Set(), () => 0.99);
    expect(r.map((p) => p.name).sort()).toEqual(["Gift 1", "Gift 3"]);
    expect(swipeRound(mixed, 0, new Set()).length).toBe(3);
  });

  it("every who and budget gives at least 10 cards from the real guides (UX audit H3)", async () => {
    await loadAllGuidePicks();
    const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];
    const thin: string[] = [];
    for (const w of SWIPE_WHO) for (const b of SWIPE_BUDGETS) {
      const n = swipeRound(swipePool(w.id, picksOf), b.id, new Set(), seededRandom(1)).length;
      if (n < 10) thin.push(`${w.id}/${b.id}: ${n}`);
    }
    expect(SWIPE_WHO.length * SWIPE_BUDGETS.length).toBeGreaterThan(30);
    expect(thin).toEqual([]);
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
  it("the landing's slim line shows the days and the gift; no 25 Days link while the flag is off; the tools are one row of four", () => {
    const { container } = render(<MemoryRouter><GiftCountdown now={la("2026-12-10")} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-countdown-days]")?.getAttribute("data-gift-countdown-days")).toBe("15");
    expect(container.querySelector("[data-gift-of-the-day]")).not.toBeNull();
    // Owner 11-20 12:30 PM: ONE slim line (no card, no thumbnail, no tip box), the tools in their own row.
    expect(container.querySelector("[data-gift-of-the-day] img, .gg-hint, [data-gift-fun-tool]")).toBeNull();
    expect(container.querySelector("[data-gift-giveaway-on]")).toBeNull();
    act(() => cleanup());
    const tools = render(<MemoryRouter><GiftTools /></MemoryRouter>).container;
    expect([...tools.querySelectorAll("[data-gift-fun-tool]")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner", "/gift-guides/printables"]);
    expect(tools.querySelector("style")?.textContent).toMatch(/\.gg-fun-tools\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
    act(() => cleanup());
    const after = render(<MemoryRouter><GiftCountdown now={la("2026-12-27")} /></MemoryRouter>);
    expect(after.container.querySelector("[data-gift-countdown-days]")).toBeNull();
    expect(after.container.querySelector("[data-gift-of-the-day]")).not.toBeNull();
  });
});

describe("security review of #4791", () => {
  it("names: invisible and direction characters are stripped; links, emails and phone numbers are refused", () => {
    expect(cleanName(`  Cal\u202E\u200B `)).toBe("Cal");
    expect(cleanNames(["Ann", "\u200B", " Ben "])).toEqual(["Ann", "Ben"]);
    expect(nameProblem("Ann")).toBeNull();
    expect(nameProblem("Mary-Kate")).toBeNull();
    expect(nameProblem("Claim your gift: bit.ly/x")).toBe("link");
    expect(nameProblem("https://evil.example")).toBe("link");
    expect(nameProblem("me@mail.com")).toBe("link");
    expect(nameProblem("www.example")).toBe("link");
    expect(nameProblem("Call 337-555-0100")).toBe("phone");
    expect(cleanName("x".repeat(40))).toHaveLength(30);
    expect(cleanName(`Ann\u0007\u061C\u180E`)).toBe("Ann");
  });

  it("the server strips the same characters as the shared client cleaner (src/lib/giftNameClean.ts)", () => {
    // The NEWEST definition of secret_santa_create (guardsReadTheNewestMigration: a later migration restated
    // export_my_data from the same file, so the file is no longer pinned by name).
    const sql = newestFunction("secret_santa_create").body;
    const client = readFileSync(join(process.cwd(), "src/lib/giftNameClean.ts"), "utf8");
    const set = (src: string, re: RegExp) => (re.exec(src)?.[1] ?? "").toLowerCase().replace(/\\u0000-/, "\\u0001-");
    const clientSet = set(client, /name\.replace\(\/\[([^\]]+)\]\/g/);
    const serverSet = set(sql, /regexp_replace\(COALESCE\(p_names\[i\], ''\), '\[([^\]]+)\]'/);
    expect(clientSet.length).toBeGreaterThan(20);
    expect(serverSet).toBe(clientSet);
  });

  it("the planner: another account's device copy is never shown, never uploaded, and sign-out clears it", async () => {
    // A's planner, saved on this device while A was signed in.
    window.localStorage.setItem(PLANNER_KEY, JSON.stringify({ ownerId: "user-a", plan: { updatedAt: Date.now(), people: [{ id: "p", name: "Mom", budget: 50, ideas: [] }] } }));
    // Signed out: the next person sees nothing.
    setPlanViewer(null);
    const out = renderHook(() => usePlan());
    expect(out.result.current.people).toEqual([]);
    out.unmount();
    // B signs in (B has no account copy yet): A's plan is neither shown nor uploaded into B's account.
    resetPlanStoreForTests();
    loadAccountPlan.mockResolvedValue(null);
    saveAccountPlan.mockResolvedValue(undefined);
    const b = renderHook(() => ({ plan: usePlan(), sync: useAccountSync("user-b", true) }));
    await waitFor(() => expect(b.result.current.sync).toBe("account"));
    expect(b.result.current.plan.people).toEqual([]);
    await new Promise((r) => setTimeout(r, 900));
    for (const call of saveAccountPlan.mock.calls) expect((call[1] as GiftPlan).people).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(PLANNER_KEY)!).ownerId).toBe("user-b");
    b.unmount();
  });

  it("the planner: a signed-out draft is kept and uploaded on sign-in; sign-out removes the device copy and the in-memory one", async () => {
    setPlanViewer(null);
    planActions.addPerson("Dad");
    expect(JSON.parse(window.localStorage.getItem(PLANNER_KEY)!).ownerId).toBeNull();
    loadAccountPlan.mockResolvedValue(null);
    saveAccountPlan.mockResolvedValue(undefined);
    const a = renderHook(() => ({ plan: usePlan(), sync: useAccountSync("user-a", true) }));
    await waitFor(() => expect(saveAccountPlan).toHaveBeenCalled());
    expect((saveAccountPlan.mock.calls[0][1] as GiftPlan).people.map((p) => p.name)).toEqual(["Dad"]);
    expect(a.result.current.plan.people.map((p) => p.name)).toEqual(["Dad"]);
    act(() => clearPlannerDevice());
    expect(window.localStorage.getItem(PLANNER_KEY)).toBeNull();
    expect(a.result.current.plan.people).toEqual([]);
    a.unmount();
  });

  it("the drawer's done screen says not to open other people's links, and shows no match", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/fun/SecretSanta.tsx"), "utf8");
    expect(src).toContain("{W.santaNoPeek}");
    expect(src).not.toMatch(/givesTo\[|names\[givesTo/);
  });
});

describe("UX audit of #4791", () => {
  const css = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/fun/FunPage.tsx"), "utf8");
  it("H1: the planner's budget and price boxes keep their width over the generic flex:1 rules, and the add row wraps at 320", () => {
    // (0,2,0) beats `.gg-plan-head input` (0,1,1) and `.gg-fun-row>input` (0,1,1).
    expect(css).toContain(".gg-plan-head .gg-plan-budget,.gg-fun-row>.gg-plan-price,.gg-plan-idea .gg-plan-price{flex:0 0 auto}");
    expect(css).toContain(".gg-plan-add{flex-wrap:wrap}");
    expect(css).toContain("@media (max-width:379px){.gg-plan-add>input:first-child{flex:1 1 100%}}");
    expect(css).toMatch(/\.gg-fun input,\.gg-fun select\{[^}]*min-width:0/);
    expect(readFileSync(join(process.cwd(), "src/pages/info/giftGuides/fun/GiftPlanner.tsx"), "utf8")).toContain('className="gg-fun-row gg-plan-add mt-2"');
  });
  it("M3 and M5: a 44px Bought target; theme-token borders", () => {
    expect(css).toContain(".gg-plan-check{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px");
    expect(css).not.toContain("#ddd8cc");
  });
  it("H2: the reveal buttons wrap within the screen and use the short words", async () => {
    reveal.mockResolvedValue({ name: "Mary Beth", match: "Thibodeaux-Broussard Jr.", budget: 25, exchangeOn: null, size: 4, matchWishList: "abcde1234567", myWishList: null });
    const { container } = render(
      <MemoryRouter initialEntries={[revealPath("abcdef0123", "c".repeat(64))]}>
        <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-reveal-their-list]")).not.toBeNull());
    const btn = container.querySelector("[data-reveal-their-list]")!;
    expect(btn.textContent).toBe("See their wish list");
    expect(btn.className).toMatch(/whitespace-normal/);
    expect(btn.className).toMatch(/max-w-full/);
    // L5: no Share with an empty list.
    expect(container.querySelector("[data-reveal-share-mine]")).toBeNull();
  });
  it("L3: a duplicate name is named in the spelling typed first", () => {
    expect(duplicateName(["Ann", "ben", "Ben"])).toBe("ben");
  });
});

describe("verify audit of #4791", () => {
  it("H1 and the pair row: the fun lists' grid column may shrink to the card (no implicit auto column)", () => {
    const css = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/fun/FunPage.tsx"), "utf8");
    expect(css).toMatch(/\.gg-fun-list\{[^}]*display:grid;grid-template-columns:minmax\(0,1fr\)/);
    expect(css).toContain(".gg-fun-list>li{min-width:0}");
  });
  it("M7: a shared Gift of the Day opens the pick's own guide", async () => {
    const items = await loadSearchItems();
    const top = topPicks();
    expect(top.length).toBeGreaterThan(3);
    const paths = top.map((p) => giftOfTheDayPath(p.name, items));
    const toGuides = paths.filter((x) => x.startsWith("/gift-guides/"));
    expect(toGuides.length).toBeGreaterThan(top.length / 2);
    for (const x of toGuides) expect(guideBySlug(x.replace("/gift-guides/", "").split("#")[0]), x).toBeDefined();
    // Until the index is in, and for a pick no guide lists: the landing at the card.
    expect(giftOfTheDayPath(top[0].name, null)).toBe("/gift-guides#gift-of-the-day");
    expect(giftOfTheDayPath("No such gift", items)).toBe("/gift-guides#gift-of-the-day");
  });
  it("a refusal clears as soon as the form changes", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/fun/SecretSanta.tsx"), "utf8");
    expect(src).toContain("onChange={() => setError(null)}");
  });
});
