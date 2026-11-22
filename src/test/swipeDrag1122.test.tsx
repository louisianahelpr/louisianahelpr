/**
 * Owner 2026-11-22 on her iPhone, Swipe to Find Gifts: "These don't swipe well". The card now follows the finger
 * straight from pointer events (no React render per move: the old deck re-rendered the whole page on every pointermove
 * and its threshold read a stale state value), tilts with it, goes past 30% of its width or on a flick (fast over the
 * last 100 ms, in the direction it moves), springs back otherwise; the sent card flies off its side; Skip/Save stay;
 * up/down still scrolls (touch-action:pan-y); reduced motion: no tilt, no fly-off, no spring. Checked in WebKit
 * (iPhone 13 Mini emulation): a slow 40px drag springs back, a 150px drag saves, a quick 50px flick left skips.
 *
 * @mutate src/pages/info/giftGuides/fun/swipeGesture.ts | export const SWIPE_SHARE = 0.3; | export const SWIPE_SHARE = 0.6;
 * @mutate src/pages/info/giftGuides/fun/swipeGesture.ts |   const flick = Math.abs(speed) >= FLING_SPEED && Math.abs(dx) >= FLING_MIN && Math.sign(speed) === Math.sign(dx); |   const flick = false;
 * @mutate src/pages/info/giftGuides/fun/swipeGesture.ts |   const tilt = reduce ? "" : | const tilt = reduce ? " rotate(1deg)" :
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx |     if (go === "back" \|\| !next(go === "save", d.dx, speed)) paint(0); |     if (!next(go === "save", d.dx, speed)) paint(0);
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | @media (prefers-reduced-motion:reduce){.gg-swipe-card{transition:none;animation:none}.gg-swipe-ghost{display:none}} | @media (prefers-reduced-motion:reduce){}
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import {
  FLING_MIN, FLING_SPEED, FLING_WINDOW, SWIPE_SHARE, cardWidth, dragSpeed, dragStyle, recentSamples, swipeDecision,
} from "@/pages/info/giftGuides/fun/swipeGesture";

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe("the swipe rules (swipeGesture.ts)", () => {
  const W = 343; // the card at 375 px
  it("past 30% of the card's width it goes (right saves, left skips); short of it, it springs back", () => {
    expect(SWIPE_SHARE).toBe(0.3);
    expect(swipeDecision(Math.floor(W * 0.3) - 1, W, 0)).toBe("back");
    expect(swipeDecision(Math.ceil(W * 0.3) + 1, W, 0)).toBe("save");
    expect(swipeDecision(-(Math.ceil(W * 0.3) + 1), W, 0)).toBe("skip");
    expect(swipeDecision(0, W, 0)).toBe("back");
  });
  it("a flick goes at any distance past FLING_MIN, only in the direction it moves; slow or tiny springs back", () => {
    expect(swipeDecision(FLING_MIN + 6, W, FLING_SPEED + 0.3)).toBe("save");
    expect(swipeDecision(-(FLING_MIN + 6), W, -(FLING_SPEED + 0.3))).toBe("skip");
    expect(swipeDecision(FLING_MIN + 6, W, -(FLING_SPEED + 0.3))).toBe("back");
    expect(swipeDecision(FLING_MIN - 4, W, 3)).toBe("back");
    expect(swipeDecision(FLING_MIN + 6, W, FLING_SPEED / 2)).toBe("back");
  });
  it("speed reads only the last 100 ms", () => {
    const s = [{ x: 0, t: 0 }, { x: 10, t: 400 }, { x: 20, t: 450 }, { x: 80, t: 500 }];
    const recent = recentSamples(s, 500);
    expect(recent.every((x) => 500 - x.t <= FLING_WINDOW)).toBe(true);
    expect(recent.map((x) => x.t)).toEqual([400, 450, 500]);
    expect(dragSpeed(recent)).toBeCloseTo(70 / 100);
    expect(dragSpeed([{ x: 0, t: 5 }])).toBe(0);
    expect(recentSamples([{ x: 3, t: 0 }], 9999)).toEqual([{ x: 3, t: 0 }]);
  });
  it("the card tilts with the drag, never under reduced motion; the tags' progress runs -1..1", () => {
    expect(dragStyle(60, W, false).transform).toMatch(/^translate3d\(60px,0,0\) rotate\(2\.45deg\)$/);
    expect(dragStyle(60, W, true).transform).toBe("translate3d(60px,0,0)");
    expect(dragStyle(0, W, false)).toEqual({ transform: "", progress: 0 });
    expect(dragStyle(9999, W, false).progress).toBe(1);
    expect(dragStyle(-9999, W, true).progress).toBe(-1);
    expect(cardWidth(0)).toBeGreaterThan(200);
  });
});

describe("the deck moves from the pointer, not from React state", () => {
  const view = readFileSync("src/pages/info/giftGuides/fun/SwipeGifts.tsx", "utf8");
  const css = readFileSync("src/pages/info/giftGuides/fun/FunPage.tsx", "utf8");
  it("no drag offset in state or in the card's style prop; the move writes the style in an animation frame", () => {
    expect(view).not.toMatch(/setDx\(/);
    expect(view).not.toMatch(/style=\{\{ transform/);
    expect(view).toMatch(/requestAnimationFrame\(\(\) => \{ frame\.current = 0; if \(drag\.current\) paint\(drag\.current\.dx\); \}\)/);
    expect(view).toMatch(/onPointerCancel=\{onCancel\} onLostPointerCapture=\{onCancel\}/);
  });
  it("up/down still scrolls (pan-y), the tags follow --swipe-p, and reduced motion drops the spring and the fly-off", () => {
    expect(css).toMatch(/\.gg-swipe-stage\{[^}]*touch-action:pan-y/);
    expect(css).toMatch(/\.gg-swipe-card\{touch-action:pan-y/);
    expect(css).toContain(".gg-swipe-tag.save{left:18px;color:#3f7a2c;border-color:#3f7a2c;opacity:clamp(0,var(--swipe-p,0),1)}");
    expect(css).toContain("opacity:clamp(0,calc(var(--swipe-p,0) * -1),1)");
    expect(css).toContain("@media (prefers-reduced-motion:reduce){.gg-swipe-card{transition:none;animation:none}.gg-swipe-ghost{display:none}}");
    expect(css).toMatch(/\.gg-swipe-card\.is-dragging\{transition:none/);
  });
});

describe("dragging the card on the page", () => {
  const start = async () => {
    const { container } = render(<MemoryRouter><SwipeGifts /></MemoryRouter>);
    fireEvent.click(container.querySelector('[data-swipe-who="her"]')!);
    await waitFor(() => expect(container.querySelector('[data-swipe-budget="under-25"]')).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(container.querySelector('[data-swipe-budget="under-25"]')!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    return container;
  };
  const press = (el: Element, type: string, clientX: number) => {
    act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 })); });
  };
  const dragBy = async (c: HTMLElement, dx: number) => {
    const card = c.querySelector("[data-swipe-card]")!;
    press(card, "pointerdown", 100);
    expect(card.classList.contains("is-dragging")).toBe(true);
    press(card, "pointermove", 100 + dx / 2);
    press(card, "pointermove", 100 + dx);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    const during = (card as HTMLElement).style.transform;
    press(card, "pointerup", 100 + dx);
    return { card: card as HTMLElement, during };
  };

  it("a short drag follows the finger, then springs back to the same card", async () => {
    const c = await start();
    const first = c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    const { card, during } = await dragBy(c, FLING_MIN - 6);
    expect(during).toMatch(/^translate3d\(18px,0,0\)/);
    expect(card.classList.contains("is-dragging")).toBe(false);
    expect(card.style.transform).toBe("");
    expect(c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")).toBe(first);
    expect(c.querySelector("[data-swipe-saved-count]")).toBeNull();
  });

  it("a drag past 30% to the right saves (counted) and deals the next card; to the left skips", async () => {
    const c = await start();
    const first = c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    await dragBy(c, cardWidth(0) * SWIPE_SHARE + 30);
    const second = c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    expect(second).not.toBe(first);
    expect(c.querySelector("[data-swipe-saved-count]")).not.toBeNull();
    // The next card is a fresh element, never left at the old card's offset.
    expect((c.querySelector("[data-swipe-card]") as HTMLElement).style.transform).toBe("");
    await dragBy(c, -(cardWidth(0) * SWIPE_SHARE + 30));
    expect(c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")).not.toBe(second);
    expect(c.querySelector("[data-swipe-count]")!.textContent).toMatch(/^3 of /);
  });

  it("Skip and Save stay, and still work", async () => {
    const c = await start();
    const first = c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card");
    fireEvent.click(c.querySelector("[data-swipe-skip]")!);
    expect(c.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")).not.toBe(first);
    fireEvent.click(c.querySelector("[data-swipe-save]")!);
    expect(c.querySelector("[data-swipe-saved-count]")).not.toBeNull();
  });
});
