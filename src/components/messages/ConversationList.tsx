import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Pin, Search, X } from "lucide-react";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
// Card-matching skeleton — mirrors the actual ConversationRow shape
// (avatar + name/job/last-msg lines + timestamp + unread dot) so the
// loading→loaded swap doesn't shift the row. See task #121.
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import { VirtualList } from "@/components/VirtualList";
import { ConversationRow } from "./ConversationRow";
import { MuteSheet } from "./MuteSheet";
import { SwipeableConversationRow } from "./SwipeableConversationRow";
import { getPinnedSet, pinnedKey, togglePinned } from "@/lib/pinnedConversations";
import type { Conversation } from "./types";

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
  setReportTarget: Dispatch<SetStateAction<{ type: "message" | "user"; id: string } | null>>;
  setBlockTarget: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
  /** Toggle the muted state of one thread. Resolves once the server has
   *  reconciled and the row's `isMuted` flag has been updated. Used by
   *  legacy paths; the new mute picker uses `onSnoozeMute` + `onUnmute`. */
  onToggleMute: (convo: Conversation) => void;
  /** Set a snooze for the thread until a caller-supplied future time
   *  (or `null` for forever-mute). Used by the MuteSheet picker. */
  onSnoozeMute: (convo: Conversation, until: Date | null) => void;
  /** Explicit unmute — clears any forever or snoozed mute. */
  onUnmute: (convo: Conversation) => void;
  /** When true, render only the inbox body (no PageScaffold / fixed-
   *  viewport shell, no title card) so the desktop Messages page can host
   *  it as the left pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone PageScaffold exactly as
   *  before. The selected thread is highlighted via `activeKey`. */
  embedded?: boolean;
  /** `${jobId}_${otherUserId}` of the open thread — used to highlight the
   *  active row in the embedded (desktop split) layout. */
  activeKey?: string | null;
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
 * badge, job status chip, per-row report / block / delete menu).
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
  setReportTarget,
  setBlockTarget,
  setDeleteConvoConfirm,
  onToggleMute,
  onSnoozeMute,
  onUnmute,
  embedded = false,
  activeKey = null,
}: ConversationListProps) {
  const navigate = useNavigate();
  const [showAllConvos, setShowAllConvos] = useState(false);
  // In-list search: an expandable field (mirrors the Activity tabs'
  // search pattern) that client-filters the already-loaded threads by
  // the other person's name and the last-message snippet. No new query —
  // a pure local filter over `conversations`, so no debounce needed.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Open the MuteSheet (snooze picker) targeted at one conversation.
  // The row's mute action opens this rather than firing the binary
  // toggle directly — keeps "1h / 8h / tomorrow / forever" one tap deep.
  const [muteSheetConvo, setMuteSheetConvo] = useState<Conversation | null>(null);
  // Bump this nonce after a pin/unpin so the derived order re-reads
  // sessionStorage (the pin set is read directly to avoid a parallel
  // state branch). Cheap, scoped to a paint.
  const [pinNonce, setPinNonce] = useState(0);

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
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orderedConversations;
    return orderedConversations.filter((c) => {
      const name = c.otherUserName?.toLowerCase() ?? "";
      const snippet = c.lastMessage?.toLowerCase() ?? "";
      const title = c.jobTitle?.toLowerCase() ?? "";
      return name.includes(q) || snippet.includes(q) || title.includes(q);
    });
  }, [orderedConversations, searchQuery]);

  // True when an active search filters every thread out — drives a tidy
  // "No conversations match" state in place of the list.
  const noSearchMatches =
    !!searchQuery.trim() && filteredConversations.length === 0;

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

  // The current pinned key-set for the rendered conversations. Kept
  // outside the render loop so SwipeableConversationRow's `isPinned`
  // prop is a stable Set lookup, not a per-row sessionStorage read.
  const pinnedSetForRender = useMemo(
    () => (userId ? getPinnedSet(userId) : new Set<string>()),
    // pinNonce drives re-evaluation when a pin/unpin happens.
    [userId, pinNonce],
  );

  // Empty inbox (loaded, no error, zero threads). When there's nothing
  // to list, the "0 threads" count chip and the redundant secondary
  // "Conversations / All threads" header are pure noise stacked above
  // the empty-state card — both are hidden so the empty state reads as
  // one clean panel.
  const isEmpty = !loading && !loadError && conversations.length === 0;

  // Show the thread count ONLY once a load has resolved with real
  // threads. During the first load `loading` is true while
  // `conversations` is still [], so keying the chip off `!isEmpty` would
  // flash "0 threads" before the list arrives, then snap to "N threads"
  // — the screen-jump the user reported. Gating on `!loading` keeps the
  // title card stable: no count during the skeleton, the real count after.
  // We intentionally do NOT gate on `loadError`: a transient refresh
  // failure still leaves the existing threads rendered (the error state
  // only takes over when `conversations.length === 0`), so the count must
  // stay to match what's on screen.
  const showThreadCount = !loading && conversations.length > 0;

  // Pull-to-refresh: swiping down on the list re-runs loadConversations.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  // The "Messages" section name now lives in the top bar (Instagram/Facebook
  // pattern — passed as `title` to DashboardHeader below), so the title card
  // holds only the count chip. Count is gated on `showThreadCount`
  // (!loading && length > 0) so it never flashes "0 threads" during the
  // skeleton load. When there's no chip we drop the whole title card
  // (undefined) rather than float an empty frosted card above the panel.
  const titleCard = showThreadCount ? (
    <p
      className="truncate font-sans font-semibold uppercase leading-none"
      style={{
        fontSize: "0.62rem",
        letterSpacing: "0.16em",
        color: "hsl(var(--olivewood) / 0.8)",
      }}
    >
      {conversations.length} {conversations.length === 1 ? "thread" : "threads"}
    </p>
  ) : undefined;

  const listBody = (
    <>
          {/* Inner header — eyebrow + title row mirroring the
              Posts/Jobs bottom-box header pattern. Hidden on an empty
              inbox so the empty state reads as a single clean panel. */}
          {!isEmpty && (
            <div
              className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: searchOpen ? "none" : "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              {/* On the desktop split the shared title card already reads
                  "Messages", so this eyebrow + "All threads" heading would
                  just stack a second redundant header directly under it.
                  Hide the text block when embedded — the row collapses to a
                  thin search toolbar over the list. Mobile keeps the full
                  header (it's the only title on that screen). */}
              {!embedded ? (
                <div className="flex flex-col leading-none">
                  <span
                    className="font-serif italic tracking-[0.18em] uppercase text-ds-10"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    Conversations
                  </span>
                  <h2
                    className="font-display italic font-bold leading-tight mt-2"
                    style={{
                      fontSize: "1.25rem",
                      color: "hsl(var(--ink-deep))",
                      letterSpacing: "-0.018em",
                    }}
                  >
                    All threads
                  </h2>
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
              {/* Search toggle — expands the field below this header row,
                  matching the Activity tabs' search pattern. Tinted active
                  while open or while a query is set so the affordance reads
                  as "filtering". 44px tap target. */}
              <button
                onClick={() => { hapticLight(); setSearchOpen((o) => !o); }}
                aria-label="Search conversations"
                aria-expanded={searchOpen}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-md transition-colors btn-press shrink-0"
                style={
                  searchOpen || searchQuery
                    ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))" }
                    : { color: "hsl(var(--olivewood) / 0.8)" }
                }
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Expandable search bar — drops below the header row. Pure
              client-side filter over already-loaded threads (name +
              snippet + job title), so no debounce. */}
          {!isEmpty && searchOpen && (
            <div
              className="shrink-0 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              <div className="relative px-4 py-3">
                <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  autoFocus
                  type="search"
                  aria-label="Search conversations"
                  placeholder="Search conversations…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
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
                title="No messages yet."
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
                : "calc(env(safe-area-inset-bottom, 0px) + 96px)",
            }}
          >
          <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <MessageThreadSkeleton key={i} />
              ))}
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
                className="font-display italic font-bold"
                style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No conversations match
              </p>
              <p
                className="font-serif italic text-[0.8rem] max-w-[240px]"
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
                    estimateSize={104}
                    overscan={6}
                    itemClassName="pb-2"
                    renderItem={(c) => {
                      const pinned = pinnedSetForRender.has(
                        pinnedKey(c.jobId, c.otherUserId),
                      );
                      // In the desktop split, highlight the row whose thread
                      // is open in the right pane so the inbox tracks the
                      // selection. No-op on mobile (activeKey stays null).
                      const isActive =
                        !!activeKey &&
                        activeKey === `${c.jobId}_${c.otherUserId}`;
                      return (
                        <SwipeableConversationRow
                          isPinned={pinned}
                          onArchive={() => handleArchive(c)}
                          onTogglePin={() => handleTogglePin(c)}
                        >
                          <div className="relative">
                            {/* Tiny pin chip — peeks over the top-right
                                corner of the avatar so a pinned row reads
                                at a glance without changing the row's
                                shape. Hidden when not pinned. */}
                            {pinned && (
                              <span
                                aria-label="Pinned"
                                className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full pointer-events-none"
                                style={{
                                  background: "hsl(var(--gold-warm) / 0.9)",
                                  boxShadow:
                                    "0 1px 3px hsl(var(--gold-warm) / 0.45)",
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
                              setReportTarget={setReportTarget}
                              setBlockTarget={setBlockTarget}
                              setDeleteConvoConfirm={setDeleteConvoConfirm}
                              onToggleMute={onToggleMute}
                              onOpenMuteSheet={setMuteSheetConvo}
                              isPinned={pinned}
                              onTogglePin={() => handleTogglePin(c)}
                              isActive={isActive}
                            />
                          </div>
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
                    Show all {filteredConversations.length} conversations
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
          </PullToRefreshWrapper>
          )}

      {/* Snooze picker — opened from any conversation row's "Mute"
          action. Lives at the list level (rather than inside each row)
          so a single sheet instance handles every row. */}
      <MuteSheet
        open={!!muteSheetConvo}
        onOpenChange={(open) => { if (!open) setMuteSheetConvo(null); }}
        convo={muteSheetConvo}
        onSnoozeMute={onSnoozeMute}
        onUnmute={onUnmute}
      />
    </>
  );

  // Embedded (desktop list+thread split): just the inbox body, no
  // PageScaffold shell or title card — the parent provides the outer
  // shell and a shared title card spanning both panes.
  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col">{listBody}</div>;
  }

  return (
    <PageScaffold header={<DashboardHeader title="Messages" />} titleCard={titleCard}>
      {listBody}
    </PageScaffold>
  );
}
