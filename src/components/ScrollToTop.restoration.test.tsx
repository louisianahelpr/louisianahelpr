/**
 * Q1312 (owner, 2026-10-05: Browse Jobs "opens mid-scroll", the heading under
 * the top bar). Measured on prod in WebKit at 375: landing scrolled to 1005 ->
 * footer "Jobs" -> /browse at the top -> Back -> Forward reopened /browse at
 * 505 (its very bottom), via ScrollToTop's own restore: scrollTo(0, 505) twice.
 * Two causes, two checks:
 *   1. the browser's own restoration (history.scrollRestoration "auto")
 *      scrolled the page on Back while the OLD route was still on screen;
 *   2. the old entry's scroll listener recorded that offset under the old
 *      entry's key, so going Forward "restored" a page that was left at 0.
 * The race itself needs WebKit's event timing; here it is replayed
 * deterministically by calling the old entry's listener after the route
 * changed.
 */
// @mutate src/components/ScrollToTop.tsx | window.history.scrollRestoration = "manual"; | window.history.scrollRestoration = "auto";
// @mutate src/components/ScrollToTop.tsx | if (currentKeyRef.current !== key) return; | if (false) return;
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router-dom";

vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

import ScrollToTop from "./ScrollToTop";

let scrollY = 0;
const scrollToCalls: number[] = [];
let listeners: { fn: EventListener; at: string }[] = [];
let realAdd: typeof window.addEventListener;

function Layout() {
  return (
    <>
      <ScrollToTop />
      <Outlet />
    </>
  );
}

function setup() {
  const router = createMemoryRouter(
    [{ path: "/", element: <Layout />, children: [{ path: "landing", element: <p>landing</p> }, { path: "browse", element: <p>browse</p> }] }],
    { initialEntries: ["/landing"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("ScrollToTop restores each history entry's OWN offset (Q1312)", () => {
  beforeEach(() => {
    scrollY = 0;
    scrollToCalls.length = 0;
    listeners = [];
    window.history.scrollRestoration = "auto";
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    window.scrollTo = ((x: number | ScrollToOptions, y?: number) => {
      const top = typeof x === "number" ? (y ?? 0) : (x.top ?? 0);
      scrollToCalls.push(top);
      scrollY = top;
    }) as typeof window.scrollTo;
    realAdd = window.addEventListener;
    window.addEventListener = ((type: string, fn: EventListener, opts?: unknown) => {
      if (type === "scroll") listeners.push({ fn, at: window.location.pathname });
      return realAdd.call(window, type, fn, opts as AddEventListenerOptions);
    }) as typeof window.addEventListener;
  });
  afterEach(() => {
    window.addEventListener = realAdd;
  });

  it("turns the browser's own scroll restoration off", () => {
    setup();
    expect(window.history.scrollRestoration).toBe("manual");
  });

  it("a scroll that lands after the route changed is not recorded under the old entry", async () => {
    const router = setup();
    // Landing, scrolled down.
    scrollY = 1005;
    for (const l of listeners) l.fn(new Event("scroll"));
    // Footer "Jobs" -> /browse, opened at the top.
    await act(async () => { await router.navigate("/browse"); });
    expect(scrollY).toBe(0);
    const browseListener = listeners[listeners.length - 1];
    // Back to the landing: it restores 1005.
    await act(async () => { await router.navigate(-1); });
    expect(scrollY).toBe(1005);
    // The race WebKit loses: /browse's listener fires AFTER the route changed,
    // reading the landing's offset (clamped to /browse's height: 505).
    scrollY = 505;
    browseListener.fn(new Event("scroll"));
    scrollY = 1005;
    // Forward to /browse: it was left at the top, so it must open at the top.
    scrollToCalls.length = 0;
    await act(async () => { await router.navigate(1); });
    expect(scrollToCalls).not.toContain(505);
    expect(scrollY).toBe(0);
  });

  it("inventory floor: the history walk bound a scroll listener per entry", async () => {
    const router = setup();
    await act(async () => { await router.navigate("/browse"); });
    expect(listeners.length).toBeGreaterThan(1);
  });
});
