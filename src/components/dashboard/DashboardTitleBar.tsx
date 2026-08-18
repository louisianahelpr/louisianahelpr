import type { ReactNode } from "react";
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
  /** Where the emblem links. Home points at itself; the signed-out guest
   *  feed points at the marketing landing, which is the page a visitor who
   *  taps the crest is actually looking for. */
  emblemTo?: string;
  /**
   * Controls pinned to the trailing end of the row, after the feed's icon
   * cluster. Defaults to the notification bell.
   *
   * The guest feed passes its "Log in" / "Get started" pair instead: a bell
   * is meaningless with no session, and those two ARE the signed-out screen's
   * entire conversion path, so they occupy the same slot the bell holds for a
   * signed-in user rather than being demoted to a second bar. They stay full
   * labelled controls — never icons, never behind a menu.
   */
  trailing?: ReactNode;
}

/**
 * The tighter title-card padding this row needs.
 *
 * PageScaffold's default `py-4 lg:py-5` is sized for a two-line greeting; a
 * single row of 44px controls floats in ~32px of dead space inside it. The
 * `!` is load-bearing — both are same-specificity utilities, so without it
 * stylesheet order (not class order) decides which `py` wins.
 */
export const TITLE_BAR_PADDING = "!py-2 lg:!py-2.5";

/**
 * The Browse feed's single band of chrome — the emblem on the left, then the
 * feed's action icons and one trailing control on the right. The large
 * "Browse jobs" title sits in the panel toolbar directly beneath it (the iOS
 * large-title pattern): one row of controls, one big title, no third bar.
 *
 * Shared by BOTH browse surfaces, which differ only in that trailing control:
 * Home ends the row with the notification bell, the signed-out guest feed with
 * its "Log in" / "Get started" pair (see `trailing`). Everything else — the
 * emblem, the icon cluster, the padding constant, the degradation behaviour —
 * is identical, which is the point: a visitor who signs up should recognise
 * the screen they were just on.
 *
 * This is a PageScaffold `titleCard` body, NOT an app bar. Home used to be the
 * last signed-in screen carrying a sticky `<DashboardHeader />`; Messages, My
 * Jobs and My Posts all dropped theirs because their page name already lives
 * in the panel's own toolbar, and Home's does too. The guest feed carried one
 * for the same non-reason and dropped it here.
 *
 * Deliberately emblem-only — no "Helpr · LA" wordmark. Home is where the user
 * already knows what app they're in; the crest is enough of a brand anchor,
 * and dropping the wordmark is what buys the room for five icons at 375px.
 *
 * Renders NO heading element of any level — the screen's single `<h1>` is the
 * toolbar's, and the emblem takes its accessible name from the image `alt`.
 *
 * Measured fit, Home (bell trailing): at 375 the card gives this row 295px
 * plus the 8px `-mr-2` overhang; the emblem is 37px and the five controls
 * occupy 94→342, leaving 16px of slack. At 320 there is no arrangement that
 * fits both — five 44px controls alone need 236 of the 246 available — so the
 * emblem is the part that yields: it has no `shrink-0`, so it shrinks toward
 * zero inside the card's `overflow-hidden` and every control stays reachable.
 * That degradation is deliberate; do not "fix" it by shrinking the tap targets
 * below 44px.
 *
 * Measured fit, guest (two labelled CTAs trailing, no `-mr-2`): a labelled
 * pair is far wider than a bell, so the row is one control shorter. At 375 the
 * 295px row holds the 37px emblem plus search · filters · "Log in" ·
 * "Get started" at 107→334 — 29px of slack. Three icons DO NOT fit with them:
 * measured, that arrangement needs ~328px of the 295 and squashes the emblem
 * to 10px, which is why the List⇄Map toggle moved down to the toolbar row
 * (`hideViewToggle` + `titleRowTrailing`). At 320 the emblem yields as above.
 */
export function DashboardTitleBar({
  filters,
  user,
  view,
  setView,
  hideViewToggle,
  emblemTo = "/dashboard",
  trailing,
}: DashboardTitleBarProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <HelprMark to={emblemTo} size="sm" emblemOnly />
      {/* The negative margin pulls a trailing ICON button's own inner padding
          back to the card's optical edge, so the bell lines up with the content
          below instead of sitting inset from it — and buys 8px of the row back.
          It is deliberately NOT applied to a custom `trailing`: the guest pair
          ends in a bordered pill whose border IS its visual edge, so pulling it
          out would hang it 8px proud of everything beneath it. */}
      <div className={`flex items-center gap-1 shrink-0${trailing ? "" : " -mr-2"}`}>
        <BrowseTasksActions
          filters={filters}
          user={user}
          view={view}
          setView={setView}
          hideViewToggle={hideViewToggle}
        />
        {trailing ?? <NotificationPanel />}
      </div>
    </div>
  );
}

export default DashboardTitleBar;
