import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useLocation, useNavigationType } from "react-router-dom";
import { dismissComingSoonToasts } from "@/components/mobileNav/useSectionTabs";

import { prefersReducedMotion, useReducedMotion } from "@/lib/accessibility";
import { hapticLight } from "@/lib/haptics";
import { resetLargeTitles } from "@/lib/largeTitles";

// Reveal the affordance only after the user has scrolled well past the fold —
// several screens down — so it never clutters short pages. iOS exposes a
// "tap the status bar to scroll to top" gesture natively, but Capacitor's
// StatusBar plugin doesn't surface a tap event, so this floating button is
// the reachable equivalent.
const REVEAL_AFTER_PX = 1200;
/** Polish audit 11-27 #6: the button floated over Holiday Hub cards early on. It shows only after two screens (and never
 *  before REVEAL_AFTER_PX), with no shadow. */
const REVEAL_AFTER_SCREENS = 2;
function revealAfter(viewport: number): number {
  return Math.max(REVEAL_AFTER_PX, REVEAL_AFTER_SCREENS * viewport);
}

// Hidden while the signed-out site footer is on screen (owner, 2026-10-20):
// the button sits bottom-right, exactly over the footer's Follow icons at 375,
// so a tap on Instagram scrolled the page up instead. At the footer the reader
// is at the end of the page anyway. Footer renders only for signed-out visitors.
function footerInView(): boolean {
  const footer = document.querySelector("footer");
  return !!footer && footer.getBoundingClientRect().top < window.innerHeight;
}

// Never on the signed-out landing (owner's UI audit 11-09, F014, on a phone: every block is full width, so the button
// always sat on card text). D019 (landing design audit 11-10): at 1440 it floated over the money band and the join
// block too, so the rule now holds at every width. The landing is one marketing page a visitor scrolls straight
// through, and the top bar's logo is one tap back to its top.
/**
 * Design audit r2 #22: the 25 Days page (classic Christmas look: cream, gold, hunter green) drew this as a white disc
 * with a grey shadow over its FAQ chevrons. There it wears the page's cream with a 1px gold edge and no shadow.
 */
const GIVEAWAY_LOOK = { background: "#fbf7ee", border: "1px solid #b08d57", color: "#1f3a2b", boxShadow: "none" } as const;
function onGiveawayPage(pathname: string): boolean {
  return pathname === "/25days"; // its only page since /25days/rules left (owner 2026-11-21: rules on Facebook)
}

function onLanding(pathname: string): boolean {
  return pathname === "/";
}

/**
 * Never on the gift guides and Shop Small pages (holiday audit 1121 #40 / #78): every row there ends in a heart at
 * the right edge, so the button always sat on one, and a tap meant to save a gift scrolled the page up instead. The
 * sticky top bar stays one tap away, as on the landing.
 */
function onHeartList(pathname: string): boolean {
  return pathname === "/gift-guides" || pathname.startsWith("/gift-guides/");
}

/** How long an in-app #link keeps looking for its section while the page's lazy content mounts. */
const HASH_WAIT_MS = 2000;
/** The fixed top bar's clearance when the section sets no scroll-margin-top (the deals sections' own scroll-mt-24). */
const HASH_CLEARANCE = "96px";

/**
 * Scroll an in-app "#section" link to its section (holiday audit 1121): polls each frame for the element (it may not
 * be drawn yet), then scrolls it to the top under the fixed bar. Returns a cancel for the next navigation.
 */
function scrollToHash(hash: string, waitMs = HASH_WAIT_MS): () => void {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed %-escape: look the raw text up instead.
  }
  if (!id) return () => {};
  const until = Date.now() + waitMs;
  let frame = 0;
  // Where the page scrollers sat after our last scroll: a reader who has scrolled since is never pulled back.
  const offsets = () => `${window.scrollY}|${[...document.querySelectorAll<HTMLElement>(".app-shell-scroll")].map((s) => s.scrollTop).join(",")}`;
  let ours: string | null = null;
  const tryScroll = () => {
    const el = document.getElementById(id);
    if (el && (ours === null || ours === offsets())) {
      if (getComputedStyle(el).scrollMarginTop === "0px") el.style.scrollMarginTop = HASH_CLEARANCE;
      // Re-aligned each frame while content above it is still drawing (photos, lazy lists push it down).
      el.scrollIntoView({ block: "start", behavior: "instant" });
      ours = offsets();
    } else if (el) {
      return; // the reader scrolled: stop
    }
    if (Date.now() < until) frame = requestAnimationFrame(tryScroll);
  };
  frame = requestAnimationFrame(tryScroll);
  return () => cancelAnimationFrame(frame);
}

// Per-history-entry scroll offsets, keyed by react-router's `location.key`.
// Module-level so it survives the AppShell remounting between routes (but
// resets on a full reload, which matches browser-native scroll restoration).
const scrollPositions = new Map<string, number>();

/**
 * Two jobs:
 *  1. Browser-style scroll restoration: on a forward navigation (PUSH/REPLACE)
 *     reset to the top; on a back/forward navigation (POP) restore the offset
 *     the user left that entry at — so backing out of a settings sub-page
 *     lands them where they were, not at the top. Hash anchors are skipped so
 *     in-page links still work.
 *  2. Renders a subtle floating "scroll to top" affordance for the AppShell
 *     internal scroll container — the iOS "tap status bar to scroll up"
 *     convention, surfaced as a tappable button since no native tap signal
 *     is available.
 *
 * Uses useLayoutEffect for the reset/restore so it happens before the browser
 * paints the new route — preventing the brief "blank/bottom" flash some pages
 * showed.
 */
const ScrollToTop = () => {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();
  // A "coming soon" toast belongs to the screen that was tapped (owner 2026-10-21): any navigation clears it.
  useEffect(() => { dismissComingSoonToasts(); }, [key]);
  // The AppShell scroll container currently being watched.
  const scrollerRef = useRef<HTMLElement | null>(null);
  // Last pathname we reset for. A query-only change (e.g. a URL-driven tab
  // switcher calling setSearchParams) mints a fresh location.key but keeps the
  // pathname — those must NOT scroll the page to the top.
  const prevPathnameRef = useRef<string | null>(null);
  // The history entry on screen NOW. A scroll listener bound to an older entry
  // must not write its offset (Q1312, below).
  const currentKeyRef = useRef(key);

  // Q1312 (owner, 2026-10-05: Browse Jobs "opens mid-scroll", heading under
  // the top bar). This component restores scroll itself (POP branch below), so
  // the browser must not ALSO restore it. With the default
  // `history.scrollRestoration = "auto"`, WebKit scrolls the page to the
  // entry's remembered offset the moment Back/Forward fires, while the OLD
  // route is still on screen, so the offset is clamped to the old page's
  // height and recorded under the old entry. Measured on prod in WebKit at 375:
  // landing scrolled to 1005 -> footer "Jobs" -> /browse (top) -> Back ->
  // Forward reopened /browse at 505, its very bottom, the title scrolled under
  // the nav. Chromium opened it at 0. "manual" leaves restoration to us.
  useLayoutEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    currentKeyRef.current = key;
    if (hash) {
      // Holiday audit 1121 (High): an in-app link to "/page#section" never scrolled. Browsers scroll to a #hash only
      // on a real page load, never on a pushState navigation, and the section is often drawn late (lazy data), so the
      // page stayed at the top on desktop and at the OLD page's offset on a phone. Scroll to it here, retrying while
      // the content mounts; a second tap on the same link mints a new key and scrolls again.
      const samePath = prevPathnameRef.current === pathname;
      prevPathnameRef.current = pathname;
      if (!samePath) resetLargeTitles();
      return scrollToHash(hash);
    }

    const samePathname = prevPathnameRef.current === pathname;
    prevPathnameRef.current = pathname;
    // D4: a new page never inherits the last page's collapsed title bar.
    if (!samePathname) resetLargeTitles();

    const mainEl = document.getElementById("main-content");
    const saved = scrollPositions.get(key);

    // POP = back/forward button. Restore the saved offset for this history
    // entry. Content may not be fully laid out on the first frame (data still
    // loading), so re-apply on the next animation frame to land accurately.
    if (navigationType === "POP" && saved != null && saved > 0) {
      const apply = () => {
        const scroller = document.querySelector<HTMLElement>(".app-shell-scroll");
        if (scroller) scroller.scrollTop = saved;
        if (mainEl) mainEl.scrollTop = saved;
        window.scrollTo(0, saved);
      };
      apply();
      requestAnimationFrame(apply);
      return;
    }

    // Query-only change on the same page (e.g. a URL-driven tab switcher) —
    // keep the user's scroll position; don't yank them to the top.
    if (samePathname) {
      return;
    }

    // Forward navigation — reset every possible scroll container to the top.
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    // Document-scroll routes use <main id="main-content"> as the scroll container.
    if (mainEl) mainEl.scrollTop = 0;
    // Fixed-shell routes use AppShell's internal `.app-shell-scroll` div —
    // resetting only #main-content leaves stale scroll position when
    // navigating between fixed-shell routes (Dashboard → Messages, etc.).
    // Every page scroller: AppShell's, and AppPage / SectionScreen's own column.
    document.querySelectorAll<HTMLElement>(".app-shell-scroll, [data-app-page-scroll]").forEach((el) => {
      el.scrollTop = 0;
    });
    setVisible(false);
  }, [pathname, hash, key, navigationType]);

  // Watch the active scroll container for the reveal threshold AND continuously
  // record its offset against the current history entry, so a later POP back to
  // this entry can restore it. The container is owned by the route, so
  // re-resolve it on each navigation; document-scroll routes fall back to the
  // window.
  useEffect(() => {
    if (hash) return;
    const scroller = document.querySelector<HTMLElement>(".app-shell-scroll");
    scrollerRef.current = scroller;
    const readPos = () => (scroller ? scroller.scrollTop : window.scrollY);
    const onScroll = () => {
      // A scroll that lands after the route changed (the new page's restore or
      // reset) belongs to the NEW entry; recording it under this one is how
      // an entry left at the top came back mid-page (Q1312).
      if (currentKeyRef.current !== key) return;
      const pos = readPos();
      const viewport = scroller ? scroller.clientHeight : window.innerHeight;
      setVisible(pos > revealAfter(viewport) && !footerInView() && !onLanding(pathname) && !onHeartList(pathname));
      scrollPositions.set(key, pos);
    };
    onScroll();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [pathname, hash, key]);

  const scrollToTop = () => {
    hapticLight();
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    // Fixed-shell routes scroll AppShell's inner container; document-scroll
    // routes (multi-step forms, legal, marketing) scroll the window. Mirror
    // the reveal watcher's `scroller ?? window` fallback — otherwise the
    // button renders on document-scroll pages but the click does nothing.
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTo({ top: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  };

  // The button fades/scales in and out with a plain CSS transition (Q1356:
  // framer-motion left this file so no route downloads it for a fade). Like
  // AnimatePresence did, it mounts when it is wanted, draws one frame in its
  // hidden pose so the fade-in has somewhere to start, and unmounts once the
  // fade-out has finished: a hidden button must not stay in the page, where
  // tap-target and press-every-control scans would find a 35px box.
  const duration = reducedMotion ? 120 : 180;
  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
  const hiddenTransform = reducedMotion ? "none" : "translateY(8px) scale(0.8)";
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      setRendered(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const t = window.setTimeout(() => setRendered(false), duration);
    return () => window.clearTimeout(t);
  }, [visible, duration]);

  if (!rendered) return null;
  return (
    <RoundIconButton
      onClick={scrollToTop}
      aria-label="Scroll to top"
      aria-hidden={shown ? undefined : true}
      tabIndex={shown ? undefined : -1}
      // Sit above the floating MobileNav dock + home indicator, hugging
      // the right edge. z below the nav (which is z-40+) so it never
      // overlaps the dock's controls.
      className="fixed right-4 z-30 active:scale-[0.94]"
      style={{
        bottom: "calc(var(--safe-area-bottom, 0px) + 112px)",
        background: "var(--surface-premium)",
        border: "1px solid hsl(var(--olivewood) / 0.18)",
        color: "hsl(var(--olivewood))",
        backdropFilter: "blur(10px) saturate(150%)",
        WebkitBackdropFilter: "blur(10px) saturate(150%)",
        // Polish audit 11-27 #6: flat, no shadow (it read as a card floating over the cards under it).
        boxShadow: "none",
        opacity: shown ? 1 : 0,
        transform: shown ? undefined : hiddenTransform,
        pointerEvents: shown ? undefined : "none",
        transition: `opacity ${duration}ms ${ease}, transform ${duration}ms ${ease}`,
        ...(onGiveawayPage(pathname) ? GIVEAWAY_LOOK : null),
      }}
    >
      <ChevronUp className="h-5 w-5" />
    </RoundIconButton>
  );
};

export default ScrollToTop;
