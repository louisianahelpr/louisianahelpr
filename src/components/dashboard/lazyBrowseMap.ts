import { lazy } from "react";

// Lazy-load BrowseMap so the map chunk (and the MapKit JS script it pulls
// from Apple's CDN) only loads when an authenticated user toggles to map
// view. List view stays cheap.
//
// A slow chunk fetch over a weak connection makes the toggle feel frozen
// with zero observability. Bracket the dynamic import in a User Timing
// mark/measure so the cost of the map-chunk load shows up in the
// Performance panel / any RUM that reads `performance.getEntriesByType`.
// One-shot: only the first load is timed (the chunk is cached after).
let mapChunkTimed = false;
export const BrowseMap = lazy(() => {
  const timed = !mapChunkTimed && typeof performance !== "undefined";
  if (timed) {
    mapChunkTimed = true;
    performance.mark("browse-map:load-start");
  }
  return import("@/components/BrowseMap").then((m) => {
    if (timed) {
      try {
        performance.mark("browse-map:load-end");
        performance.measure("browse-map:load", "browse-map:load-start", "browse-map:load-end");
      } catch {
        /* measure can throw if marks were cleared — never block the map */
      }
    }
    return { default: m.BrowseMap };
  });
});
