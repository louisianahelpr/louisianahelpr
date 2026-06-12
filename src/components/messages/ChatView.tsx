import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronsDown, Flag, AlertTriangle, MessageSquare, Trash2, MoreVertical, Loader2, Ban, RotateCw, X, Lock, BellOff, Bell } from "lucide-react";
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
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium } from "@/lib/haptics";
import { MessageActionSheet } from "./MessageActionSheet";
import { cn } from "@/lib/utils";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColor } from "@/lib/statusColors";
import { FirstMessageChips } from "./FirstMessageChips";
import { MuteSheet } from "./MuteSheet";
import { snoozeRemainingLabel } from "@/lib/threadMutes";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import type { Conversation, Message } from "./types";
import type { JobSystemEvent } from "@/lib/jobSystemEvents";

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
          className="max-w-full max-h-64 object-contain rounded-ds-sm cursor-pointer hover:opacity-90 transition-opacity"
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
    attachment?: { path: string; mime: string; size: number; duration?: number },
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
  /** Toggle the muted state of the open thread. Mute is per-user and
   *  silences push only — the conversation stays visible and the unread
   *  badge still increments (matches iMessage's "Hide Alerts"). */
  onToggleMute: (convo: Conversation) => void;
  /** Set a snooze for the open thread until a caller-supplied future
   *  time. `null` mutes forever. Used by the MuteSheet picker. */
  onSnoozeMute: (convo: Conversation, until: Date | null) => void;
  /** Explicit unmute — clears any forever or snoozed mute. */
  onUnmute: (convo: Conversation) => void;
  /** System-event entries derived from the active job's transition
   *  timestamps — rendered as styled centered <div>s interleaved with
   *  the messages so both participants see status changes in the same
   *  scroll. NOT real message rows. */
  jobSystemEvents: JobSystemEvent[];
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
  onToggleMute,
  onSnoozeMute,
  onUnmute,
  jobSystemEvents,
}: ChatViewProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Open the snooze picker for the active thread.
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  // Single-photo lightbox for tapped chat images — keeps the photo inside
  // the app's frosted viewer instead of punting to a system browser tab
  // (window.open in a Capacitor WebView leaves the app).
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  // Message whose long-press action sheet is open (null = closed). One
  // shared sheet for the whole thread, mirroring JobQuickActionSheet.
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
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
  // Live "is the user parked near the newest message" flag, updated by the
  // scroll observer below. Read by the keyboard-open effect so we only
  // re-anchor to the bottom when the user wasn't scrolled up reading
  // history. A ref (not state) so the effect closure always sees the
  // latest value without re-subscribing.
  const nearBottomRef = useRef(true);

  // First unread inbound message — captured ONCE when the conversation
  // opens, BEFORE the openConvo flow optimistically marks rows read.
  // The conversation row's `unread` count tells us how many trailing
  // inbound messages were unread; the first of those is the jump target.
  // Used by the "Jump to new messages" chip when the user is scrolled
  // above the first unread.
  const initialFirstUnreadIdRef = useRef<string | null>(null);
  const initialUnreadCountRef = useRef(0);
  // Snapshot whenever the open conversation changes — the unread count
  // on `activeConvo` is the pre-open count from the inbox refresh.
  useEffect(() => {
    initialFirstUnreadIdRef.current = null;
    initialUnreadCountRef.current = activeConvo.unread ?? 0;
  }, [activeConvo.jobId, activeConvo.otherUserId, activeConvo.unread]);
  // Resolve the first-unread id once messages for this thread arrive. We
  // look at the LAST N inbound (where N == unread count) and take the
  // earliest as the jump target — these are the unread messages the user
  // hasn't seen yet. Subsequent renders skip the lookup until the
  // conversation changes again.
  if (
    initialFirstUnreadIdRef.current === null &&
    initialUnreadCountRef.current > 0 &&
    messages.length > 0 &&
    userId
  ) {
    const inboundFromMe = messages.filter((m) => m.receiver_id === userId);
    const unreadCount = Math.min(
      initialUnreadCountRef.current,
      inboundFromMe.length,
    );
    if (unreadCount > 0) {
      const target = inboundFromMe[inboundFromMe.length - unreadCount];
      initialFirstUnreadIdRef.current = target.id;
    }
  }
  // Tracks whether the first-unread message is currently scrolled off
  // screen (above the viewport). Drives the "Jump to new messages" chip.
  const [firstUnreadOffscreen, setFirstUnreadOffscreen] = useState(false);

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
  // Also tracks whether the first-unread anchor (if any) is above the
  // current viewport, which drives the "Jump to new messages" chip.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToBottom(distFromBottom > 120);
      nearBottomRef.current = distFromBottom <= 120;
      const firstUnreadId = initialFirstUnreadIdRef.current;
      if (firstUnreadId) {
        const node = el.querySelector<HTMLDivElement>(
          `[data-msg-id="${firstUnreadId}"]`,
        );
        if (node) {
          const containerRect = el.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          // "Above the viewport" = its bottom is above the container's top.
          setFirstUnreadOffscreen(nodeRect.bottom < containerRect.top);
        } else {
          setFirstUnreadOffscreen(false);
        }
      } else {
        setFirstUnreadOffscreen(false);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Initial pass once mounted so the chip can appear without requiring
    // a scroll event first (e.g. when the conversation opens scrolled at
    // the top by an external anchor).
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  // Reset the jump button whenever the conversation changes so a stale
  // "scrolled up" state from a previous thread doesn't bleed through.
  useEffect(() => {
    setShowJumpToBottom(false);
    setFirstUnreadOffscreen(false);
  }, [activeConvo.jobId, activeConvo.otherUserId]);

  // Re-anchor to the newest message when the keyboard opens. Tapping the
  // composer raises the keyboard, which adds `keyboardInset` of bottom
  // padding and shrinks the visible thread — without this the latest
  // messages slide up behind the keyboard. We only pull to the bottom if
  // the user was already parked near it (nearBottomRef); if they'd scrolled
  // up to read history, yanking them down would be hostile. Double-rAF so
  // the scroll runs after the padding change has been laid out. We key on
  // the open transition only (>0) — on close the padding shrinks back and
  // the content is already in view.
  const prevKeyboardInsetRef = useRef(keyboardInset);
  useEffect(() => {
    const opened = prevKeyboardInsetRef.current === 0 && keyboardInset > 0;
    prevKeyboardInsetRef.current = keyboardInset;
    if (!opened || !nearBottomRef.current) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [keyboardInset]);

  // Merge messages and system events into a single chronological
  // timeline so a state-change row ("Helper marked complete") sits
  // exactly where it happened relative to the surrounding chat. Each
  // row carries a discriminator (`type`) so the renderer can branch
  // between a real bubble and a styled <div>. System events get
  // hidden behind older-message pagination: only those whose `at` is
  // newer than the oldest loaded message (or all of them when nothing
  // is paginated) are surfaced — keeps the chronological invariant.
  type TimelineItem =
    | { type: "message"; key: string; at: string; message: Message }
    | { type: "system"; key: string; at: string; event: JobSystemEvent }
    | { type: "date"; key: string; at: string; label: string };

  // Format the divider label for a given message timestamp. "Today",
  // "Yesterday", or the locale's short date — read at a glance without
  // the full year noise for current-week messages.
  const dateDividerLabel = (d: Date): string => {
    const now = new Date();
    const startOf = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const today = startOf(now);
    const that = startOf(d);
    const diffDays = Math.round((today - that) / 86_400_000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7)
      return d.toLocaleDateString([], { weekday: "long" });
    if (d.getFullYear() === now.getFullYear())
      return d.toLocaleDateString([], { month: "long", day: "numeric" });
    return d.toLocaleDateString([], {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const timeline: TimelineItem[] = (() => {
    const items: TimelineItem[] = messages.map((m) => ({
      type: "message",
      key: m.clientId ?? m.id,
      at: m.created_at,
      message: m,
    }));
    // Only include system events that fall within the loaded window —
    // anything older than the oldest message stays hidden until the
    // user loads earlier messages (otherwise paginated history would
    // surface system rows out of order at the top of the visible thread).
    if (jobSystemEvents.length > 0) {
      const oldestLoadedAt = messages.length > 0
        ? new Date(messages[0].created_at).getTime()
        : -Infinity;
      const onlyWhenAllLoaded = hasMoreMessages;
      for (const ev of jobSystemEvents) {
        const evMs = new Date(ev.at).getTime();
        // If older messages still exist server-side, only show system
        // events that occurred after the oldest message we have loaded.
        if (onlyWhenAllLoaded && evMs < oldestLoadedAt) continue;
        items.push({
          type: "system",
          key: ev.id,
          at: ev.at,
          event: ev,
        });
      }
    }
    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    // Insert date dividers between items that cross a day boundary so the
    // thread reads as a dated transcript ("Today" / "Yesterday" / a
    // formatted date) rather than an undifferentiated wall of bubbles.
    const dated: TimelineItem[] = [];
    let prevDayKey: string | null = null;
    for (const item of items) {
      const d = new Date(item.at);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKey !== prevDayKey) {
        dated.push({
          type: "date",
          key: `date-${dayKey}`,
          at: item.at,
          label: dateDividerLabel(d),
        });
        prevDayKey = dayKey;
      }
      dated.push(item);
    }
    return dated;
  })();

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
          // Only pad for the keyboard here. The sticky composer already adds
          // its own safe-area-inset-bottom — padding it on the wrapper too
          // double-counts the inset and leaves a dead gap below the composer.
          style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : 0 }}
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
                {/* Muted bell — quiet visual mark that notifications are
                    silenced for this thread. The aria-label upgrades to
                    include the snooze TTL when the mute is time-bound
                    ("Muted for 8h") so screen readers don't just say
                    "muted" for a one-hour snooze. */}
                {activeConvo.isMuted && (() => {
                  const remaining = snoozeRemainingLabel(activeConvo.muteUntil ?? null);
                  return (
                    <BellOff
                      className="w-3 h-3 shrink-0"
                      style={{ color: "hsl(var(--olivewood) / 0.55)" }}
                      aria-label={remaining ?? "Muted"}
                    />
                  );
                })()}
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
                {/* Mute / unmute — top item so the most-frequent action
                    is one tap. When unmuted, opens the snooze picker
                    ("1h / 8h / until tomorrow 8 AM / forever"). When
                    already muted, this collapses to a fast unmute. */}
                {activeConvo.isMuted ? (
                  <DropdownMenuItem onClick={() => onToggleMute(activeConvo)}>
                    <Bell className="w-4 h-4 mr-2" /> Unmute notifications
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setMuteSheetOpen(true)}>
                    <BellOff className="w-4 h-4 mr-2" /> Mute notifications…
                  </DropdownMenuItem>
                )}
                <div role="separator" className="my-1 h-px bg-border" />
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
            {!chatLoadError && timeline.length === 0 && (
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
            {timeline.map((item) => {
              if (item.type === "date") {
                // Section divider — quietly anchors the thread to the
                // calendar so scrolling back through long history reads
                // as a dated transcript, not an undifferentiated wall of
                // bubbles. Hairline rules on either side, italic serif
                // label centered between them.
                return (
                  <div
                    key={item.key}
                    role="separator"
                    aria-label={`Date: ${item.label}`}
                    className="flex items-center gap-3 px-2 pt-3 pb-1"
                  >
                    <span
                      aria-hidden="true"
                      className="flex-1 h-px"
                      style={{ background: "hsl(var(--olivewood) / 0.15)" }}
                    />
                    <span
                      className="font-serif italic uppercase tracking-wider whitespace-nowrap"
                      style={{
                        fontSize: "0.62rem",
                        letterSpacing: "0.16em",
                        color: "hsl(var(--olivewood) / 0.65)",
                      }}
                    >
                      {item.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-1 h-px"
                      style={{ background: "hsl(var(--olivewood) / 0.15)" }}
                    />
                  </div>
                );
              }
              if (item.type === "system") {
                // System messages — styled centered <div>, NOT a real
                // message row. Reads as "the app speaking" rather than
                // either participant. Compact pill so it doesn't dominate
                // the surrounding chat.
                const ev = item.event;
                return (
                  <div key={item.key} className="flex justify-center py-1">
                    <div
                      role="note"
                      aria-label={`System update: ${ev.label}`}
                      className="max-w-[80%] px-3 py-1.5 rounded-full text-center"
                      style={{
                        background: "hsl(var(--ivory-sand) / 0.55)",
                        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                        boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6)",
                      }}
                    >
                      <p
                        className="font-serif italic text-[0.74rem] leading-snug"
                        style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                      >
                        {ev.label}
                      </p>
                      <p
                        className="font-sans uppercase tracking-wider mt-0.5"
                        style={{
                          fontSize: "8.5px",
                          letterSpacing: "0.12em",
                          color: "hsl(var(--olivewood) / 0.5)",
                        }}
                      >
                        {new Date(ev.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                      </p>
                    </div>
                  </div>
                );
              }
              const m = item.message;
              return (
                <MessageBubble
                  key={item.key}
                  m={m}
                  mine={m.sender_id === userId}
                  activeConvo={activeConvo}
                  retryMessage={retryMessage}
                  setLightboxPhoto={setLightboxPhoto}
                  onReport={(id) => setReportTarget({ type: "message", id })}
                  onDelete={setDeleteMessageConfirm}
                  onLongPress={setActionMessage}
                />
              );
            })}
            {isOtherTyping && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
          </PullToRefreshWrapper>

          {/* Jump-to-new-messages / jump-to-newest button.
              When the user is scrolled above the first unread inbound
              message, the chip targets that message and counts the
              unread tail ("3 new messages"). Otherwise — once they've
              scrolled past the unread anchor — it falls back to the
              "newest message" jump so they can get back to the bottom
              without scrolling manually. Hidden on empty threads. */}
          {(firstUnreadOffscreen || showJumpToBottom) && messages.length > 0 && (
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
                aria-label={
                  firstUnreadOffscreen
                    ? `Jump to ${initialUnreadCountRef.current} new message${initialUnreadCountRef.current === 1 ? "" : "s"}`
                    : "Jump to newest message"
                }
                onClick={() => {
                  const el = scrollContainerRef.current;
                  if (!el) return;
                  const firstUnreadId = initialFirstUnreadIdRef.current;
                  if (firstUnreadOffscreen && firstUnreadId) {
                    const node = el.querySelector<HTMLDivElement>(
                      `[data-msg-id="${firstUnreadId}"]`,
                    );
                    if (node) {
                      node.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                      return;
                    }
                  }
                  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                }}
              >
                <ChevronsDown className="w-3 h-3" />
                {firstUnreadOffscreen
                  ? `${initialUnreadCountRef.current} new message${initialUnreadCountRef.current === 1 ? "" : "s"}`
                  : "New messages"}
              </button>
            </div>
          )}

          {composerLocked ? (
            /* Poster-first lock — the applicant waits for the poster to
               open the conversation. Replaces chips + quick replies +
               composer so there's no disabled control to fight with. The
               backend RLS policy enforces the same rule server-side. */
            <div
              className="pt-2 pb-3 glass-header sticky bottom-0"
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

              {/* Quick replies — most chips populate the composer; the
                  status-aware smart-reply chips ("On my way", "Running
                  5 min late", "Done", from #15) fire on tap so an
                  active-job logistics update is one tap, not three.
                  `jobStatus` drives which smart-reply set (if any) is
                  prepended. */}
              <div className="pt-1">
                <QuickReplies
                  onSelect={(msg) => setDraft(msg)}
                  onSend={(msg) => { void sendMessage(msg); }}
                  audience={activeConvo?.viewerIsPoster ? "poster" : "helper"}
                  jobStatus={activeConvo.jobStatus}
                />
              </div>

              {/* Rich message input */}
              <div
                className="pt-2 pb-3 glass-header sticky bottom-0"
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

      {/* Snooze picker — opens from the header dropdown. Mounted at the
          shell level so it overlays both the chat body and the composer. */}
      <MuteSheet
        open={muteSheetOpen}
        onOpenChange={setMuteSheetOpen}
        convo={muteSheetOpen ? activeConvo : null}
        onSnoozeMute={onSnoozeMute}
        onUnmute={onUnmute}
      />

      {/* Long-press action sheet for a chat bubble — Copy plus Report
          (inbound) or Delete (own). One shared sheet, opened with the
          target message. */}
      <MessageActionSheet
        message={actionMessage}
        mine={actionMessage?.sender_id === userId}
        onClose={() => setActionMessage(null)}
        onReport={(id) => setReportTarget({ type: "message", id })}
        onDelete={setDeleteMessageConfirm}
      />
    </AppShell>
  );
}

/**
 * A single chat message row: the styled bubble (with attachment / photo /
 * location rendering) plus the meta row (timestamp, read receipt, and the
 * inline report/delete affordance). Extracted from the thread map so each
 * row can own a `useLongPress` (hooks can't run inside a map) — a long
 * press opens the shared MessageActionSheet via `onLongPress`.
 */
function MessageBubble({
  m,
  mine,
  activeConvo,
  retryMessage,
  setLightboxPhoto,
  onReport,
  onDelete,
  onLongPress,
}: {
  m: Message;
  mine: boolean;
  activeConvo: Conversation;
  retryMessage: (clientId: string) => void;
  setLightboxPhoto: (url: string | null) => void;
  onReport: (id: string) => void;
  onDelete: (id: string) => void;
  onLongPress: (m: Message) => void;
}) {
  const isSending = m.sendStatus === "sending";
  const isFailed = m.sendStatus === "failed";
  // Only settled messages get a long-press menu — there's nothing to
  // copy/report/delete on an in-flight or failed row.
  const actionable = !isSending && !isFailed;
  const longPress = useLongPress({
    onLongPress: () => {
      if (!actionable) return;
      void hapticMedium();
      onLongPress(m);
    },
  });
  const pressHandlers = actionable ? longPress : {};

  return (
    <div
      data-msg-id={m.id}
      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
    >
      <div
        {...pressHandlers}
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
            duration={m.attachment_duration}
            mine={mine}
          />
        )}
        {m.content && renderMessageContent(m.content, setLightboxPhoto)}
      </div>
      {/* Meta row — timestamp / read-receipt plus the report (inbound) or
          delete (own) affordance. Kept BELOW the bubble, never overlaid on
          the copy, so the icon can't sit on top of the message text. Faded
          on touch (no hover) so it stays discoverable without dominating
          every row. */}
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
                onClick={() => onReport(m.id)}
                className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center w-5 h-5 rounded-full"
                title="Report"
                aria-label="Report message"
              >
                <Flag className="w-2.5 h-2.5" />
              </button>
            )}
            {mine && (
              <button
                onClick={() => onDelete(m.id)}
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
}
