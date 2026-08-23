import { useEffect, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
import { hapticLight } from "@/lib/haptics";
import type { StatusFilter } from "./activityFilters";
import { defaultStatusFilterFor } from "@/components/activity/activityConstants";

/**
 * ActivityHeader — the title row with search/filter toggle buttons, the
 * status-filter dropdown, and the expandable search bar. Stateless: all
 * search/filter state is owned by the page and passed in.
 *
 * It is mounted as PageScaffold's `titleCard`, NOT as the panel's first child.
 * That is what gives it the rounded floating liquid-glass card the panel below
 * already uses (owner picked the card treatment over the hairline rule it used
 * to be) — the treatment is PageScaffold's own TITLE_CARD_CLASS /
 * TITLE_CARD_STYLE, so nothing here re-implements it.
 */

/**
 * Vertical padding override for the title card when it holds this row.
 *
 * Ships WITH the header it is sized for — same reason DashboardTitleBar owns
 * TITLE_BAR_PADDING: the card's default `py-4 lg:py-5` is sized for a greeting
 * block, and on a single 44px control row it leaves the title floating in dead
 * space. `!` because PageScaffold concatenates rather than merges.
 */
export const ACTIVITY_HEADER_PADDING = "!py-1.5 lg:!py-2";

export interface ActivityHeaderProps {
  /** Page name, rendered here rather than in an app bar above the panel.
   *  The bar was removed: it stated the page name a second time, directly
   *  above this row, which is the stacked-header problem already fixed on the
   *  message thread. */
  title: string;
  /** Hide the title VISUALLY (it stays in the accessibility tree). Set on the
   *  desktop website, where this row is rendered inside the global app bar and
   *  the page name would otherwise repeat chrome the bar already carries. The
   *  title is not dropped — a screen with no h1 is an a11y defect — it is
   *  `sr-only`, which is exactly what ScreenHeaderRow's own `titleSrOnly`
   *  does. */
  titleSrOnly?: boolean;
  /**
   * Put the status tabs IN THE HEADER ROW, beside the screen name, rather than
   * on their own line beneath it.
   *
   * Set on the desktop website only, and it is purely about width: at 375px the
   * four labels cannot share a row with a title and a search button, so phone
   * gives them their own line. Both placements show the same tabs — the sheet
   * they used to hide behind on phone is gone (owner: "put the needs you etc at
   * the top oiver the job card same for search and remove the filter since they
   * will all be ther").
   */
  inlineFilters?: boolean;
  activeStatusFilters: StatusFilter[];
  activeCounts: Record<string, number>;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

/** The filter both this disclosure and Activity.tsx call the default.
 *  Read from the same function Activity.tsx seeds its state with, so the two
 *  can never disagree about what "unfiltered" means. */
const DEFAULT_STATUS_FILTER = defaultStatusFilterFor("posted");

export function ActivityHeader({
  title,
  titleSrOnly = false,
  inlineFilters = false,
  activeStatusFilters,
  activeCounts,
  statusFilter,
  setStatusFilter,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
}: ActivityHeaderProps) {
  /* The tab set drops the catch-all. On My Jobs "All" returned the same rows
     as Active, so it was a quarter of the control spent on a duplicate
     (owner). Which tab opens selected is the page's call
     (`defaultStatusFilterFor`), not this row's. */
  const inlineStatusFilters = activeStatusFilters.filter((f) => f.key !== "all");

  /**
   * The status tabs are behind a disclosure now (owner: "add a dropdown arrow
   * next to search so these aren't always showing, but then always open to
   * needs you"). Four labelled buttons with counts sat permanently above the
   * cards to express one choice that is usually left on its default.
   *
   * It starts OPEN when the filter is not the default. Collapsing a screen
   * that is silently showing you a subset — arrived at by a deep link, or by
   * back/forward restoring `?filter=` — would mean looking at four of your
   * twelve jobs with nothing on screen saying why. The disclosure hides a
   * control, never an active filter.
   */
  const isDefaultFilter = statusFilter === DEFAULT_STATUS_FILTER;
  const [tabsOpen, setTabsOpen] = useState(!isDefaultFilter);
  // A filter arriving later (deep link resolving, or a tab switch that resets
  // it) has to be able to open the disclosure too — otherwise the same
  // "filtered, but nothing says so" state comes back through the side door.
  useEffect(() => {
    if (!isDefaultFilter) setTabsOpen(true);
  }, [isDefaultFilter]);

  /* THE TABS, built once and placed twice.

     On the desktop website they ride in the header row's `meta` slot beside
     the screen name — there is width to spare there. On phone the same four
     labels cannot share a 375px row with a title and a search button, so the
     row below places them on their own line, still directly above the first
     job card (owner: "put the needs you etc at the top oiver the job card
     same for search and remove the filter since they will all be ther").

     ONE definition either way — the phone list and the desktop list must
     never be able to offer different filters.

     UNDERLINE TABS, not filled chips (owner: "make smaller", "could look
     better in this space"). Bordered pills in a tinted track put four
     rectangles of chrome above the cards to express one choice; the same
     choice reads at a glance as the screen's own display italic with a rule
     under the live one, and it costs a third of the height. It also stops
     the filter competing with the job cards for weight — the cards are the
     content, this is a caption on them. */
  const statusTabs = (
    <UnderlineTabs
      /* Inline in the header row on the desktop website; on its own line on
         phone, where the taps need a real target. */
      dense={inlineFilters}
      ariaLabel="Filter by status"
      tabs={inlineStatusFilters.map((f) => ({
        key: f.key,
        label: f.label,
        count: activeCounts[f.key] || 0,
      }))}
      value={statusFilter}
      onChange={setStatusFilter}
    />
  );

  return (
    <>
      {/* No hairline rule and no horizontal padding of its own: this row is the
          body of PageScaffold's title card now, so the card owns the surface,
          the radius and the `px-5`.

          The row itself is the shared <ScreenHeaderRow> — the same component
          the Browse feed's toolbar renders, so "My Posts" and Home cannot
          drift apart on the geometry (44px floor, title block, trailing
          `gap-1` icon cluster) that makes them read as one screen family. */}
      {searchOpen ? (
        /* Search mode — input replaces the title row inline (iOS pattern). */
        <ScreenHeaderRow title={title} titleSrOnly={titleSrOnly}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              autoFocus
              type="search"
              aria-label="Search jobs"
              placeholder="Search jobs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => { hapticLight(); setSearchOpen(false); setSearchQuery(""); }}
            className="shrink-0 text-ds-13 font-medium btn-press py-2"
            style={{ color: "hsl(var(--bark))" }}
          >
            Cancel
          </button>
        </ScreenHeaderRow>
      ) : (
        /* Normal mode — title + action buttons. */
        <ScreenHeaderRow
          title={title}
          titleSrOnly={titleSrOnly}
          style={inlineFilters ? { minHeight: "34px" } : undefined}
          className={inlineFilters ? "[&>div:first-child]:!py-0" : undefined}
          /* The active-filter indicator sits to the RIGHT of the name, the
             same shape Messages uses for "1 unread" (the one the owner asked
             for there: "put 1 unread to the right of messages bc i dont like
             it under"). It is a <span>, never a heading — the row's h1 is the
             whole page's only one. */
          meta={inlineFilters && tabsOpen ? statusTabs : undefined}
          actions={
            <>
              <button
                type="button"
                onClick={() => { hapticLight(); setTabsOpen((v) => !v); }}
                aria-expanded={tabsOpen}
                aria-controls="activity-status-tabs"
                aria-label={tabsOpen ? "Hide status filters" : "Filter by status"}
                className={`rounded-ds-md flex items-center justify-center btn-press transition ${
                  tabsOpen || !isDefaultFilter
                    ? "text-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.12)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                } ${inlineFilters ? "h-7 w-7 !min-h-0 !min-w-0" : "h-11 w-11"}`}
              >
                <ChevronDown
                  className={`${inlineFilters ? "w-3.5 h-3.5" : "w-4 h-4"} transition-transform duration-200 ${tabsOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.25}
                />
              </button>
              <button
                type="button"
                onClick={() => { hapticLight(); setSearchOpen(true); }}
                aria-label="Search jobs"
                className={`rounded-ds-md flex items-center justify-center btn-press transition text-muted-foreground hover:text-foreground hover:bg-secondary/60 ${
                  inlineFilters ? "h-7 w-7 !min-h-0 !min-w-0" : "h-11 w-11"
                }`}
              >
                <Search className={inlineFilters ? "w-3.5 h-3.5" : "w-4 h-4"} />
              </button>
            </>
          }
        />
      )}

      {/* PHONE: the same tabs, on their own line under the title row. Rendered
          only when they are not already IN that row, and hidden while the
          search input has taken the row over — one control at a time. The
          horizontal scroller is insurance for a 320px screen; from 375 up the
          four labels fit without it. */}
      {!inlineFilters && !searchOpen && tabsOpen && (
        <div id="activity-status-tabs" className="-mx-1 px-1 pb-0.5 overflow-x-auto scrollbar-hide">
          {statusTabs}
        </div>
      )}
    </>
  );
}

