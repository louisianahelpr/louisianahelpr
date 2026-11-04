import { useEffect, useState } from "react";
import { dockRevealsAtEnd } from "@/components/mobileNav/dockAtEnd";

// Moved out of MobileNav.tsx unchanged (Q806 god-component ratchet, pure move): the dock's
// scroll-aware shadow lift and hide-on-scroll, re-run on every route (pathname).
export function useDockScrollState(pathname: string) {
  // Scroll-aware shadow lift — when content is actually scrolled under the
  // nav, deepen the drop shadow so the bar reads as floating above the
  // page rather than glued to the bottom edge.
  const [scrolled, setScrolled] = useState(false);
  // Hide-on-scroll: the whole bar (curtain + pill + Post FAB) slides off the
  // bottom when the user scrolls DOWN into content, and returns on scroll UP
  // or near the top — so the reading area is uncluttered but navigation is
  // one upward flick away. The Post FAB rides with the bar, so it's never
  // permanently gone; scrolling up reveals it again.
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    // A fresh route always shows the bar and resets the scroll baseline.
    setNavHidden(false);
    // Reads the active scroll offset from whichever region actually scrolled.
    // Routes differ: AppShell pages scroll `.app-shell-scroll`, but several
    // pages (guest browse, Activity) roll their own `overflow-auto` flex
    // container, and document-scroll routes scroll the window. A capture-phase
    // listener (below) hands us the true scroll target, so prefer its
    // scrollTop; fall back to the AppShell container, then the window.
    //
    // The `.app-shell-scroll` lookup is resolved ONCE per route, not per event.
    // It used to run inside `getY`, i.e. on every scroll event — and on any
    // route rendering `<AppShell scrollable={false}>` (Profile, Activity,
    // Messages) that element does not exist, so every single scroll event paid
    // for a full-document querySelector that was always going to miss. Measured
    // at ~8x the cost of a hit. `null` is a valid cached answer here: we want
    // "already looked, not present", not "look again".
    let cachedShell: HTMLElement | null = null;
    let shellResolved = false;
    const shellScroller = () => {
      if (!shellResolved) {
        cachedShell = document.querySelector<HTMLElement>(".app-shell-scroll");
        shellResolved = true;
      }
      return cachedShell;
    };
    // The element whose scroll last drove the decision. Held so the observer
    // below can notice when THAT surface stops being able to scroll — see the
    // invariant note there.
    let activeScroller: HTMLElement | null = null;
    const getY = (target: EventTarget | null) => {
      if (
        target instanceof HTMLElement &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        activeScroller = target;
        return target.scrollTop;
      }
      const internal = shellScroller();
      if (internal && internal.scrollTop > 0) {
        activeScroller = internal;
        return internal.scrollTop;
      }
      // Window/document scroll — no element to watch.
      activeScroller = null;
      return window.scrollY;
    };

    // INVARIANT: the dock may only stay hidden while some surface is actually
    // scrolled down. Everything else here is event-driven off `scroll`, which
    // means a surface that simply STOPS EXISTING never fires anything and the
    // dock is stranded off-screen with no gesture that can bring it back.
    //
    // Measured, not hypothesised: on Home, scroll the feed down (dock hides),
    // then tap Map view. BrowseTasksFeed sets `display:none` on the list's
    // PullToRefreshWrapper and renders the map in a sibling that never
    // scrolls — so there was no scroll surface left on the route at all, and
    // the whole bottom nav (tabs AND the Post FAB) stayed 130px below the
    // viewport until the user navigated away. The same shape applies to any
    // view swap that unmounts the scroller.
    //
    // ResizeObserver is the right tool: an observed element that becomes
    // `display:none` (or leaves the document) reports a 0x0 box, which is
    // exactly the "this surface can no longer justify a hidden dock" signal.
    // It is deliberately NOT a second copy of the hide/reveal logic — it only
    // ever REVEALS, and re-baselines `lastY` so the next real scroll event
    // measures a delta from where the surface is now rather than from a
    // position that belonged to a container that is gone. Coming BACK to a
    // scrollable view therefore leaves the dock visible instead of snapping it
    // shut on a toggle the user never scrolled.
    let observed: HTMLElement | null = null;
    const surfaceObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const el = observed;
            if (!el) return;
            const scrollable =
              el.isConnected && el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 8;
            lastY = scrollable ? el.scrollTop : 0;
            if (!scrollable) setNavHidden(false);
          });
    const syncObserver = () => {
      if (!surfaceObserver || activeScroller === observed) return;
      surfaceObserver.disconnect();
      observed = activeScroller;
      if (observed) surfaceObserver.observe(observed);
    };

    let lastY = getY(null);
    const checkScroll = (e?: Event) => {
      const y = getY(e?.target ?? null);
      syncObserver();
      setScrolled(y > 8);
      const delta = y - lastY;
      const surface = activeScroller ?? document.documentElement;
      const atEnd = dockRevealsAtEnd(surface.scrollHeight, surface.clientHeight, y); // DA-9: dockAtEnd.ts
      // Ignore sub-threshold jitter and iOS rubber-band overscroll (y < 0), which would otherwise flicker the bar
      // during momentum scrolling; never at the end, whose last step is often under 6px.
      if (!atEnd && (y < 0 || Math.abs(delta) < 6)) {
        lastY = y;
        return;
      }
      // Near the top or at the end: reveal. Otherwise scrolling down hides and scrolling up reveals.
      setNavHidden(!atEnd && y >= 64 && delta > 0);
      lastY = y;
    };
    checkScroll();
    // Capture phase catches scroll from ANY nested container on the route
    // (scroll events don't bubble but do capture), so one listener covers
    // window-, AppShell-, and custom-container-scrolling pages uniformly.
    document.addEventListener("scroll", checkScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", checkScroll, { capture: true });
      surfaceObserver?.disconnect();
    };
  }, [pathname]);

  return { scrolled, navHidden };
}
