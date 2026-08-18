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
  /**
   * Drop the icon cluster (view toggle · saved searches · search · filters)
   * from this row because the caller renders `<BrowseTasksActions>` itself,
   * somewhere else, with the SAME `filters` / `view` state.
   *
   * Home does exactly that: the cluster is lifted into PageScaffold's title
   * card beside the emblem and the bell, so this row carries only the large
   * "Browse jobs" title. The guest dashboard leaves this false and keeps the
   * cluster inline, sharing the row with the title.
   *
   * Nothing else changes — the search input, the recent/popular dropdown, the
   * FilterSheet and the chip rows all still live here, driven by the same
   * `searchOpen` / `filtersOpen` flags the lifted buttons toggle.
   */
  hideActions?: boolean;
  /**
   * Rendered at the trailing edge of the title row, opposite the heading.
   * Home puts its live in-progress job pill here: at 375px the title card
   * above has ~295px of usable width, and the emblem + five 40px icons
   * already claim ~250px of it, so a ~90px pill in that row overflows. This
   * row has the space now that the icons left it. Hidden while the search
   * input has taken the row over.
   */
  titleRowTrailing?: ReactNode;
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
