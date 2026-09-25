import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { ScreenHeaderRow } from "@/components/ui/ScreenHeaderRow";
import { hapticLight } from "@/lib/haptics";
import type { StatusFilter } from "@/components/job-card/activityFilters";
import { defaultStatusFilterFor } from "@/components/job-card/activityConstants";

/**
 * PostsHeader — the My Posts (/posts) header: the "My Posts" title row with
 * the search and status-filter toggle buttons, the status tabs, and the
 * expandable search field. Stateless: all search/filter state is owned by the
 * page and passed in.
 *
 * My Posts owns this header and My Jobs owns its own (src/pages/jobs/
 * JobsHeader.tsx). Owner, 2026-09-25: "They should be there own headers. We
 * already discussed they should not be under a shared activity folder." The
 * two headers share only generic UI primitives (ScreenHeaderRow,
 * UnderlineTabs); src/test/filterDisclosureParity.test.ts keeps the phone
 * disclosure behaving the same on My Posts, My Jobs and Messages.
 *
 * On phone it is mounted as PageScaffold's `titleCard`, which gives it the
 * rounded floating liquid-glass card the panel below uses — the treatment is
 * PageScaffold's own TITLE_CARD_CLASS / TITLE_CARD_STYLE, so nothing here
 * re-implements it. On the desktop website it is the panel's first child.
 */

/**
 * Vertical padding override for the title card when it holds this row.
 *
 * Ships WITH the header it is sized for — same reason DashboardTitleBar owns
 * TITLE_BAR_PADDING: the card's default `py-4 lg:py-5` is sized for a greeting
 * block, and on a single 44px control row it leaves the title floating in dead
 * space. `!` because PageScaffold concatenates rather than merges.
 */
export const POSTS_HEADER_PADDING = "!py-1.5 lg:!py-2";

const TITLE = "My Posts";
const TABS_ID = "posts-status-tabs";

export interface PostsHeaderProps {
  /** Hide the title VISUALLY (it stays in the accessibility tree). Set on the
   *  desktop website, where the app bar and the right rail already name the
   *  page. The title is `sr-only`, not dropped — a screen with no h1 is an a11y
   *  defect — which is exactly what ScreenHeaderRow's own `titleSrOnly` does. */
  titleSrOnly?: boolean;
  /**
   * Put the status tabs IN THE HEADER ROW, beside the screen name, rather than
   * on their own line beneath it.
   *
   * Set on the desktop website only, and it is purely about width: at 375px the
   * labels cannot share a row with a title and a search button, so phone gives
   * them their own line. Both placements show the same tabs (owner: "put the
   * needs you etc at the top oiver the job card same for search and remove the
   * filter since they will all be ther").
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

/** The filter My Posts opens on. Read from the same function JobListPage
 *  seeds its state with, so the two can never disagree about what
 *  "unfiltered" means. */
const DEFAULT_STATUS_FILTER = defaultStatusFilterFor("posted");

export function PostsHeader({
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
}: PostsHeaderProps) {
  /* The tab set drops the catch-all "All" (owner: it spent a tab on a
     duplicate of Active). Which tab opens selected is the page's call
     (`defaultStatusFilterFor`), not this row's. */
  const inlineStatusFilters = activeStatusFilters.filter((f) => f.key !== "all");

  /* ONE PRESS OUT, AND THE FOCUS COMES BACK.
     Owner, 2026-09-19 (/posts): "the x on search needed to be clicked 3
     times to close the search bar". The X clears the query and closes the
     field in a single activation, and the `?q=` mirror does not re-open it
     (transition trail in src/test/searchDismissAndOverlay.test.tsx).
     The field unmounts under the caret, so every dismiss goes through
     `closeSearch()`, which restores the whole pre-open state in one call —
     query cleared, field closed, focus back on the magnifier that opened it.
     Escape does the same thing. */
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  /* Focus AFTER the commit that unmounts the field — the trigger does not
     exist yet at the moment the click handler runs. An effect keyed on the
     open flag is the only place both facts are true, and it fires only on a
     true->false transition so it can never steal focus on first paint. */
  const wasOpenRef = useRef(searchOpen);
  useEffect(() => {
    if (wasOpenRef.current && !searchOpen) searchTriggerRef.current?.focus();
    wasOpenRef.current = searchOpen;
  }, [searchOpen]);
  const closeSearch = () => {
    hapticLight();
    setSearchQuery("");
    setSearchOpen(false);
  };

  const isDefaultFilter = statusFilter === DEFAULT_STATUS_FILTER;
  // THE PHONE TAB ROW STARTS FOLDED ON THE DEFAULT FILTER. Owner, 2026-09-25
  // (screenshots of My Posts, My Jobs and Messages on iPhone): "This should
  // open with the chevrons collapsed. Not expanded." A non-default filter
  // arrives OPEN, so an active filter is never hidden. The chevron beside
  // search opens and folds the row (owner, 2026-09-19: "add a dropdown arrow
  // next to search so these aren't always showing").
  const [tabsOpenPhone, setTabsOpenPhone] = useState(!isDefaultFilter);
  // On the wide screen the tabs simply STAY UP — there is room for them beside
  // the title, so hiding them behind a chevron buys nothing and costs a press
  // (owner: "drop down not needed on the wide screen, the category can stay at
  // the top"). The disclosure is a phone affordance.
  const tabsOpen = inlineFilters || tabsOpenPhone;
  const setTabsOpen = setTabsOpenPhone;
  // A FILTER ARRIVING LATER RE-OPENS A ROW THE READER FOLDED AWAY.
  // The disclosure may hide a control; it may never hide an ACTIVE filter. A
  // deep link resolving, back/forward restoring `?filter=`, or a bucket change
  // all land the same way: a filtered list with nothing on screen saying why.
  useEffect(() => {
    if (!isDefaultFilter) setTabsOpen(true);
  }, [isDefaultFilter]);

  /* IF A LABEL IS PAST THE EDGE, SAY SO.
     The labels FIT the phone row (11px type + 12px gaps, and the short words
     below 390px). This fade covers every width they cannot be measured at:
     Dynamic Type at its largest, a sixth bucket, a translation, a three-digit
     count. In all of those the row scrolls, and a scroller with no affordance
     reads as the end of the row, not as more of it.
     A MASK, not an overlay gradient: the card behind this row is
     liquid-glass, so a gradient painted in a surface colour would be a pale
     rectangle on translucency in one theme and a dark one in the other.
     Fading the CONTENT's own alpha is right in both themes and on any
     surface, and it costs no element.
     Only while there IS something past that edge, and on the side it is on —
     a permanent fade would dim a label that is fully on screen. */
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = tabScrollerRef.current;
    if (!el) {
      setTabEdges({ start: false, end: false });
      return;
    }
    const measure = () => {
      /* THE PREDICATE IS "A LABEL IS PAST THE EDGE", not "the box scrolls".
         `scrollWidth - clientWidth` is the second thing, and at 320 the two
         disagree: this scroller carries the card's own `px-5` (it bleeds with
         `-mx-5`), and Chrome counts the trailing 20px of that padding in
         scrollWidth, so a row whose labels all fit reports 6px of slack.
         Measuring the tab GROUP's box against the scroller's asks the question
         the fade is actually for. */
      const content = el.firstElementChild;
      if (!content) return;
      const box = el.getBoundingClientRect();
      const inner = content.getBoundingClientRect();
      setTabEdges({
        start: inner.left < box.left - 1,
        end: inner.right > box.right + 1,
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // The width that decides this is the ELEMENT's, not the window's: the
    // desktop rail opening and closing changes it with no resize event at all.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
    // `statusFilter` is in here because selecting a tab scrolls the row to it
    // (UnderlineTabs' own scrollIntoView), which moves both edges.
  }, [tabsOpen, inlineFilters, inlineStatusFilters.length, statusFilter]);

  const TAB_FADE_PX = 28;
  const tabFadeStyle: CSSProperties | undefined =
    tabEdges.start || tabEdges.end
      ? (() => {
          const gradient =
            `linear-gradient(to right, ` +
            `${tabEdges.start ? "transparent 0px, #000 " + TAB_FADE_PX + "px" : "#000 0px"}, ` +
            `${tabEdges.end ? `#000 calc(100% - ${TAB_FADE_PX}px), transparent 100%` : "#000 100%"})`;
          // Both spellings: WebKit is the engine the app actually ships in.
          return { WebkitMaskImage: gradient, maskImage: gradient };
        })()
      : undefined;

  /* THE TABS, built once and placed twice.

     On the desktop website they ride in the header row's `meta` slot beside
     the screen name. On phone they cannot share a 375px row with a title and
     a search button, so the row below places them on their own line, directly
     above the first job card. ONE definition either way — the phone list and
     the desktop list can never offer different filters.

     UNDERLINE TABS, not filled chips (owner: "make smaller", "could look
     better in this space"): the screen's own display italic with a rule under
     the live one, at a third of the height of bordered pills, so the filter
     reads as a caption on the cards rather than competing with them. */
  const statusTabs = (
    <UnderlineTabs
      /* Inline in the header row on the desktop website; on its own line on
         phone, where the taps need a real target. */
      dense={inlineFilters}
      /* PHONE PAYS FOR THE WIDTH, DESKTOP DOES NOT. `tight` drops the labels
         to 11px and the gap to 12px, and `shortLabel` swaps three of the five
         words below 390px — both only on the phone row, where five tabs, a
         title and a search button share 320 to 414px. The desktop row has
         ~1100px and keeps the owner's words at their own size. */
      tight={!inlineFilters}
      ariaLabel="Filter by status"
      tabs={inlineStatusFilters.map((f) => ({
        key: f.key,
        label: f.label,
        // Desktop has the room, so it never takes the short word — passing it
        // only on the phone row is what keeps the swap a width decision and
        // not a second source of truth about what a bucket is called.
        shortLabel: inlineFilters ? undefined : f.shortLabel,
        count: activeCounts[f.key] || 0,
      }))}
      value={statusFilter}
      onChange={setStatusFilter}
    />
  );

  return (
    <>
      {/* No hairline rule and no horizontal padding of its own: on phone this
          row is the body of PageScaffold's title card, so the card owns the
          surface, the radius and the `px-5`.

          The row itself is the shared <ScreenHeaderRow> — the same component
          the Browse feed's toolbar renders, so this screen and Home cannot
          drift apart on the geometry (44px floor, title block, trailing
          `gap-1` icon cluster) that makes them read as one screen family. */}
      {searchOpen ? (
        /* Search mode — the field GROWS LEFTWARD out of the search button it
           came from, and the title stays exactly as it was (owner: "search
           should expand to the left if it's selected without coloring the
           title").

           This is the shared <ScreenHeaderRow expandingSearch> slot. The slot
           keeps the name (visible AND as the h1), gives the field free space
           rather than a sibling's, and holds the magnifier's place in the
           trailing cluster OPEN while the field is up, so the ✕ at the field's
           trailing edge can never sit on the control that replaces it. See
           SearchTriggerSlot for the arithmetic. */
        <ScreenHeaderRow
          title={TITLE}
          titleSrOnly={titleSrOnly}
          expandingSearch={{
            open: true,
            /* DESKTOP: THE TABS STAY UP WHILE SEARCHING, and the field is
               capped (owner, 2026-09-14, VN-31: "search does not need to open
               that large. also the chevron on the right is useless here").
               On the desktop website (`inlineFilters`) the tabs keep their
               place on the left, the field sits at the right capped at
               `max-w-md`, and no chevron renders. Phone: full-width field,
               tabs on their own line, chevron. */
            leading: inlineFilters ? (
              <div id={TABS_ID} className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                {statusTabs}
              </div>
            ) : undefined,
            /* The held-open slot must match the trigger's OWN box, which this
               row sizes by width: `h-7 w-7` on the desktop website, `h-11 w-11`
               on phone. A slot narrower than the button it reserves hands the
               overlap straight back. */
            triggerWidth: inlineFilters ? "28px" : "44px",
            /* THE SAME 320–414 BUDGET THE TAB LABELS ARE FIGHTING FOR.
               On a phone this row keeps five legible tab labels while search is
               closed, and a field you can read what you typed in while it is
               open. The tabs pay with type and shorter words; the open field has
               no such lever — every other item on the row is fixed-width — so
               what yields is the visible page name, below 500px only. Measured
               at 375: the field is 233px wide. See
               `narrowTitleStepsAside`. */
            narrowTitleStepsAside: true,
            field: (
              <div className={`relative flex-1 min-w-0 ${inlineFilters ? "max-w-md" : ""} origin-right motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200`}>
                {/* THE MAGNIFIER IS IN THE FIELD (owner, 2026-09-19: "the
                    magnifier should move to the left and the x stay"). Not a
                    button — the field is already open — just the glyph that
                    says what this box is. */}
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  type="search"
                  aria-label="Search jobs"
                  /* No placeholder (owner). The magnifier already says what the
                     field is. */
                  placeholder=""
                  spellCheck={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  /* Escape is the keyboard's X. Same single activation, same
                     pre-open state, same focus return — see closeSearch above. */
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
                  className="w-full pl-9 pr-10 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                />
                {/* The X lives INSIDE the field, on its right (owner), and is
                    the only control in the field. Always present, not only once
                    you have typed: it is the way OUT of search. Clears the query
                    and closes in one press — the two things "done searching"
                    means.

                    `!min-h-0 !min-w-0` — index.css's bare
                    `button { min-height: 44px; min-width: 44px }` HIG rule
                    otherwise wins over `h-7 w-7` and renders this 44x44 inside
                    a 36px-tall bar, spilling past its top and bottom edge (the
                    same trap as the toast close button and BrowseSearchBar's ✕).
                    A hit area wider than the glyph is how a mis-tap lands on
                    whatever is next to it. */}
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Close search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 flex items-center justify-center ctl-exit text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
                >
                  <X className="w-4 h-4" strokeWidth={2.25} />
                </button>
              </div>
            ),
            /* The status chevron STAYS available while searching — the two
               filters are independent, and making you leave search to change a
               status filter you can see the results of is a needless round
               trip. Phone only: on desktop the tabs are already beside the
               field (VN-31, above). */
            actions: !inlineFilters ? (
              <button
                type="button"
                onClick={() => { hapticLight(); setTabsOpen((v) => !v); }}
                aria-expanded={tabsOpen}
                aria-controls={tabsOpen ? TABS_ID : undefined}
                aria-label={tabsOpen ? "Hide status filters" : "Filter by status"}
                className={`shrink-0 rounded-ds-md flex items-center justify-center btn-press transition hover:bg-secondary/60 h-11 w-11 ${
                  !isDefaultFilter ? "text-[hsl(var(--bark))]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${tabsOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.25}
                />
              </button>
            ) : undefined,
          }}
        />
      ) : (
        /* Normal mode — title + action buttons. */
        <ScreenHeaderRow
          title={TITLE}
          titleSrOnly={titleSrOnly}
          style={inlineFilters ? { minHeight: "34px" } : undefined}
          className={inlineFilters ? "[&>div:first-child]:!py-0" : undefined}
          /* The desktop tabs sit to the RIGHT of the name, in the row's `meta`
             slot — the same shape Messages uses for "1 unread". They carry the
             same id as the phone row below; only ONE of the two ever renders
             (inlineFilters is exactly one of true/false), so the id stays
             unique and `aria-controls` resolves on both surfaces. */
          meta={inlineFilters && tabsOpen ? <div id={TABS_ID}>{statusTabs}</div> : undefined}
          actions={
            <>
              <button
                ref={searchTriggerRef}
                type="button"
                data-search-trigger
                onClick={() => { hapticLight(); setSearchOpen(true); }}
                aria-label="Search jobs"
                className={`rounded-ds-md flex items-center justify-center btn-press transition text-muted-foreground hover:text-foreground hover:bg-secondary/60 ${
                  inlineFilters ? "h-7 w-7 !min-h-0 !min-w-0" : "h-11 w-11"
                }`}
              >
                <Search className={inlineFilters ? "w-3.5 h-3.5" : "w-4 h-4"} />
              </button>
              {!inlineFilters && (
              <button
                type="button"
                onClick={() => { hapticLight(); setTabsOpen((v) => !v); }}
                aria-expanded={tabsOpen}
                /* Only while the panel EXISTS. The tabs unmount when folded,
                   and pointing at a missing id is axe
                   `aria-valid-attr-value` critical. */
                aria-controls={tabsOpen ? TABS_ID : undefined}
                aria-label={tabsOpen ? "Hide status filters" : "Filter by status"}
                className={`rounded-ds-md flex items-center justify-center btn-press transition hover:bg-secondary/60 ${
                  // No filled pill: the chevron's ROTATION carries open/closed,
                  // so it reads as the same kind of control as the plain search
                  // glyph beside it. Ink darkens while a non-default filter is
                  // on, so an active filter is never silent.
                  !isDefaultFilter
                    ? "text-[hsl(var(--bark))]"
                    : "text-muted-foreground hover:text-foreground"
                } ${inlineFilters ? "h-7 w-7 !min-h-0 !min-w-0" : "h-11 w-11"}`}
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${tabsOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.25}
                />
              </button>
              )}
            </>
          }
        />
      )}

      {/* PHONE: the same tabs, on their own line under the title row. Rendered
          only when they are not already IN that row, and hidden while the
          search input has taken the row over — one control at a time.

          The scroller BLEEDS TO THE CARD EDGE (`-mx-5 px-5`, the title card's
          own `px-5`), so if a label ever overflows it is cut by the card's
          rounded edge rather than hidden inside the card padding. `scroll-px-5`
          keeps a tab you scroll to from landing under the padding. The five
          labels fit this scroller at 320 and up, so normally nothing is past
          either edge and no fade shows; `tabFadeStyle` covers the case where
          something is. */}
      {!inlineFilters && tabsOpen && (
        <div
          id={TABS_ID}
          ref={tabScrollerRef}
          style={tabFadeStyle}
          className="-mx-5 px-5 scroll-px-5 pb-0.5 overflow-x-auto scrollbar-hide"
        >
          {statusTabs}
        </div>
      )}
    </>
  );
}
