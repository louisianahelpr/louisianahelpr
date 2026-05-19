import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { ConversationSkeleton } from "@/components/SkeletonLoaders";
import { VirtualList } from "@/components/VirtualList";
import { ConversationRow } from "./ConversationRow";
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
}: ConversationListProps) {
  const navigate = useNavigate();
  const [showAllConvos, setShowAllConvos] = useState(false);

  // Pull-to-refresh: swiping down on the list re-runs loadConversations.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  return (
    <PageScaffold
      header={<DashboardHeader />}
      titleCard={
          <div className="flex flex-col leading-none">
            <h1
              className="font-display font-bold leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Messages
            </h1>
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
          </div>
      }
    >
          {/* Inner header — eyebrow + title row mirroring the
              Posts/Jobs bottom-box header pattern. */}
          <div
            className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
          >
            <div className="flex flex-col leading-none">
              <span
                className="font-serif italic tracking-[0.18em] uppercase text-[0.62rem]"
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
                body="Apply to a task or accept a helpr's offer — your conversations will land here."
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
                <ConversationSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const visibleConvos = showAllConvos ? conversations : conversations.slice(0, CONVO_LIMIT);
                return (
                  <VirtualList
                    items={visibleConvos}
                    getKey={(c) => `${c.jobId}_${c.otherUserId}`}
                    estimateSize={104}
                    overscan={6}
                    itemClassName="pb-2"
                    renderItem={(c) => (
                      <ConversationRow
                        convo={c}
                        openConvo={openConvo}
                        setReportTarget={setReportTarget}
                        setBlockTarget={setBlockTarget}
                        setDeleteConvoConfirm={setDeleteConvoConfirm}
                      />
                    )}
                  />
                );
              })()}
              {!showAllConvos && conversations.length > CONVO_LIMIT && (
                <button onClick={() => setShowAllConvos(true)} className="w-full text-center py-3 text-ds-13 text-primary font-medium hover:underline">
                  Show all {conversations.length} conversations
                </button>
              )}
            </div>
          )}
          </div>
          </PullToRefreshWrapper>
          )}
    </PageScaffold>
  );
}
