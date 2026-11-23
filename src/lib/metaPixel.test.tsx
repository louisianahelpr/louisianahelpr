/**
 * The Meta Pixel loader (owner, 2026-11-22): the website only, never before the page has loaded and gone idle, never
 * for robots, tests or localhost, and one PageView per route change read from React Router's location.
 *
 * @mutate src/lib/metaPixel.ts | if (Capacitor.isNativePlatform()) return false; | if (Capacitor.isNativePlatform()) return true;
 * @mutate src/lib/metaPixel.ts | return automationReason() === null && !isLocalDevOrigin(); | return !isLocalDevOrigin();
 * @mutate src/lib/metaPixel.ts | if (win.document.readyState === "complete") afterLoad(); | if (true) afterLoad();
 * @mutate src/lib/metaPixel.ts | win.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS }); | run();
 * @mutate src/lib/metaPixel.ts | lastPath = pathname; | lastPath = null;
 * @mutate src/components/MetaPixelRoutes.tsx | }, [pathname, search]); | }, []);
 * @mutate src/lib/metaPixel.ts | fbq.allowDuplicatePageViews = true; | fbq.allowDuplicatePageViews = false;
 * @mutate src/lib/metaPixel.ts | if (onSecretPage(win, `${pathname}${search}`)) return; | if (false) return;
 * @mutate src/lib/metaPixel.ts | return carriesSecretToken(win.location.href) \|\| (routerUrl | return false && (routerUrl
 * @mutate src/lib/metaPixel.ts |     fbq("set", "autoConfig", false, META_PIXEL_ID); |     void 0;
 * @mutate src/components/MetaPixelRoutes.tsx | metaPixelRoute(pathname, search); | metaPixelRoute(pathname);
 * @mutate src/lib/metaPixel.ts |   if (onSecretPage(win)) { |   if (false) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useEffect } from "react";

const st = vi.hoisted(() => ({
  native: false,
  reason: null as null | "webdriver" | "flag" | "seed_user",
  local: false,
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => st.native } }));
vi.mock("@/lib/automatedBrowser", () => ({
  automationReason: () => st.reason,
  isLocalDevOrigin: () => st.local,
}));

import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { FBEVENTS_SRC, META_PIXEL_ID, carriesSecretToken, metaPixelAllowed, metaPixelRoute, resetMetaPixelForTests } from "./metaPixel";
import { MetaPixelRoutes } from "@/components/MetaPixelRoutes";

type PixelWin = Window & { fbq?: { queue: unknown[][]; disablePushState?: boolean }; _fbq?: unknown; requestIdleCallback?: unknown };
const w = window as PixelWin;

let idleCallbacks: Array<() => void> = [];
const fbScripts = () => [...document.querySelectorAll("script")].filter((s) => s.src === FBEVENTS_SRC);
const pageViews = () => (w.fbq?.queue ?? []).filter((a) => a[0] === "track" && a[1] === "PageView").length;
const runIdle = () => {
  const cbs = idleCallbacks;
  idleCallbacks = [];
  cbs.forEach((cb) => cb());
};

beforeEach(() => {
  st.native = false;
  st.reason = null;
  st.local = false;
  idleCallbacks = [];
  w.requestIdleCallback = vi.fn((cb: () => void) => {
    idleCallbacks.push(cb);
    return 1;
  });
  resetMetaPixelForTests();
});

afterEach(() => {
  delete w.fbq;
  delete w._fbq;
  Reflect.deleteProperty(w, "requestIdleCallback");
  fbScripts().forEach((s) => s.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Meta Pixel: never in the app, never for robots, tests or localhost", () => {
  it.each([
    ["the iPhone/Android app", (): void => { st.native = true; }],
    ["a webdriver browser", (): void => { st.reason = "webdriver"; }],
    ["the lh_automation flag", (): void => { st.reason = "flag"; }],
    ["a signed-in test profile", (): void => { st.reason = "seed_user"; }],
    ["a dev or preview build on localhost", (): void => { st.local = true; }],
  ] as const)("is a no-op in %s", (_name, arrange: () => void) => {
    arrange();
    expect(metaPixelAllowed()).toBe(false);
    metaPixelRoute("/");
    runIdle();
    window.dispatchEvent(new Event("load"));
    runIdle();
    metaPixelRoute("/gift-guides");
    expect(idleCallbacks).toHaveLength(0);
    expect(w.fbq).toBeUndefined();
    expect(fbScripts()).toHaveLength(0);
  });

  it("stays dark when a test profile signs in while the page is still loading", () => {
    metaPixelRoute("/");
    expect(idleCallbacks).toHaveLength(1);
    st.reason = "seed_user";
    runIdle();
    expect(w.fbq).toBeUndefined();
    expect(fbScripts()).toHaveLength(0);
  });
});

describe("Meta Pixel: loads only after the page has loaded and gone idle", () => {
  it("nothing is injected until the idle callback runs, then the base code inits and counts one PageView", () => {
    expect(document.readyState).toBe("complete");
    metaPixelRoute("/");
    expect(w.fbq).toBeUndefined();
    expect(fbScripts()).toHaveLength(0);
    expect(idleCallbacks).toHaveLength(1);

    runIdle();
    expect(fbScripts()).toHaveLength(1);
    expect(fbScripts()[0].async).toBe(true);
    expect(w.fbq?.queue).toEqual([
      ["set", "autoConfig", false, META_PIXEL_ID],
      ["init", META_PIXEL_ID],
      ["track", "PageView"],
    ]);
    // fbevents.js would also count each pushState itself; the router listener does it once instead.
    expect(w.fbq?.disablePushState).toBe(true);
    // ...and fbevents.js drops a second PageView in one document unless this is set, so route changes would count zero.
    expect((w.fbq as { allowDuplicatePageViews?: boolean } | undefined)?.allowDuplicatePageViews).toBe(true);
  });

  it("waits for the load event when the page is still loading", () => {
    const ready = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    metaPixelRoute("/");
    expect(w.requestIdleCallback).not.toHaveBeenCalled();
    ready.mockReturnValue("complete");
    window.dispatchEvent(new Event("load"));
    expect(w.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(fbScripts()).toHaveLength(0);
    runIdle();
    expect(fbScripts()).toHaveLength(1);
  });

  it("without requestIdleCallback, waits a short timer after load", () => {
    vi.useFakeTimers();
    Reflect.deleteProperty(w, "requestIdleCallback");
    metaPixelRoute("/");
    vi.advanceTimersByTime(1499);
    expect(fbScripts()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fbScripts()).toHaveLength(1);
    expect(pageViews()).toBe(1);
  });
});

describe("Meta Pixel: PageView on every route change", () => {
  let go: (path: string) => void = () => {};
  const Driver = () => {
    const navigate = useNavigate();
    useEffect(() => {
      go = (path) => navigate(path);
    }, [navigate]);
    return null;
  };

  it("counts the first page once, then one PageView per new path from React Router's location", () => {
    render(
      <MemoryRouter initialEntries={["/gift-guides"]}>
        <Driver />
        <MetaPixelRoutes />
      </MemoryRouter>,
    );
    // Before idle: nothing loaded, and a route change before then is covered by the start PageView.
    act(() => go("/gift-guides/her"));
    expect(w.fbq).toBeUndefined();
    act(() => runIdle());
    expect(pageViews()).toBe(1);

    act(() => go("/gift-guides/him"));
    expect(pageViews()).toBe(2);
    act(() => go("/gift-guides/him?sort=price"));
    expect(pageViews()).toBe(2);
    act(() => go("/legal"));
    expect(pageViews()).toBe(3);
    expect(fbScripts()).toHaveLength(1);
  });

  it("a remount on the same page (StrictMode, a lazy chunk re-rendering) does not count it twice", () => {
    metaPixelRoute("/gift-guides");
    runIdle();
    expect(pageViews()).toBe(1);
    metaPixelRoute("/gift-guides");
    expect(pageViews()).toBe(1);
    metaPixelRoute("/gift-guides/kids");
    metaPixelRoute("/gift-guides/kids");
    expect(pageViews()).toBe(2);
  });
});

/**
 * Audit LT-1 (11-23): a Secret Santa reveal token or a Rentals invite token never reaches Meta. fbevents.js sends the
 * whole document address as dl=, so the pixel must not start, count a PageView or run automatic events on such a page.
 */
describe("Meta Pixel: never on a page whose address holds a reveal or invite token", () => {
  const SANTA = "/gift-guides/secret-santa/a1b2c3d4e5/LHSECRETTOKEN";
  const INVITE = "/rentals/invite/LHSECRETTOKEN";
  const LOGIN_INVITE = `/login?redirect=${encodeURIComponent(INVITE)}`;
  afterEach(() => window.history.replaceState(null, "", "/"));

  it.each([
    ["a Secret Santa reveal link", SANTA, ""],
    ["a Rentals invite link", INVITE, ""],
    ["the sign-in page carrying an invite link", "/login", `?redirect=${encodeURIComponent(INVITE)}`],
  ])("does not start the pixel on %s", (_n, path, search) => {
    window.history.replaceState(null, "", `${path}${search}`);
    metaPixelRoute(path, search);
    runIdle();
    expect(idleCallbacks).toHaveLength(0);
    expect(w.fbq).toBeUndefined();
    expect(fbScripts()).toHaveLength(0);
  });

  it("starts on the next page without a token, and never counts the token page", () => {
    window.history.replaceState(null, "", LOGIN_INVITE);
    metaPixelRoute("/login", LOGIN_INVITE.slice("/login".length));
    expect(w.fbq).toBeUndefined();
    window.history.replaceState(null, "", "/rentals");
    metaPixelRoute("/rentals");
    runIdle();
    expect(pageViews()).toBe(1);
    // Back to the invite page after the pixel started: no PageView for it.
    window.history.replaceState(null, "", INVITE);
    metaPixelRoute(INVITE);
    expect(pageViews()).toBe(1);
    expect(JSON.stringify(w.fbq?.queue)).not.toContain("LHSECRETTOKEN");
  });

  it("stays dark when the visitor opens a token page while the page is going idle", () => {
    metaPixelRoute("/gift-guides");
    expect(idleCallbacks).toHaveLength(1);
    window.history.replaceState(null, "", SANTA);
    runIdle();
    expect(w.fbq).toBeUndefined();
    expect(fbScripts()).toHaveLength(0);
  });

  it("turns automatic events off before init, so fbevents.js sends nothing on its own from a token page", () => {
    metaPixelRoute("/");
    runIdle();
    expect(w.fbq?.queue.slice(0, 2)).toEqual([
      ["set", "autoConfig", false, META_PIXEL_ID],
      ["init", META_PIXEL_ID],
    ]);
  });

  it("the router listener passes the query, so /login?redirect=<invite> is caught", () => {
    render(
      <MemoryRouter initialEntries={[LOGIN_INVITE]}>
        <MetaPixelRoutes />
      </MemoryRouter>,
    );
    runIdle();
    expect(idleCallbacks).toHaveLength(0);
    expect(w.fbq).toBeUndefined();
  });

  it("every route in App.tsx with a :token param is caught, literal and inside a sign-in redirect", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    const tokenRoutes = [...app.matchAll(/<Route\s+path="([^"]*:token[^"]*)"/g)].map((m) => m[1]);
    expect(tokenRoutes.length).toBeGreaterThan(1);
    for (const route of tokenRoutes) {
      const url = route.replace(/:code\b/g, "a1b2c3d4e5").replace(/:token\b/g, "LHSECRETTOKEN").replace(/:\w+/g, "x1");
      expect(carriesSecretToken(url), route).toBe(true);
      expect(carriesSecretToken(`/login?redirect=${encodeURIComponent(url)}`), route).toBe(true);
    }
    expect(carriesSecretToken("/gift-guides/secret-santa")).toBe(false);
    expect(carriesSecretToken("/gift-guides/her")).toBe(false);
  });
});
