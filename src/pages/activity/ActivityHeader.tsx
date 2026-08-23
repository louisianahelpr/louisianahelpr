import { Search, SlidersHorizontal, X } from "lucide-react";
import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
import { hapticLight } from "@/lib/haptics";
import type { StatusFilter } from "./activityFilters";
import type { Tab } from "@/components/activity/activityConstants";
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
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
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
  filterOpen,
  setFilterOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
}: ActivityHeaderProps) {
  // The "non-default" status that lights up the filter button + dot.
  // Preserved verbatim from the prior dropdown so the active indicator
  // behaves identically after the move to the bottom sheet.
  const defaultStatus = defaultStatusFilterFor(tab);
  const isStatusFiltered = statusFilter !== defaultStatus;

  // What subset am I looking at? Without this the page says "My Posts" whether
  // it is showing everything or two of eleven, and the only clue that a filter
  // is on is a 2px dot on the filter button.
  //
  // "All" says nothing, deliberately — an unfiltered list needs no caveat, and
  // it is the one value where the extra words would be pure noise. Note this is
  // keyed on the literal "all", NOT on the tab's default: My Posts DEFAULTS to
  // Active, which is a subset, and the whole point is to say so.
  const activeFilter =
    statusFilter === "all" ? undefined : activeStatusFilters.find((f) => f.key === statusFilter);
  const activeFilterCount = activeFilter ? activeCounts[activeFilter.key] ?? 0 : 0;
  // COUNT FIRST: "2 Active", not "Active 2".
  //
  // Owner's call, and it is a parsing fix rather than a preference. "Active 2"
  // reads as a label with a trailing number of unclear meaning — a count? a
  // rank? part of a name? — while "2 Active" reads as a quantity of a thing,
  // which is what it is. It also matches the Messages chip this indicator was
  // modelled on, which has always said "1 unread" and not "unread 1".
  //
  // Applies to every filter value (Active / Completed / Cancelled), not just
  // Active, and the sr-only prefix below announces the same order the sighted
  // reader gets.
  // The inline set drops the catch-all. See the note on the control below.
  const inlineStatusFilters = activeStatusFilters.filter((f) => f.key !== "all");

  const filterLabel = activeFilter
    ? activeFilterCount > 0
      ? `${activeFilterCount} ${activeFilter.label}`
      : activeFilter.label
    : undefined;

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
          meta={
            inlineFilters ? (
              /* UNDERLINE TABS, not filled chips (owner: "make smaller",
                 "could look better in this space"). Three bordered pills in a
                 tinted track put four rectangles of chrome above the cards to
                 express one choice; the same choice reads at a glance as the
                 screen's own display italic with a rule under the live one,
                 and it costs a third of the height. It also stops the filter
                 competing with the job cards for weight — the cards are the
                 content, this is a caption on them.

                 "All" is deliberately absent (owner): on My Jobs it returned
                 the same rows as Active, so it was a third of the control
                 spent on a duplicate. */
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
                        className="font-display italic text-ds-13 leading-none"
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
            ) : filterLabel ? (
              <span
                className="font-serif italic text-ds-11 leading-none shrink-0"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* The middot is the ONLY decorative glyph in this label, and
                    it leads. There is deliberately nothing after
                    `filterLabel` — the owner reported "a stray character
                    after the count"; what is actually there is the filter
                    button's own active dot (the 8px bark pip pinned to that
                    button's top-right, further along the row), which is a
                    real state indicator and stays. Kept as a single leading
                    span so a future edit can't reintroduce a trailing one. */}
                <span aria-hidden className="mr-1">·</span>
                <span className="sr-only">Filtered by </span>
                {filterLabel}
              </span>
            ) : undefined
          }
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
              {/* The sheet's trigger. Absent on the desktop website — the
                  chips above ARE the filter there, so this would open a modal
                  duplicating controls already in the row. */}
              {!inlineFilters && (
                <button
                  type="button"
                  aria-label="Filter by status"
                  aria-expanded={filterOpen}
                  onClick={() => { hapticLight(); setFilterOpen(true); }}
                  className={`h-11 w-11 rounded-ds-md btn-press flex items-center justify-center relative transition ${
                    filterOpen || isStatusFiltered
                      ? "text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.45)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  {isStatusFiltered && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[hsl(var(--bark))] ring-2 ring-background" />
                  )}
                </button>
              )}
            </>
          }
        />
      )}

      {!inlineFilters && (
      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeFilterCount={isStatusFiltered ? 1 : 0}
        onClearAll={() => setStatusFilter(defaultStatus)}
        sections={[
          {
            key: "status",
            title: "Filter by status",
            content: (
              <div className="grid grid-cols-2 gap-1.5">
                {activeStatusFilters.map((f) => {
                  const count = activeCounts[f.key] || 0;
                  const isActive = statusFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => { hapticLight(); setStatusFilter(f.key); setFilterOpen(false); }}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-2 h-9 rounded-ds-md squircle border text-ds-11 font-semibold tracking-tight transition-all btn-press active:scale-[0.98]"
                      style={
                        isActive
                          ? {
                              background: "hsl(var(--bark))",
                              color: "hsl(var(--parchment))",
                              borderColor: "hsl(var(--bark))",
                              boxShadow: "var(--elev-bark-flat)",
                            }
                          : {
                              background: "hsl(var(--background))",
                              color: "hsl(var(--ink-deep))",
                              borderColor: "hsl(var(--border) / 0.6)",
                            }
                      }
                    >
                      <span className="truncate">{f.label}</span>
                      {count > 0 && (
                        <span
                          className="text-ds-10 tabular-nums font-semibold shrink-0 px-1.5 py-[1px] rounded-ds-pill leading-none inline-flex items-center"
                          style={
                            isActive
                              ? { background: "hsl(var(--parchment) / 0.18)", color: "hsl(var(--parchment))" }
                              : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.85)" }
                          }
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ),
          },
        ]}
      />
      )}

    </>
  );
}

