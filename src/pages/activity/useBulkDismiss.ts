import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tab } from "@/components/activity/activityConstants";

/**
 * useBulkDismiss — local-only "dismiss from view" mechanism for the
 * Cancelled section of Activity. Lets the user long-press a cancelled
 * row to enter selection mode and bulk-hide the noise. The dismissed
 * IDs persist in sessionStorage keyed by tab so a navigation away and
 * back keeps the cleared view; a fresh app launch starts over (these
 * are UI-only hides, not server-side deletes — audit history must
 * remain intact).
 *
 * The hook is tab-scoped because the dismissal namespace differs
 * (posted-job ids vs. applied-application ids should never collide,
 * but they are stored separately for safety and clarity).
 */
export function useBulkDismiss(tab: Tab) {
  const storageKey = `activity:dismissed:${tab}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    } catch {
      return new Set();
    }
  });

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...dismissed]));
    } catch {
      /* private mode / quota — ignore */
    }
  }, [dismissed, storageKey]);

  const enterSelectionMode = useCallback((seedId?: string) => {
    setSelectionMode(true);
    if (seedId) {
      setSelected(new Set([seedId]));
    }
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dismissIds = useCallback((ids: string[]) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const dismissSelected = useCallback(() => {
    dismissIds([...selected]);
    exitSelectionMode();
  }, [dismissIds, selected, exitSelectionMode]);

  const undismissAll = useCallback(() => {
    setDismissed(new Set());
  }, []);

  // Filter helper — returns the items that have NOT been dismissed.
  const filterDismissed = useCallback(
    <T extends { id: string }>(items: T[]): T[] =>
      items.filter((i) => !dismissed.has(i.id)),
    [dismissed],
  );

  const stats = useMemo(
    () => ({ dismissedCount: dismissed.size, selectedCount: selected.size }),
    [dismissed, selected],
  );

  return {
    dismissed,
    selected,
    selectionMode,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelected,
    dismissSelected,
    dismissIds,
    undismissAll,
    filterDismissed,
    stats,
  };
}
