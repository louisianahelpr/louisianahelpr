import type { ReactNode, RefObject } from "react";
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
  /** List vs Map view selection. Surfaced as the filter sheet's "View"
   *  section, not as an icon in the header row. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /**
   * The Filters button that opens the panel, so the desktop-web popover can
   * anchor to it. Created by the page, which is the one component that renders
   * both the button (in the title card) and this toolbar.
   */
  filtersAnchorRef?: RefObject<HTMLElement | null>;
  /** Drop the filter sheet's "View" section entirely. On the desktop web the
   *  feed and map sit side by side, so the choice is meaningless — both panes
   *  are visible. */
  hideViewToggle?: boolean;
  /**
   * Fold Search and "Saved only" INTO the filter sheet.
   *
   * Set on phone/native, where the brand row is emblem + filter + bell and has
   * no room for their icons (owner: "phone view and ios should just be logo
   * filter and notification, everything else there somehow folds into
   * filter"). Both really are filters — one narrows by text, the other by
   * whether you saved it — so they read correctly as sheet sections. Desktop
   * web leaves them inline in the in-panel toolbar, which has the width.
   */
  compactActions?: boolean;
  /** Show only saved jobs. Passed through so the sheet can offer the toggle
   *  when `compactActions` has taken its icon out of the header row. */
  savedOnly?: boolean;
  onToggleSavedOnly?: () => void;
  savedCount?: number;
  /** Called when the user clears all filters via the "Clear all" chip —
   *  Dashboard uses this to scroll the feed back to the top so the user
   *  doesn't end up mid-list in a freshly unfiltered feed. */
  onClearAllFilters?: () => void;
  /**
   * Render the page title for screen readers only.
   *
   * Home shows the brand emblem and nothing else — owner decision: "home will
   * not have a title just the H logo". Every other screen keeps its visible
   * name. The heading is NOT dropped, only hidden: "exactly one <h1> per
   * screen" is the invariant that caught /jobs/:id rendering zero headings on
   * the public share-link page, and a screen with no h1 leaves a screen-reader
   * user on an unnameable document.
   *
   * The "Filtered · N active" eyebrow stays VISIBLE regardless — it is live
   * state, not a title, and it is the only on-screen sign that the feed is
   * showing a subset.
   */
  titleSrOnly?: boolean;
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
