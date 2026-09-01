import { useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { MESSAGE_MAX_LENGTH } from "@/lib/messageLimits";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { MessageActionSheet } from "./MessageActionSheet";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
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
  /** Leave the thread and return to the inbox. Owned by the Messages page,
   *  because closing has to clear the `?chat=1` flag from the URL as well as
   *  the state — MobileNav hides the whole bottom dock while that flag is
   *  set, so a close that only nulls the state strands the user on a list
   *  with no navigation. See the contract on CHAT_OPEN_PATH. */
  onCloseThread: () => void;
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
    replyToId?: string | null,
    opts?: { isLocationShare?: boolean },
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
  /** Persist an edit to a sent message's content. Mirrors the sender-only,
   *  15-minute-window RLS policy — see
   *  supabase/migrations/20260831003117_add_message_editing.sql. */
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
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

/** localStorage key prefix for the per-user community-rules banner dismissal. */
const CHAT_RULES_DISMISSED_KEY = "helpr.chatRulesBannerDismissed";

function readBannerDismissed(key: string | null): boolean {
  if (typeof window === "undefined" || !key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
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
  onCloseThread,
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
  onEditMessage,
  onToggleMute,
  onSnoozeMute,
  onUnmute,
  jobSystemEvents,
  embedded = false,
}: ChatViewProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  // Community-rules banner dismissal — persisted so once the user has read &
  // dismissed it, it stays gone across thread switches and app relaunches
  // instead of shouting on every thread open.
  //
  // Keyed PER USER. The key used to be a bare `helpr.chatRulesBannerDismissed`,
  // which meant one person dismissing it on a shared device silently suppressed
  // the off-platform-payment warning for the next account to sign in — someone
  // who had never seen it. This is a trust-and-safety control, so it is allowed
  // to be quiet for the person who read it and nobody else.
  const bannerKey = userId ? `${CHAT_RULES_DISMISSED_KEY}:${userId}` : null;
  const [bannerDismissed, setBannerDismissed] = useState(() =>
    readBannerDismissed(bannerKey),
  );
  // `userId` is seeded from an effect on the page, so it can arrive a tick
  // after first render — re-read once it does rather than showing the banner
  // to someone who already dismissed it.
  useEffect(() => {
    setBannerDismissed(readBannerDismissed(bannerKey));
  }, [bannerKey]);
  const dismissBanner = () => {
    setBannerDismissed(true);
    if (!bannerKey) return;
    try {
      window.localStorage.setItem(bannerKey, "1");
    } catch {
      // Quota / private mode — silently ignore; in-memory state still works.
    }
  };
  // Open the snooze picker for the active thread.
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  // Single-photo lightbox for tapped chat images — keeps the photo inside
  // the app's frosted viewer instead of punting to a system browser tab
  // (window.open in a Capacitor WebView leaves the app).
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  // Message whose long-press action sheet is open (null = closed). One
  // shared sheet for the whole thread, mirroring JobQuickActionSheet.
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  // Message being edited via the sheet's "Edit" action, plus the draft text
  // for the edit dialog below. Separate from `draft` (the composer's own
  // in-progress text) so opening an edit never clobbers an unsent reply.
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Ticking countdown for the edit dialog, mirroring the server's 15-minute
  // RLS window (see EDIT_WINDOW_MS in MessageActionSheet.tsx and the policy
  // in supabase/migrations/20260831003117_add_message_editing.sql). Without
  // this, a save that straddles the deadline just silently fails server-side
  // with no warning the window was closing.
  const [editSecondsLeft, setEditSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!editingMessage) { setEditSecondsLeft(null); return; }
    const deadline = new Date(editingMessage.created_at).getTime() + 15 * 60 * 1000;
    const tick = () => {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      setEditSecondsLeft(Math.max(remaining, 0));
      if (remaining <= 0) {
        setEditingMessage(null);
        toast.error("The 15-minute edit window closed — that change wasn't saved.");
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [editingMessage]);
  const saveEdit = async () => {
    if (!editingMessage) return;
    if (editDraft.length > MESSAGE_MAX_LENGTH) {
      toast.error(`Messages are limited to ${MESSAGE_MAX_LENGTH.toLocaleString()} characters.`);
      return;
    }
    setSavingEdit(true);
    await onEditMessage(editingMessage.id, editDraft);
    setSavingEdit(false);
    setEditingMessage(null);
  };
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

  // Poster-first rule: a PENDING APPLICANT cannot open a job conversation —
  // only the poster may send the first message (stops posters being flooded by
  // applicants). The applicant's composer stays locked until at least one
  // inbound message from the poster exists. The only other participant in
  // a job thread is the poster, so any message we didn't send is theirs.
  //
  // "Applicant" must mean *applicant*, not merely "not the poster". This
  // deliberately mirrors `public.can_message_in_job`, the WITH CHECK on the
  // `Users can send messages` INSERT policy, which permits three classes:
  // the poster, the assigned/offered helper, and anyone the poster messaged
  // first. Case 2 was previously missing here, so the lock survived
  // acceptance and silenced the hired helper for the rest of the job — while
  // the server would happily have accepted the insert. Keep these in step:
  // the client may never be STRICTER than the RLS policy.
  const isApplicant =
    !activeConvo.viewerIsPoster && !activeConvo.viewerIsAssignedHelper;
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
          /* The inbox stays on screen in the embedded (desktop two-pane)
             layout, so the header drops its status chip — the selected row
             already shows it. */
          inboxVisible={embedded}
          ownsSafeArea={!embedded}
          onBack={() => { setDraft(""); setLightboxPhoto(null); onCloseThread(); }}
          onOpenMuteSheet={() => setMuteSheetOpen(true)}
          onToggleMute={onToggleMute}
          onReportUser={() => setReportTarget({ type: "user", id: activeConvo.otherUserId })}
          onBlockUser={() => setBlockTarget({ id: activeConvo.otherUserId, name: activeConvo.otherUserName })}
          onViewProfile={() => navigate(`/user/${activeConvo.otherUserId}`)}
        />
      }
    >
        <div
          // The pane (embedded desktop split) or the page container
          // (standalone — ChatPaneShell's own wrapper grows up to
          // `2xl:max-w-7xl`, 1280px, sized for generic wide-page content, not
          // a conversation) can both be much wider than a comfortable reading
          // column, so this cap applies in BOTH cases: bubbles and the
          // composer spanning near-full width read as sparse/oversized
          // ("the bottom bar does not fit correctly" — the composer visibly
          // outgrowing a normal chat's proportions on a wide standalone
          // screen was this exact bug).
          className="flex flex-col flex-1 min-h-0 w-full max-w-[780px] mx-auto transition-[padding] duration-150"
          // Only pad for the keyboard here. The sticky composer already adds
          // its own safe-area-inset-bottom — padding it on the wrapper too
          // double-counts the inset and leaves a dead gap below the composer.
          style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : 0 }}
        >
          {/* The standalone (phone / native) chat screen replaces the app
              chrome with the conversation's own header, so it leaves the page
              with no <h1> at all — a screen reader landing here was told
              nothing about where "here" is. The visible title is the name pill
              in ChatHeader, but that is a <button>, whose content model is
              phrasing-only and cannot legally hold a heading. So the heading
              is carried separately and silently. Embedded (desktop split) the
              page already has its one <h1> from PageScaffold. */}
          {!embedded && (
            <h1 className="sr-only">
              Conversation with {activeConvo.otherUserName}
            </h1>
          )}

          {/* Community rules banner — compact */}
          {!bannerDismissed && (
            <div className="rounded-md bg-accent/10 border border-accent/20 px-2.5 py-1.5 mt-2 mb-1 relative flex items-start gap-1.5 pr-11">
              <AlertTriangle className="w-3 h-3 text-accent mt-[3px] shrink-0" />
              <p className="text-ds-11 leading-snug text-accent">
                Keep chats &amp; payments on Helpr — going off-platform risks an account restriction.
              </p>
              {/* Absolutely positioned so the 44px hit target doesn't force the
                  compact banner to expand to 44px in height. The button is
                  vertically centred inside the banner; overflow: visible (the
                  default) means any slight bleed above/below is fine. */}
              <button
                onClick={dismissBanner}
                className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[44px] min-w-[44px] text-accent/60 hover:text-accent"
                aria-label="Dismiss safety reminder"
              >
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
            className="flex-1 flex flex-col space-y-3 pt-4 pb-2"
          >
          {/* The reveal handlers live on this plain div, NOT on
              PullToRefreshWrapper: that component destructures a fixed prop
              list and silently drops anything else, so spreading them there
              compiled, rendered, and did nothing. `overflow-x-clip` keeps the
              revealed time column from widening the page while the rows are
              translated left. */}
          {/* `mt-auto` / `my-auto` anchor the timeline to the BOTTOM of the
              scroller (or centre it while the thread is empty) instead of the
              top. A three-message thread used to sit pinned under the header
              with a ~400px void between the last bubble and the composer,
              which is what made the dock read as a panel floating in dead
              space. Auto margins collapse to 0 the moment the content is
              taller than the scroller, so a real thread scrolls exactly as
              before. */}
          <div
            {...revealHandlers}
            className={`overflow-x-clip ${timeline.length === 0 ? "my-auto" : "mt-auto"}`}
          >
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
            composerLocked={composerLocked}
            onRetryLoad={onRetryLoad}
            isOtherTyping={isOtherTyping}
            bottomRef={bottomRef}
            retryMessage={retryMessage}
            setLightboxPhoto={setLightboxPhoto}
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
        onEdit={(m) => { setEditDraft(m.content); setEditingMessage(m); }}
        onReact={react}
        myReaction={actionMessage ? (reactions.get(actionMessage.id)?.mine ?? null) : null}
        onReply={setReplyTo}
      />

      {/* Edit dialog — opened from the action sheet's "Edit" row. A plain
          textarea rather than reusing ChatComposer: editing replaces a
          sent message in place, it doesn't attach/reply/send a new one,
          so the composer's send-pipeline machinery doesn't apply here. */}
      <BrandConfirmDialog
        open={!!editingMessage}
        onOpenChange={(open) => { if (!open) setEditingMessage(null); }}
        title="Edit Message"
        description={
          editSecondsLeft !== null
            ? `Changes are visible to the other person, and the message is marked as edited. Editable for ${
                editSecondsLeft >= 60 ? `${Math.ceil(editSecondsLeft / 60)}m` : `${editSecondsLeft}s`
              } more.`
            : "Changes are visible to the other person, and the message is marked as edited."
        }
        primaryLabel={savingEdit ? "Saving…" : "Save"}
        primaryTone="bark"
        primaryDisabled={savingEdit || !editDraft.trim() || editDraft.length > MESSAGE_MAX_LENGTH}
        primaryHaptic="none"
        onPrimary={(e) => { e.preventDefault(); saveEdit(); }}
        secondaryLabel="Cancel"
      >
        <textarea
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          rows={3}
          autoFocus
          maxLength={MESSAGE_MAX_LENGTH}
          className="w-full rounded-ds-md border px-3 py-2 text-ds-13 font-sans resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          style={{ borderColor: "hsl(var(--olivewood) / 0.2)", background: "hsl(var(--ivory-sand) / 0.5)", color: "hsl(var(--ink-deep))" }}
        />
        {editDraft.length > MESSAGE_MAX_LENGTH * 0.9 && (
          <p
            className="text-ds-10 text-right mt-1"
            style={{ color: editDraft.length > MESSAGE_MAX_LENGTH ? "hsl(var(--destructive))" : "hsl(var(--olivewood) / 0.6)" }}
          >
            {editDraft.length.toLocaleString()} / {MESSAGE_MAX_LENGTH.toLocaleString()}
          </p>
        )}
      </BrandConfirmDialog>
    </ChatPaneShell>
  );
}
