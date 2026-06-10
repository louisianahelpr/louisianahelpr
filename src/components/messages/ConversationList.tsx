import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Pin } from "lucide-react";
import { toast } from "sonner";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { EmptyState } from "@/components/ui/EmptyState";
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
}: ConversationListProps) {
  const navigate = useNavigate();
  const [showAllConvos, setShowAllConvos] = useState(false);
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

  return (
    <PageScaffold
      header={<DashboardHeader />}
      scrollRef={containerRef}
      titleCard={
          <div className="flex flex-col leading-none">
            {/* Canonical page-title — same `.text-page-title` (Bodoni Moda
                italic 700, --headline-hero) used by the Activity tabs
                (My Posts / My Jobs) so the four signed-in title cards read
                as one family. */}
            <h1 className="text-page-title leading-tight">Messages</h1>
            {/* Count chip — gated on `showThreadCount` (!loading &&
                length > 0) so it never flashes "0 threads" during the
                skeleton load, the screen-jump the user reported. */}
            {showThreadCount && (
              <p
                className="mt-1 truncate font-sans font-semibold uppercase"
                style={{
                  fontSize: "0.62rem",
                  letterSpacing: "0.16em",
                  color: "hsl(var(--olivewood) / 0.55)",
                }}
              >
                {conversations.length} {conversations.length === 1 ? "thread" : "threads"}
              </p>
            )}
          </div>
      }
    >
          {/* Inner header — eyebrow + title row mirroring the
              Posts/Jobs bottom-box header pattern. Hidden on an empty
              inbox so the empty state reads as a single clean panel. */}
          {!isEmpty && (
            <div
              className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              <div className="flex flex-col leading-none">
                <span
                  className="font-serif italic tracking-[0.18em] uppercase text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
                >
                  Conversations
                </span>
                <h2
                  className="font-display italic font-bold leading-tight mt-1"
                  style={{
                    fontSize: "1.25rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.018em",
                  }}
                >
                  All threads
                </h2>
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
                eyebrow="Quiet for now"
                title="No messages yet."
                body="Apply to a task or accept a helpr's offer — conversations appear here once they start."
                action={
                  <BarkPillButton onClick={() => navigate("/dashboard")}>
                    Browse tasks
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
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
          >
          <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <MessageThreadSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const visibleConvos = showAllConvos
                  ? orderedConversations
                  : orderedConversations.slice(0, CONVO_LIMIT);
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
                            />
                          </div>
                        </SwipeableConversationRow>
                      );
                    }}
                  />
                );
              })()}
              {!showAllConvos && orderedConversations.length > CONVO_LIMIT && (
                <button onClick={() => setShowAllConvos(true)} className="w-full text-center py-3 text-ds-13 text-primary font-medium hover:underline">
                  Show all {orderedConversations.length} conversations
                </button>
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
    </PageScaffold>
  );
}
