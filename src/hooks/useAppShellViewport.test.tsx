import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { useAppShellViewport } from "./useAppShellViewport";

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
  // container. Marketing/auth/long-form routes need NORMAL document
  // scroll, so they should NOT get the class.

  it("removes app-shell on the marketing root /", () => {
    document.documentElement.classList.add("app-shell"); // start locked
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /login (auth flow uses min-h-screen)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/login") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /signup", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/signup") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /forgot-password", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/forgot-password") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
  });

  it("removes app-shell on /profile (tall multi-tab page)", () => {
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/profile") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(false);
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

  it("ADDS app-shell on /admin (no document-scroll route hits it)", () => {
    renderHook(() => useAppShellViewport(), { wrapper: wrapperFor("/admin") });
    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
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
});
