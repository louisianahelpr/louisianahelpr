import { Search, X } from "lucide-react";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
import { hapticLight } from "@/lib/haptics";
import type { StatusFilter } from "./activityFilters";
import type { Tab } from "@/components/activity/activityConstants";

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
   * Render the status filters as chips IN THIS ROW instead of behind the
   * "Refine your search" sheet (owner: "delete this pop up and just add it to
   * the left of the search bar for webpages").
   *
   * Set on the desktop website only. Four mutually-exclusive statuses with
   * counts is a segmented control, and putting a segmented control behind a
   * modal costs two taps and a page-covering overlay to change one value that
   * would fit in the row it filters. Phone and native keep the sheet — there
   * the row is ~330px wide and four chips plus the page title do not fit.
   */
  inlineFilters?: boolean;
  tab: Tab;
  activeStatusFilters: StatusFilter[];
  activeCounts: Record<string, number>;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export function ActivityHeader({
  title,
  titleSrOnly = false,
  inlineFilters = false,
  tab,
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
          <div
            role="group"
            aria-label="Filter by status"
            className="flex items-baseline gap-4 shrink-0"
          >
            {inlineStatusFilters.map((f) => {
              const count = activeCounts[f.key] || 0;
              const isActive = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => { hapticLight(); setStatusFilter(f.key); }}
                  className="group inline-flex items-baseline gap-1 !min-h-0 !min-w-0 py-0.5 transition-colors"
                  style={{
                    color: isActive
                      ? "hsl(var(--bark))"
                      : "hsl(var(--olivewood) / 0.65)",
                  }}
                >
                  <span
                    /* `whitespace-nowrap`: "Needs you" wrapped to two lines
                       on a 375px screen and the active underline then sat
                       under "you" alone, which looked like a typo rather than
                       a selected tab. The row scrolls horizontally instead —
                       a tab label is a name, and a name does not wrap. */
                    className="font-display italic text-ds-13 leading-none whitespace-nowrap"
                    style={{
                      fontWeight: isActive ? 700 : 500,
                      borderBottom: isActive
                        ? "1.5px solid hsl(var(--bark))"
                        : "1.5px solid transparent",
                      paddingBottom: "3px",
                    }}
                  >
                    {f.label}
                  </span>
                  {count > 0 && (
                    <span
                      className="font-sans tabular-nums text-ds-9 leading-none"
                      style={{
                        color: isActive
                          ? "hsl(var(--bark) / 0.6)"
                          : "hsl(var(--olivewood) / 0.45)",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
          meta={inlineFilters ? statusTabs : undefined}
          actions={
            <>
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
      {!inlineFilters && !searchOpen && (
        <div className="-mx-1 px-1 pb-0.5 overflow-x-auto scrollbar-hide">
          {statusTabs}
        </div>
      )}
    </>
  );
}

