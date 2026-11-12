import "@/lib/i18n/enMessages";
import { t } from "@/lib/i18n/language";
import { Button } from "@/components/ui/button";
import "@/lib/i18n/enScreens";
import { useEffect, useRef, useState } from "react";
import { chatDraftKey, useChatDraft } from "./chatView/useChatDraft";
import type { ChatViewProps } from "./chatView/chatViewProps";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { MESSAGE_MAX_LENGTH } from "@/lib/messageLimits";
import { isThreadClosed, serverNow } from "@/lib/messagingLockout";
import { useRecipientRestricted } from "@/lib/recipientGate";
import { useOffJobState } from "@/lib/offJobGate";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { MessageActionSheet } from "./MessageActionSheet";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { MuteSheet } from "./MuteSheet";
import { ChatHeader } from "./ChatHeader";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import type { Message } from "./types";
import { ChatPaneShell } from "./chatView/ChatPaneShell";
import { ChatTimeline } from "./chatView/ChatTimeline";
import { useMessageReactions } from "./useMessageReactions";
import { ChatComposer } from "./chatView/ChatComposer";
import { JumpToBottomButton } from "./chatView/JumpToBottomButton";
import { useChatScroll } from "./chatView/useChatScroll";
import { useTimestampReveal } from "./chatView/useTimestampReveal";
import { ApplicationNoteCard } from "./chatView/ApplicationNoteCard";
import { buildTimeline, resolveLastOwnMessageId } from "./chatView/chatViewHelpers";
import { CHAT_RULES_DISMISSED_KEY, readBannerDismissed } from "./chatView/chatRulesBanner";
import { DealCard } from "./chatView/DealCard";
import { Textarea } from "@/components/ui/textarea";
import { memberProfilePath } from "@/lib/profileLink/memberProfilePath";

/**
 * The reading column for the safety banner and the message scroller, NOT the composer's (VN-25, owner 09-14). Owner
 * 11-01 (B107, ~1900px: "narrow column, big empty sides"): from lg it is the pane's whole width; the bubbles cap
 * themselves (MessageBubble: 65% of the pane, theirs left, mine right). Phone unchanged (780px, centred).
 */
const CHAT_READING_COLUMN = "w-full max-w-[780px] mx-auto lg:max-w-none";

/**
 * ChatView — the active-conversation surface of the Messages page: the chat
 * header (avatar / status chip / options), the community-rules banner, the
 * scrolling thread (the poster sees the applicant's note at its top, then
 * messages with attachments, read receipts, typing indicator), and the
 * quick-reply + composer dock. Extracted from Messages.tsx; the draft and
 * banner-dismissed state are local to this surface, so they live here.
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
  // F472: the draft survives a reload, kept per chat in this browser.
  const [draft, setDraft] = useChatDraft(chatDraftKey(userId, activeConvo.jobId, activeConvo.otherUserId));
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
  // Opening a thread REPLACES the inbox on screen (Messages.tsx swaps the
  // list for this view), so the row the user pressed is gone and the browser
  // drops focus to <body>: a keyboard user's next Tab starts from the top of
  // the document and a screen reader hears nothing about where it landed
  // (audit, 2026-09-12). Move focus onto the thread's own heading — the
  // standard "new screen" hand-off: the name is announced, and Tab continues
  // from the header (Back is next). Re-run when the thread changes.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (embedded) return;
    headingRef.current?.focus({ preventScroll: true });
  }, [embedded, activeConvo.jobId, activeConvo.otherUserId]);
  // Open the snooze picker for the active thread.
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  // Single-photo lightbox for tapped chat images — keeps the photo inside the app's frosted viewer instead of
  // punting to a system browser tab (window.open in a Capacitor WebView leaves the app).
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
        toast.error(t("chat.editClosed"));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [editingMessage]);
  const saveEdit = async () => {
    if (!editingMessage) return;
    if (editDraft.length > MESSAGE_MAX_LENGTH) {
      toast.error(t("chat.limit", { count: MESSAGE_MAX_LENGTH.toLocaleString() }));
      return;
    }
    setSavingEdit(true);
    await onEditMessage(editingMessage.id, editDraft);
    setSavingEdit(false);
    setEditingMessage(null);
  };
  // Tapbacks, job-scoped (useMessageReactions). A team thread (src/lib/teamThread.ts) has none, nor replies or report/block.
  const isTeam = !!activeConvo.teamThread;
  const { reactions, react } = useMessageReactions(isTeam ? null : activeConvo?.jobId ?? null, userId);
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
    isOtherTyping,
  });

  // Poster-first rule: a PENDING APPLICANT cannot open a job conversation —
  // only the poster may send the first message (stops posters being flooded by
  // applicants). The applicant's composer stays locked until at least one
  // inbound message from the poster exists. The only other participant in
  // a job thread is the poster, so any message we didn't send is theirs.
  //
  // "Applicant" must mean *applicant*, not merely "not the poster". This
  // mirrors `public.can_message_in_job`, which (with
  // `can_send_message_to_in_job`) is the WITH CHECK on the `Users can send
  // messages` INSERT policy. It admits: the poster; the hired Helpr, or the
  // offered Helpr while the offer is pending; a current crew member; and an
  // applicant the poster messaged first, only while their application is
  // still pending or accepted (20260925175953, 20260925230845). Someone who is
  // no longer on the job is refused in BOTH directions (owner, 2026-09-25):
  // that case is `offJobState` below, asked of the server, not derived here.
  // Keep these in step: the client may never be STRICTER than the RLS policy.
  const isApplicant =
    !isTeam && !activeConvo.viewerIsPoster && !activeConvo.viewerIsAssignedHelper;
  const posterHasMessaged = messages.some((m) => m.sender_id !== userId);

  // 24h post-completion lockout, for everyone on the job. The closing instant
  // comes from the server (same expression as the INSERT gate), so the
  // notice appears exactly when sends start being refused. Read against
  // server-corrected time on every render, and re-render once at the closing instant so
  // a thread left open across it closes in place.
  const messagingClosesAt = activeConvo.messagingClosesAt ?? null;
  const [, setCloseTick] = useState(0);
  useEffect(() => {
    if (!messagingClosesAt) return;
    // Server time, not the device clock (see messagingLockout.serverNow).
    const ms = Date.parse(messagingClosesAt) - serverNow();
    // setTimeout overflows past 2^31-1 ms (~24.8 days); nothing that far out
    // needs a live flip.
    if (Number.isNaN(ms) || ms <= 0 || ms > 2_147_483_647) return;
    const t = setTimeout(() => setCloseTick((n) => n + 1), ms + 250);
    return () => clearTimeout(t);
  }, [messagingClosesAt]);
  const threadClosed = isThreadClosed(messagingClosesAt);
  // Q262: null when the other party deleted their account.
  const otherUserId = activeConvo.otherUserId;

  // Off the job (owner, 2026-09-25): once either person in this thread is no
  // longer on the job (rejected, removed from the crew, offer declined or
  // expired), neither may start a new message here. Asked of the server's
  // own read, so the composer is replaced by a read-only notice instead of a
  // send RLS refuses. Checked before the poster-first lock: someone off the
  // job is not waiting to be contacted. See src/lib/offJobGate.ts.
  const offJobState = useOffJobState({ activeConvo, userId, skip: threadClosed });
  const composerLocked = isApplicant && !posterHasMessaged && !offJobState;

  // Receiver gate (only the poster may message applicants and an offered
  // Helpr): asked of the server for the open thread, so an existing thread
  // the viewer can no longer send in shows a read-only notice instead of a
  // composer whose sends bounce. Not asked while the closed, off-the-job or
  // poster-first notice already owns the dock. See src/lib/recipientGate.ts.
  const recipientRestricted = useRecipientRestricted({
    activeConvo,
    userId,
    skip: threadClosed || !!offJobState || composerLocked,
  });

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
          onBack={() => { setLightboxPhoto(null); onCloseThread(); }}
          onOpenMuteSheet={() => setMuteSheetOpen(true)}
          onToggleMute={onToggleMute}
          // Q262: ChatHeader offers none of these for a deleted-account thread (otherUserId null); the guards keep a null out.
          onReportUser={() => { if (otherUserId !== null) setReportTarget({ type: "user", id: otherUserId }); }}
          onBlockUser={() => { if (otherUserId !== null) setBlockTarget({ id: otherUserId, name: activeConvo.otherUserName, muteInstead: () => setMuteSheetOpen(true) }); }}
          onViewProfile={() => { if (otherUserId !== null) navigate(memberProfilePath(otherUserId)); }}
        />
      }
    >
        <div
          // THE COLUMN SPANS THE PANE; THE READING CONTENT DOES NOT (owner,
          // 2026-09-14, VN-25: "the bottom message part needs to fill the
          // bottom area"). This column used to be `max-w-[780px] mx-auto`, so
          // on a ~1570px desktop pane the composer floated as a centred 780px
          // strip with wide blank sides. The ask named only the composer, so
          // only the composer dock is uncapped: the column itself fills the
          // pane (and the dock still bleeds to the pane edges via
          // `--chat-gutter`, ChatPaneShell), while the message scroller below
          // keeps the 780px centred reading column via CHAT_READING_COLUMN
          // (the safety banner does not: it spans the column, see below).
          // The pane (embedded) or the standalone
          // page container can be far wider than a comfortable reading
          // column, and bubbles spread across it read as sparse/oversized.
          // Phone is unaffected — nothing there is ever wider than 780.
          className="flex flex-col flex-1 min-h-0 w-full transition-[padding] duration-150"
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
          {!embedded && (<h1 ref={headingRef} tabIndex={-1} className="sr-only focus:outline-none">
              Conversation with {activeConvo.otherUserName}</h1>
          )}

          {/* THE SAFETY BANNER SITS DIRECTLY UNDER THE HEADER, FULL WIDTH
              (owner, 2026-09-25, phone screenshot of an empty thread: "The red
              alert thing needs to fill the space and be under the name and
              info more up"). This reverses 2026-09-19, when it rode inside the
              bottom-anchored block with the 780px reading measure — on an
              empty thread that floated it mid-pane as a narrow strip. It now
              spans the chat column exactly like the composer notices at the
              bottom, and sits first under ChatHeader. It is a one-time,
              dismiss-forever notice (`CHAT_RULES_DISMISSED_KEY`), so the space
              below it is only ever there until it is dismissed. Guarded by
              src/test/chatThreadNoDeadBandAboveMessages.test.tsx and
              ChatView.layout.test.tsx. */}
          {!isTeam && userId && <DealCard convo={activeConvo} userId={userId} hasMessages={messages.length > 0} />}
          {!bannerDismissed && !isTeam && (
            <div data-off-platform-note className="w-full mt-3 shrink-0 rounded-md bg-muted border border-border px-2.5 py-1.5 relative flex items-start gap-1.5 pr-11 mb-2">
              <AlertTriangle className="w-3 h-3 text-foreground mt-[3px] shrink-0" />
              <p className="text-ds-11 leading-snug text-foreground">
                Keep chats &amp; payments on Helpr so your job stays covered.
              </p>
              {/* Absolutely positioned so the 44px hit target doesn't force the
                  compact banner to expand to 44px in height. The button is
                  vertically centred inside the banner; overflow: visible (the
                  default) means any slight bleed above/below is fine. */}
              <Button type="button" variant="ghost" size="iconCompact" onClick={dismissBanner}
                className="absolute right-0 top-1/2 -translate-y-1/2 ctl-exit text-muted-foreground hover:text-foreground"
                aria-label={t("msg.dismissSafety")}
              >
                <X className="w-3 h-3" />
              </Button>
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
            className={`${CHAT_READING_COLUMN} flex-1 flex flex-col space-y-3 pt-4 pb-2`}
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
          {/* The applicant's full note heads the thread and scrolls with it (owner, 2026-10-12). */}
          <ApplicationNoteCard activeConvo={activeConvo} />
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
            onReact={isTeam ? undefined : react}
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
            threadClosed={threadClosed}
            offJobState={offJobState}
            recipientRestricted={recipientRestricted}
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
        onReport={isTeam ? undefined : (id) => setReportTarget({ type: "message", id })}
        onBlock={isTeam ? undefined : () => { if (otherUserId !== null) setBlockTarget({ id: otherUserId, name: activeConvo.otherUserName, muteInstead: () => setMuteSheetOpen(true) }); }}
        onDelete={setDeleteMessageConfirm}
        onEdit={(m) => { setEditDraft(m.content); setEditingMessage(m); }}
        onReact={isTeam ? undefined : react}
        myReaction={actionMessage ? (reactions.get(actionMessage.id)?.mine ?? null) : null}
        onReply={isTeam ? undefined : setReplyTo}
      />

      {/* Edit dialog — opened from the action sheet's "Edit" row. A plain
          textarea rather than reusing ChatComposer: editing replaces a
          sent message in place, it doesn't attach/reply/send a new one,
          so the composer's send-pipeline machinery doesn't apply here. */}
      <BrandConfirmDialog
        open={!!editingMessage}
        onOpenChange={(open) => { if (!open) setEditingMessage(null); }}
        title={t("msg.editTitle")}
        description={
          editSecondsLeft !== null
            ? t("msg.editBodyLeft", { left: editSecondsLeft >= 60 ? `${Math.ceil(editSecondsLeft / 60)}m` : `${editSecondsLeft}s` })
            : t("msg.editBody")
        }
        primaryLabel={savingEdit ? t("msg.saving") : t("msg.save")}
        primaryTone="bark"
        primaryDisabled={savingEdit || !editDraft.trim() || editDraft.length > MESSAGE_MAX_LENGTH}
        primaryHaptic="none"
        onPrimary={(e) => { e.preventDefault(); saveEdit(); }}
        secondaryLabel="Cancel"
      >
        <Textarea
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
            style={{ color: editDraft.length > MESSAGE_MAX_LENGTH ? "hsl(var(--destructive-ink))" : "hsl(var(--olivewood) / 0.6)" }}
          >
            {editDraft.length.toLocaleString()} / {MESSAGE_MAX_LENGTH.toLocaleString()}
          </p>
        )}
      </BrandConfirmDialog>
    </ChatPaneShell>
  );
}
