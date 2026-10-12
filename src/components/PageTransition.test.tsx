/**
 * Q1356 (owner, 2026-10-12): the route wrapper drops the page-change fade and
 * keeps iPhone's swipe-from-the-left-edge to go back, rebuilt on plain pointer
 * events. These pin the gesture's behaviour: an edge swipe past the distance
 * goes back, a mid-screen or vertical drag never moves the page, a swipe with
 * no in-app history snaps back, and the page carries no transform at rest (a
 * transformed ancestor would become AppShell's fixed containing block).
 * The bundle half (no framer-motion in this chunk) is scripts/check-deferred-vendors.mjs.
 *
 * @mutate src/components/PageTransition.tsx | if (e.clientX > EDGE_ZONE_PX) return; | if (e.clientX > 10000) return;
 * @mutate src/components/PageTransition.tsx | if (committed && hasInAppHistory()) navigate(-1); | if (committed) navigate(-1);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const hasInAppHistory = vi.fn(() => true);
vi.mock("@/lib/inAppHistory", () => ({ hasInAppHistory: () => hasInAppHistory() }));

import PageTransition from "./PageTransition";

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function setup() {
  render(
    <MemoryRouter initialEntries={["/home", "/jobs/1"]} initialIndex={1}>
      <Routes>
        <Route
          path="*"
          element={
            <PageTransition>
              <div data-testid="page">
                <Where />
              </div>
            </PageTransition>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId("page").parentElement as HTMLElement;
}

/** jsdom has no PointerEvent: a MouseEvent carries clientX/Y, then the pointer fields are added. */
function pointer(target: Window | Element, type: string, x: number, y: number, timeStamp: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "isPrimary", { value: true });
  Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  fireEvent(target, ev);
}

function swipe(page: HTMLElement, from: [number, number], to: [number, number], ms = 400) {
  pointer(page, "pointerdown", from[0], from[1], 1000);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    pointer(window, "pointermove", x, y, 1000 + (ms * i) / steps);
  }
  pointer(window, "pointerup", to[0], to[1], 1000 + ms + 1);
}

describe("PageTransition: edge swipe-back without framer-motion (Q1356)", () => {
  beforeEach(() => hasInAppHistory.mockReturnValue(true));

  it("carries no transform or will-change at rest", () => {
    const page = setup();
    expect(page.style.transform).toBe("");
    expect(page.style.willChange).toBe("");
  });

  it("a slow swipe from the left edge past 110px goes back", () => {
    const page = setup();
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
    swipe(page, [10, 300], [200, 305], 2000);
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("the page follows the finger during the drag and is cleared on release", () => {
    const page = setup();
    pointer(page, "pointerdown", 10, 300, 1000);
    pointer(window, "pointermove", 60, 302, 1500);
    expect(page.style.transform).toMatch(/translate3d\(45px/);
    pointer(window, "pointerup", 60, 302, 1600);
    expect(page.style.transform).toBe("");
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
  });

  it("a short fast flick from the edge goes back (velocity, not distance)", () => {
    const page = setup();
    swipe(page, [10, 300], [80, 300], 80);
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("a short slow edge drag snaps back and stays", () => {
    const page = setup();
    swipe(page, [10, 300], [80, 300], 2000);
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
    expect(page.style.transform).toBe("");
  });

  it("a drag that starts mid-screen never moves the page", () => {
    const page = setup();
    pointer(page, "pointerdown", 150, 300, 1000);
    pointer(window, "pointermove", 320, 300, 1100);
    expect(page.style.transform).toBe("");
    pointer(window, "pointerup", 320, 300, 1110);
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
  });

  it("a mostly vertical drag from the edge is a scroll, not a swipe", () => {
    const page = setup();
    swipe(page, [10, 100], [140, 500], 200);
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
  });

  it("with no in-app history the swipe snaps back instead of leaving the app", () => {
    hasInAppHistory.mockReturnValue(false);
    const page = setup();
    swipe(page, [10, 300], [250, 300], 300);
    expect(screen.getByTestId("where").textContent).toBe("/jobs/1");
    expect(page.style.transform).toBe("");
  });
});
