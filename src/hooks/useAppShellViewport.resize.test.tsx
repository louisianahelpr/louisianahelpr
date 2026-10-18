/**
 * Q?admin-rail-resize: `desktop-rail` follows `web-desktop` LIVE, not only on
 * a route change.
 *
 * `desktop-rail` is computed from the `web-desktop` class, and the effect that
 * computes it used to re-run only on a pathname or user change. A signed-in
 * window widened from phone width to desktop width got `web-desktop` (its own
 * matchMedia listener) and the rail itself, but never `desktop-rail`, so
 * neither inset rule (`.app-shell-frame { right }`, `#root { padding-right }`)
 * applied and the page ran under the rail until the next navigation. Measured
 * on a local build of /admin?view=idvreview, resized 375 -> 1440: the card's
 * right edge at 1408 against the rail's left edge at 1192; a fresh 1440 load
 * of the same view and of seven other admin views put nothing under the rail.
 */
// @mutate src/hooks/useAppShellViewport.ts | reapplyShellClasses?.();\n    };\n    apply(mql.matches); | \n    };\n    apply(mql.matches);
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "signed-in-user" }, isReady: true }),
}));

import { useAppShellViewport } from "./useAppShellViewport";

type Listener = (e: MediaQueryListEvent) => void;

/** A matchMedia whose `matches` the test flips, firing `change` like a real resize. */
const installMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(min-width: 900px)",
    onchange: null,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    dispatchEvent: () => true,
  };
  const original = window.matchMedia;
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  return {
    resize(toDesktop: boolean) {
      matches = toDesktop;
      for (const l of [...listeners]) l({ matches } as MediaQueryListEvent);
    },
    restore() {
      window.matchMedia = original;
    },
  };
};

const wrapperFor = (initialPath: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );

const html = () => document.documentElement.classList;

describe("desktop-rail tracks a live viewport resize (Q?admin-rail-resize)", () => {
  let mm: ReturnType<typeof installMatchMedia>;

  beforeEach(() => {
    html().remove("web-desktop", "desktop-rail", "app-shell");
  });
  afterEach(() => {
    mm?.restore();
    html().remove("web-desktop", "desktop-rail", "app-shell");
  });

  for (const route of ["/admin", "/home", "/jobs"]) {
    it(`${route}: phone -> desktop adds desktop-rail with web-desktop, and back removes it`, () => {
      mm = installMatchMedia(false);
      renderHook(() => useAppShellViewport(), { wrapper: wrapperFor(route) });
      expect(html().contains("web-desktop")).toBe(false);
      expect(html().contains("desktop-rail")).toBe(false);

      act(() => mm.resize(true));
      expect(html().contains("web-desktop")).toBe(true);
      expect(html().contains("desktop-rail"), "widened to desktop: the rail shows, so the inset class must too").toBe(true);

      act(() => mm.resize(false));
      expect(html().contains("web-desktop")).toBe(false);
      expect(html().contains("desktop-rail"), "narrowed to phone: no rail, no rail flag").toBe(false);
    });
  }

  it("a desktop-width first load still has desktop-rail (no regression on the fresh-load path)", () => {
    mm = installMatchMedia(true);
    // prePaintShellClasses stamps this before React mounts in the real app.
    html().add("web-desktop");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/admin") });
    expect(html().contains("web-desktop")).toBe(true);
    expect(html().contains("desktop-rail")).toBe(true);
  });
});
