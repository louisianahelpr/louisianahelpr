import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronsDown, Flag, AlertTriangle, MessageSquare, Trash2, MoreVertical, Loader2, Ban, RotateCw, X, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { QuickReplies } from "@/components/QuickReplies";
import { RichMessageInput } from "@/components/RichMessageInput";
import { MessageAttachment } from "@/components/MessageAttachment";
import { OnlineIndicator, TypingIndicator, ReadReceipt } from "@/components/ChatPresence";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColor } from "@/lib/statusColors";
import { FirstMessageChips } from "./FirstMessageChips";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import type { Conversation, Message } from "./types";

const renderMessageContent = (content: string, onImageClick: (url: string) => void) => {
  // Photo message
  if (content.startsWith("📷 ")) {
    const parts = content.slice(2).trim().split("\n");
    const url = parts[0].trim();
    const caption = parts.slice(1).join("\n").trim();
    return (
      <div className="space-y-1">
        <img
          loading="lazy"
          decoding="async"
          src={url}
          alt="Shared photo"
          className="max-w-full rounded-ds-sm cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => onImageClick(url)}
        />
        {caption && <p>{caption}</p>}
      </div>
    );
  }
  // Location message
  if (content.startsWith("📍 Location:")) {
    const url = content.replace("📍 Location: ", "");
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 underline hover:no-underline"
      >
        📍 View location on map
      </a>
    );
  }
  return <p>{content}</p>;
};

interface ChatViewProps {
  /** The open conversation — this component only renders inside the
   *  activeConvo branch, so it is always non-null. */
  activeConvo: Conversation;
  setActiveConvo: Dispatch<SetStateAction<Conversation | null>>;
  /** Soft-keyboard inset (px) so the composer clears the keyboard. */
  keyboardInset: number;
  /** Presence — from the page's useChatPresence hook. */
  isOtherOnline: boolean;
  isOtherTyping: boolean;
  broadcastTyping: () => void;
  messages: Message[];
  userId: string | null;
  /** True when the thread fetch failed — shows a recoverable error
   *  state instead of the misleading "Say hello." empty state. */
  chatLoadError: boolean;
  /** Re-runs the thread fetch for the open conversation. */
  onRetryLoad: () => void;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => void;
  /** Pull-to-refresh handler — re-fetches the latest page of the open
   *  thread. Resolves once the refetch completes. */
  onRefreshThread: () => Promise<void>;
  /** Sends a message. Resolves `true` when accepted for delivery,
   *  `false` when blocked by the content scan — the composer keeps the
   *  typed text on `false` so a blocked message isn't silently lost. */
  sendMessage: (
    content: string,
    attachment?: { path: string; mime: string; size: number },
  ) => Promise<boolean>;
  /** Re-dispatch a previously failed optimistic message by its clientId. */
  retryMessage: (clientId: string) => void;
  /** Scroll container + bottom sentinel — created by the page so its
   *  realtime/scroll handlers can read them; attached to nodes here. */
  chatContainerRef: Ref<HTMLDivElement>;
  bottomRef: Ref<HTMLDivElement>;
  setReportTarget: Dispatch<SetStateAction<{ type: "message" | "user"; id: string } | null>>;
  setBlockTarget: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setDeleteMessageConfirm: Dispatch<SetStateAction<string | null>>;
}

/**
 * ChatView — the active-conversation surface of the Messages page: the
 * chat header (avatar / status chip / options), the community-rules
 * banner, the scrolling message thread (with attachments, read
 * receipts, typing indicator), and the quick-reply + composer dock.
 *
 * Extracted verbatim from Messages.tsx (a step in splitting that file)
 * — the JSX is unchanged. The draft + banner-dismissed state are purely
 * local to this surface, so they live here rather than being threaded
 * down as props.
 */
export function ChatView({
  activeConvo,
  setActiveConvo,
  keyboardInset,
  isOtherOnline,
  isOtherTyping,
  broadcastTyping,
  messages,
  userId,
  chatLoadError,
  onRetryLoad,
  hasMoreMessages,
  loadingMore,
  loadOlderMessages,
  onRefreshThread,
  sendMessage,
  retryMessage,
  chatContainerRef,
  bottomRef,
  setReportTarget,
  setBlockTarget,
  setDeleteMessageConfirm,
}: ChatViewProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Single-photo lightbox for tapped chat images — keeps the photo inside
  // the app's frosted viewer instead of punting to a system browser tab
  // (window.open in a Capacitor WebView leaves the app).
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  // Once the user taps any first-message chip the row hides for the rest
  // of this conversation — it's only meant to break the empty-thread
  // ice, not stick around as the chat actually starts.
  const [chipsDismissed, setChipsDismissed] = useState(false);
  // Tracks whether the user is scrolled far enough from the bottom that
  // we should show a "jump to newest" affordance. `true` = show button.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // Stable ref to the scroll container for the jump handler and the
  // scroll-position observer.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Poster-first rule: an applicant cannot open a job conversation — only
  // the poster may send the first message (stops posters being flooded by
  // applicants). The applicant's composer stays locked until at least one
  // inbound message from the poster exists. The only other participant in
  // a job thread is the poster, so any message we didn't send is theirs.
  const isApplicant = !activeConvo.viewerIsPoster;
  const posterHasMessaged = messages.some((m) => m.sender_id !== userId);
  const composerLocked = isApplicant && !posterHasMessaged;

  // Pull-to-refresh for the chat thread — reuses the same hook +
  // wrapper every other scrollable surface uses. The hook owns its own
  // `containerRef`; the page also needs a handle on the scroll node
  // (for scroll-position preservation when loading older messages), so
  // a merged callback ref points both at the single thread element.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } =
    usePullToRefresh({ onRefresh: onRefreshThread });

  const setThreadRef = useCallback(
    (node: HTMLDivElement | null) => {
      // The hook ref is typed read-only; it is a plain useRef under the
      // hood, so assigning through a mutable cast is safe here.
      (containerRef as { current: HTMLDivElement | null }).current = node;
      if (typeof chatContainerRef === "function") {
        chatContainerRef(node);
      } else if (chatContainerRef) {
        (chatContainerRef as { current: HTMLDivElement | null }).current = node;
      }
      // Keep our own stable reference for the jump-to-bottom handler.
      scrollContainerRef.current = node;
    },
    [containerRef, chatContainerRef],
  );

  // Track scroll position to show/hide the jump-to-newest button.
  // 120px from the bottom is the threshold — any further up and the
  // button appears so the user can get back without scrolling manually.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToBottom(distFromBottom > 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Reset the jump button whenever the conversation changes so a stale
  // "scrolled up" state from a previous thread doesn't bleed through.
  useEffect(() => {
    setShowJumpToBottom(false);
  }, [activeConvo.jobId, activeConvo.otherUserId]);

  return (
    // Fixed-viewport lock + safe-area-top header inset come from AppShell,
    // the single shell primitive. `scrollable={false}` because the chat
    // body manages its own scroll (chatContainerRef); the message input
    // bleeds to the safe-area bottom rather than reserving dock space.
    <AppShell
      header={<DashboardHeader />}
      scrollable={false}
      reserveBottomNav={false}
      className="bg-premium-page"
    >
      <main className="container mx-auto px-5 lg:px-8 xl:px-12 pt-0 flex-1 min-h-0 flex flex-col">
        <div className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex-1 min-h-0 flex flex-col">
        <div
          className="flex flex-col flex-1 min-h-0 transition-[padding] duration-150"
          style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : "env(safe-area-inset-bottom)" }}
        >
          {/* Chat header — compact, vertically centered. Avatar uses
              the other user's photo when available, name is brand-
              display italic, and a small status chip surfaces where
              the job currently stands so both sides have shared
              context without scrolling back. */}
          <div className="flex items-center gap-2.5 py-2 -mx-4 px-4 border-b border-border bg-card">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-9 w-9 shrink-0 self-center"
              onClick={() => { setActiveConvo(null); setDraft(""); setLightboxPhoto(null); navigate("/messages", { replace: true }); }}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center shrink-0 self-center overflow-hidden",
                // When no profile photo is set, the warm hashed gradient
                // (keyed off `otherUserId`) replaces the flat bark tint so
                // the chat partner has a stable visual identity. The
                // `<img>` overlay covers the gradient when a photo is set.
                !activeConvo.otherUserAvatarUrl &&
                  cn("bg-gradient-to-br", avatarGradientFor(activeConvo.otherUserId)),
              )}
              style={{
                border: "1px solid hsl(var(--bark) / 0.22)",
              }}
            >
              {activeConvo.otherUserAvatarUrl ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={activeConvo.otherUserAvatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span
                  className="text-ds-13 font-bold drop-shadow-sm"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {activeConvo.otherUserName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden self-center">
              <p
                className="font-display italic font-bold leading-tight truncate flex items-center gap-1.5"
                style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                <span className="truncate">{activeConvo.otherUserName}</span>
                <OnlineIndicator isOnline={isOtherOnline} />
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-ds-11 truncate leading-tight font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  {activeConvo.jobTitle}
                </p>
                {activeConvo.jobStatus && (() => {
                  const status = activeConvo.jobStatus;
                  // Colors come from the canonical `jobStatusColor` map
                  // (see `src/lib/statusColors.ts`) so the chat header
                  // pill paints identically to every other status chip
                  // in the app. Labels come from `jobStatusLabel` (#46).
                  //
                  // `assigned` isn't in the job_status enum — it's a
                  // legacy conversation alias for the offered-not-yet-
                  // confirmed window. Keep its bespoke "Awarded" copy
                  // and route its color through the sienna-tinted
                  // `in_progress` slot so it reads as "in motion".
                  const palette =
                    status === "assigned"
                      ? jobStatusColor("in_progress")
                      : jobStatusColor(status);
                  const label =
                    status === "assigned" ? "Awarded" : jobStatusLabel(status);
                  return (
                    <span
                      className="text-[9px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ color: palette.text, backgroundColor: palette.bg, letterSpacing: "0.08em" }}
                    >
                      {label}
                    </span>
                  );
                })()}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-2 rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0 self-center"
                  aria-label="Conversation options"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setReportTarget({ type: "user", id: activeConvo.otherUserId })}>
                  <Flag className="w-4 h-4 mr-2" /> Report user
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockTarget({ id: activeConvo.otherUserId, name: activeConvo.otherUserName })}>
                  <Ban className="w-4 h-4 mr-2" /> Block user
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Community rules banner — compact */}
          {!bannerDismissed && (
            <div className="rounded-md bg-accent/10 border border-accent/20 px-2.5 py-1.5 mt-2 mb-1 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 text-accent mt-[3px] shrink-0" />
              <p className="text-ds-11 leading-snug text-accent flex-1">
                Keep chats &amp; payments on Helpr. Sharing contact info or going off-platform = warning, then permanent ban.
              </p>
              <button onClick={() => setBannerDismissed(true)} className="-m-2 p-2 text-accent/60 hover:text-accent shrink-0 self-start" aria-label="Dismiss">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Message thread — `aria-live="polite"` so screen readers
              announce inbound messages as they arrive without stealing
              focus. Wrapped in PullToRefreshWrapper so a downward swipe
              re-fetches the thread, matching every other surface. */}
          <PullToRefreshWrapper
            ref={setThreadRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 space-y-3 pt-4 pb-2"
          >
          <div aria-live="polite" aria-relevant="additions" className="space-y-3">
            {hasMoreMessages && (
              <div className="text-center py-2">
                <button onClick={loadOlderMessages} disabled={loadingMore} className="text-ds-11 text-primary font-medium hover:underline disabled:opacity-50 flex items-center gap-1.5 mx-auto">
                  {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
                  {loadingMore ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}
            {/* Failed thread fetch — recoverable error state. Shown
                instead of the "Say hello." empty state so a network
                failure never masquerades as an empty conversation. */}
            {chatLoadError && (
              <div className="flex flex-col items-center text-center py-14 gap-3">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: "hsl(var(--destructive) / 0.1)",
                    border: "1px solid hsl(var(--destructive) / 0.2)",
                  }}
                >
                  <AlertTriangle className="w-6 h-6" style={{ color: "hsl(var(--destructive))" }} strokeWidth={1.75} />
                </div>
                <div className="space-y-1">
                  <p
                    className="font-display italic font-bold"
                    style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                  >
                    Couldn't load this conversation.
                  </p>
                  <p
                    className="font-serif italic text-[0.82rem] max-w-[260px]"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Tap Retry. If it sticks, our end is having a hiccup —
                    not yours.
                  </p>
                </div>
                <Button variant="outline" size="sm" className="rounded-full" onClick={onRetryLoad}>
                  <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                  Retry
                </Button>
              </div>
            )}
            {!chatLoadError && messages.length === 0 && (
              <div className="flex flex-col items-center text-center py-14 gap-3">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                    border: "1px solid hsl(var(--olivewood) / 0.10)",
                    boxShadow:
                      "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                      "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                      "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                  }}
                >
                  <MessageSquare className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                </div>
                <div className="space-y-1">
                  <p
                    className="font-display italic font-bold"
                    style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                  >
                    Say hello.
                  </p>
                  <p
                    className="font-serif italic text-[0.82rem] max-w-[260px]"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Send the first message to get the job moving.
                  </p>
                </div>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === userId;
              const isSending = m.sendStatus === "sending";
              const isFailed = m.sendStatus === "failed";
              return (
                <div key={m.clientId ?? m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-ds-13 group relative space-y-2 transition-opacity ${
                      mine ? "rounded-br-md" : "rounded-bl-md"
                    } ${isSending ? "opacity-60" : ""}`}
                    style={mine ? {
                      // "Mine" bubble — bark with subtle inner highlight + soft shadow
                      // for a tactile, brand-aligned feel (vs. flat primary fill).
                      background: "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.92) 100%)",
                      color: "hsl(var(--parchment))",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.15), " +
                        "0 1px 2px hsl(var(--bark) / 0.18), " +
                        "0 6px 14px -6px hsl(var(--bark) / 0.32)",
                    } : {
                      // "Theirs" bubble — translucent parchment with a hairline border
                      // so it reads as an inbound card without looking gray-on-gray.
                      backgroundColor: "hsla(0, 0%, 100%, 0.78)",
                      color: "hsl(var(--ink-deep))",
                      border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
                        "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                        "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    {m.attachment_url && m.attachment_mime && (
                      <MessageAttachment
                        path={m.attachment_url}
                        mime={m.attachment_mime}
                        size={m.attachment_size}
                        mine={mine}
                      />
                    )}
                    {m.content && renderMessageContent(m.content, setLightboxPhoto)}
                  </div>
                  {/* Meta row — timestamp / read-receipt plus the
                      report (inbound) or delete (own) affordance. Kept
                      BELOW the bubble, never overlaid on the copy, so the
                      icon can't sit on top of the message text. Faded on
                      touch (no hover) so it stays discoverable without
                      dominating every row. */}
                  <div className={`flex items-center gap-1 mt-1 px-1 text-ds-10 text-muted-foreground ${mine ? "flex-row-reverse" : ""}`}>
                    {isSending ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        Sending…
                      </span>
                    ) : isFailed ? (
                      <button
                        type="button"
                        onClick={() => m.clientId && retryMessage(m.clientId)}
                        className="flex items-center gap-1 text-destructive font-medium hover:underline"
                        title="Retry sending"
                      >
                        <RotateCw className="w-2.5 h-2.5" />
                        Not sent — tap to retry
                      </button>
                    ) : (
                      <>
                        <span>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                        </span>
                        <ReadReceipt
                          read={m.read}
                          sentByMe={mine}
                          recipientName={activeConvo?.otherUserName}
                          recipientAvatarUrl={activeConvo?.otherUserAvatarUrl}
                        />
                        {!mine && (
                          <button
                            onClick={() => setReportTarget({ type: "message", id: m.id })}
                            className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center w-5 h-5 rounded-full"
                            title="Report"
                            aria-label="Report message"
                          >
                            <Flag className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {mine && (
                          <button
                            onClick={() => setDeleteMessageConfirm(m.id)}
                            className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center w-5 h-5 rounded-full"
                            title="Delete"
                            aria-label="Delete message"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {isOtherTyping && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
          </PullToRefreshWrapper>

          {/* Jump-to-newest button — appears when the user is scrolled
              more than 120px from the bottom. Tapping it smoothly
              scrolls the thread back to the latest message so they
              don't miss new arrivals. Hidden on empty threads. */}
          {showJumpToBottom && messages.length > 0 && (
            <div className="flex justify-center -mt-1 mb-1 pointer-events-none">
              <button
                type="button"
                className="pointer-events-auto flex items-center gap-1 px-3 py-1 rounded-full text-ds-11 font-medium shadow-md transition-all active:scale-95"
                style={{
                  background: "hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  boxShadow:
                    "0 2px 8px hsl(var(--bark) / 0.28), " +
                    "inset 0 1px 0 0 rgba(255,255,255,0.12)",
                }}
                aria-label="Jump to newest message"
                onClick={() => {
                  scrollContainerRef.current?.scrollTo({
                    top: scrollContainerRef.current.scrollHeight,
                    behavior: "smooth",
                  });
                }}
              >
                <ChevronsDown className="w-3 h-3" />
                New messages
              </button>
            </div>
          )}

          {composerLocked ? (
            /* Poster-first lock — the applicant waits for the poster to
               open the conversation. Replaces chips + quick replies +
               composer so there's no disabled control to fight with. The
               backend RLS policy enforces the same rule server-side. */
            <div
              className="pt-2 pb-3 border-t border-border sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
              style={{ paddingBottom: keyboardInset > 0 ? "8px" : "env(safe-area-inset-bottom, 12px)" }}
            >
              <div
                className="flex items-start gap-2.5 rounded-ds-md px-3.5 py-3"
                style={{
                  background: "hsl(var(--gold-warm) / 0.10)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.30)",
                }}
              >
                <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna) / 0.8)" }} strokeWidth={2} aria-hidden="true" />
                <p className="font-serif italic text-[0.84rem] leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                  Your application's in. The poster will reach out here if they're interested — you'll be able to reply as soon as they do.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* First-message chips — three ice-breaker suggestions shown
                  ONLY when the thread is brand-new (zero messages) and the
                  user hasn't already picked one this session. Dismissed
                  after one tap so a fresh thread doesn't keep nudging the
                  user once they've started typing. */}
              {!chatLoadError && messages.length === 0 && !chipsDismissed && (
                <FirstMessageChips
                  viewerRole={activeConvo.viewerIsPoster ? "customer" : "helper"}
                  onPick={(text) => {
                    setDraft(text);
                    setChipsDismissed(true);
                  }}
                />
              )}

              {/* Quick replies — populate the input instead of sending instantly */}
              <div className="pt-1">
                <QuickReplies
                  onSelect={(msg) => setDraft(msg)}
                  audience={activeConvo?.viewerIsPoster ? "poster" : "helper"}
                />
              </div>

              {/* Rich message input */}
              <div
                className="pt-2 pb-3 border-t border-border sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
                style={{ paddingBottom: keyboardInset > 0 ? "8px" : "env(safe-area-inset-bottom, 12px)" }}
              >
                <RichMessageInput
                  value={draft}
                  onChange={setDraft}
                  onSend={async (content, attachment) => {
                    // RichMessageInput clears its (controlled) text right
                    // after onSend returns. If the content scan in the page
                    // blocks the message (`sendMessage` resolves `false`),
                    // restore the typed text so a blocked message isn't
                    // silently lost — the user keeps what they wrote and a
                    // toast explains why it didn't send.
                    const accepted = await sendMessage(content, attachment);
                    if (!accepted && content.trim()) setDraft(content);
                  }}
                  onTyping={broadcastTyping}
                  jobId={activeConvo.jobId}
                  senderId={userId || undefined}
                />
              </div>
            </>
          )}
        </div>
        </div>
      </main>
      <PhotoLightbox
        photos={lightboxPhoto ? [lightboxPhoto] : []}
        lightboxIndex={lightboxPhoto ? 0 : null}
        setLightboxIndex={(value) => {
          const next = typeof value === "function" ? value(lightboxPhoto ? 0 : null) : value;
          if (next === null) setLightboxPhoto(null);
        }}
      />
    </AppShell>
  );
}
