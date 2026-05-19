import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Flag, Ban, Trash2, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { ConversationSkeleton } from "@/components/SkeletonLoaders";
import { VirtualList } from "@/components/VirtualList";
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
                    renderItem={(c) => {
                      // Relative time so the list reads as "active",
                      // not as a stack of full dates.
                      const ageMs = Date.now() - new Date(c.lastAt).getTime();
                      const ageMin = Math.floor(ageMs / 60000);
                      const ageHr = Math.floor(ageMin / 60);
                      const ageDay = Math.floor(ageHr / 24);
                      const when =
                        ageMin < 1 ? "now" :
                        ageMin < 60 ? `${ageMin}m` :
                        ageHr < 24 ? `${ageHr}h` :
                        ageDay < 7 ? `${ageDay}d` :
                        new Date(c.lastAt).toLocaleDateString([], { month: "short", day: "numeric" });
                      // Status chip — short label so it fits inline
                      // next to the job title. Same color logic as
                      // the chat-header status pill.
                      const statusChip = c.jobStatus && (() => {
                        const s = c.jobStatus;
                        if (s === "open") return { label: "Open", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.12)" };
                        if (s === "assigned" || s === "in_progress") return { label: "Awarded", color: "hsl(var(--burnt-sienna))", bg: "hsl(var(--burnt-sienna) / 0.12)" };
                        if (s === "completed") return { label: "Done", color: "hsl(var(--olivewood) / 0.9)", bg: "hsl(var(--olivewood) / 0.10)" };
                        if (s === "cancelled") return { label: "Cancelled", color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.10)" };
                        return null;
                      })();
                      return (
                      <div
                        className="w-full text-left p-3 rounded-ds-md liquid-glass hover:shadow-md transition-shadow flex items-center gap-2.5"
                      >
                        {/* Avatar — uses real photo when available, falls
                            back to bark-tinted initials circle. */}
                        <div
                          className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center overflow-hidden self-center"
                          style={{
                            background: "hsl(var(--bark) / 0.12)",
                            border: "1px solid hsl(var(--bark) / 0.22)",
                          }}
                        >
                          {c.otherUserAvatarUrl ? (
                            <img
                              loading="lazy"
                              decoding="async"
                              src={c.otherUserAvatarUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--bark))" }}>
                              {c.otherUserName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => openConvo(c)}
                          className="flex-1 min-w-0 text-left self-center"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p
                                  className="font-display italic font-bold truncate"
                                  style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                                >
                                  {c.otherUserName}
                                </p>
                                {c.unread > 0 && (
                                  <span
                                    className="shrink-0 px-1.5 h-4 min-w-[1rem] rounded-full text-[0.65rem] font-bold flex items-center justify-center"
                                    style={{
                                      background: "hsl(var(--burnt-sienna))",
                                      color: "hsl(var(--parchment))",
                                    }}
                                  >
                                    {c.unread}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <p
                                  className="text-[0.7rem] truncate font-serif italic"
                                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                                >
                                  {c.jobTitle}
                                </p>
                                {statusChip && (
                                  <span
                                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                                  >
                                    {statusChip.label}
                                  </span>
                                )}
                              </div>
                              <p
                                className="text-[0.78rem] truncate mt-0.5"
                                style={{
                                  color: c.unread > 0 ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.75)",
                                  fontWeight: c.unread > 0 ? 600 : 400,
                                }}
                              >
                                {c.lastMessage || "—"}
                              </p>
                            </div>
                            <span
                              className="text-[0.7rem] shrink-0 self-start whitespace-nowrap"
                              style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                            >
                              {when}
                            </span>
                          </div>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1.5 rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Conversation options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setReportTarget({ type: "user", id: c.otherUserId })}>
                              <Flag className="w-4 h-4 mr-2" /> Report user
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setBlockTarget({ id: c.otherUserId, name: c.otherUserName })}>
                              <Ban className="w-4 h-4 mr-2" /> Block user
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConvoConfirm(c)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete conversation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      );
                    }}
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
