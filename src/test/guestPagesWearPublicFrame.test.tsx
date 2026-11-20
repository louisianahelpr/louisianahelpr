/**
 * Q2784 + Q2785 (landing audit L006 / L025, 2026-11-09): signed-out pages wore three different frames, and the guest
 * app pages scrolled inside an inner box. Measured 2026-11-15 on local vite (prod backend, signed out, Chromium, service
 * workers blocked) at 375 and 1440: /declutter, its item page, /helprs and /search had html.app-shell (overflow hidden)
 * with the page scrolling in AppShell's inner column, no public footer, and no public header (/helprs and /search no
 * logo either); /hire/<service>/<town> wore the public header and footer but under the html lock it did not scroll AT
 * ALL (body 2044px tall at 375, window.scrollY stuck at 0), and /jobs/<id> the same (body 1542px). After: html unlocked, the window scrolls 400px on every one,
 * the public header and footer drawn on each.
 *
 * A guest on the web on a GUEST_PUBLIC_FRAME_ROUTES page (src/lib/guestPublicFrame.ts) gets PublicLayout from AppPage
 * and SectionScreen (useGuestPublicFrame), and useAppShellViewport lifts the html lock for the same visitor. A member
 * keeps AppShell and the lock.
 *
 * The route-table walk: every route in src/App.tsx that a signed-out visitor can open (no ProtectedRoute, or
 * ProtectedRoute allowGuest, or DeclutterGuestOrMember) is a document-scroll public page, a guest-scroll route, a
 * guest public-frame route, a redirect, or one of the exact NOT_YET_FRAMED routes below (empty since 11-15, when
 * /shops/:id and /book/:userId joined the frame; a new unframed guest route fails here).
 *
 * @mutate src/components/AppPage.tsx |   const guestFrame = useGuestPublicFrame(); |   const guestFrame = false;
 * @mutate src/components/sections/SectionScreen.tsx |   const guestFrame = useGuestPublicFrame(); |   const guestFrame = false;
 * @mutate src/components/sections/SectionScreen.tsx |             className="sticky z-30 -mx-5 | className="z-30 -mx-5
 * @mutate src/hooks/useAppShellViewport.ts | \|\| (framedGuest && isGuestPublicFrameRoute(pathname))) { | ) {
 * @mutate src/lib/guestPublicFrame.ts | export const GUEST_PUBLIC_FRAME_ROUTES = ["/declutter", "/declutter/item/", "/hire/", "/helprs", "/search", "/jobs/", "/shops/", "/book/", "/post-job"] as const; | export const GUEST_PUBLIC_FRAME_ROUTES = ["/declutter", "/declutter/item/", "/helprs", "/search", "/jobs/", "/shops/", "/book/", "/post-job"] as const;
 * @mutate src/lib/guestPublicFrame.ts | "/jobs/", "/shops/", "/book/", "/post-job"] as const; | "/jobs/", "/post-job"] as const;
 * @mutate src/lib/guestPublicFrame.ts | const NOT_GUEST_PAGES = ["/jobs/settings", "/shops/mine", "/shops/orders", "/shops/dashboard"]; | const NOT_GUEST_PAGES = ["/jobs/settings"];
 * @mutate src/lib/guestPublicFrame.ts |   !NOT_GUEST_PAGES.includes(pathname) && |
 * @mutate src/lib/guestPublicFrame.ts | export const isGuestViewer = (user: unknown, isReady: boolean): boolean => (isReady ? !user : definitelyGuest()); | export const isGuestViewer = (user: unknown, isReady: boolean): boolean => !user;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, isReady: true }));
const guestProbe = vi.hoisted(() => ({ definitelyGuest: true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/lib/persistedAuthToken", async (orig) => ({
  ...(await orig<typeof import("@/lib/persistedAuthToken")>()),
  definitelyGuest: () => guestProbe.definitelyGuest,
}));
vi.mock("@/components/marketing/PublicLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-frame="public"><nav aria-label="Primary" />{children}<footer /></div>,
}));
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-frame="app-shell">{children}</div>,
}));
vi.mock("@/components/profile/ProfileTabHeader", () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/sections/AppTopBar", () => ({ AppTopBar: () => <div data-top-bar="" /> }));
vi.mock("@/components/sections/ExploreSearchEntry", () => ({ ExploreSearchEntry: () => null }));

const { default: AppPage } = await import("@/components/AppPage");
const { SectionScreen } = await import("@/components/sections/SectionScreen");
const { useAppShellViewport, isDocumentScrollRoute, isGuestDocumentScrollRoute } = await import("@/hooks/useAppShellViewport");
const { GUEST_PUBLIC_FRAME_ROUTES, isGuestPublicFrameRoute } = await import("@/lib/guestPublicFrame");

const at = (path: string) => ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
const frameOf = (c: HTMLElement) => c.querySelector("[data-frame]")?.getAttribute("data-frame");
const locked = () => document.documentElement.classList.contains("app-shell");

beforeEach(() => {
  auth.user = null;
  auth.isReady = true;
  guestProbe.definitelyGuest = true;
  document.documentElement.classList.add("app-shell");
});

/** Guest-reachable routes that still wear AppShell or no public frame for a guest. Exact; empty since 11-15 (Q2784). */
const NOT_YET_FRAMED: string[] = [];
/** A route pattern with each :param filled, to ask the matchers. */
const sample = (path: string) => path.replace(/:[A-Za-z]+/g, "x1");

describe("signed-out pages wear the public frame and scroll the document (Q2784, Q2785)", () => {
  it("walks the route table: every guest-reachable route is framed, a redirect, or listed (floor + exact)", () => {
    const app = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].map((m) => ({ path: m[1], el: m[2] }));
    expect(routes.length).toBeGreaterThan(60);
    const guestReachable = routes.filter(({ el }) => !/<ProtectedRoute\b/.test(el) || /allowGuest|DeclutterGuestOrMember/.test(el));
    expect(guestReachable.length).toBeGreaterThan(30);
    const unframed = guestReachable
      .filter(({ path, el }) => {
        if (path === "*") return false; // NotFound reports itself (setNotFoundPathname) and wears PublicLayout.
        if (/^<Navigate\b/.test(el.trim()) || /Redirect\b|UserProfileRoute/.test(el)) return false;
        const p = sample(path);
        return !(isDocumentScrollRoute(p) || isGuestDocumentScrollRoute(p) || isGuestPublicFrameRoute(p));
      })
      .map(({ path }) => path);
    expect([...new Set(unframed)].sort()).toEqual([...NOT_YET_FRAMED].sort());
    for (const p of ["/declutter", "/declutter/item/:id", "/hire/:service/:town", "/helprs", "/search", "/jobs/:id", "/shops/:id", "/book/:userId"]) {
      expect(isGuestPublicFrameRoute(sample(p)), p).toBe(true);
    }
    // A member-only page under /declutter stays off: the guest is sent to log in there.
    expect(isGuestPublicFrameRoute("/declutter/sell")).toBe(false);
    expect(isGuestPublicFrameRoute("/declutter/item/")).toBe(false);
    expect(isGuestPublicFrameRoute("/jobs/settings")).toBe(false);
    expect(isGuestPublicFrameRoute("/jobs")).toBe(false);
    for (const p of ["/shops", "/shops/mine", "/shops/orders", "/shops/dashboard", "/book/"]) expect(isGuestPublicFrameRoute(p), p).toBe(false);
    expect(GUEST_PUBLIC_FRAME_ROUTES.length).toBe(9); // owner 11-20: /post-job (a guest starts a post)
  });

  it("guest: AppPage (item page, /helprs, /search) draws the public header and footer, not AppShell", () => {
    for (const path of ["/helprs", "/search", "/declutter/item/abc", "/shops/abc", "/book/abc"]) {
      const { container, unmount } = render(<AppPage title="T">body</AppPage>, { wrapper: at(path) });
      expect(frameOf(container), path).toBe("public");
      expect(container.querySelector("nav[aria-label=Primary]"), path).not.toBeNull();
      expect(container.querySelector("footer"), path).not.toBeNull();
      unmount();
    }
  });

  it("guest: SectionScreen (/declutter) draws the public header and footer", () => {
    const { container } = render(<SectionScreen section="declutter" title="Declutter">list</SectionScreen>, { wrapper: at("/declutter") });
    expect(frameOf(container)).toBe("public");
    expect(container.querySelector("footer")).not.toBeNull();
    // The tab row stays put while the window scrolls (owner 2026-10-30; measured 11-15 at 1440: the tablist's top
    // 138px before and after a 1600px scroll): the section header is sticky right under the fixed public header.
    const sticky = container.querySelector<HTMLElement>("[data-guest-explore-sticky]");
    expect(sticky?.className).toMatch(/(^| )sticky( |$)/);
    expect(sticky?.style.top).toContain("var(--public-nav-h)");
    expect(sticky?.querySelector("[data-explore-header]")).not.toBeNull();
  });

  it("guest before auth settles (no stored session for certain): already the public frame", () => {
    auth.isReady = false;
    const { container } = render(<AppPage title="T">body</AppPage>, { wrapper: at("/helprs") });
    expect(frameOf(container)).toBe("public");
  });

  it("member, or a stored session before auth settles: AppShell as before", () => {
    auth.user = { id: "u1" };
    const a = render(<AppPage title="T">body</AppPage>, { wrapper: at("/helprs") });
    expect(frameOf(a.container)).toBe("app-shell");
    a.unmount();
    auth.user = null;
    auth.isReady = false;
    guestProbe.definitelyGuest = false;
    const b = render(<SectionScreen section="declutter" title="Declutter">list</SectionScreen>, { wrapper: at("/declutter") });
    expect(frameOf(b.container)).toBe("app-shell");
  });

  it("a guest on another app page keeps AppShell", () => {
    const { container } = render(<AppPage title="T">body</AppPage>, { wrapper: at("/profile") });
    expect(frameOf(container)).toBe("app-shell");
  });

  it("the html lock comes off for a guest on each page (the window scrolls), and stays for a member", () => {
    for (const path of ["/declutter", "/declutter/item/abc", "/hire/assembly/baton-rouge", "/helprs", "/search", "/jobs/abc", "/shops/abc", "/book/abc"]) {
      document.documentElement.classList.add("app-shell");
      const { unmount } = renderHook(() => useAppShellViewport(), { wrapper: at(path) });
      expect(locked(), path).toBe(false);
      unmount();
    }
    auth.user = { id: "u1" };
    document.documentElement.classList.add("app-shell");
    renderHook(() => useAppShellViewport(), { wrapper: at("/declutter") });
    expect(locked()).toBe(true);
  });
});
