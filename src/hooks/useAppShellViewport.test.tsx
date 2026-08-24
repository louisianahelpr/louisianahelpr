import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { useAppShellViewport, setNotFoundPathname } from "./useAppShellViewport";

const wrapperFor = (initialPath: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );

describe("useAppShellViewport", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("app-shell");
  });

  // The "app-shell" class on <html> locks the viewport to 100dvh +
  // overflow:hidden, forcing pages to use AppShell's internal scroll
  // container. Marketing, long-form, and auth/onboarding pages that may
  // exceed the viewport height (including Login on short landscape viewports)
  // need normal document scroll and must NOT have the lock.

  it("removes app-shell on the marketing root /", () => {
    document.documentElement.classList.add("app-shell"); // start locked
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /login (AuthShell document-scroll — card can exceed fold on landscape)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/login") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /signup", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/signup") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /forgot-password (AuthShell page that may exceed viewport)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/forgot-password") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("ADDS app-shell on /profile (Profile landing uses AppShell's internal scroll)", () => {
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/profile") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
  });

  it("removes app-shell on /user/:id sub-routes (startsWith match)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/user/abc-123") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("ADDS app-shell on /dashboard (the in-app shell with internal scroll)", () => {
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/dashboard") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
  });

  it("ADDS app-shell on /messages", () => {
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/messages") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
  });

  it("removes app-shell on /admin (min-h-screen document-scroll dashboard)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/admin") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("does NOT match /loginX (avoids false-positive on prefix overlap)", () => {
    // Without proper "===" check, /login would match /loginX. The hook
    // uses pathname === route || startsWith(`${route}/`). So /loginX
    // — which neither equals /login nor starts with /login/ — is NOT
    // a document-scroll route, and gets app-shell.
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/loginX") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
  });

  it("matches deep paths under /business via startsWith", () => {
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/business/team") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /reset-password (twin of /forgot-password)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/reset-password") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  // The `path="*"` catch-all. NotFound renders inside PublicLayout (marketing
  // Navbar + Footer), which is taller than a viewport — under the app-shell
  // lock its footer and, on a phone, the "Back to Home" button sit below the
  // fold with no way to scroll to them. The route list cannot express "every
  // path that is not a route", so NotFound reports its own pathname.
  describe("404 catch-all", () => {
    afterEach(() => setNotFoundPathname(null));

    it("locks an unknown path by default (nothing has claimed it yet)", () => {
      renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/no-such-page") });
      expect(document.documentElement.classList.contains("app-shell")).toBe(true);
    });

    it("unlocks the moment NotFound reports that pathname", () => {
      renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/no-such-page") });
      expect(document.documentElement.classList.contains("app-shell")).toBe(true);
      // Pushed, not polled — this must take effect without the hook
      // re-rendering, because NotFound's effect can run either side of the
      // hook's (they are siblings in App.tsx, not parent and child).
      act(() => setNotFoundPathname("/no-such-page"));
      expect(document.documentElement.classList.contains("app-shell")).toBe(false);
    });

    it("re-locks when NotFound unmounts and clears its claim", () => {
      renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/no-such-page") });
      act(() => setNotFoundPathname("/no-such-page"));
      expect(document.documentElement.classList.contains("app-shell")).toBe(false);
      act(() => setNotFoundPathname(null));
      expect(document.documentElement.classList.contains("app-shell")).toBe(true);
    });

    it("a stale claim for a DIFFERENT path can't unlock the current one", () => {
      setNotFoundPathname("/some-old-404");
      renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/messages") });
      expect(document.documentElement.classList.contains("app-shell")).toBe(true);
    });
  });
});
