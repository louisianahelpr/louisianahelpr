import "@/lib/i18n/enMessages";
import { t } from "@/lib/i18n/language";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import { navIconFor } from "@/components/mobileNav/mobileNavHelpers";
import { SectionInboxEmpty, type InboxLeadPanel, type SectionEmpty } from "./SectionInboxEmpty";
import { UNFILTERED_INBOX_TAB, type InboxView } from "@/lib/inboxDefault";
import { MessageSquare, Search, Trash2 } from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { SelectBarExitButton } from "@/components/ui/SelectBarExitButton";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { Button } from "@/components/ui/button";
// Card-matching skeleton — mirrors the actual ConversationRow shape (avatar + name/job/last-msg lines +
// timestamp + unread dot) so the loading→loaded swap doesn't shift the row. See task #121.
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import { VirtualList, type VirtualListHandle } from "@/components/VirtualList";
import { ConversationRow } from "./ConversationRow";
import { OrderTalkFromLink } from "@/components/declutter/DeclutterOrderTalk";
import { OrderTalkLoadError, OrderTalkRow, type OrderTalkInbox } from "./DeclutterOrderTalkInbox";
import { inboxItemKey, mixInboxItems, visibleOrderTalks } from "./inboxItems";
import { RestoreConversationButton } from "./RestoreConversationButton";
import { SwipeableConversationRow } from "./SwipeableConversationRow";
import { HiddenUnreadBar } from "./HiddenUnreadBar";
import { pinnedKey } from "@/lib/pinnedConversations";
import type { Conversation } from "./types";
import type { ReactNode } from "react";

/** S2-016: with no threads, the shop chats (a Lead) take the empty inbox's place, which they show only with none. */
function InboxLeadOr({ lead: LeadPanel, children }: { lead: InboxLeadPanel | null; children: ReactNode }) {
  return LeadPanel ? <LeadPanel empty={children} /> : <>{children}</>;
}
import { THREAD_AGE_OUT_DAYS } from "./threadAgeOut";

/**
 * The inbox list body (Q806 god-component split, 11-05): loading / error / empty states, the hidden-unread bar,
 * the virtualized thread rows and the select-mode action bar. Moved verbatim out of ConversationList, which owns
 * every piece of state and passes it down; this file only renders.
 */
export interface ConversationListBodyProps {
  /** F420: the Declutter order chats that belong under this chip (useMessageSections), or null when none do. */
  orderTalks: OrderTalkInbox | null;
  inboxLead?: InboxLeadPanel | null;
  loading: boolean;
  loadError: boolean;
  conversations: Conversation[];
  retryInbox: () => void | Promise<void>;
  isSpecialFilterView: boolean;
  containerRef: RefObject<HTMLDivElement>;
  pullDistance: number;
  refreshing: boolean;
  isPulling: boolean;
  canTrigger: boolean;
  sectionEmpty: SectionEmpty | null;
  navigate: NavigateFunction;
  mainEmptyBody: string;
  isWebDesktop: boolean;
  inboxTab: InboxView;
  searchQuery: string;
  agedOutCount: number;
  cachedHiddenUnread: number;
  dismissedHiddenUnread: number;
  hiddenUnreadCount: number;
  setInboxFilter: Dispatch<SetStateAction<string | null>>;
  dismissHiddenUnread: () => void;
  noTabMatches: boolean;
  allTabConversations: Conversation[];
  noSearchMatches: boolean;
  selectMode: boolean;
  showAllConvos: boolean;
  filteredConversations: Conversation[];
  listHandleRef: MutableRefObject<VirtualListHandle | null>;
  pinnedSetForRender: Set<string>;
  activeKey: string | null;
  selectedKeys: Set<string>;
  isRecentlyDeletedView: boolean;
  userId: string | null;
  openConvo: (convo: Conversation) => void;
  toggleSelect: (c: Conversation) => void;
  handleArchive: (convo: Conversation) => void;
  handleTogglePin: (convo: Conversation) => void;
  setShowAllConvos: Dispatch<SetStateAction<boolean>>;
  hasThreads: boolean;
  embedded: boolean;
  exitSelectMode: () => void;
  handleBatchDelete: () => void;
  /** The most threads one multi-select may hold (ConversationList's MAX_SELECT). */
  maxSelect: number;
  /** The rendered-list cap before "Show all" (ConversationList's CONVO_LIMIT). */
  convoLimit: number;
}

export function ConversationListBody({
  orderTalks,
  inboxLead = null,
  loading,
  loadError,
  conversations,
  retryInbox,
  isSpecialFilterView,
  containerRef,
  pullDistance,
  refreshing,
  isPulling,
  canTrigger,
  sectionEmpty,
  navigate,
  mainEmptyBody,
  isWebDesktop,
  inboxTab,
  searchQuery,
  agedOutCount,
  cachedHiddenUnread,
  dismissedHiddenUnread,
  hiddenUnreadCount,
  setInboxFilter,
  dismissHiddenUnread,
  noTabMatches,
  allTabConversations,
  noSearchMatches,
  selectMode,
  showAllConvos,
  filteredConversations,
  listHandleRef,
  pinnedSetForRender,
  activeKey,
  selectedKeys,
  isRecentlyDeletedView,
  userId,
  openConvo,
  toggleSelect,
  handleArchive,
  handleTogglePin,
  setShowAllConvos,
  hasThreads,
  embedded,
  exitSelectMode,
  handleBatchDelete,
  maxSelect: MAX_SELECT,
  convoLimit: CONVO_LIMIT,
}: ConversationListBodyProps) {
  // F420: the order chats that sit in THIS view (inboxItems.ts), under the same tab and search as the threads.
  const orderTalkRows = visibleOrderTalks(orderTalks, { selectMode, isSpecialFilterView, inboxTab, searchQuery });
  /* The order-chat answer is still out: hold the empty state rather than flash "No messages yet" at someone whose
     only conversations are order chats (D2-1's "not before the answer is in"). */
  const orderTalksComing = !!orderTalks && orderTalks.pending && !selectMode && !isSpecialFilterView;
  const nothingToList = noTabMatches && orderTalkRows.length === 0;
  const nothingFound = noSearchMatches && orderTalkRows.length === 0;
  const items = mixInboxItems(filteredConversations, orderTalkRows, pinnedSetForRender);
  return (
    <>
          {/* NO horizontal padding on these two branches. EmptyState/ErrorState
              render their own `dock` card; inset inside the page panel — which
              is itself a rounded card — that produced TWO nested rounded
              frames a few px apart, visible on device. The thread LIST below
              keeps its padding, because rows do need to clear the panel edge.
              Same defect and same fix as Activity's empty state. */}
          {!loading && loadError && conversations.length === 0 ? (
            <div className="flex-1 min-h-0 flex" data-thread-area>
              <ErrorState
                title={t("chat.loadFailed")}
                onRetry={() => { void retryInbox(); }}
              />
            </div>
          ) : !loading && conversations.length === 0 && !isSpecialFilterView && orderTalkRows.length === 0 && !orderTalksComing ? (
            // `conversations` (the default inbox, archived threads already dropped) being empty does NOT mean
            // Pinned/Recently Deleted are empty too — they read a DIFFERENT source (orderedConversations /
            // allConversations, see filteredConversations above). Gating this global "No messages yet" state on the
            // default inbox alone meant archiving your one thread made Recently Deleted permanently show "No messages
            // yet" instead of the thread you just hid — the exact thing that view exists to surface. Inside the pull
            // area, like My Posts' empty state (owner, 2026-10-08, Q1560: "why doesn't messages refresh in the app
            // like the other pages").
            <PullToRefreshWrapper
              data-thread-area
              ref={containerRef}
              pullDistance={pullDistance}
              refreshing={refreshing}
              isPulling={isPulling}
              canTrigger={canTrigger}
              className="flex-1 min-h-0 flex flex-col"
            >
              {sectionEmpty ? (
                <SectionInboxEmpty empty={sectionEmpty} onGo={(to) => navigate(to)} />
              ) : (
              <InboxLeadOr lead={inboxLead}>
              <EmptyState
                // The same circle-and-icon as My Posts / My Jobs (owner, 2026-10-08,
                // Q1558: "nearly identical"); the icon is the Messages tab's own.
                icon={navIconFor("/messages")}
                title={t("chat.emptyTitle")}
                body={mainEmptyBody}
                bodyLines={MAIN_TAB_EMPTY_BODY_LINES}
                action={
                  <BarkPillButton onClick={() => navigate("/jobs")}>
                    {t("chat.browseJobs")}
                  </BarkPillButton>
                }
              />
              </InboxLeadOr>
              )}
            </PullToRefreshWrapper>
          ) : (
          <PullToRefreshWrapper
            data-thread-area
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-3 py-3"
            style={{
              /* CLEARANCE FOR THE DOCK, AND ONLY WHERE THE DOCK EXISTS
                 (owner, 2026-09-19: "messages need to fill the screen").

                 96px is AppShell's `reserveBottomNav` clearance — the floating
                 MobileNav pill plus the Post FAB, which ride in the same
                 `.mobile-nav-frame`. On the desktop website that frame is
                 `display: none !important` (index.css, `html.web-desktop
                 .mobile-nav-frame`), so the reserve was holding open 96px of
                 scroll for something that is not painted: the inbox ran out of
                 threads ~96px above the panel's bottom edge, and since the
                 panel itself runs flush to the viewport floor on desktop
                 (pageCardSurfaces' zeroed bottom radii — owner, 2026-09-16,
                 panels are NOT curved at the bottom), that reserve read as the
                 list simply stopping short of the screen.

                 This used to be keyed on `embedded`, which no production
                 caller ever sets, so the trim never once ran. It is keyed on
                 `useIsWebDesktop()` now — the SAME predicate that puts the
                 `web-desktop` class on <html>, which is the only thing that
                 hides the dock. Those are two separate literals in two files
                 (useIsWebDesktop.ts and useAppShellViewport.ts), so a guard
                 asserts they stay identical; if they ever drift, this padding
                 would come off at a width where the dock is still painted and
                 the last thread would hide behind it.

                 Desktop keeps a real 1rem gutter rather than zero — the panel
                 has no bottom edge there, so 0 would leave the final row
                 sitting on the viewport floor. The safe-area term stays in:
                 web-desktop is a BROWSER at >=900px, which includes an iPad in
                 landscape with a home indicator.

                 Phone and native are untouched: `isWebDesktop` is false at
                 every phone width and on native at every size, so this is the
                 same string it has always been there, and the dock clearance
                 is load-bearing. */
              paddingBottom: isWebDesktop
                ? "calc(var(--safe-area-bottom, 0px) + 1rem)"
                : "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px))",
            }}
          >
          <div className="space-y-2">
          {/* ── THE AGED-OUT NOTE ───────────────────────────────────────────
              "Keep them, auto-hide after a while. Never delete" (owner,
              2026-09-19). Hiding silently is how "hidden" becomes "I lost my
              messages", so All says how many finished threads it is holding
              back and how to reach them. The answer is the search box, which
              deliberately ignores the age rule (see filteredConversations).
              Not a button: there is no "show them all" tab to send anyone to,
              and inventing one would undo the decision. */}
          {!loading && inboxTab === "all" && !searchQuery.trim() && agedOutCount > 0 && (
            <p
              role="status"
              className="font-sans text-ds-12 leading-snug px-3 py-2"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {agedOutCount === 1
                ? `1 finished conversation is older than ${THREAD_AGE_OUT_DAYS} days and is tucked away. It's still here — search for the person or the job to open it.`
                : `${agedOutCount} finished conversations are older than ${THREAD_AGE_OUT_DAYS} days and are tucked away. They're still here — search for the person or the job to open one.`}
            </p>
          )}
          {/* ── THE HIDDEN-UNREAD BANNER ────────────────────────────────────
              The price of landing on Active (owner, 2026-09-19), paid openly.

              Active is `LIVE_JOB_STATUSES`, which does NOT include `open` —
              so an applicant's unread question about a posting you have not
              awarded yet, the single most common unread thread a poster gets,
              is NOT in the tab the inbox now opens on. "Opens to Active" must
              never mean "hides something you have not read".

              This is the only place that can say so, and it matters most on
              PHONE: the tab strip lives behind a disclosure that starts
              collapsed, so the "All N" count is not even on screen. There is
              no Unread tab to fall back on any more either — it was removed
              the same day.

              Shown only when there is genuinely something concealed: on
              Active, not searching, with at least one unread thread outside
              the live slice. It sends the reader to All (the widest view),
              not to a filter, because the point is to stop hiding.
              On top, space held while loading (MQ28): see ./HiddenUnreadBar. */}
          {loading && inboxTab === "active" && !searchQuery.trim() && cachedHiddenUnread > dismissedHiddenUnread && (
            <HiddenUnreadBar held count={cachedHiddenUnread} />
          )}
          {!loading && inboxTab === "active" && !searchQuery.trim() && hiddenUnreadCount > dismissedHiddenUnread && (
            <HiddenUnreadBar
              count={hiddenUnreadCount}
              onShowAll={() => { hapticLight(); setInboxFilter(UNFILTERED_INBOX_TAB); }}
              onDismiss={() => { hapticLight(); dismissHiddenUnread(); }}
            />
          )}
          {loading ? (
            /* No `space-y` here on purpose. The real list stacks
               ConversationRows flush and divides them with each row's own
               inset hairline; an 8px gap between bones put the placeholder
               list at a 76px pitch against the real 64px, so every row below
               the first slid up when the inbox landed. The bones carry the
               same hairline and stack the same way.

               SIX, not four. The panel is ~600px tall at 375 and a 64px row
               fills it six times over — four bones left a third of the list
               blank and then filled in, which reads as the page growing. Six
               is a FLOOR, not a promise: the real count is unknowable while
               the query is out, so reserve what the viewport will hold and let
               a longer list extend past the fold, where nothing is displaced. */
            <div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <MessageThreadSkeleton key={i} />
              ))}
            </div>
          ) : nothingToList ? (
            <div className="flex flex-col items-center text-center py-14 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--success-ink) / 0.10)",
                  border: "0.5px solid hsl(var(--success-ink) / 0.24)",
                }}
              >
                <MessageSquare className="w-5 h-5" style={{ color: "hsl(var(--success-ink))" }} />
              </div>
              <p
                className="font-display font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {/* The "You're all caught up" variant went with the Unread
                    tab on 2026-09-19 — it was that tab's empty state and
                    nothing else can reach it now. */}
                {t("msg.nothingHere")}
              </p>
              <p
                className="font-sans text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* NAME THE NUMBER, the way My Jobs does ("you have 3 in
                    Waiting and 2 in Done"). This is the one place the counts
                    the collapsed header folds away are genuinely owed to the
                    reader: the list below is empty, so it cannot show them,
                    and "Switch to All" without a number asks you to go and
                    check whether there is anything over there at all. */}
                {inboxTab === "pinned"
                  ? t("msg.nonePinned")
                  : inboxTab === "recentlyDeleted"
                    ? t("msg.noneHidden")
                    : inboxTab === "active"
                      /* THE ACTIVE EMPTY STATE, and the one the Active
                         default made common: a user whose jobs have all
                         finished now LANDS here, where All would have shown
                         them threads. It has to read as "nothing is running",
                         never as "your inbox is broken" — so it names the
                         reason, and the button beneath it names the number
                         waiting under Any status. */
                      ? t("msg.noneActive")
                      : t("msg.noneMatchView")}
              </p>
              {/* THE COUNT, and a way to ACT on it — the "Show Waiting (3)"
                  button My Jobs puts under the same copy, which is where that
                  screen surfaces the numbers its own collapsed header folds
                  away. This is the one place Messages' counts are genuinely
                  owed to the reader: the list is empty, so it cannot show them,
                  and "switch to All" without a number asks you to go and check
                  whether there is anything over there at all. Carrying the
                  number HERE rather than in the sentence also keeps the prose
                  from saying "All" twice in one line.

                  Only for Active, the one tab whose fix really is "switch to
                  All" (Unread, the other one, was removed on 2026-09-19).
                  Pinned and Recently Deleted are told to swipe instead: there
                  is nothing under All to send them to.

                  The count is `allTabConversations`, the same number the All
                  tab prints — promising "Show All (12)" and then rendering 9
                  because the age rule trimmed three would be a fresh lie.

                  UNFILTERED_INBOX_TAB, not DEFAULT_INBOX_TAB. Those were the
                  same constant until 2026-09-19, when the landing tab became
                  Active; a button labelled "Show All" that set the default
                  would, from the Active empty state, set Active again and do
                  nothing at all. */}
              {inboxTab === "active" && allTabConversations.length > 0 && (
                <BarkPillButton onClick={() => { hapticLight(); setInboxFilter(UNFILTERED_INBOX_TAB); }}>
                  {t("msg.showFinished", { n: allTabConversations.length })}
                </BarkPillButton>
              )}
            </div>
          ) : nothingFound ? (
            /* Active search filtered every thread out — a tidy in-place
               message rather than an empty list. */
            <div className="flex flex-col items-center text-center py-14 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--ivory-sand) / 0.6)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.16)",
                }}
              >
                <Search className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
              </div>
              <p
                className="font-display font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {t("msg.noneMatch")}
              </p>
              <p
                className="font-sans text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {/* Same generic search-empty state as the default inbox, but
                    scoped so it doesn't read as "you have zero X" — it means
                    "zero X match this search," which is a different claim
                    when X is Pinned or Recently Deleted specifically. */}
                {isSpecialFilterView
                  ? (inboxTab === "pinned" ? t("msg.tryOtherPinned") : t("msg.tryOtherHidden"))
                  : t("msg.tryOther")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">{sectionEmpty?.Lead && !searchQuery.trim() && !selectMode && <sectionEmpty.Lead empty={null} />}
              {/* S2-016: the member's shop chats above the threads under All / Unread. */}
              {!sectionEmpty?.Lead && inboxLead && !searchQuery.trim() && !selectMode && !isSpecialFilterView && (() => { const Lead = inboxLead; return <Lead empty={null} />; })()}
              {orderTalks && orderTalks.error != null && !selectMode && !isSpecialFilterView && (
                <OrderTalkLoadError error={orderTalks.error} retry={orderTalks.reload} />
              )}
              {(() => {
                const visibleItems = showAllConvos ? items : items.slice(0, CONVO_LIMIT);
                return (
                  <VirtualList
                    items={visibleItems}
                    getKey={inboxItemKey}
                    estimateSize={80}
                    overscan={6}
                    /* /messages is an AppShell route, deliberately OFF
                       DOCUMENT_SCROLL_ROUTES, so `html.app-shell` pins
                       window.scrollY at 0 and a window virtualizer never
                       advances. The inbox scrolls inside
                       PullToRefreshWrapper — that is the scroll source.
                       Measured before this prop: 16 of 29 threads mounted at
                       375, unchanged after scrolling 1758px; the rest of the
                       panel was blank. */
                    scrollElementRef={containerRef}
                    virtualizerRef={listHandleRef}
                    renderItem={(it) => {
                      if (it.kind === "order") return <OrderTalkRow row={it.row} />;
                      const c = it.c;
                      const key = `${c.jobId}_${c.otherUserId}`;
                      const pinned =
                        c.otherUserId !== null &&
                        pinnedSetForRender.has(pinnedKey(c.jobId, c.otherUserId));
                      // In the desktop split, highlight the row whose thread
                      // is open in the right pane so the inbox tracks the
                      // selection. No-op on mobile (activeKey stays null).
                      const isActive = !!activeKey && activeKey === key;
                      const selected = selectedKeys.has(key);
                      // Recently Deleted: Restore rides the row's `trailing` slot, in flow (Q1465).
                      const restore = isRecentlyDeletedView && userId ? <RestoreConversationButton convo={c} userId={userId} /> : undefined;
                      const row = (
                        <ConversationRow
                          convo={c}
                          currentUserId={userId}
                          openConvo={openConvo}
                          isActive={isActive}
                          selectMode={selectMode}
                          selected={selected}
                          onToggleSelect={() => toggleSelect(c)}
                          pinned={pinned}
                          trailing={restore}
                        />
                      );
                      // Swipe gestures (archive / pin) are inert in select mode, and meaningless in the Recently
                      // Deleted view (Restore replaces them there) — render the bare row so a drag can't fire an
                      // archive mid-selection or re-archive an already-archived thread. Q335: a deleted-account
                      // thread swipes to archive only; pin stays off (thread_pins.other_user_id is NOT NULL, owner
                      // 2026-09-26: no pin or mute).
                      // A "Louisiana Helpr Team" thread has no job to key an
                      // archive or pin on (src/lib/teamThread.ts): bare row.
                      return selectMode || isRecentlyDeletedView || c.teamThread ? row : (
                        <SwipeableConversationRow
                          isPinned={pinned}
                          onArchive={() => handleArchive(c)}
                          onTogglePin={c.otherUserId === null ? undefined : () => handleTogglePin(c)}
                        >
                          {row}
                        </SwipeableConversationRow>
                      );
                    }}
                  />
                );
              })()}
              {/* F420: the chat sheet for a tapped order row (?order_talk=<order id>), over Messages; closing it takes the parameter off. */}
              {orderTalks && <OrderTalkFromLink />}
              {!showAllConvos && items.length > CONVO_LIMIT && (
                <div className="flex justify-center py-3">
                  {/* The shared Button (outline, sm; Q2709 11-05), bark ink. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllConvos(true)}
                    className="text-ds-13 font-medium text-[hsl(var(--bark))]"
                  >
                    Show all {items.length} conversations
                  </Button>
                </div>
              )}
            </div>
          )}
          </div>
          </PullToRefreshWrapper>
          )}

          {/* Multi-select action bar.
              
              This used to be an in-flow `shrink-0` row that padded itself by
              `safe-area + 88px` to clear the floating nav dock. In-flow, that
              reserve is not clearance — it is 88px of card-coloured padding
              rendered BELOW the buttons, so select mode showed a dead white
              band between Cancel/Delete and the bottom of the screen.

              It is now a fixed floating bar, which is what the app already
              does for this exact interaction on Activity (`BulkDismissBar`).
              Same ink pill, same safe-area maths, same left-count /
              right-actions arrangement — so the two bulk-select surfaces stop
              being two different inventions of the same control.

              The count moved in here with it; the toolbar's "N/3 selected"
              text is gone, because with both present the same number was on
              screen twice. */}
          {selectMode && hasThreads && (
            <div
              role="toolbar"
              aria-label={t("msg.bulkBar")}
              // Embedded (desktop split): anchor inside the list pane so the
              // bar doesn't stretch across the thread pane; standalone keeps
              // the fixed viewport-bottom float above the nav dock.
              data-rail-inset={embedded ? undefined : ""}
              className={`${embedded ? "absolute" : "fixed"} inset-x-0 z-40 px-4`}
              style={{ bottom: embedded ? "1rem" : "calc(var(--safe-area-bottom, 0px) + 80px)" }}
            >
              <div
                className="mx-auto max-w-xl flex items-center justify-between gap-3 px-4 py-3 rounded-ds-md"
                style={{
                  background: "hsl(var(--ink-deep))",
                  boxShadow: "0 12px 28px hsl(var(--ink-deep) / 0.32)",
                }}
              >
                <span
                  className="text-ds-13 font-semibold truncate"
                  style={{ color: "hsl(var(--parchment))" }}
                  aria-live="polite"
                >
                  {selectedKeys.size === 0
                    ? t("msg.tapToSelect")
                    : t("msg.nSelected", { n: selectedKeys.size, max: MAX_SELECT })}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <SelectBarExitButton
                    onClick={exitSelectMode}
                    aria-label={t("chat.cancelSelection")}
                  />
                  {/* The shared primary Button, sm (Q2709 11-05): the olive pill on the ink bar. */}
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleBatchDelete}
                    disabled={selectedKeys.size === 0}
                    // "Hide", not "Delete" — the action is the same honest
                    // local archive every other surface calls hiding ("no
                    // messages are deleted"); the bar must not promise more.
                    aria-label={selectedKeys.size === 1 ? t("msg.hideOne") : t("msg.hideN", { n: selectedKeys.size })}
                    className="gap-1.5 px-3 text-ds-13 font-semibold disabled:opacity-40 [&_svg]:size-4"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("msg.hide")}
                  </Button>
                </div>
              </div>
            </div>
          )}

    </>
  );
}
