import type { ReactNode } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

export interface BrowseTasksToolbarProps {
  /** Dashboard filter state + setters (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  /** Signed-in user — gates the SavedSearches control. */
  user: SupaUser | null;
  /** Helper availability rows — only the count is read, to enable the
   *  "match my hours" filter. */
  helperAvailability: unknown[];
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /** Hide the List⇄Map toggle. On the desktop web the feed and map sit
   *  side by side, so the toggle is meaningless — both panes are visible. */
  hideViewToggle?: boolean;
  /** Called when the user clears all filters via the "Clear all" chip —
   *  Dashboard uses this to scroll the feed back to the top so the user
   *  doesn't end up mid-list in a freshly unfiltered feed. */
  onClearAllFilters?: () => void;
}

// Active-filter recap chip definition. Only render when 3+ filters are
// active simultaneously. With <3 active, the existing input controls
// already cover the same ground and a recap row would be redundant
// noise. Each chip's × reuses the same clear handler the existing
// single-filter chips use further down.
export type ChipDef = {
  key: string;
  label: ReactNode;
  onClear: () => void;
  ariaLabel: string;
};
