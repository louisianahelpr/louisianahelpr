import type { User as SupaUser } from "@supabase/supabase-js";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { BrowseTasksActions } from "@/components/dashboard/browseTasksToolbar/BrowseTasksActions";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

interface DashboardTitleBarProps {
  /** Dashboard filter state + setters (from useDashboardFilters) — the SAME
   *  object BrowseTasksToolbar receives, so the lifted buttons and the input
   *  they open share one copy of `searchOpen` / `filtersOpen`. */
  filters: ReturnType<typeof useDashboardFilters>;
  /** Signed-in user — gates the SavedSearches control. */
  user: SupaUser | null;
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /** Hide the List⇄Map toggle (web desktop shows both panes at once). */
  hideViewToggle?: boolean;
}

/**
 * Home's single band of chrome — the emblem on the left, then the feed's
 * action icons and the notification bell on the right. The large "Browse jobs"
 * title sits in the panel toolbar directly beneath it (the iOS large-title
 * pattern): one row of controls, one big title, no third bar.
 *
 * This is a PageScaffold `titleCard` body, NOT an app bar. Home used to be the
 * last signed-in screen carrying a sticky `<DashboardHeader />`; Messages, My
 * Jobs and My Posts all dropped theirs because their page name already lives
 * in the panel's own toolbar, and Home's does too.
 *
 * Deliberately emblem-only — no "Helpr · LA" wordmark. Home is where the user
 * already knows what app they're in; the crest is enough of a brand anchor,
 * and dropping the wordmark is what buys the room for five icons at 375px.
 *
 * Renders NO heading element of any level — the screen's single `<h1>` is the
 * toolbar's, and the emblem takes its accessible name from the image `alt`.
 *
 * Measured fit: at 375 the card gives this row 295px plus the 8px `-mr-2`
 * overhang; the emblem is 37px and the five controls occupy 94→342, leaving
 * 16px of slack. At 320 there is no arrangement that fits both — five 44px
 * controls alone need 236 of the 246 available — so the emblem is the part
 * that yields: it has no `shrink-0`, collapses to zero width inside the card's
 * `overflow-hidden`, and every control stays reachable. That degradation is
 * deliberate; do not "fix" it by shrinking the tap targets below 44px.
 */
export function DashboardTitleBar({
  filters,
  user,
  view,
  setView,
  hideViewToggle,
}: DashboardTitleBarProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <HelprMark to="/dashboard" size="sm" emblemOnly />
      {/* -mr-2 pulls the trailing icon button's own inner padding back to the
          card's optical edge, so the bell lines up with the content below
          instead of sitting inset from it — and buys 8px of the row back. */}
      <div className="flex items-center gap-1 shrink-0 -mr-2">
        <BrowseTasksActions
          filters={filters}
          user={user}
          view={view}
          setView={setView}
          hideViewToggle={hideViewToggle}
        />
        <NotificationPanel />
      </div>
    </div>
  );
}

export default DashboardTitleBar;
