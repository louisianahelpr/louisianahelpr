import "@/lib/i18n/enMessages";
import { t } from "@/lib/i18n/language";
import { MessagesSearchRow } from "./MessagesSearchRow";
import "@/lib/i18n/enScreens";
import { mainInboxEmptyBody } from "./messageSections";
import { ChevronDown, Search, X } from "lucide-react";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { hapticLight } from "@/lib/haptics";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { InboxOptionsMenu, MessagesMoreMenu } from "./InboxMenus";
import { InboxFilterTabs, PinnedFilterChip } from "./ConversationListHeader";
import { COMPACT_HEADER_ROW_MIN_HEIGHT, ScreenHeaderRow, SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { ConversationListBody } from "./ConversationListBody";
import { FieldClearButton } from "@/components/ui/FieldClearButton";
import { CONVO_LIMIT, useConversationListState } from "./useConversationListState";
import type { ConversationListProps } from "./conversationListProps";
import { HEADER_ICON_BUTTON_BASE_CLASS, HEADER_ICON_BUTTON_CLASS, HEADER_ICON_BUTTON_DESKTOP_CLASS, HEADER_ICON_BUTTON_INK_CLASS, INBOX_TABS_ID } from "./conversationListHeaderClasses";

/**
 * Title-card padding. The SAME value as PostsHeader's POSTS_HEADER_PADDING
 * and JobsHeader's JOBS_HEADER_PADDING — that identity is the whole point: this card is
 * supposed to have My Posts' exact geometry. Copied rather than imported
 * because importing it pulls the My Posts / My Jobs header module into the Messages
 * chunk for two utility classes. `!` because PageScaffold concatenates
 * rather than merges. If one moves, move the other.
 */
const MESSAGES_HEADER_PADDING = "!py-1.5 lg:!py-2";

/**
 * ConversationList — the inbox surface of the Messages page: the
 * Messages title card, the "All threads" header, and the pull-to-
 * refresh, virtualized list of conversation rows (avatar, unread
 * badge, job status chip, relative timestamp).
 *
 * Extracted verbatim from Messages.tsx (a step in splitting that file)
 * — the JSX is unchanged. The "show all" toggle and the pull-to-
 * refresh wiring are local to this surface, so they live here.
 */
export function ConversationList({
  conversations,
  allConversations,
  loading,
  loadError,
  retryInbox,
  userId,
  loadConversations,
  openConvo,
  setDeleteConvoConfirm,
  embedded = false,
  activeKey = null,
  onBatchArchive,
  resetSelectionNonce = 0,
  sectionTabs,
  sectionEmpty = null,
  mainEmptyBody = mainInboxEmptyBody(false),
  orderTalks = null,
}: ConversationListProps) {
  const {
    navigate, isWebDesktop, searchOnOwnLine, showAllConvos, setShowAllConvos, selectMode, selectedKeys,
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchTriggerRef, closeSearch,
    setInboxFilter, inboxTab, isDefaultInboxFilter, setTabsOpenPhone, tabsOpen, allTabConversations,
    agedOutCount, filteredConversations, isRecentlyDeletedView, isSpecialFilterView, noSearchMatches,
    noTabMatches, handleTogglePin, handleArchive, MAX_SELECT, enterSelectMode, exitSelectMode,
    toggleSelect, handleBatchDelete, pinnedSetForRender, hasThreads, activeThreads, hiddenUnreadCount,
    cachedHiddenUnread, dismissedHiddenUnread, dismissHiddenUnread, containerRef, pullDistance,
    refreshing, isPulling, canTrigger, listHandleRef,
  } = useConversationListState({
    conversations, allConversations, loading, loadError, userId, loadConversations, setDeleteConvoConfirm,
    onBatchArchive, resetSelectionNonce,
  });

  // The title card holds the toolbar itself — the name, the Select/Search
  // cluster and (on phone) the Active/All tabs. It does NOT hold a
  // "N threads" chip: that restated the thread list directly beneath it, the
  // same count box My Posts / My Jobs dropped.

  const inboxTabs = (
    <InboxFilterTabs isWebDesktop={isWebDesktop} activeThreads={activeThreads} allTabConversations={allTabConversations} inboxTab={inboxTab} setInboxFilter={setInboxFilter} />
  );

  // Neither "Pinned" nor "Recently Deleted" is one of the three visible
  // tabs (both are reached via the hamburger instead), so with either
  // active none of the underline tabs highlight — this chip is the only
  // thing telling the user why the list shrank and how to get back.
  const pinnedFilterChip = (
    <PinnedFilterChip inboxTab={inboxTab} setInboxFilter={setInboxFilter} />
  );

  /* SELECT mode takes the whole row over. ScreenHeaderRow's `children` branch
     is precisely that escape hatch: it keeps the row geometry and still renders
     the page's h1 `sr-only`, so Messages never has zero headings while
     something is standing in for its name. Null in the normal state, which is
     what puts the row back on its title / meta / actions branch.

     SEARCH mode does NOT come through here any more — it is the shared
     `expandingSearch` slot below, which is the one arrangement every screen
     with an expanding search now uses. */
  const rowTakeover = selectMode ? (
    /* Select mode — the row is just the page name's stand-in. The live
       "N/3 selected" count lives in the floating action bar at the bottom of
       the list (see below); having it here too put the same number on screen
       twice. */
    <span className="flex-1 text-ds-13 font-medium" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {selectedKeys.size}/{MAX_SELECT} selected
    </span>
  ) : null;

  /* SEARCH MODE — the shared shape, not a third arrangement of it.
     Capped at `lg:max-w-md` on desktop (owner, 2026-09-14, VN-35: "search
     shouldn't open that large for messages either") — the same cap as the
     Browse search (VN-5) and My Posts / My Jobs (VN-31). Phone stays
     full-width.

     THE MAGNIFIER IS IN THE FIELD and the ✕ is the field's only control
     (owner, 2026-09-19: "the magnifier should move to the left and the x
     stay"). The dismiss used to be a 32px circle OUTSIDE the field, with a
     SECOND ✕ inside it for "clear" once you had typed: two X's a few pixels
     apart doing nearly the same thing, and the outer one sitting exactly where
     the magnifier comes back to. One ✕ now, inside the field on the right,
     clearing and closing in a single press — the two things "done searching"
     means — with the magnifier's slot in the cluster held open beside it so
     the press can never land on the control that replaces it.

     `ml-auto` is load-bearing above `lg`, where the `max-w-md` cap stops the
     field growing to fill the row. Measured at 1440 without it: the field
     capped at 448px and flexbox parked the remaining ~600px of slack AFTER
     it, so the field sat hard against the screen name with a dead band
     between it and the cluster — the field opening on the LEFT, which is the
     shape of the owner's Home report. Below `lg` the field fills the row and
     this is a no-op. */
  const searchField = (
    <div className="relative flex-1 min-w-0 lg:max-w-md ml-auto">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        autoFocus
        type="search"
        aria-label={t("chat.search")}
        placeholder={`${t("chat.searchHint")}…`}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        /* Escape is the keyboard's X — same single activation, same return
           to the pre-open state, same focus hand-back. */
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
        spellCheck={false}
        className={`w-full pl-9 pr-10 ${isWebDesktop ? "h-[34px]" : "h-9"} text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground`}
      />
      {/* The shared field ✕ (FieldClearButton: .ctl-exit, .ctl-tint, and `!min-h-0 !min-w-0` so index.css's 44px
          button floor does not spill past this 36px field). */}
      <FieldClearButton onClick={closeSearch} aria-label={t("chat.closeSearch")} className="right-2.5">
        <X className="w-4 h-4" />
      </FieldClearButton>
    </div>
  );

  /* What sits beside the screen name ON THE DESKTOP WEBSITE: the tabs
     themselves, exactly as they do on My Posts / My Jobs, where the row is
     1102px wide and the name is `sr-only` anyway. On phone this slot stays
     empty and the strip takes its own line below — see the placement note
     above the state block for the widths that decided it.

     It is not just the tabs that do not fit here on a phone. An earlier
     attempt put a separate "1 unread" caption in this slot and that missed
     too: at 393 the row is 353px of card, the controls and their gaps took
     144, the caption and its gap 73 more, leaving 96px for a title needing
     101 — "Messag…". This slot has never had room on a phone for anything at
     all, which is the finding, not a coincidence. */
  /* UNCONDITIONAL on whether the inbox has threads — the owner's 2026-09-20
     ruling, see the note on `hasThreads`. Still conditional on the desktop
     website, because on a phone this slot has no room for anything at all
     (the widths are measured in the note above). */
  const headerMeta = isWebDesktop && !sectionEmpty ? <div id={INBOX_TABS_ID}>{inboxTabs}</div> : undefined;

  /* The trailing icon cluster.
     Search · hamburger · chevron, in that order (owner, 2026-09-14, VN-35:
     "on messages, move the chevron to the right of the hamburger"). This
     reverses the earlier search · chevron · hamburger order, which had put
     the chevron next to search to mirror Activity.

     All three share ONE class, and it is PostsHeader's / JobsHeader's: the chevron cannot
     be a different ink from the search glyph beside it, and Messages' cluster
     should not be a different ink from the identical cluster on My Jobs. */
  /* THE MAGNIFIER, kept separate from the rest of the cluster.
     While the field is open it is not here at all — it is inside the field, on
     its left — and ScreenHeaderRow holds its 44px slot open in its place. The
     split is what makes that possible without also unmounting the hamburger
     beside it: opening search must hide no other control. */
  /* ALWAYS. It used to be `hasThreads || isSpecialFilterView` — the second
     half because Pinned/Recently Deleted read a different source than the
     default inbox (see isSpecialFilterView above) and can have threads of
     their own when the default inbox has none. Both halves are now moot: the
     owner's 2026-09-20 ruling is that the inbox's controls are on the screen
     whether or not there are threads, and a magnifier that vanishes on an
     empty inbox is half of the "looks broken" shape they reported. It costs
     nothing to leave: pressing it on an empty inbox opens a field that finds
     nothing, which is an honest answer, not a dead end. */
  const searchTriggerButton = (
    <button
      ref={searchTriggerRef}
      type="button"
      data-search-trigger
      onClick={() => { hapticLight(); setSearchOpen(true); }}
      aria-label={t("chat.search")}
      className={isWebDesktop ? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS}
    >
      <Search className={isWebDesktop ? "w-3.5 h-3.5" : "w-4 h-4"} />
    </button>
  );

  /* The views both menus open (InboxMenus.tsx); Recently Deleted refetches on open (see onRecentlyDeleted there). */
  const inboxViewItems = { canSelect: hasThreads, onSelect: enterSelectMode, onPinned: () => setInboxFilter("pinned"),
    onRecentlyDeleted: () => { setInboxFilter("recentlyDeleted"); if (userId) void loadConversations(userId); } };

  /* Everything in the cluster that is NOT the magnifier. Stays mounted in both
     states — see the `expandingSearch` contract on ScreenHeaderRow. */
  const headerActionsWithoutSearch = (
    <>
      {/* Hamburger — the OVERFLOW MENU, never gated on hasThreads (see InboxMenus.tsx). */}
      <InboxOptionsMenu
        {...inboxViewItems}
        triggerClassName={isWebDesktop ? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS}
        iconClassName={isWebDesktop ? "w-3.5 h-3.5" : "w-4 h-4"}
      />
      {/* THE DISCLOSURE CHEVRON — third in the cluster, after search and the
          hamburger (owner, 2026-09-14, VN-35: "on messages, move the chevron
          to the right of the hamburger"). Restored 2026-09-22 after its
          2026-09-19 removal; the history and the owner's words are in the
          docblock above MESSAGES_HEADER_PADDING, and it behaves as
          PostsHeader's and JobsHeader's do.

          Phone only, and identical to PostsHeader's / JobsHeader's: haptic on press,
          `aria-expanded` on the state, `aria-controls` only while the panel
          EXISTS (the strip unmounts when collapsed, and pointing at a missing
          id is `aria-valid-attr-value` critical in axe and a real lie to a
          screen reader), rotation carrying open/closed, and the ink darkening
          to `--bark` while a non-default slice is on so a folded-away filter
          is never silent. No filled pill: a tinted box beside a plain
          magnifier makes two siblings read as different kinds of control. */}
      {/* AND NOT WHILE SEARCH HAS THE ROW. The strip this chevron discloses is
          already unmounted when search is open — see the `!searchOpen` gate on
          its render below — so in that state this is a control with nothing to
          control, and it was costing the one thing the row cannot spare.

          MEASURED, prod-audit run 35798352756 at 320:

            the open search field is 90px wide, under the 120px floor. 76px of
            it is the magnifier and the ✕, so what is left cannot be typed in

          90 + 44 (this button) = 134, over the floor. Restoring the chevron
          earlier today took exactly one button's width out of the open field,
          on the one screen width where there was none to take. The row already
          documents that it "has 20px to spare at 320" CLOSED and none open —
          I verified the closed state at 320 and never opened the search.

          `tabsOpen` state is untouched by this: the chevron reappears with the
          strip the moment search closes, in whatever state it was left. */}
      {/* …BUT ITS BOX STAYS HELD while search is open, from 360px up (Q48).
          Hiding the chevron shifted the whole open cluster 48px right, so the
          held-open magnifier slot (SearchTriggerSlot) no longer sat where the
          magnifier comes back, and the ✕ landed on it. prod-audit run
          35817028797, e2e/prod-audit/expanding-search-geometry.spec.ts:

            375   ✕ 192…220 vs magnifier 194…238  →  26px overlap
                  (and the hamburger jumped 242 → 290 when search opened)

          With this box held: ✕ 144…172, overlap 0px, field 141px (floor 120),
          hamburger at 242 in both states. Measured on a local build against
          prod, signed in.

          BELOW 360 IT IS NOT HELD, and that is a known, open conflict — not a
          fix (docs/OPEN.md Q48). At 320 the resting magnifier's left edge is
          at 139 and the row starts at 41, so with the row's 8px gap the field
          can be at most 90px if the ✕ is to clear it — under the 120px floor
          e794385ab restored. Holding the box at 320 measured exactly that:
          field 90px, ✕ clear. Not holding it: field 138px, ✕ overlapping the
          magnifier by 28px. Both clauses of the geometry spec cannot hold at
          320 with three 44px controls in this order; which one yields is the
          owner's call.

          THE OWNER'S CALL (2026-09-23, Q48 option D, Q143): below 360 search
          opens on its OWN LINE under this row (SEARCH_OWN_LINE_QUERY), so the
          field no longer competes with this box and it is held at every
          width. Measured on a local build against prod before holding it at
          320: the hamburger jumped 187 -> 235 when search opened on its own
          line; held, the row does not move. */}
      {!isWebDesktop && searchOpen && (
        <div aria-hidden className="shrink-0 pointer-events-none w-11 self-stretch" />
      )}
      {!isWebDesktop && !searchOpen && !sectionEmpty && (
        <button
          type="button"
          onClick={() => { hapticLight(); setTabsOpenPhone((v) => !v); }}
          aria-expanded={tabsOpen}
          aria-controls={tabsOpen ? INBOX_TABS_ID : undefined}
          aria-label={tabsOpen ? t("msg.hideFilters") : t("msg.filterConvos")}
          className={`${HEADER_ICON_BUTTON_BASE_CLASS} ${
            isDefaultInboxFilter ? HEADER_ICON_BUTTON_INK_CLASS : "text-[hsl(var(--bark))]"
          }`}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${tabsOpen ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </>
  );

  /* The cluster as the RESTING row renders it: magnifier first, then the
     overflow menu. One definition, so the open and closed states cannot drift
     on which controls exist. */
  const headerActions = (
    <>
      {searchTriggerButton}
      {headerActionsWithoutSearch}
    </>
  );

  /* THE TITLE CARD on phone and native (owner, 2026-08-27): Messages wears the same floating title card,
     gap, then panel as its siblings; on the desktop website it stays the panel's first child (`embedded`). */
  /* Q2231 (owner, 2026-10-19): on the PHONE the top bar IS the shared AppTopBar (title · bell · profile, no "+");
     search, options and Active/All fold into ONE slim search row under the section tabs, its "more" menu at the
     row's right edge. Select mode still takes the row over; desktop keeps its in-panel row. Guard: messagesTopBarGlobalRule. */
  const phoneTopBar = embedded || !isWebDesktop; // Board 38: the desktop list pane wears the phone header too.
  const moreMenu = (
    <MessagesMoreMenu
      {...inboxViewItems}
      isDefaultFilter={isDefaultInboxFilter}
      showTabs={!sectionEmpty}
      inboxTab={inboxTab}
      onTab={setInboxFilter}
    />
  );
  const phoneSearchRow = <MessagesSearchRow value={searchQuery} onChange={setSearchQuery} moreMenu={moreMenu} />;

  const headerEl = phoneTopBar && !selectMode ? (
    <>
      <div className="shrink-0 -mt-1"><AppTopBar title={t("msg.title")} desktopGap={false} /></div>
      {phoneSearchRow}
      {sectionTabs && (
        <div className="shrink-0 pt-1 pb-1.5" data-testid="messages-section-tabs">
          {sectionTabs}
        </div>
      )}
    </>
  ) : (
    <>
          <ScreenHeaderRow
            /* THE SHARED ROW — literally the component My Posts / My Jobs
               render through PostsHeader / JobsHeader, and the Browse feed through
               BrowseTasksToolbar. This row used to be a hand-rolled copy of it
               (same `flex items-center gap-3`, same `min-w-0 flex-1 gap-2
               py-2.5` title block, same `gap-1 shrink-0` action cluster), which
               is exactly how two screens end up a few pixels apart. It is now
               the real thing, so the geometry cannot drift.

               The row renders ALWAYS, including on an empty inbox. It used to
               be gated on the inverse of the controls' gate, which meant an
               empty Messages had no title bar at all — the screen opened on the
               empty illustration with nothing naming it, while My Jobs beside
               it kept its title, and the page had ZERO h1 so a screen reader
               landed on an unnamed screen. Only the Search / disclosure actions
               are gated: those genuinely have nothing to act on. */
            title={t("msg.title")}
            /* On the desktop website the page name is deleted from this row
               (owner) — the app bar and the side panel both already say where
               you are, so a third "Messages" three rows apart is chrome
               restating chrome. It goes `sr-only`, never away. Phone and native
               keep it visible: they have no app bar. */
            titleSrOnly={embedded || isWebDesktop}
            // In the title card the card owns the horizontal padding and there
            // is nothing below to rule off from — the gap does that. Embedded
            // (desktop) keeps both, because there it IS the panel's first row.
            /* `max-[359px]:gap-2` is the ONLY deviation from the shared row's
               geometry, and it is 4px on one breakpoint. At 320 the card gives
               this row 240px; the three 44px controls and their gaps take 141,
               the shared `gap-3` takes 12, and "Messages" wants 88 in the 87
               that leaves — a two-pixel miss that cost the screen its own name
               ("Messag…", measured, not guessed). Tightening the title-to-
               actions gap by one step below 360 buys the four pixels back.
               375 and up are untouched, so the row stays pixel-identical to My
               Posts / My Jobs at every width a shipping phone actually has. */
            /* Desktop website (not the split-pane embed): My Posts / My Jobs'
               compact row, `[&>div:first-child]:!py-0` + COMPACT_HEADER_ROW_MIN_HEIGHT
               (PostsHeader's inlineFilters). Without them this row was 40px
               inside a 49px bar where theirs is 34 inside 43 (Q1558, measured
               on a local build 2026-10-12). */
            className={`shrink-0 max-[359px]:gap-2 ${embedded ? "px-4" : ""} ${isWebDesktop && !embedded ? "[&>div:first-child]:!py-0" : ""}`}
            style={{
              // The 52px floor is an IN-PANEL toolbar measure: it keeps the row
              // off the list under it. In the title card the card's own padding
              // governs the height and ScreenHeaderRow's own 44px floor carries
              // the controls — keeping 52 there made this card 6pt taller than
              // the identical card on My Posts, measured on device.
              minHeight: embedded ? "52px" : isWebDesktop ? COMPACT_HEADER_ROW_MIN_HEIGHT : undefined,
              borderBottom: embedded ? "1px solid hsl(var(--olivewood) / 0.1)" : undefined,
            }}
            meta={rowTakeover ? undefined : headerMeta}
            actions={
              rowTakeover
                ? undefined
                : searchOpen && searchOnOwnLine
                  ? (
                    /* Below 360 the row stays at rest while the field sits on
                       the line below: the magnifier is inside the field, and
                       its box here is HELD OPEN so the hamburger and chevron
                       do not slide, and the magnifier comes back exactly
                       where it was pressed. */
                    <>
                      <SearchTriggerSlot width="44px" />
                      {headerActionsWithoutSearch}
                    </>
                  )
                  : headerActions
            }
            /* Search is the SHARED slot. `open` is false whenever select mode
               has the row (the two takeovers are mutually exclusive and select
               mode wins), which puts the row back on `children`. */
            expandingSearch={{
              /* Not in the row below 360: there the field has its own line
                 (see SEARCH_OWN_LINE_QUERY and the line under this row). */
              open: searchOpen && !selectMode && !searchOnOwnLine,
              field: searchField,
              /* HEADER_ICON_BUTTON_CLASS is `h-11 w-11`. The slot reserves the
                 magnifier's real box, not a guess — see SearchTriggerSlot. */
              triggerWidth: isWebDesktop ? "28px" : "44px",
              /* THE FIELD TAKES ITS OWN LINE UNDER THE NAME BELOW 500px,
                 exactly as on My Posts / My Jobs — same row component, same
                 arithmetic. Measured with the title beside it:

                   320   title 41…129 (88px)   field 137…179  =  42px
                   375   title 41…129 (88px)   field 141…230  =  89px

                 Both under the typable floor. Until 2026-10-01 the visible
                 title stepped aside to pay for it; the owner's report from the
                 app ("Search should not cover the page titles") rules that
                 out, so the row wraps instead. Below 360 the field is not in
                 the row at all (SEARCH_OWN_LINE_QUERY). */
              narrowFieldWraps: true,
              actions: headerActionsWithoutSearch,
            }}
          >
            {rowTakeover}
          </ScreenHeaderRow>
          {/* PHONE / NATIVE: the Active / All strip on its own line under the toolbar, ALWAYS (owner,
              2026-09-20), so an empty inbox's thread area starts at the same y as a full one's (127 at 375). */}
          {/* The filter chips (board 13: one inbox, owner 2026-10-20); they step aside for search / select. */}
          {sectionTabs && !searchOpen && !selectMode && (
            <div className="shrink-0 pt-1 pb-1.5" data-testid="messages-section-tabs">
              {sectionTabs}
            </div>
          )}
          {!isWebDesktop && tabsOpen && !sectionEmpty && !searchOpen && !selectMode && (
            /* `-mx-1 px-1 pb-0.5` are PostsHeader's / JobsHeader's exact classes, so this
               card matches My Posts / My Jobs. The negative margin keeps the
               tabs' focus rings inside the scroller rather than clipped by it;
               the scroller itself is insurance for 320px, where two labels are
               already comfortable. */
            <div id={INBOX_TABS_ID} className="shrink-0 -mx-1 px-1 pb-0.5 overflow-x-auto scrollbar-hide">
              {inboxTabs}
            </div>
          )}
          {/* BELOW 360: the search field, on the line the strip above gives up
              while search is open. Full width; same field, same ✕, same
              Escape as the in-row field at 375 and up. */}
          {searchOnOwnLine && searchOpen && !selectMode && (
            <div data-search-own-line className="shrink-0 flex items-center py-1">
              {searchField}
            </div>
          )}
          {!searchOpen && !selectMode && pinnedFilterChip}
    </>
  );

  const listBody = (
    <ConversationListBody
      orderTalks={orderTalks}
      loading={loading}
      loadError={loadError}
      conversations={conversations}
      retryInbox={retryInbox}
      isSpecialFilterView={isSpecialFilterView}
      containerRef={containerRef}
      pullDistance={pullDistance}
      refreshing={refreshing}
      isPulling={isPulling}
      canTrigger={canTrigger}
      sectionEmpty={sectionEmpty}
      navigate={navigate}
      mainEmptyBody={mainEmptyBody}
      isWebDesktop={isWebDesktop}
      inboxTab={inboxTab}
      searchQuery={searchQuery}
      agedOutCount={agedOutCount}
      cachedHiddenUnread={cachedHiddenUnread}
      dismissedHiddenUnread={dismissedHiddenUnread}
      hiddenUnreadCount={hiddenUnreadCount}
      setInboxFilter={setInboxFilter}
      dismissHiddenUnread={dismissHiddenUnread}
      noTabMatches={noTabMatches}
      allTabConversations={allTabConversations}
      noSearchMatches={noSearchMatches}
      selectMode={selectMode}
      showAllConvos={showAllConvos}
      filteredConversations={filteredConversations}
      listHandleRef={listHandleRef}
      pinnedSetForRender={pinnedSetForRender}
      activeKey={activeKey}
      selectedKeys={selectedKeys}
      isRecentlyDeletedView={isRecentlyDeletedView}
      userId={userId}
      openConvo={openConvo}
      toggleSelect={toggleSelect}
      handleArchive={handleArchive}
      handleTogglePin={handleTogglePin}
      setShowAllConvos={setShowAllConvos}
      hasThreads={hasThreads}
      embedded={embedded}
      exitSelectMode={exitSelectMode}
      handleBatchDelete={handleBatchDelete}
      maxSelect={MAX_SELECT}
      convoLimit={CONVO_LIMIT}
    />
  );

  // Embedded (desktop list+thread split): just the inbox body, no
  // PageScaffold shell or title card — the parent provides the outer
  // shell and a shared title card spanning both panes.
  if (embedded) {
    // `relative` so the embedded select-mode action bar anchors to this
    // pane instead of the viewport.
    return (
      <div className="relative flex-1 min-h-0 flex flex-col">
        {headerEl}
        {listBody}
      </div>
    );
  }

  return (
    // No "N threads" chip above the list: the list directly below IS the count, and the empty state already says
    // there's nothing — the same redundant count line removed from Activity, /jobs, and the browse toolbar. The
    // desktop split's bar keeps its UNREAD pill, which is real information you can't get by glancing at the list. The
    // page's h1 lives in the toolbar row (visible on phone/native, sr-only when embedded, and an sr-only stand-in
    // during search/select modes), which is what the title card renders.
    /* ONE BOX on the desktop website, exactly as Activity does it
       (Activity.tsx:484-496; owner, 2026-09-16: Messages was "the only page
       with a separate top panel"). Home, My Posts and My Jobs all fold their
       header into the panel at ≥900px; Messages was still passing a title
       card unconditionally, so it alone showed two stacked boxes.

       Phone and native keep the two-card stack — there the header carries the
       VISIBLE page name (no app bar exists to carry it). `isWebDesktop` is
       false at every phone width and on native at every size, so that
       rendering is untouched. */
    <PageScaffold
      titleCard={isWebDesktop ? undefined : headerEl}
      titleCardClassName={isWebDesktop ? undefined : MESSAGES_HEADER_PADDING}
    >
      {isWebDesktop && (
        /* The wrapper owns the hairline and the horizontal padding, the same
           way Activity's does — which is why the row's own `px-4` /
           `minHeight: 52px` / `borderBottom` stay keyed to `embedded` below
           and are NOT doubled up here. */
        <div
          className="shrink-0 px-5 py-1"
          style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          {headerEl}
        </div>
      )}
      {listBody}
    </PageScaffold>
  );
}
