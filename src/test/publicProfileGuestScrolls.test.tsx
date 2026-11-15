/**
 * Owner 11-14 (Depop/Vinted review item 10): a guest on /u/<handle> could not scroll the page at all on the web.
 * Measured on www.louisianahelpr.com/u/lexi-l at 390 in Chromium, signed out: <html> carried `app-shell`
 * (overflow: hidden), body 5018px tall, scrollY stuck at 0 after a 700px wheel, so the listings under the header were
 * unreachable. The guest page is PublicHeaderPage (document scroll, F066) but /u was never a document-scroll route.
 *
 * The lock comes off for a definite guest only (auth ready, signed out: the same test the page uses to pick the public
 * shell). A member's page is AppPage, whose internal scroller needs the lock; before auth is ready the page shows
 * AppPage too, so the lock stays.
 *
 * Inventory: every route whose page picks its shell by guest/member (GUEST_DOCUMENT_SCROLL_ROUTES); today /u.
 *
 * @mutate src/hooks/useAppShellViewport.ts | if (isDocumentScrollRoute(pathname) \|\| (definiteGuest && isGuestDocumentScrollRoute(pathname)) \|\| | if (isDocumentScrollRoute(pathname) \|\|
 * @mutate src/hooks/useAppShellViewport.ts | const definiteGuest = isReady && !user; | const definiteGuest = !user;
 * @mutate src/hooks/useAppShellViewport.ts | const GUEST_DOCUMENT_SCROLL_ROUTES = ["/u"]; | const GUEST_DOCUMENT_SCROLL_ROUTES: string[] = [];
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, isReady: true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));

const { useAppShellViewport, isGuestDocumentScrollRoute } = await import("@/hooks/useAppShellViewport");

const at = (path: string) => ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
const locked = () => document.documentElement.classList.contains("app-shell");

beforeEach(() => {
  auth.user = null;
  auth.isReady = true;
  document.documentElement.classList.add("app-shell");
});

describe("a guest can scroll /u/<handle> (owner 11-14)", () => {
  it("the page that picks its shell by guest/member is the inventory (floor)", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/u/PublicProfilePage.tsx"), "utf8"));
    expect(page).toContain("const guestShell = isReady && !user;");
    expect(page).toMatch(/<PublicHeaderPage\b/);
    expect(isGuestDocumentScrollRoute("/u/lexi-l")).toBe(true);
    expect(isGuestDocumentScrollRoute("/user/abc")).toBe(false);
    expect(isGuestDocumentScrollRoute("/u")).toBe(false);
  });

  it("guest (auth ready, signed out): the lock comes off, so the document scrolls", () => {
    renderHook(() => useAppShellViewport(), { wrapper: at("/u/lexi-l") });
    expect(locked()).toBe(false);
  });

  it("member: the lock stays (AppPage scrolls inside it)", () => {
    auth.user = { id: "u1" };
    renderHook(() => useAppShellViewport(), { wrapper: at("/u/lexi-l") });
    expect(locked()).toBe(true);
  });

  it("auth not ready yet: the lock stays (the page shows AppPage until then)", () => {
    auth.isReady = false;
    renderHook(() => useAppShellViewport(), { wrapper: at("/u/lexi-l") });
    expect(locked()).toBe(true);
  });

  it("another app route stays locked for a guest", () => {
    renderHook(() => useAppShellViewport(), { wrapper: at("/profile") });
    expect(locked()).toBe(true);
  });
});
