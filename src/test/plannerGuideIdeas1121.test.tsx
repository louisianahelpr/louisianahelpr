/**
 * Gift planner "From our guides" (owner 2026-11-21, "let them add ideas from our guides"): each person in the planner
 * has a picker of the live guides' picks (Her, Him, Kids), with a search box and All / Her / Him / Kids chips. Tapping a
 * pick adds it to that person with its name, the price its guide shows, its shop link and its photo; the idea then
 * shows its photo and a "Shop" link in the planner, and the pick reads "Added". A name that plainly names a guide
 * ("Mom") opens on that guide's chip. A planner idea keeps only an https photo link.
 *
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |     A.addIdea(p.id, { name: g.name, href: g.href, guide: g.guide, | A.addIdea(p.id, { name: g.name, guide: g.guide,
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx | ...(price !== undefined ? { price } : {}), ...(g.image ? { image: g.image } : {}) }); | ...(g.image ? { image: g.image } : {}) });
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |                 {i.href && ( |                 {false && (
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |               {i.image && <PickThumb | {false && <PickThumb
 * @mutate src/pages/info/giftGuides/fun/GuidePicksPicker.tsx |   const rows = all.filter((p) => (!only \|\| p.guide === only) && matchesSearch(p, query)); |   const rows = all.filter((p) => matchesSearch(p, query));
 * @mutate src/pages/info/giftGuides/fun/GuidePicksPicker.tsx |   return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w)); |   return true;
 * @mutate src/pages/info/giftGuides/fun/GuidePicksPicker.tsx |     setOnly(guideForName(personName)); |     setOnly(null);
 * @mutate src/content/giftGuideFun1120.ts | typeof d.image === "string" && /^https:\/\//.test(d.image) | typeof d.image === "string"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  loadAccountPlan: vi.fn(),
  saveAccountPlan: vi.fn(),
}));
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { guideForName, livePicks } from "@/pages/info/giftGuides/fun/GuidePicksPicker";
import { resetPlanStoreForTests } from "@/pages/info/giftGuides/fun/plannerStore";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { cleanPlan } from "@/content/giftGuideFun1120";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";

// The guides' prices show for 3 days after their check day: pin "today" to the chunk's check day.
const HER = JSON.parse(readFileSync(join(process.cwd(), "src/content/giftGuidePicks/her.json"), "utf8")) as { picks: { priceAt?: string }[] };
const CHECK_DAY = HER.picks.find((p) => p.priceAt)?.priceAt ?? "2026-11-21";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${CHECK_DAY}T18:00:00Z`));
  window.localStorage.clear();
  resetPlanStoreForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetGiftListForTests();
  resetHintsForTests();
});

const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);

function addPerson(c: HTMLElement, name: string) {
  fireEvent.change(c.querySelector("[data-plan-new-name]")!, { target: { value: name } });
  fireEvent.click(c.querySelector("[data-plan-add-person]")!);
}

describe("gift planner: add ideas from our guides", () => {
  it("the picker lists the live guides' picks with photo, name and price; a tap adds name, price, link and photo; the idea shows Shop", async () => {
    await loadAllGuidePicks();
    const live = livePicks();
    // Inventory floor: Her, Him and Kids hold 139 picks today (36 + 47 + 56).
    expect(live.length).toBeGreaterThan(100);
    expect(new Set(live.map((p) => p.guide))).toEqual(new Set(["her", "him", "kids"]));

    const { container: c } = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    addPerson(c, "Aunt Claire");
    await waitFor(() => expect(c.querySelector("[data-plan-from-guides]")).not.toBeNull());
    fireEvent.click(c.querySelector("[data-plan-from-guides]")!);
    const sheet = await waitFor(() => {
      const d = document.querySelector<HTMLElement>("[data-plan-picker]");
      expect(d).not.toBeNull();
      return d!;
    });
    await waitFor(() => expect(sheet.querySelectorAll("[data-plan-pick]").length).toBe(live.length));
    // "Aunt Claire" names no guide plainly: All is on.
    expect(sheet.querySelector('[data-plan-picker-chip="all"]')!.getAttribute("aria-pressed")).toBe("true");
    const first = live[0];
    const row = sheet.querySelector<HTMLElement>(`[data-plan-pick="${first.href}"]`)!;
    expect(row.textContent).toContain(first.name);
    expect(row.querySelector("img")?.getAttribute("src")).toBe(first.image);
    expect(row.querySelector("[data-gift-price]")?.textContent).toBe(`~$${Math.max(1, Math.round(first.price!))}`);

    // The chips narrow; the search narrows.
    fireEvent.click(sheet.querySelector('[data-plan-picker-chip="kids"]')!);
    expect(sheet.querySelectorAll("[data-plan-pick]").length).toBe(live.filter((p) => p.guide === "kids").length);
    fireEvent.click(sheet.querySelector('[data-plan-picker-chip="all"]')!);
    const word = first.name.split(/\s+/).find((w) => w.length > 4)!;
    fireEvent.change(sheet.querySelector("[data-plan-picker-search]")!, { target: { value: word } });
    const hits = sheet.querySelectorAll("[data-plan-pick]").length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(live.length);
    fireEvent.change(sheet.querySelector("[data-plan-picker-search]")!, { target: { value: "zzqx nothing" } });
    expect(sheet.querySelector("[data-plan-picker-none]")).not.toBeNull();
    fireEvent.change(sheet.querySelector("[data-plan-picker-search]")!, { target: { value: "" } });

    // Tap: stored with its name, the shown price, its link and its photo; the row now reads Added.
    fireEvent.click(sheet.querySelector(`[data-plan-pick="${first.href}"]`)!);
    const idea = stored().people[0].ideas[0];
    expect(idea).toMatchObject({ name: first.name, href: first.href, price: first.price, image: first.image, guide: first.guide, bought: false });
    await waitFor(() => expect(sheet.querySelector<HTMLButtonElement>(`[data-plan-pick="${first.href}"]`)!.disabled).toBe(true));
    expect(within(sheet).getAllByText("Added").length).toBe(1);
    // A second tap adds nothing.
    fireEvent.click(sheet.querySelector(`[data-plan-pick="${first.href}"]`)!);
    expect(stored().people[0].ideas).toHaveLength(1);

    // In the planner: the photo and a Shop link to the item; the price box holds the price.
    const li = c.querySelector<HTMLElement>(`[data-plan-idea="${idea.id}"]`)!;
    expect(li.querySelector("img")?.getAttribute("src")).toBe(first.image);
    const shop = li.querySelector(`[data-plan-shop="${idea.id}"]`)!.closest("a")!;
    expect(shop.textContent).toContain("Shop");
    expect(shop.getAttribute("href")).toBe(first.href);
    expect(shop.getAttribute("rel")).toBe("sponsored noopener");
    expect((li.querySelector("[data-plan-price]") as HTMLInputElement).value).toBe(String(first.price));
    // Bought still works on it, and moves the money.
    fireEvent.click(li.querySelector("[data-plan-bought]")!);
    expect(stored().people[0].ideas[0].bought).toBe(true);
  });

  it("a name that plainly names a guide opens on its chip; anything else opens on All", async () => {
    expect(guideForName("Mom")).toBe("her");
    expect(guideForName("dad")).toBe("him");
    expect(guideForName("Kids")).toBe("kids");
    expect(guideForName("Aunt Claire")).toBeNull();
    await loadAllGuidePicks();
    const { container: c } = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    addPerson(c, "Mom");
    await waitFor(() => expect(c.querySelector("[data-plan-from-guides]")).not.toBeNull());
    fireEvent.click(c.querySelector("[data-plan-from-guides]")!);
    const sheet = await waitFor(() => document.querySelector<HTMLElement>("[data-plan-picker]")!);
    expect(sheet.querySelector('[data-plan-picker-chip="her"]')!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(sheet.querySelectorAll("[data-plan-pick]").length).toBe(livePicks().filter((p) => p.guide === "her").length));
  });

  it("a planner idea keeps only an https photo link", () => {
    const plan = cleanPlan({ people: [{ id: "a", name: "A", ideas: [
      { id: "1", name: "x", image: "https://m.media-amazon.com/images/I/a.jpg" },
      { id: "2", name: "y", image: "javascript:alert(1)" },
      { id: "3", name: "z", image: `https://e.com/${"a".repeat(500)}` },
    ] }] });
    expect(plan.people[0].ideas.map((i) => i.image)).toEqual(["https://m.media-amazon.com/images/I/a.jpg", undefined, undefined]);
  });
});
