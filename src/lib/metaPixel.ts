/**
 * Meta Pixel: the website only, loaded after the page (owner, 2026-11-22).
 *
 * The owner's snippet is Meta's standard base code (fbq stub + fbevents.js, init 2088408795197912, track PageView).
 * It is NOT pasted into index.html: a synchronous script in <head> sits in front of first paint, and the CSP has no
 * 'unsafe-inline' (Q13). Instead this module rebuilds the same stub in code and injects fbevents.js once the page
 * has loaded and the browser is idle, so nothing a visitor sees waits for it (owner rule: nothing slow for users).
 * The pixel id is public by design: it ships in every page that carries Meta's snippet.
 *
 * Never in the iPhone or Android app. Tracking inside the App Store build would need Apple's tracking prompt (ATT) and
 * new privacy labels, and could get the app rejected. That is a genuine native capability difference, so
 * Capacitor.isNativePlatform() is the right gate here (CLAUDE.md: never for layout or navigation).
 *
 * Never for robots or tests: the same checks that keep PostHog dark (src/lib/posthog.ts, Q2112) keep this dark too, a
 * webdriver browser, the lh_automation flag, a signed-in test profile (is_seed) and a dev/preview build on
 * http://localhost. So no test run sends Meta an event.
 *
 * PageView fires once when the pixel starts (for the page the visitor is on) and then on every route change, read from
 * React Router's location by src/components/MetaPixelRoutes.tsx. fbevents.js would also fire PageView on every
 * pushState by itself; `disablePushState` turns that off so a route change counts once, not twice, and
 * `allowDuplicatePageViews` lets that one through (fbevents.js drops a second PageView in the same document otherwise:
 * measured 2026-11-22, the route-change PageView never left the browser without it).
 *
 * The privacy notice Meta's Business Tools Terms require is the "Meta Pixel" row on /legal?tab=privacy.
 * Guards: src/lib/metaPixel.test.tsx, src/test/metaPixelNeverInIndexHtml.test.ts.
 */
import { Capacitor } from "@capacitor/core";
import { automationReason, isLocalDevOrigin } from "@/lib/automatedBrowser";

export const META_PIXEL_ID = "2088408795197912";
export const FBEVENTS_SRC = "https://connect.facebook.net/en_US/fbevents.js";

/** The longest requestIdleCallback waits once the page has loaded; a busy page still gets its PageView. */
const IDLE_TIMEOUT_MS = 4000;
/** Browsers without requestIdleCallback (Safari before 18.x): this long after `load`. */
const NO_IDLE_CALLBACK_DELAY_MS = 1500;

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
  allowDuplicatePageViews?: boolean;
};

type PixelWindow = Window & {
  fbq?: Fbq;
  _fbq?: Fbq;
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

let state: "idle" | "scheduled" | "started" = "idle";
/** The router's latest path, and the path the last PageView counted. */
let routerPath: string | null = null;
let lastPath: string | null = null;

/** The website, a person's browser, a real origin. False in the app, under automation and on localhost. */
export function metaPixelAllowed(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return false;
  } catch {
    return false; // cannot tell whether this is the app: stay dark rather than track inside it
  }
  return automationReason() === null && !isLocalDevOrigin();
}

/** Meta's base code, as code: the queueing fbq stub and the async fbevents.js tag. */
function installBaseCode(win: PixelWindow): Fbq {
  if (win.fbq) return win.fbq;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  fbq.disablePushState = true;
  // fbevents.js keeps one PageView per pixel per document unless this is set (its own pushState handler sets it per
  // call). metaPixelRoute counts each path once itself, so a route change is one PageView, never zero or two.
  fbq.allowDuplicatePageViews = true;
  win.fbq = fbq;
  if (!win._fbq) win._fbq = fbq;
  const script = win.document.createElement("script");
  script.async = true;
  script.src = FBEVENTS_SRC;
  win.document.head.appendChild(script);
  return fbq;
}

function start(win: PixelWindow): void {
  if (state === "started") return;
  // Re-checked at start: a test profile may have signed in while the page loaded.
  if (!metaPixelAllowed()) {
    state = "idle";
    return;
  }
  state = "started";
  try {
    const fbq = installBaseCode(win);
    fbq("init", META_PIXEL_ID);
    fbq("track", "PageView");
    lastPath = routerPath ?? win.location.pathname;
  } catch {
    /* advertising measurement must never break the page */
  }
}

/** After `load`, then the next idle moment (or a short timer where there is no requestIdleCallback). */
function whenLoadedAndIdle(win: PixelWindow, run: () => void): void {
  const afterLoad = () => {
    if (typeof win.requestIdleCallback === "function") win.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else win.setTimeout(run, NO_IDLE_CALLBACK_DELAY_MS);
  };
  if (win.document.readyState === "complete") afterLoad();
  else win.addEventListener("load", afterLoad, { once: true });
}

/**
 * Call on every route (MetaPixelRoutes does, from React Router's location). The first call schedules the pixel for
 * after load + idle, which then counts the page the visitor is on; each later change of path counts one PageView.
 * A no-op in the app, under automation and on localhost.
 */
export function metaPixelRoute(pathname: string): void {
  if (!metaPixelAllowed()) return;
  const win = window as PixelWindow;
  routerPath = pathname;
  if (state === "idle") {
    state = "scheduled";
    whenLoadedAndIdle(win, () => start(win));
    return;
  }
  // Not started yet: the PageView at start covers whichever page the visitor is on by then.
  if (state !== "started" || pathname === lastPath) return;
  lastPath = pathname;
  try {
    win.fbq?.("track", "PageView");
  } catch {
    /* advertising measurement must never break the page */
  }
}

/** Tests only: forget that the pixel started. */
export function resetMetaPixelForTests(): void {
  state = "idle";
  routerPath = null;
  lastPath = null;
}
