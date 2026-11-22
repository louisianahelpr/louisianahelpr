/**
 * Owner 2026-11-22 on her iPhone, the gift planner (people, "Share this list", "Remove Her", "Add a person", "Price
 * drop alerts"): "This needs a major polish". One card per person ending in one action row (Share this list the
 * primary button with the 90-day note as small help under it; Remove a small quiet button that asks first); "Add a
 * person" one compact 44px row; the alerts card a title, a line, the email, ONE consent box with its words beside it
 * (the guides' `.gg-fun label{display:block}` rule had pushed the box onto its own line) and the button; the
 * saved-where line one small line; the links one styled row. Every function and test id kept.
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun label.gg-alerts-consent{display:flex; | .gg-fun label.gg-alerts-consent{display:block;
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |         onPrimary={() => { setConfirming(false); removePerson(); }} |         onPrimary={() => setConfirming(false)}
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx | onClick={() => setConfirming(true)} data-plan-remove={p.id} | onClick={removePerson} data-plan-remove={p.id}
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx | <p className="gg-plan-help" data-plan-share-note={p.id}> | <p className="gg-plan-help" hidden data-plan-share-note={p.id}>
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |   if (lists.length === 0 \|\| (lists.length === 1 && !soloNote)) return null; |   if (lists.length === 0) return null;
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import { WISH } from "@/content/giftWishList";
import { FUN_WORDS as W } from "@/content/giftGuideFun1120";

beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
  setPlanViewer(null);
});
afterEach(() => cleanup());

const css = readFileSync("src/pages/info/giftGuides/fun/FunPage.tsx", "utf8");
const rule = (sel: string) => {
  const at = css.lastIndexOf(`${sel}{`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
};

describe("the planner's polish (styles)", () => {
  it("each person card spaces on 12, the action row has a top rule, Remove is small and quiet, the help text is 12px", () => {
    expect(rule(".gg-plan-person")).toMatch(/display:flex;flex-direction:column;gap:12px;padding:16px/);
    expect(rule(".gg-plan-acts")).toMatch(/border-top:1px solid var\(--gg-line\)/);
    expect(rule(".gg-fun .gg-plan-remove")).toMatch(/min-height:44px;[^}]*font-size:13px;font-weight:500;color:var\(--gg-muted\)/);
    expect(rule(".gg-plan-help")).toMatch(/font-size:12px/);
  });
  it("Add a person: the box and the button are both 44px; the consent box sits beside its words; small lines stay >= 12px", () => {
    expect(rule(".gg-plan-add input")).toMatch(/height:44px;min-height:44px/);
    expect(rule(".gg-plan-add .gg-plan-add-btn")).toMatch(/height:44px;min-height:44px/);
    expect(rule(".gg-fun label.gg-alerts-consent")).toMatch(/display:flex;align-items:flex-start;gap:10px;min-height:44px/);
    for (const sel of [".gg-alerts-small", ".gg-plan-sync", ".gg-plan-help", ".gg-alerts-lead"]) {
      const size = Number(/font-size:(\d+)px/.exec(rule(sel))?.[1]);
      expect(size, sel).toBeGreaterThanOrEqual(12);
    }
  });
});

describe("the planner's polish (page)", () => {
  const setup = async () => {
    await loadGuidePicks("her");
    const her = guideBySlug("her")!.picks;
    const mom = planActions.addPerson("Mom")!;
    planActions.addIdea(mom, { name: her[0].name, href: her[0].href, guide: "her", price: her[0].price, image: her[0].image });
    planActions.addIdea(mom, { name: "Typed idea", price: 10 });
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector(`[data-plan-person="${mom}"]`)).not.toBeNull());
    return { c: view.container, mom };
  };

  it("one action row per card: Share this list (primary) with the 90-day note under it, then the quiet Remove", async () => {
    const { c, mom } = await setup();
    const card = c.querySelector<HTMLElement>(`[data-plan-person="${mom}"]`)!;
    const acts = card.querySelector<HTMLElement>(".gg-plan-acts")!;
    expect(acts).not.toBeNull();
    const share = acts.querySelector<HTMLButtonElement>(".gg-wish-share-btn")!;
    expect(share.textContent).toBe(WISH.shareThisList);
    expect(share.classList.contains("btn-grad-primary")).toBe(true);
    const note = acts.querySelector<HTMLElement>(`[data-plan-share-note="${mom}"]`)!;
    expect(note.textContent).toContain("90 days");
    expect(note.textContent).toContain("1 gift you typed in stays private");
    expect(share.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const remove = acts.querySelector<HTMLButtonElement>(`[data-plan-remove="${mom}"]`)!;
    expect(remove.textContent).toBe(W.plannerRemovePerson("Mom"));
    expect(note.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One list: no orphan "Share all" block (its card shares it); the add row and the alerts follow the cards.
    expect(c.querySelector("[data-share-all-lists]")).toBeNull();
    const add = c.querySelector<HTMLElement>("form.gg-plan-add")!;
    expect(add.querySelector("[data-plan-new-name]")).not.toBeNull();
    expect(add.querySelector("[data-plan-add-person]")!.classList.contains("gg-plan-add-btn")).toBe(true);
  });

  it("Remove asks first; Keep leaves the person, Remove takes them off", async () => {
    const { c, mom } = await setup();
    const ask = () => {
      fireEvent.click(c.querySelector(`[data-plan-remove="${mom}"]`)!);
      return waitFor(() => {
        const d = [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((x) => x.textContent?.includes(W.plannerRemoveTitle("Mom")));
        expect(d).toBeTruthy();
        return d!;
      });
    };
    let d = await ask();
    expect(d.textContent).toContain(W.plannerRemoveBody("Mom", 2));
    fireEvent.click([...d.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === W.plannerRemoveKeep)!);
    expect(c.querySelector(`[data-plan-person="${mom}"]`)).not.toBeNull();
    const cards = c.querySelectorAll("[data-plan-person]").length;
    d = await ask();
    fireEvent.click([...d.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === W.plannerRemovePerson("Mom"))!);
    // Wait for the removal itself (one card fewer), never for an absence the first paint already has (waitForEmptyIsVacuous).
    await waitFor(() => expect(c.querySelectorAll("[data-plan-person]")).toHaveLength(cards - 1));
    expect(c.querySelector(`[data-plan-person="${mom}"]`)).toBeNull();
  });

  it("the alerts card: title, line, email, ONE consent box inside its own label (unticked), the unsubscribe line, the button", async () => {
    const { c } = await setup();
    const form = c.querySelector<HTMLElement>('[data-price-alerts="form"]')!;
    expect(form.classList.contains("gg-alerts")).toBe(true);
    expect(form.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
    const box = form.querySelector<HTMLElement>("[data-price-alerts-consent]")!;
    expect(box.getAttribute("aria-checked")).toBe("false");
    const label = box.closest("label")!;
    expect(label.classList.contains("gg-alerts-consent")).toBe(true);
    expect(label.textContent).toMatch(/^Yes, email me about price drops/);
    expect(form.querySelector(".gg-alerts-small")!.textContent).toMatch(/^Unsubscribe anytime/);
    expect(form.querySelector("[data-price-alerts-submit]")!.classList.contains("gg-alerts-btn")).toBe(true);
    // Saved-where is one small line with the log-in link inline; the way on is one row of links.
    const sync = c.querySelector<HTMLElement>("[data-plan-sync]")!;
    expect(sync.classList.contains("gg-plan-sync")).toBe(true);
    expect(sync.querySelector("a.gg-link")!.getAttribute("href")).toBe("/login");
    expect(c.querySelector(".gg-plan-more [data-plan-find-gifts]")!.getAttribute("href")).toBe("/gift-guides/swipe");
  });
});
