import type { RefObject } from "react";
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
  /** Show only saved jobs. The sheet offers this toggle because "Only saved
   *  jobs" is a filter, not a header control — it comes from
   *  buildJobFilterSections and never rode the brand row. */
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
  /**
   * Whether this toolbar renders the screen's `<h1>`.
   *
   * It normally must: the browse screens have no visible title by design
   * (owner: "home will not have a title just the H logo"), so the toolbar's
   * sr-only heading is the only thing keeping the document from having zero
   * headings, which is an a11y defect.
   *
   * It must NOT when the surrounding shell already supplies one. Guest
   * `/browse` on WEB renders through `PublicHeaderPage title="Browse Jobs"`,
   * which draws a visible `<h1>` — so the toolbar's sr-only copy made TWO
   * `<h1>Browse Jobs</h1>` on that page: an a11y defect and a Playwright
   * strict-mode violation, caught by `home-chrome.spec.ts` at 320, 375 and
   * 1440. Native keeps rendering it, because `PageScaffold`'s title card there
   * is the H logo and carries no heading of its own.
   */
  renderHeading?: boolean;
}

