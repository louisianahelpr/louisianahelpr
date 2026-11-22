/**
 * The gift planner's budget and price boxes carry a "$" inside them (holiday audit 1121 #17), but it never showed
 * (reported 2026-11-22 by the planner polish lane, screenshots before and after). The "$" was in the DOM
 * (holidayListsLows1121 checks its text) yet painted over: the box is the shared Input, whose glass-field look has a
 * backdrop blur. A backdrop blur makes the box its own layer, and a layer paints with the positioned things, in DOM
 * order, so the box (after the "$") painted over it with its opaque fill. The fix drops the blur on a money box, as
 * index.css already does for any field with an icon over it; the box then paints in the normal flow, before the "$".
 *
 * This reads the computed style with the app's real glass-field rule (copied from src/index.css, as the app's
 * stylesheet is not loaded in jsdom) and the planner's own CSS, and asks the painting question: is the box a layer of
 * its own while the "$" has no z-index above it? Red on the old code (the box computed backdrop-filter: blur(4px)).
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun .gg-money-box input{width:100%;padding-left:22px;-webkit-backdrop-filter:none;backdrop-filter:none} | .gg-fun .gg-money-box input{width:100%;padding-left:22px}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-money-box .gg-money-sign{position:absolute;left:11px;top:50%;transform:translateY(-50%); | .gg-money-box .gg-money-sign{position:static;left:11px;top:50%;transform:translateY(-50%);
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";

beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
  setPlanViewer(null);
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-test-app-css]").forEach((s) => s.remove());
});

/** The app's glass-field rule, exactly as src/index.css declares it (the top-level block, not :focus-visible). */
function glassFieldRule(): string {
  const css = readFileSync("src/index.css", "utf8");
  const m = /^\.glass-field \{[^}]*\}/m.exec(css);
  if (!m) throw new Error("src/index.css has no top-level .glass-field rule: update this test to the field's new look");
  return m[0];
}

/** True when the element is painted as a layer of its own (a stacking context or a positioned box). */
function paintsAsLayer(el: Element): boolean {
  const cs = getComputedStyle(el);
  const set = (v: string, none: string) => v !== "" && v !== none;
  return (
    set(cs.position, "static") ||
    set(cs.getPropertyValue("backdrop-filter"), "none") ||
    set(cs.getPropertyValue("filter"), "none") ||
    set(cs.getPropertyValue("transform"), "none") ||
    set(cs.getPropertyValue("isolation"), "auto") ||
    set(cs.getPropertyValue("mix-blend-mode"), "normal") ||
    (cs.opacity !== "" && Number(cs.opacity) < 1)
  );
}

describe("the planner's $ shows inside its budget and price boxes", () => {
  it("the box never paints over its $ (no backdrop blur, no layer of its own above a z-index:auto $)", async () => {
    const style = document.createElement("style");
    style.setAttribute("data-test-app-css", "");
    style.textContent = glassFieldRule();
    document.head.appendChild(style);
    // Control: the rule really computes in jsdom, so a pass below is not a parser that read nothing.
    const probe = document.createElement("input");
    probe.className = "glass-field";
    document.body.appendChild(probe);
    expect(getComputedStyle(probe).getPropertyValue("backdrop-filter")).toBe("blur(4px)");
    probe.remove();

    const mom = planActions.addPerson("Mom")!;
    planActions.setBudget(mom, 100);
    planActions.addIdea(mom, { name: "Mug", price: 12 });
    planActions.addIdea(mom, { name: "Scarf", price: 30 });
    const { container } = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    const boxes = await waitFor(() => {
      const b = [...container.querySelectorAll(".gg-money-box")];
      expect(b.length).toBeGreaterThan(2); // the budget and both prices
      return b;
    });
    for (const box of boxes) {
      const sign = box.querySelector(".gg-money-sign")!;
      const input = box.querySelector("input")!;
      expect(sign.textContent).toBe("$");
      expect(input.classList.contains("glass-field"), "the box is the shared field (else this test checks nothing)").toBe(true);
      // The $ sits over the box: positioned, and before the input in the DOM.
      expect(getComputedStyle(sign).position).toBe("absolute");
      expect(sign.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const signZ = Number.parseInt(getComputedStyle(sign).zIndex, 10);
      const signLifted = Number.isFinite(signZ) && signZ > 0;
      expect(
        signLifted || !paintsAsLayer(input),
        `${input.getAttribute("aria-label")}: the box is a layer (backdrop-filter ${getComputedStyle(input).getPropertyValue("backdrop-filter")}) painted after its z-index:auto $, so it covers it`,
      ).toBe(true);
      expect(getComputedStyle(input).getPropertyValue("backdrop-filter")).toBe("none");
    }
  });

  it("the $ sits in the box's left padding, vertically centred", () => {
    const css = readFileSync("src/pages/info/giftGuides/fun/FunPage.tsx", "utf8");
    const rule = (sel: string) => {
      const at = css.lastIndexOf(`${sel}{`);
      return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
    };
    const sign = rule(".gg-money-box .gg-money-sign");
    expect(sign).toMatch(/position:absolute;left:(\d+)px;top:50%;transform:translateY\(-50%\)/);
    const left = Number(/left:(\d+)px/.exec(sign)?.[1]);
    for (const sel of [".gg-fun .gg-money-box input", ".gg-fun .gg-plan-idea .gg-money-box input"]) {
      const pad = Number(/padding-left:(\d+)px/.exec(rule(sel))?.[1]);
      // The $ glyph is about 9px wide at 15px: the words start after it, never under it.
      expect(pad - left, sel).toBeGreaterThanOrEqual(9);
    }
  });
});
