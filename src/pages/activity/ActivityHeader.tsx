import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  /* ONE PRESS OUT, AND THE FOCUS COMES BACK.
     Owner, 2026-09-19 (/my-posts): "the x on search needed to be clicked 3
     times to close the search bar". The state machine was never the problem —
     instrumented, the X already does query-clear + close in a single
     activation and the `?q=` mirror does not re-open it (transition trail in
     src/test/searchDismissAndOverlay.test.tsx).
     What it did NOT do was give the focus back. The field unmounts under the
     caret, so `document.activeElement` fell to <body>: a keyboard user pressing
     the X landed nowhere and had to Tab from the top of the page to find search
     again, and a screen-reader user lost the row entirely. Every dismiss on
     this screen now goes through `closeSearch()`, which is the whole pre-open
     state in one call — query cleared, field closed, focus back on the
     magnifier that opened it. Escape does the same thing, which is what the X
     already implied and the keyboard had no way to ask for. */
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
  const [tabsOpenPhone, setTabsOpenPhone] = useState(!isDefaultFilter);
  // On the wide screen the tabs simply STAY UP — there is room for them beside
  // the title, so hiding four short words behind a chevron buys nothing and
  // costs a press (owner: "drop down not needed on the wide screen, the
  // category can stay at the top"). The disclosure is a phone affordance,
  // where the row genuinely cannot hold both.
  const tabsOpen = inlineFilters || tabsOpenPhone;
  const setTabsOpen = setTabsOpenPhone;
  // A filter arriving later (deep link resolving, or a tab switch that resets
  // it) has to be able to open the disclosure too — otherwise the same
  // "filtered, but nothing says so" state comes back through the side door.
  useEffect(() => {
    if (!isDefaultFilter) setTabsOpen(true);
  }, [isDefaultFilter]);

  /* LAYER THREE: IF A LABEL IS STILL PAST THE EDGE, SAY SO.
     ────────────────────────────────────────────────────────────────────────
     The first two layers (11px type + 12px gaps, and the short words below
     390px) are what make the five labels FIT. This one is the insurance for
     every width they cannot be measured at: Dynamic Type at its largest, a
     future sixth bucket, a translation, a three-digit count. In all of those
     the row goes back to scrolling — and a scroller with no affordance is
     exactly the defect that shipped, because a hard cut at a card edge reads
     as the end of the row, not as more of it.
     A MASK, not an overlay gradient: the card behind this row is
     liquid-glass, so a gradient painted in a surface colour would be a pale
     rectangle sitting on translucency in one theme and a dark one in the
     other. Fading the CONTENT's own alpha is right in both themes and on any
     surface, and it costs no element.
     Only while there IS something past that edge, and on the side it is on —
     a permanent fade would dim "Cancelled" on a 414 phone where it is fully
     on screen, which is a cost paid for nothing. */
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = tabScrollerRef.current;
    if (!el) {
      setTabEdges({ start: false, end: false });
      return;
    }
    const measure = () => {
      const slack = el.scrollWidth - el.clientWidth;
      setTabEdges({
        start: slack > 1 && el.scrollLeft > 1,
        end: slack > 1 && el.scrollLeft < slack - 1,
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
      {/* No hairline rule and no horizontal padding of its own: this row is the
          body of PageScaffold's title card now, so the card owns the surface,
          the radius and the `px-5`.

          The row itself is the shared <ScreenHeaderRow> — the same component
          the Browse feed's toolbar renders, so "My Posts" and Home cannot
          drift apart on the geometry (44px floor, title block, trailing
          `gap-1` icon cluster) that makes them read as one screen family. */}
      {searchOpen ? (
        /* Search mode — the field GROWS LEFTWARD out of the search button it
           came from, and the title stays exactly as it was (owner: "search
           should expand to the left if it's selected without coloring the
           title"). It used to swap the whole row for the input, so the screen
           you were on lost its name the moment you tapped search — the one
           piece of context you need while typing into it.

           This state is the SHARED <ScreenHeaderRow expandingSearch> slot now,
           not a hand-rolled `children` arrangement on top of it. The slot owns
           the three facts this row used to own alone: the name stays (visible
           AND as the h1), the field takes free space rather than a sibling's,
           and — the three-click fix — the magnifier's place in the trailing
           cluster is HELD OPEN while the field is up, so the ✕ at the field's
           trailing edge can never sit on the control that replaces it. See
           SearchTriggerSlot for the arithmetic. */
        <ScreenHeaderRow
          title={title}
          titleSrOnly={titleSrOnly}
          expandingSearch={{
            open: true,
            /* DESKTOP: THE TABS STAY UP WHILE SEARCHING, and the field is
               capped (owner, 2026-09-14, VN-31: "search does not need to open
               that large. also the chevron on the right is useless here").
               The field used to take the whole ~1500px row and swap the tabs
               out, leaving the chevron as the only way back to them. On the
               desktop website (`inlineFilters`) there is room for both, so the
               tabs keep their place on the left, the field sits at the right
               capped at `max-w-md`, and the chevron is not rendered. Phone is
               unchanged: full-width field, tabs on their own line, chevron. */
            leading: inlineFilters ? (
              <div id="activity-status-tabs" className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                {statusTabs}
              </div>
            ) : undefined,
            /* The held-open slot must match the trigger's OWN box, which this
               row sizes by width: `h-7 w-7` on the desktop website, `h-11 w-11`
               on phone. A slot narrower than the button it reserves hands the
               overlap straight back. */
            triggerWidth: inlineFilters ? "28px" : "44px",
            field: (
              <div className={`relative flex-1 min-w-0 ${inlineFilters ? "max-w-md" : ""} origin-right motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200`}>
                {/* THE MAGNIFIER IS IN THE FIELD (owner, 2026-09-19: "the
                    magnifier should move to the left and the x stay"). Not a
                    button — the field is already open, so a second control
                    that opens it would do nothing — just the glyph that says
                    what this box is. */}
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  type="search"
                  aria-label="Search jobs"
                  /* No placeholder (owner). The magnifier already says what the
                     field is, and greyed placeholder text inside a field that only
                     exists because you just tapped search is repeating it. */
                  placeholder=""
                  spellCheck={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  /* Escape is the keyboard's X. Same single activation, same
                     pre-open state, same focus return — see closeSearch above. */
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
                  className="w-full pl-9 pr-10 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                />
                {/* The X lives INSIDE the field, on its right (owner), and with
                    the magnifier gone it is the ONLY control in the field.
                    Always present, not only once you have typed: it is the way
                    OUT of search, so hiding it until there is a query left an
                    empty search bar with no visible dismiss. Clears the query
                    and closes in one press — the two things "done searching"
                    means.

                    `!min-h-0 !min-w-0` — index.css's bare
                    `button { min-height: 44px; min-width: 44px }` HIG rule
                    otherwise wins over `h-7 w-7` and renders this 44x44 inside
                    a 36px-tall bar, spilling past its top and bottom edge. The
                    classes here said 28px and the box measured 44 (the same
                    trap already documented on the toast close button and on
                    BrowseSearchBar's ✕); a control whose real hit area is 16px
                    wider than it looks is how a mis-tap lands on whatever is
                    next to it. */}
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
                aria-controls={tabsOpen ? "activity-status-tabs" : undefined}
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
          title={title}
          titleSrOnly={titleSrOnly}
          style={inlineFilters ? { minHeight: "34px" } : undefined}
          className={inlineFilters ? "[&>div:first-child]:!py-0" : undefined}
          /* The active-filter indicator sits to the RIGHT of the name, the
             same shape Messages uses for "1 unread" (the one the owner asked
             for there: "put 1 unread to the right of messages bc i dont like
             it under"). It is a <span>, never a heading — the row's h1 is the
             whole page's only one. */
          /* Same id as the phone row below. Only ONE of the two ever renders
             (inlineFilters is exactly one of true/false), so the id stays
             unique — and `aria-controls` on the chevron resolves on BOTH
             surfaces. Without this the desktop chevron pointed at an id that
             only existed in the phone branch, which axe flags
             `aria-valid-attr-value` critical. */
          meta={inlineFilters && tabsOpen ? <div id="activity-status-tabs">{statusTabs}</div> : undefined}
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
                /* Only while the panel EXISTS. The tabs unmount when
                   collapsed, so emitting this unconditionally pointed at a
                   missing id — axe flags it `aria-valid-attr-value` critical,
                   and it is a real lie to a screen reader. */
                aria-controls={tabsOpen ? "activity-status-tabs" : undefined}
                aria-label={tabsOpen ? "Hide status filters" : "Filter by status"}
                className={`rounded-ds-md flex items-center justify-center btn-press transition hover:bg-secondary/60 ${
                  // No filled pill. The chevron's ROTATION already carries
                  // open/closed, and a tinted box beside a plain search glyph
                  // made two siblings read as different kinds of control. Ink
                  // still darkens while a non-default filter is on, so an
                  // active filter is never silent.
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
          own `px-5`), not to a 4px inset. This used to say the four labels fit
          at 375 without scrolling; there are five now, and their content width
          is ~407px against a 335px column, so the row always scrolls on a
          phone. With the 4px inset the scroller's clip edge sat INSIDE the
          card padding, and "Cancelled" — starting 1px past it — was hidden
          whole: the empty-bucket copy said "1 in Cancelled" under a tab row
          that showed no Cancelled. Clipping at the card's rounded edge instead
          lets the fifth label peek, cut by the card, which is the one signal
          that says "this scrolls". `scroll-px-5` keeps a tab you scroll to
          from landing under the padding.

          THAT PEEK IS NO LONGER THE PLAN, it is the fallback. The five labels
          now FIT this scroller at 320 and up (11px type, 12px gaps, and the
          short words below 390px), so on a phone there is normally nothing
          past either edge and no fade. `tabFadeStyle` is what happens when
          there is anyway — see the note beside it. */}
      {!inlineFilters && tabsOpen && (
        <div
          id="activity-status-tabs"
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

