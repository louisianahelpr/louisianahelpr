import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Pin, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
// Card-matching skeleton — mirrors the actual ConversationRow shape
// (avatar + name/job/last-msg lines + timestamp + unread dot) so the
// loading→loaded swap doesn't shift the row. See task #121.
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import { VirtualList } from "@/components/VirtualList";
import { ConversationRow } from "./ConversationRow";
import { SwipeableConversationRow } from "./SwipeableConversationRow";
import { getPinnedSet, loadPins, pinnedKey, togglePinned } from "@/lib/pinnedConversations";
import type { Conversation } from "./types";

/**
 * Job states that mean "this work is still running", for the Active inbox tab.
 * `open` is deliberately absent: a thread on an open posting is somebody asking
 * about a job nobody has been awarded yet, which is a conversation, not a job in
 * progress. Completed / cancelled are equally absent — those threads are
 * history, and history lives under All.
 */
const LIVE_JOB_STATUSES = new Set([
  "accepted",
  "in_progress",
  "revision_requested",
  "disputed",
  "pending_approval",
]);

// Cap the rendered list; "Show all" reveals the rest. The virtualizer
// keeps long lists cheap, but a default cap keeps first paint trivial.
const CONVO_LIMIT = 50;

interface ConversationListProps {
  conversations: Conversation[];
  loading: boolean;
  loadError: boolean;
  userId: string | null;
  /** Reloads the conversation list — drives retry + pull-to-refresh. */
  loadConversations: (uid: string) => Promise<void>;
  /** Opens a conversation into the chat view. */
  openConvo: (convo: Conversation) => void;
  /** Opens the confirm dialog for hiding one thread (an honest local
   *  archive, not a hard delete). Fired by the row's left swipe. */
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
  /** When true, render only the inbox body (no PageScaffold / fixed-
   *  viewport shell, no title card) so the desktop Messages page can host
   *  it as the left pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone PageScaffold exactly as
   *  before. The selected thread is highlighted via `activeKey`. */
  embedded?: boolean;
  /** `${jobId}_${otherUserId}` of the open thread — used to highlight the
   *  active row in the embedded (desktop split) layout. */
  activeKey?: string | null;
  /** Batch-hide the selected threads (multi-select delete). Reuses the
   *  same honest local-archive semantics as the single-row delete — the
   *  parent opens ONE combined confirm dialog and, on confirm, archives
   *  each. Never a hard delete. */
  onBatchArchive: (convos: Conversation[]) => void;
  /** Bumped by the parent after a batch archive resolves — clears the
   *  in-list selection and exits select mode. */
  resetSelectionNonce?: number;
}

// Sort comparator (descending by lastAt) — pulled out so the pinned /
// unpinned partitions both use the exact same ordering rule.
function byLastAtDesc(a: Conversation, b: Conversation): number {
  return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
}

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
  loading,
  loadError,
  userId,
  loadConversations,
  openConvo,
  setDeleteConvoConfirm,
  embedded = false,
  activeKey = null,
  onBatchArchive,
  resetSelectionNonce = 0,
}: ConversationListProps) {
  const navigate = useNavigate();
  const [showAllConvos, setShowAllConvos] = useState(false);
  // Multi-select delete mode. `selectMode` swaps each row into a
  // checkbox toggle (opening is suppressed) and reveals a bottom action
  // bar; `selectedKeys` holds up to MAX_SELECT `${jobId}_${otherUserId}`
  // keys. Reset from the parent via `resetSelectionNonce` after a batch
  // archive resolves.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // In-list search: an expandable field (mirrors the Activity tabs'
  // search pattern) that client-filters the already-loaded threads by
  // the other person's name and the last-message snippet. No new query —
  // a pure local filter over `conversations`, so no debounce needed.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /* Which slice of the inbox. Unread is the default WHEN THERE IS UNREAD —
     opening a caught-up inbox on an empty "Unread" tab would be the app hiding
     every conversation the user has to prove a point (owner: "i think unread
     should be the default tab??"). Resolved once, on mount, from the first
     load; changing tabs after that is the user's business.

     `null` means "not chosen yet" so the effect below can seed it as soon as
     the first page of threads lands — `conversations` is empty on the very
     first render and a default computed then would always be "all". */
  const [inboxFilter, setInboxFilter] = useState<string | null>(null);
  // Bump this nonce after a pin/unpin so the derived order re-reads
  // sessionStorage (the pin set is read directly to avoid a parallel
  // state branch). Cheap, scoped to a paint.
  const [pinNonce, setPinNonce] = useState(0);

  // Pull the pin list from the server once the user is known.
  //
  // Pins are now durable (public.thread_pins) rather than sessionStorage, so
  // a cold launch has to fetch them. `loadPins` seeds its cache from the local
  // mirror first, so the first paint is already right in the common case; this
  // bump is what folds in anything pinned on another device. It never rejects
  // — a failed pin fetch resolves to the mirror rather than breaking the inbox.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadPins(userId).then(() => {
      if (!cancelled) setPinNonce((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Partition + sort: pinned threads first (kept in their own
  // newest-first stack), then everything else in newest-first order.
  // Keeps the inbox readable when 2-3 threads are pinned without
  // splitting them into a separate panel.
  const orderedConversations = useMemo(() => {
    if (!userId) return [...conversations].sort(byLastAtDesc);
    const pinnedSet = getPinnedSet(userId);
    const pinned: Conversation[] = [];
    const rest: Conversation[] = [];
    for (const c of conversations) {
      if (pinnedSet.has(pinnedKey(c.jobId, c.otherUserId))) pinned.push(c);
      else rest.push(c);
    }
    pinned.sort(byLastAtDesc);
    rest.sort(byLastAtDesc);
    return [...pinned, ...rest];
    // pinNonce is the dependency, even though it's not used in the body —
    // bumping it triggers a re-read of sessionStorage.
  }, [conversations, userId, pinNonce]);

  // Client-side search over the already-ordered list. Case-insensitive
  // substring match on the other person's name and the last-message
  // snippet — the two fields a user scans when hunting for a thread.
  // Empty query is a no-op (returns the full ordered list).
  const filteredConversations = useMemo(() => {
    // Tab first, then the search box. Searching inside the slice you are
    // looking at is what a two-control list is expected to do; searching the
    // whole inbox while a tab says "Unread" would make the tab a lie.
    const byTab =
      inboxFilter === "unread"
        ? orderedConversations.filter((c) => c.unread > 0)
        : inboxFilter === "active"
          ? orderedConversations.filter(
              (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
            )
          : orderedConversations;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((c) => {
      const name = c.otherUserName?.toLowerCase() ?? "";
      const snippet = c.lastMessage?.toLowerCase() ?? "";
      const title = c.jobTitle?.toLowerCase() ?? "";
      return name.includes(q) || snippet.includes(q) || title.includes(q);
    });
  }, [orderedConversations, searchQuery, inboxFilter]);

  // Seed the default tab from the FIRST loaded page, once. See the state decl.
  useEffect(() => {
    if (inboxFilter !== null || conversations.length === 0) return;
    setInboxFilter(conversations.some((c) => c.unread > 0) ? "unread" : "all");
  }, [conversations, inboxFilter]);

  // True when an active search filters every thread out — drives a tidy
  // "No conversations match" state in place of the list.
  const noSearchMatches =
    !!searchQuery.trim() && filteredConversations.length === 0;

  /* And the same thing for a TAB that filters everything out.
     `isEmpty` asks whether the whole inbox is empty, so it stayed false while
     the Unread tab was showing nothing — and the list column rendered as a
     blank white panel with no message at all. A caught-up inbox is a good
     outcome; it should say so rather than look broken. */
  const noTabMatches =
    !searchQuery.trim() && conversations.length > 0 && filteredConversations.length === 0;

  const handleTogglePin = (convo: Conversation) => {
    if (!userId) return;
    const next = togglePinned(userId, convo.jobId, convo.otherUserId);
    setPinNonce((n) => n + 1);
    toast.success(next ? "Pinned to top" : "Unpinned");
  };

  const handleArchive = (convo: Conversation) => {
    // Reuse the existing "delete conversation" confirm flow — it's an
    // honest local archive, not a destructive delete (see archivedConversations.ts).
    setDeleteConvoConfirm(convo);
  };

  // Cap the selection so batch-delete stays a deliberate, small action.
  const MAX_SELECT = 3;
  const convoKey = (c: Conversation) => `${c.jobId}_${c.otherUserId}`;

  // Enter select mode from the toolbar. Close any open search so the two
  // modes never overlap.
  const enterSelectMode = () => {
    hapticLight();
    setSearchOpen(false);
    setSearchQuery("");
    setSelectMode(true);
    setSelectedKeys(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  // Toggle one row's selection, enforcing the 3-thread cap with a toast
  // when a fourth is attempted. Reads `selectedKeys` from the closure so
  // the cap check stays out of the state updater (no double toast under
  // StrictMode's double-invoked reducers).
  const toggleSelect = (c: Conversation) => {
    const key = convoKey(c);
    const already = selectedKeys.has(key);
    if (!already && selectedKeys.size >= MAX_SELECT) {
      toast(`You can select up to ${MAX_SELECT} conversations.`);
      return;
    }
    hapticLight();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hand the selected threads up to the parent, which owns the combined
  // confirm dialog + the honest local-archive. Selection is cleared via
  // `resetSelectionNonce` only after that confirm resolves.
  const handleBatchDelete = () => {
    const selected = filteredConversations.filter((c) =>
      selectedKeys.has(convoKey(c)),
    );
    if (selected.length === 0) return;
    onBatchArchive(selected);
  };

  // Parent bumps `resetSelectionNonce` after a batch archive resolves —
  // clear the selection and drop out of select mode.
  useEffect(() => {
    if (resetSelectionNonce > 0) exitSelectMode();
    // Only react to the nonce changing (exitSelectMode is stable).
  }, [resetSelectionNonce]);

  // The current pinned key-set for the rendered conversations. Kept
  // outside the render loop so SwipeableConversationRow's `isPinned`
  // prop is a stable Set lookup, not a per-row sessionStorage read.
  const pinnedSetForRender = useMemo(
    () => (userId ? getPinnedSet(userId) : new Set<string>()),
    // pinNonce drives re-evaluation when a pin/unpin happens.
    [userId, pinNonce],
  );

  // Empty inbox (loaded, no error, zero threads). When there's nothing
  // to list, the redundant secondary "Conversations / All threads"
  // header is pure noise stacked above the empty-state card — it's
  // hidden so the empty state reads as one clean panel.
  const isEmpty = !loading && !loadError && conversations.length === 0;

  // Header second line, matching the Activity pages ("My Jobs" / "All · 4").
  //
  // Messages has no status filter, so there is no filter label to hoist — but
  // an inbox does have one number worth stating up front, which is how much is
  // waiting on you. Threads, not messages: "2 unread" means two conversations
  // need a reply, which is the actionable unit here.
  //
  // Omitted entirely at zero rather than rendering "0 unread" — a caught-up
  // inbox should say nothing, not report an absence.
  const unreadThreads = conversations.filter((c) => c.unread > 0).length;
  /* The inbox had no filter at all — a single undifferentiated list, with
     "2 unread" printed beside the title as the only acknowledgement that some
     threads want you and the rest don't (owner: "i think unread should be the
     default tab??" and "where are the other options?").

     Three slices, and they answer three different questions: who is waiting on
     me, which conversations belong to work that is still running, and
     everything. Same control My Posts / My Jobs use — literally the same
     component — because "which slice of this list am I looking at" is one idea
     and the app should express it one way.

     The count beside "Unread" is what "2 unread" used to say, so that caption
     comes out rather than sitting next to a tab that already says it. */
  const activeThreads = conversations.filter(
    (c) => c.jobStatus && LIVE_JOB_STATUSES.has(c.jobStatus),
  ).length;

  // Pull-to-refresh: swiping down on the list re-runs loadConversations.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  // No title card: the "Messages" section name lives in the top bar
  // (Instagram/Facebook pattern — passed as `title` to DashboardHeader
  // below), and the "N threads" chip that used to be the card's only
  // content just restated the thread list directly beneath it. Same
  // call as My Posts / My Jobs, which dropped their count box too.

  const inboxTabs = (
    <UnderlineTabs
      dense={embedded}
      ariaLabel="Filter conversations"
      tabs={[
        { key: "unread", label: "Unread", count: unreadThreads },
        { key: "active", label: "Active", count: activeThreads },
        { key: "all", label: "All", count: conversations.length },
      ]}
      value={inboxFilter ?? "all"}
      onChange={setInboxFilter}
    />
  );

  const listBody = (
    <>
          {/* Thin list toolbar — iOS shows only the nav title over the
              list, so the old "Conversations" eyebrow + "All threads"
              serif heading are gone (an app-wide decision to drop these
              eyebrow kickers). What remains is a Select + Search toolbar;
              in select mode it swaps to a live "N/3 selected" count.
              Hidden on an empty inbox so the empty state reads as one
              clean panel. */}
          {/* The header renders ALWAYS, including when the inbox is empty.
              It used to be gated on `!isEmpty`, which meant an empty Messages
              had no title bar at all — the screen just opened on the empty
              illustration with nothing naming it, while My Jobs beside it kept
              its title. It also left the page with ZERO h1, so a screen reader
              landed on an unnamed screen. (The route sweep missed this because
              it seeds conversations, so Messages is never empty there — the
              owner hit it on a real device with no messages.)

              Only the Select/Search actions are gated now: those genuinely
              have nothing to act on when the list is empty. */}
          {(
            <div
              className="shrink-0 flex items-center gap-3 px-4"
              style={{ minHeight: "52px", borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              {selectMode ? (
                /* Select mode — live "N/3 selected" counter fills the row. */
                <span className="flex-1 text-ds-13 font-medium" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {selectedKeys.size}/{MAX_SELECT} selected
                </span>
              ) : searchOpen ? (
                /* Search mode — input replaces the row inline (iOS pattern). */
                <>
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      autoFocus
                      type="search"
                      aria-label="Search conversations"
                      placeholder="Search conversations…"
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
                </>
              ) : (
                /* Normal mode — title + Select + Search. */
                <>
                  {/* Title and unread count sit on ONE line, count to the
                      right of the name — owner: "put 1 unread to the right of
                      messages bc i dont like it under". Stacking them made a
                      two-line block for what is really one short phrase, and
                      pushed the row taller than the other screens' toolbars.

                      `items-baseline` so the small italic count sits on the
                      wordmark's baseline rather than centring against a much
                      larger cap-height. The h1 keeps `min-w-0` + truncate and
                      the count is `shrink-0`, so a long title yields first and
                      the count is never the thing that gets cut. */}
                  <div className="flex items-baseline min-w-0 flex-1 gap-2 py-2.5">
                    {/* On the desktop website the page name is deleted from
                        this row (owner) — the app bar and the side panel both
                        already say where you are, so a third "Messages" three
                        rows apart is chrome restating chrome. It goes
                        `sr-only`, never away: a screen with no h1 is an a11y
                        defect, and this is Messages' only one. Phone and
                        native keep it visible — they have no app bar. */}
                    <h1
                      className={
                        embedded
                          ? "sr-only"
                          : "font-display font-bold text-foreground text-ds-20 truncate m-0 leading-none min-w-0"
                      }
                    >
                      Messages
                    </h1>
                    {/* DESKTOP: the tabs ride beside the screen name, exactly
                        as they do on My Posts / My Jobs. Phone puts them on
                        their own line below this row — see after the toolbar.
                        The "2 unread" caption that used to sit here is gone:
                        the Unread tab carries that number now, and the caption
                        beside a tab that already says it is the same fact
                        twice. */}
                    {embedded && !isEmpty && inboxTabs}
                  </div>
                  <div className={`flex items-center gap-1 shrink-0 ${isEmpty ? "hidden" : ""}`}>
                    <button
                      onClick={enterSelectMode}
                      aria-label="Select conversations"
                      className="min-h-[44px] px-2 inline-flex items-center text-ds-13 font-medium btn-press"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      Select
                    </button>
                    <button
                      onClick={() => { hapticLight(); setSearchOpen(true); }}
                      aria-label="Search conversations"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-md transition-colors btn-press shrink-0"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* PHONE: the same tabs, on their own line under the toolbar —
              there is no room for them beside a visible "Messages" title and
              the Select / Search cluster. Hidden while search or select mode
              has taken the row over: one control at a time. */}
          {!embedded && !isEmpty && !searchOpen && !selectMode && (
            <div className="shrink-0 px-4 pt-2.5 pb-1 overflow-x-auto scrollbar-hide">
              {inboxTabs}
            </div>
          )}
          {!loading && loadError && conversations.length === 0 ? (
            <div className="px-3 pt-4 flex-1 min-h-0 flex">
              <ErrorState
                title="We couldn't load your messages."
                onRetry={() => { if (userId) loadConversations(userId); }}
              />
            </div>
          ) : !loading && conversations.length === 0 ? (
            <div className="px-3 pt-4 flex-1 min-h-0 flex">
              <EmptyState
                icon={MessageSquare}
                illustration={<EmptyStateIllustration variant="inbox" />}
                eyebrow="Quiet for now"
                title="No messages yet"
                body="Apply to a job or accept a Helpr's offer — conversations appear here once they start."
                action={
                  <BarkPillButton onClick={() => navigate("/dashboard")}>
                    Browse jobs
                  </BarkPillButton>
                }
              />
            </div>
          ) : (
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-3 py-3"
            style={{
              // Mobile pads for the floating dock; the desktop split pane
              // has no dock, so the 96px reserve would just be dead scroll
              // space — trim it to a normal gutter when embedded.
              paddingBottom: embedded
                ? "1rem"
                : "calc(var(--safe-area-bottom, 0px) + 96px)",
            }}
          >
          <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <MessageThreadSkeleton key={i} />
              ))}
            </div>
          ) : noTabMatches ? (
            <div className="flex flex-col items-center text-center py-14 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--success-ink) / 0.10)",
                  border: "0.5px solid hsl(var(--success-ink) / 0.24)",
                }}
              >
                <MessageSquare className="w-5 h-5" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {inboxFilter === "unread" ? "You're all caught up" : "Nothing here right now"}
              </p>
              <p
                className="font-serif italic text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {inboxFilter === "unread"
                  ? "Every thread has been read. Switch to All to see them."
                  : "No conversations belong to a job that's still running. Switch to All to see them."}
              </p>
            </div>
          ) : noSearchMatches ? (
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
                <Search className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No conversations match
              </p>
              <p
                className="font-serif italic text-ds-13 max-w-[240px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Try a different name or keyword.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const visibleConvos = showAllConvos
                  ? filteredConversations
                  : filteredConversations.slice(0, CONVO_LIMIT);
                return (
                  <VirtualList
                    items={visibleConvos}
                    getKey={(c) => `${c.jobId}_${c.otherUserId}`}
                    estimateSize={80}
                    overscan={6}
                    renderItem={(c) => {
                      const key = `${c.jobId}_${c.otherUserId}`;
                      const pinned = pinnedSetForRender.has(
                        pinnedKey(c.jobId, c.otherUserId),
                      );
                      // In the desktop split, highlight the row whose thread
                      // is open in the right pane so the inbox tracks the
                      // selection. No-op on mobile (activeKey stays null).
                      const isActive = !!activeKey && activeKey === key;
                      const selected = selectedKeys.has(key);
                      const row = (
                        <div className="relative">
                          {/* Tiny pin chip — peeks over the top-right
                              corner of the avatar so a pinned row reads at a
                              glance. Hidden when not pinned, and while
                              selecting (the checkbox takes that corner). */}
                          {pinned && !selectMode && (
                            <span
                              aria-label="Pinned"
                              className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full pointer-events-none"
                              style={{
                                background: "hsl(var(--burnt-sienna) / 0.9)",
                                boxShadow:
                                  "0 1px 3px hsl(var(--burnt-sienna) / 0.45)",
                              }}
                            >
                              <Pin
                                className="w-2.5 h-2.5"
                                style={{ color: "hsl(var(--parchment))" }}
                                strokeWidth={2.4}
                              />
                            </span>
                          )}
                          <ConversationRow
                            convo={c}
                            currentUserId={userId}
                            openConvo={openConvo}
                            isActive={isActive}
                            selectMode={selectMode}
                            selected={selected}
                            onToggleSelect={() => toggleSelect(c)}
                          />
                        </div>
                      );
                      // Swipe gestures (archive / pin) are inert in select
                      // mode — render the bare row so a drag can't fire an
                      // archive mid-selection.
                      return selectMode ? row : (
                        <SwipeableConversationRow
                          isPinned={pinned}
                          onArchive={() => handleArchive(c)}
                          onTogglePin={() => handleTogglePin(c)}
                        >
                          {row}
                        </SwipeableConversationRow>
                      );
                    }}
                  />
                );
              })()}
              {!showAllConvos && filteredConversations.length > CONVO_LIMIT && (
                <div className="flex justify-center py-3">
                  <button
                    onClick={() => setShowAllConvos(true)}
                    className="btn-press inline-flex items-center justify-center rounded-ds-md px-4 py-1.5 text-ds-13 font-medium transition-colors"
                    style={{
                      background: "hsl(var(--parchment) / 0.8)",
                      color: "hsl(var(--bark))",
                      border: "1px solid hsl(var(--bark) / 0.22)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
                        "0 1px 2px hsl(var(--bark) / 0.10)",
                    }}
                  >
                    Show All {filteredConversations.length} Conversations
                  </button>
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
          {selectMode && !isEmpty && (
            <div
              role="toolbar"
              aria-label="Bulk delete action bar"
              className="fixed inset-x-0 z-40 px-4"
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
                    ? "Tap to select"
                    : `${selectedKeys.size} of ${MAX_SELECT} selected`}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={exitSelectMode}
                    aria-label="Cancel selection"
                    className="h-9 w-9 rounded-ds-md inline-flex items-center justify-center btn-press transition"
                    style={{
                      color: "hsl(var(--parchment) / 0.85)",
                      background: "hsl(var(--parchment) / 0.06)",
                    }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    disabled={selectedKeys.size === 0}
                    aria-label={`Delete ${selectedKeys.size} selected conversation${selectedKeys.size === 1 ? "" : "s"}`}
                    className="h-9 px-3 rounded-ds-md inline-flex items-center gap-1.5 text-ds-13 font-semibold btn-press transition disabled:opacity-40 disabled:pointer-events-none"
                    style={{
                      background: "hsl(var(--burnt-sienna))",
                      color: "hsl(var(--parchment))",
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

    </>
  );

  // Embedded (desktop list+thread split): just the inbox body, no
  // PageScaffold shell or title card — the parent provides the outer
  // shell and a shared title card spanning both panes.
  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col">{listBody}</div>;
  }

  return (
    // No "N threads" chip above the list: the list directly below IS the
    // count, and the empty state already says there's nothing — the same
    // redundant count line removed from Activity, /jobs, and the browse
    // toolbar. The desktop split's bar keeps its UNREAD pill, which is real
    // information you can't get by glancing at the list.
    // `titleAs="h1"` because this standalone inbox renders no other heading —
    // the title card was dropped, so without this the whole mobile/native
    // Messages screen has ZERO h1 (the desktop split in Messages.tsx already
    // passes it; only this branch was missed). Phone web and the iOS app are
    // the same surface, so that was the shipped app's inbox announcing no
    // page heading to VoiceOver.
    <PageScaffold>
      {listBody}
    </PageScaffold>
  );
}
