import { useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { MessageActionSheet } from "./MessageActionSheet";
import { MuteSheet } from "./MuteSheet";
import { ChatHeader } from "./ChatHeader";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import type { Conversation, Message } from "./types";
import type { JobSystemEvent } from "@/lib/jobSystemEvents";
import { ChatPaneShell } from "./chatView/ChatPaneShell";
import { ChatTimeline } from "./chatView/ChatTimeline";
import { useMessageReactions } from "./useMessageReactions";
import { ChatComposer } from "./chatView/ChatComposer";
import { JumpToBottomButton } from "./chatView/JumpToBottomButton";
import { useChatScroll } from "./chatView/useChatScroll";
import { useTimestampReveal } from "./chatView/useTimestampReveal";
import {
  buildTimeline,
  resolveLastOwnMessageId,
} from "./chatView/chatViewHelpers";

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
  /** True while a newly-opened conversation's messages are still being
   *  fetched — shows a skeleton instead of a blank window or the
   *  misleading "Say hello." empty state. */
  chatLoading: boolean;
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
  /** When true, render only the chat body (no AppShell / fixed-viewport
   *  lock, no centered max-width column) so the desktop Messages page can
   *  host it as the right pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone shell exactly as before. */
  embedded?: boolean;
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
  chatLoading,
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
  embedded = false,
}: ChatViewProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  // Community-rules banner dismissal — persisted to localStorage so once
  // the user has read & dismissed it, it stays gone across thread switches
  // and app relaunches instead of re-showing on every mount. Mirrors the
  // lazy-init + persist-on-change pattern in usePersistedBrowseView.
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("helpr.chatRulesBannerDismissed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined" || !bannerDismissed) return;
    try {
      window.localStorage.setItem("helpr.chatRulesBannerDismissed", "1");
    } catch {
      // Quota / private mode — silently ignore; in-memory state still works.
    }
  }, [bannerDismissed]);
  // Open the snooze picker for the active thread.
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  // Single-photo lightbox for tapped chat images — keeps the photo inside
  // the app's frosted viewer instead of punting to a system browser tab
  // (window.open in a Capacitor WebView leaves the app).
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  // Message whose long-press action sheet is open (null = closed). One
  // shared sheet for the whole thread, mirroring JobQuickActionSheet.
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  // Tapbacks for the open thread. Scoped by job so the realtime subscription
  // can be filtered server-side (see useMessageReactions).
  const { reactions, react } = useMessageReactions(activeConvo?.jobId ?? null, userId);
  // The message being replied to. Cleared once a reply actually sends (the
  // composer only clears on acceptance, so a blocked message keeps its reply).
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Drag-left-to-see-times. Attached to the thread scroller, and deliberately
  // inert until the gesture is clearly horizontal so vertical scrolling —
  // the primary gesture on this screen — is never stolen.
  const { reveal, handlers: revealHandlers } = useTimestampReveal();
  // Once the user taps any first-message chip the row hides for the rest
  // of this conversation — it's only meant to break the empty-thread
  // ice, not stick around as the chat actually starts.
  const [chipsDismissed, setChipsDismissed] = useState(false);

  // Scroll behavior — the jump-to-newest / first-unread observer, the
  // conversation-change reset, the keyboard-open re-anchor, the
  // pull-to-refresh wiring, and the merged thread ref.
  const {
    scrollContainerRef,
    initialFirstUnreadIdRef,
    initialUnreadCountRef,
    showJumpToBottom,
    firstUnreadOffscreen,
    setThreadRef,
    pullDistance,
    refreshing,
    isPulling,
    canTrigger,
  } = useChatScroll({
    activeConvo,
    messages,
    userId,
    keyboardInset,
    onRefreshThread,
    chatContainerRef,
  });

  // Poster-first rule: an applicant cannot open a job conversation — only
  // the poster may send the first message (stops posters being flooded by
  // applicants). The applicant's composer stays locked until at least one
  // inbound message from the poster exists. The only other participant in
  // a job thread is the poster, so any message we didn't send is theirs.
  const isApplicant = !activeConvo.viewerIsPoster;
  const posterHasMessaged = messages.some((m) => m.sender_id !== userId);
  const composerLocked = isApplicant && !posterHasMessaged;

  // iMessage-style read receipt: only the CURRENT USER's most recent
  // *settled* outbound message carries a "Read"/"Delivered" indicator —
  // not every bubble. Derived from the messages already in state (no new
  // query). We walk from the end and take the first non-system,
  // fully-sent message we sent.
  const lastOwnMessageId: string | null = resolveLastOwnMessageId(messages, userId);

  const timeline = buildTimeline(messages, jobSystemEvents, hasMoreMessages);

  return (
    <ChatPaneShell
      embedded={embedded}
      header={
        <ChatHeader
          activeConvo={activeConvo}
          isOtherOnline={isOtherOnline}
          hideBack={embedded}
          ownsSafeArea={!embedded}
          onBack={() => { setActiveConvo(null); setDraft(""); setLightboxPhoto(null); navigate("/messages", { replace: true }); }}
          onOpenMuteSheet={() => setMuteSheetOpen(true)}
          onToggleMute={onToggleMute}
          onReportUser={() => setReportTarget({ type: "user", id: activeConvo.otherUserId })}
          onBlockUser={() => setBlockTarget({ id: activeConvo.otherUserId, name: activeConvo.otherUserName })}
          onViewProfile={() => navigate(`/user/${activeConvo.otherUserId}`)}
        />
      }
    >
        <div
          className={
            // Embedded (desktop split) the pane can be very wide, so cap the
            // conversation to a natural reading column and center it — bubbles
            // spanning the full pane read as sparse. Standalone already gets a
            // centered max-width column from ChatPaneShell, so no cap here.
            embedded
              ? "flex flex-col flex-1 min-h-0 w-full max-w-[780px] mx-auto transition-[padding] duration-150"
              : "flex flex-col flex-1 min-h-0 transition-[padding] duration-150"
          }
          // Only pad for the keyboard here. The sticky composer already adds
          // its own safe-area-inset-bottom — padding it on the wrapper too
          // double-counts the inset and leaves a dead gap below the composer.
          style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : 0 }}
        >
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
          {/* The reveal handlers live on this plain div, NOT on
              PullToRefreshWrapper: that component destructures a fixed prop
              list and silently drops anything else, so spreading them there
              compiled, rendered, and did nothing. `overflow-x-clip` keeps the
              revealed time column from widening the page while the rows are
              translated left. */}
          <div {...revealHandlers} className="overflow-x-clip">
          <ChatTimeline
            reveal={reveal}
            timeline={timeline}
            userId={userId}
            activeConvo={activeConvo}
            lastOwnMessageId={lastOwnMessageId}
            hasMoreMessages={hasMoreMessages}
            loadingMore={loadingMore}
            loadOlderMessages={loadOlderMessages}
            chatLoadError={chatLoadError}
            chatLoading={chatLoading}
            onRetryLoad={onRetryLoad}
            isOtherTyping={isOtherTyping}
            bottomRef={bottomRef}
            retryMessage={retryMessage}
            setLightboxPhoto={setLightboxPhoto}
            setReportTarget={setReportTarget}
            setDeleteMessageConfirm={setDeleteMessageConfirm}
            setActionMessage={setActionMessage}
            reactions={reactions}
            onReact={react}
          />
          </div>
          </PullToRefreshWrapper>

          <JumpToBottomButton
            firstUnreadOffscreen={firstUnreadOffscreen}
            showJumpToBottom={showJumpToBottom}
            hasMessages={messages.length > 0}
            scrollContainerRef={scrollContainerRef}
            initialFirstUnreadIdRef={initialFirstUnreadIdRef}
            initialUnreadCountRef={initialUnreadCountRef}
          />

          <ChatComposer
            composerLocked={composerLocked}
            chatLoadError={chatLoadError}
            keyboardInset={keyboardInset}
            activeConvo={activeConvo}
            messages={messages}
            userId={userId}
            draft={draft}
            setDraft={setDraft}
            chipsDismissed={chipsDismissed}
            setChipsDismissed={setChipsDismissed}
            sendMessage={sendMessage}
            broadcastTyping={broadcastTyping}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
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

      {/* Long-press action sheet for a chat bubble — Copy plus Report +
          Block (inbound) or Delete (own). One shared sheet, opened with
          the target message. `onBlock` is the SAME handler the ChatHeader
          ⋮ menu fires, so both entry points land in the one page-level
          BlockUserDialog. */}
      <MessageActionSheet
        message={actionMessage}
        mine={actionMessage?.sender_id === userId}
        onClose={() => setActionMessage(null)}
        onReport={(id) => setReportTarget({ type: "message", id })}
        onBlock={() => setBlockTarget({ id: activeConvo.otherUserId, name: activeConvo.otherUserName })}
        onDelete={setDeleteMessageConfirm}
        onReact={react}
        myReaction={actionMessage ? (reactions.get(actionMessage.id)?.mine ?? null) : null}
        onReply={setReplyTo}
      />
    </ChatPaneShell>
  );
}
