// Persist the user's List ⇄ Map preference for the current session so
// flipping to Map, opening a job, and coming back lands in Map again.
// Shared across Dashboard (auth) and DashboardGuest (anon).
//
// sessionStorage (not localStorage): Browse must default to List on every
// fresh sign-in / app launch — a one-off Map detour shouldn't permanently
// pin the feed to Map. The choice still follows the user while they browse,
// but a new session starts clean on List.
//
// Not useSearchParams: the toggle is a personal preference, not a shareable
// URL parameter — we don't want a share/deep-link to lock subsequent
// visitors into the sharer's view.

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
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      return stored === "map" || stored === "list" ? stored : defaultView;
    } catch {
      return defaultView;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Quota / private mode — silently ignore; the in-memory state
      // still works for this session.
    }
  }, [view]);

  return [view, setViewState];
}
