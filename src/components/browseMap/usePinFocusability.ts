import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { MKMap } from "./mapkitRuntime";
import type { MapJob } from "./config";

/*
 * Two DOM-level pin syncs BrowseMap runs against MapKit's own pin elements, moved out of
 * src/components/BrowseMap.tsx unchanged (Q806, the god-component ratchet). BrowseMap calls each one at the
 * spot the code used to sit, so the effects run in the same order as before.
 */

export function usePinFocusability(mapRef: RefObject<MKMap | null>, mapReady: boolean, visibleJobs: MapJob[]) {
  /**
   * Keep only the pins a user can actually reach in the tab order.
   *
   * MapKit does not remove a clustered pin from the DOM — it leaves the
   * element parked at the cluster's position, drawn BEHIND the cluster bubble,
   * and marks it by setting `pointer-events: none` on it (verified 2026-08-31:
   * every pin under a cluster computed `none`, every standalone pin `auto`).
   * Because our pins are `tabIndex=0`, that meant a keyboard user could tab to
   * a pin that is invisible under a bubble and get a focus ring on nothing.
   * Mirroring MapKit's own signal into `tabindex`/`aria-hidden` fixes it with
   * no loss: the cluster standing in for those pins is itself focusable and
   * named ("6 jobs in this area — zoom in to see them"), and expanding it
   * hands the pins back.
   */
  const syncPinFocusability = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.element.querySelectorAll<HTMLElement>(".browse-map-pin").forEach((el) => {
      // Never hide the element that currently HAS focus — aria-hidden on the
      // active element is itself a violation, and the user is mid-interaction.
      const collapsed =
        getComputedStyle(el).pointerEvents === "none" && document.activeElement !== el;
      el.tabIndex = collapsed ? -1 : 0;
      if (collapsed) el.setAttribute("aria-hidden", "true");
      else el.removeAttribute("aria-hidden");
    });
  }, []);

  // Re-run it whenever the clustering can have changed. MapKit rebuilds and
  // re-styles annotation nodes asynchronously (and re-clusters on every camera
  // move), so a one-shot call after `addAnnotations` is always too early — a
  // rAF-debounced MutationObserver on the map's own subtree is what actually
  // catches it. `attributeFilter: ["style"]` both narrows the work to the
  // property that carries MapKit's signal AND keeps our own `tabindex` /
  // `aria-hidden` writes from re-triggering the observer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncPinFocusability);
    };
    schedule();
    const obs = new MutationObserver(schedule);
    obs.observe(map.element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    map.addEventListener("region-change-end", schedule);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      map.removeEventListener("region-change-end", schedule);
    };
  }, [visibleJobs, mapReady, syncPinFocusability]);
}

export function useHoveredPinHighlight(
  mapRef: RefObject<MKMap | null>,
  mapReady: boolean,
  visibleJobs: MapJob[],
  hoveredJobId: string | null | undefined,
) {
  // Desktop split-view hover sync: scale the pin whose feed card the pointer
  // is over. Pin elements are plain DOM nodes tagged with `data-job-id` (see
  // pinElement) rather than React-owned, so this reaches into the map's own
  // container to toggle a class — cheaper than rebuilding annotations on
  // every mouse move, and MapKit only calls the pin factory once anyway.
  const prevHoveredElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = prevHoveredElRef.current;
    if (prev) {
      prev.classList.remove("browse-map-pin-hovered");
      prevHoveredElRef.current = null;
    }
    if (!hoveredJobId) return;
    const el = map.element.querySelector<HTMLElement>(
      `.browse-map-pin[data-job-id="${CSS.escape(hoveredJobId)}"]`,
    );
    if (el) {
      el.classList.add("browse-map-pin-hovered");
      prevHoveredElRef.current = el;
    }
  }, [hoveredJobId, mapReady, visibleJobs]);
}
