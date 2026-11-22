/**
 * Managing a "Save for someone" list (owner 2026-11-21, on the live sheet: "How do they edit or remove items in the
 * list or delete the list? I entered the budget as 100 but it doesn't say how much I have left to spend or how much
 * I'm over").
 *   - Every list total says where it stands: "5 gifts · $163.25 · $63.25 over" (warning ink) or
 *     "... · $36.75 left" (owner 11-21: no "your $100"), worked out in whole cents; no budget: the count and total only.
 *   - The picker's boxes say when the gift is on the list (tap again to take it off) and hold Open, Edit and Delete
 *     icons (owner 11-21: "Remove view list. Add an open icon in the box ... same for edit and delete"); Done says
 *     "Saved for Zander · View list".
 *   - A list's sheet: Remove with Undo, Edit name and budget, Delete list through the shared confirm dialog (never
 *     window.confirm); "Me": Clear list (confirmed), the list kept.
 *
 * @mutate src/pages/info/giftGuides/saveForPeople.ts |   const cents = Math.round(p.budget * 100) - Math.round(listTotal(p).amount * 100); |   const cents = p.budget - listTotal(p).amount;
 * @mutate src/pages/info/giftGuides/saveForPeople.ts |   return cents < 0 ? { kind: "over" |   return cents > 0 ? { kind: "over"
 * @mutate src/pages/info/giftGuides/ManageList.tsx |     successToast(WISH.removedGift(idea.name), { action: { label: WISH.undo, onClick: () => planActions.restoreIdea(p.id, idea, index) } }); |     successToast(WISH.removedGift(idea.name));
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |     return { ...p, ideas: [...p.ideas.slice(0, at), idea, ...p.ideas.slice(at)] }; |     return { ...p, ideas: [...p.ideas, idea] };
 * @mutate src/pages/info/giftGuides/ManageList.tsx |         onPrimary={() => { planActions.removePerson(p.id); setConfirming(false); }} |         onPrimary={() => { setConfirming(false); }}
 * @mutate src/pages/info/giftGuides/ManageList.tsx |     planActions.setBudget(p.id, b); |     void b;
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |     if (r === "added") onAdded(p.id, p.name); |     void r;
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |             {on && <small className="gg-savefor-on" data-savefor-on={p.id}>{WISH.onListHint}</small>} |             {null}
 * @mutate src/pages/info/giftGuides/ManageList.tsx |   if (pick) return <PickThumb pick={pick} size={40} />; |   if (false) return <PickThumb pick={pick} size={40} />;
 * @mutate src/pages/info/giftGuides/ManageList.tsx |         onPrimary={() => { if (p) planActions.removePerson(p.id); else emptyWishList(); setConfirming(false); }} |         onPrimary={() => { setConfirming(false); }}
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |         <ListTools p={p} ready={ready} onOpen={() => { closeSaveFor(); openMyLists(p.id); }} /> |         {null}
 * @mutate src/pages/info/giftGuides/giftList.tsx | export const emptyWishList = () => write({ ...read(), picks: [] }); | export const emptyWishList = () => write(EMPTY);
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ successToast: toasts.success, errorToast: toasts.error }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(), setSecretSantaWishList: vi.fn(), createSecretSanta: vi.fn(), SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(async () => null), saveAccountPlan: vi.fn(async () => undefined),
}));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  requestWishLink: vi.fn(async () => ({ id: "11111111-2222-4333-8444-555555555555", link: null })),
  readWishLinks: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, null]))),
  shareGiftLists: vi.fn(async () => "abcdef123456"),
}));

import { SaveForSomeone } from "@/pages/info/giftGuides/SaveForSomeone";
import { ListLine } from "@/pages/info/giftGuides/ManageList";
import { budgetStatus, openMyLists, requestSaveFor } from "@/pages/info/giftGuides/saveForPeople";
import { planActions, resetPlanStoreForTests, setPlanViewer, usePlan } from "@/pages/info/giftGuides/fun/plannerStore";
import { addToWishList, giftListNow, resetGiftListForTests, setListName } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import type { PlanPerson } from "@/content/giftGuideFun1120";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";

const person = (budget: number | undefined, prices: number[]): PlanPerson => ({
  id: "z", name: "Zander", ...(budget !== undefined ? { budget } : {}),
  ideas: prices.map((price, k) => ({ id: `i${k}`, name: `Gift ${k}`, bought: false, price })),
});
const GIFT = { name: "Cozy Throw", href: "https://www.amazon.com/dp/B000000009?tag=louisianahelpr-20", price: 24.5 };

let zander = "";
beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
  resetGiftListForTests();
  resetHintsForTests();
  toasts.success.mockReset();
  setPlanViewer(null);
  zander = planActions.addPerson("Zander")!;
  planActions.setBudget(zander, 100);
  for (const [k, price] of [99.99, 20, 20, 13.26, 10].entries()) planActions.addIdea(zander, { name: `Gift ${k}`, price });
});
afterEach(() => cleanup());

function Host() {
  usePlan();
  return <SaveForSomeone />;
}
const mount = () => render(<MemoryRouter><Host /></MemoryRouter>);
const sheet = () => document.querySelector<HTMLElement>("[data-mylists-panel]");

describe("where a list stands against its budget", () => {
  it("over or left, in whole cents; no budget, nothing", () => {
    expect(budgetStatus(person(100, [99.99, 20, 20, 13.26, 10]))).toEqual({ kind: "over", amount: 63.25, budget: 100 });
    expect(budgetStatus(person(200, [99.99, 20, 20, 13.26, 10]))).toEqual({ kind: "left", amount: 36.75, budget: 200 });
    // 0.1 + 0.2 is 0.30000000000000004 in floating point: whole cents say exactly $0 left.
    expect(budgetStatus(person(0.3, [0.1, 0.2]))).toEqual({ kind: "left", amount: 0, budget: 0.3 });
    expect(budgetStatus(person(undefined, [5]))).toEqual({ kind: "none" });
  });

  it("the line: count, total and the budget part, the over part in warning ink", () => {
    const over = render(<ListLine p={person(100, [99.99, 20, 20, 13.26, 10])} />).container;
    expect(over.textContent).toBe("5 gifts · $163.25 · $63.25 over");
    expect(over.querySelector("[data-list-over]")?.className).toBe("gg-list-over");
    cleanup();
    expect(render(<ListLine p={person(200, [99.99, 20, 20, 13.26, 10])} />).container.textContent).toBe("5 gifts · $163.25 · $36.75 left");
    cleanup();
    expect(render(<ListLine p={person(undefined, [12])} />).container.textContent).toBe("1 gift · $12");
    const css = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/giftWishStyles.ts"), "utf8");
    expect(css).toContain(".gg-list-over{color:hsl(var(--amber-ink));font-weight:700}");
  });
});

describe("the Save for someone sheet", () => {
  it("each row shows the budget line live, says when the gift is on the list, and a second tap takes it off", async () => {
    mount();
    act(() => { requestSaveFor(GIFT); });
    const row = await waitFor(() => document.querySelector<HTMLButtonElement>(`[data-savefor-person="${zander}"]`)!);
    expect(document.querySelector(`[data-savefor-total="${zander}"]`)?.textContent).toBe("5 gifts · $163.25 · $63.25 over");
    expect(row.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(`[data-savefor-total="${zander}"]`)?.textContent).toBe("6 gifts · $187.75 · $87.75 over"));
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(row.getAttribute("aria-label")).toBe("Remove Cozy Throw from Zander's list");
    expect(document.querySelector(`[data-savefor-on="${zander}"]`)?.textContent).toBe("On the list · tap to remove");
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(`[data-savefor-total="${zander}"]`)?.textContent).toBe("5 gifts · $163.25 · $63.25 over"));
    expect(document.querySelector(`[data-savefor-on="${zander}"]`)).toBeNull();
  });

  it("Done says Saved for Zander, and its View list opens Zander's list", async () => {
    mount();
    act(() => { requestSaveFor(GIFT); });
    fireEvent.click(await waitFor(() => document.querySelector<HTMLButtonElement>(`[data-savefor-person="${zander}"]`)!));
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-savefor-done]")!);
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const [msg, opts] = toasts.success.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toBe("Saved for Zander");
    expect(opts.action.label).toBe("View list");
    act(() => { opts.action.onClick(); });
    await waitFor(() => expect(sheet()?.getAttribute("data-mylists-panel")).toBe(zander));
  });

  it("the Open icon in a box opens that person's list; Edit and Delete are there too, apart from the save tap", async () => {
    mount();
    act(() => { requestSaveFor(GIFT); });
    const open = await waitFor(() => document.querySelector<HTMLButtonElement>(`[data-savefor-open="${zander}"]`)!);
    expect(open.getAttribute("aria-label")).toBe("Open Zander's list");
    expect(document.querySelector(`[data-savefor-edit="${zander}"]`)?.getAttribute("aria-label")).toBe("Edit Zander's name and budget");
    expect(document.querySelector(`[data-savefor-delete="${zander}"]`)?.getAttribute("aria-label")).toBe("Delete Zander's list");
    // The icons are their own buttons, never inside the save/remove tap.
    expect(document.querySelector(`[data-savefor-person="${zander}"]`)!.contains(open)).toBe(false);
    expect(document.querySelector("[data-savefor-view]")).toBeNull();
    fireEvent.click(open);
    await waitFor(() => expect(sheet()?.getAttribute("data-mylists-panel")).toBe(zander));
    expect(document.querySelector("[data-savefor-picker]")).toBeNull();
  });

  it("Edit in the box changes the budget there; Delete in the box asks first, then removes the list", async () => {
    mount();
    act(() => { requestSaveFor(GIFT); });
    fireEvent.click(await waitFor(() => document.querySelector<HTMLButtonElement>(`[data-savefor-edit="${zander}"]`)!));
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-list-edit-budget]")!, { target: { value: "200" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-list-edit-save]")!);
    await waitFor(() => expect(document.querySelector(`[data-savefor-total="${zander}"]`)?.textContent).toBe("5 gifts · $163.25 · $36.75 left"));
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[data-savefor-delete="${zander}"]`)!);
    const dialog = await waitFor(() => [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((d) => d.textContent?.includes("Delete Zander's list?"))!);
    fireEvent.click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete list")!);
    await waitFor(() => expect(planPeople()).toEqual([]));
  });
});

describe("a list's own sheet", () => {
  const openZander = async () => {
    mount();
    act(() => { openMyLists(zander); });
    await waitFor(() => expect(sheet()).not.toBeNull());
  };

  it("Remove takes a gift off with an Undo that puts it back where it was", async () => {
    await openZander();
    const second = planActionsIdeaIds()[1];
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[data-mylists-remove="${second}"]`)!);
    expect(planActionsIdeaIds()).not.toContain(second);
    const [msg, opts] = toasts.success.mock.calls[toasts.success.mock.calls.length - 1] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toBe("Removed Gift 1");
    expect(opts.action.label).toBe("Undo");
    act(() => { opts.action.onClick(); });
    expect(planActionsIdeaIds()[1]).toBe(second);
  });

  it("Edit changes the budget and the line follows", async () => {
    await openZander();
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[data-list-edit-open="${zander}"]`)!);
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-list-edit-budget]")!, { target: { value: "200" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-list-edit-save]")!);
    await waitFor(() => expect(document.querySelector(`[data-mylists-total="${zander}"]`)?.textContent).toBe("5 gifts · $163.25 · $36.75 left"));
  });

  it("Delete list asks first in the app's own dialog, never window.confirm, then removes the person", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await openZander();
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[data-list-delete="${zander}"]`)!);
    const dialog = await waitFor(() => {
      const d = [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((x) => x.textContent?.includes("Delete Zander's list?"));
      expect(d).toBeTruthy();
      return d!;
    });
    expect(dialog.textContent).toContain("the 5 gifts");
    const yes = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete list")!;
    fireEvent.click(yes);
    await waitFor(() => expect(planPeople()).toEqual([]));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Me: Clear list empties My Wish List after asking, and keeps its name", async () => {
    setListName("Lexi's list");
    addToWishList({ href: GIFT.href, name: GIFT.name });
    mount();
    act(() => { openMyLists("me"); });
    fireEvent.click(await waitFor(() => document.querySelector<HTMLButtonElement>("[data-list-clear]")!));
    const dialog = await waitFor(() => [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((x) => x.textContent?.includes("Clear My Wish List?"))!);
    fireEvent.click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Clear list")!);
    await waitFor(() => expect(giftListNow().picks).toEqual([]));
    expect(giftListNow().name).toBe("Lexi's list");
  });

  it("a guide pick saved without its photo shows the pick's photo; a typed idea shows the gift icon, never a gap", async () => {
    await loadAllGuidePicks();
    const pick = guideBySlug("her")!.picks.find((p) => p.image)!;
    const id = planActions.addPerson("Ann")!;
    planActions.addIdea(id, { name: pick.name, href: pick.href });
    planActions.addIdea(id, { name: "zzqx typed idea" });
    mount();
    act(() => { openMyLists(id); });
    await waitFor(() => expect(sheet()?.querySelector(`img[src="${pick.image}"]`)).not.toBeNull());
    expect(sheet()!.querySelectorAll("[data-list-gift-icon]")).toHaveLength(1);
  });

  it("no window.confirm anywhere in the sheet's source", () => {
    for (const f of ["ManageList.tsx", "SaveForSomeone.tsx"]) {
      expect(readFileSync(join(process.cwd(), "src/pages/info/giftGuides", f), "utf8")).not.toMatch(/window\.confirm|\bconfirm\(/);
    }
  });
});

function planPeople() {
  return (JSON.parse(window.localStorage.getItem("lh-gift-planner") ?? "{}") as { plan?: { people?: { id: string }[] } }).plan?.people ?? [];
}
function planActionsIdeaIds() {
  return ((JSON.parse(window.localStorage.getItem("lh-gift-planner") ?? "{}") as { plan?: { people?: { ideas: { id: string }[] }[] } }).plan?.people?.[0]?.ideas ?? []).map((i) => i.id);
}
