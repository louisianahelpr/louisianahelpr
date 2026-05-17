// Persist the user's List ⇄ Map preference across mounts so flipping
// to Map, leaving the tab, and coming back lands in Map again. Shared
// across Dashboard (auth) and DashboardGuest (anon) so the choice
// follows the user regardless of session state.
//
// localStorage rather than useSearchParams: the toggle is a personal
// preference, not a shareable URL parameter, and we don't want every
// share/deep-link to lock subsequent visitors into the sharer's view.

import { useEffect, useState } from "react";

type BrowseView = "list" | "map";
const STORAGE_KEY = "helpr.browseView";

export function usePersistedBrowseView(defaultView: BrowseView = "list"): [
  BrowseView,
  (next: BrowseView) => void,
] {
  const [view, setViewState] = useState<BrowseView>(() => {
    if (typeof window === "undefined") return defaultView;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "map" || stored === "list" ? stored : defaultView;
    } catch {
      return defaultView;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Quota / private mode — silently ignore; the in-memory state
      // still works for this session.
    }
  }, [view]);

  return [view, setViewState];
}
