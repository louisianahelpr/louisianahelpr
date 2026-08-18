import { useCallback, useEffect, useState, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { useChatPresence } from "@/hooks/useChatPresence";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

import { archiveConversation } from "@/lib/archivedConversations";

import type { Conversation } from "@/components/messages/types";
import { ChatView } from "@/components/messages/ChatView";
import { ConversationList } from "@/components/messages/ConversationList";
import { SectionBoundary } from "@/components/SectionBoundary";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { useIsWebDesktop } from "@/components/DesktopSidebarNav";

import {
  CHAT_OPEN_PATH,
  MESSAGES_LIST_PATH,
  THREAD_OPEN_STATE,
  isThreadOpenEntry,
} from "./messages/constants";
import { useMessagesData } from "./messages/useMessagesData";
import { useMessagesRealtime } from "./messages/useMessagesRealtime";
import { useThreadMuteActions } from "./messages/useThreadMuteActions";
import { MessagesTitleCard } from "./messages/MessagesTitleCard";
import { MessagesEmptyThread } from "./messages/MessagesEmptyThread";

const Messages = () => {
  usePageTitle("Messages — Helpr");
  const navigate = useNavigate();
  // On the desktop website (≥1024px, non-native) the inbox and the open
  // thread sit side by side in a single shell — the list on the left, the
  // thread on the right — instead of the mobile screen-swap. False on
  // phone/native, where the either/or swap below is unchanged.
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const deepLinkJobId = searchParams.get("jobId");
  const deepLinkUserId = searchParams.get("userId");
  // The URL's "a thread is open" flag — MobileNav hides the entire bottom
  // dock while it is set. See the contract on CHAT_OPEN_PATH in
  // ./messages/constants; the effect below is what keeps it honest.
  const threadFlagInUrl = searchParams.has("chat");
  const { user: cachedUser } = useCurrentUser();
  const [userId, setUserId] = useState<string | null>(null);
  // Mirror of `activeConvo` for the realtime handlers to read. Keeping it
  // in a ref (kept current by the effect below) lets the subscription
  // effect depend only on the stable `userId` — so opening or switching a
  // conversation no longer tears down and re-subscribes the whole
  // 3-listener channel (a websocket handshake + a window where inbound
  // messages can be missed on every thread switch).
  const activeConvoRef = useRef<Conversation | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: "message" | "user"; id: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConvoConfirm, setDeleteConvoConfirm] = useState<Conversation | null>(null);
  const [deleteMessageConfirm, setDeleteMessageConfirm] = useState<string | null>(null);
  // Multi-select batch delete: the threads staged for the combined
  // "Hide N conversations?" confirm, and a nonce bumped after a batch
  // archive resolves so the inbox list drops out of select mode.
  const [batchArchiveConfirm, setBatchArchiveConfirm] = useState<Conversation[] | null>(null);
  const [selectionResetNonce, setSelectionResetNonce] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();

  // Scroll the thread to its bottom sentinel. Uses a double rAF rather
  // than a fixed setTimeout: the first frame lets React commit the new
  // message node, the second runs after layout so the element exists
  // and has its final height — reliable across slow renders, where a
  // hard-coded 100ms timeout could fire before the DOM settled.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior });
      });
    });
  }, []);

  // The Messages page data layer — owns the inbox conversations, the active
  // thread, its messages + derived system events, and all the fetch / send /
  // pagination handlers. See useMessagesData. The Supabase queries (including
  // the exact `.or()` thread filters) are preserved verbatim there.
  const {
    conversations,
    setConversations,
    activeConvo,
    setActiveConvo,
    jobSystemEvents,
    messages,
    setMessages,
    loading,
    loadError,
    chatLoadError,
    chatLoading,
    hasMoreMessages,
    loadingMore,
    loadConversations,
    openConvo,
    refreshActiveThread,
    loadOlderMessages,
    patchConversationForMessage,
    sendMessage,
    retryMessage,
  } = useMessagesData({
    userId,
    cachedUser,
    deepLinkJobId,
    deepLinkUserId,
    navigate,
    scrollToBottom,
    activeConvoRef,
    chatContainerRef,
  });

  // ── The bottom-nav invariant ────────────────────────────────────────────
  // `?chat=1` is present  ⟺  a thread is actually open. Both directions are
  // enforced here, because MobileNav returns null on `/messages` whenever the
  // flag is set: a flag left over the LIST is a dead end with no bottom nav
  // and no way out of Messages (owner, on device: "Where is the bottom nav?
  // I'm stuck here").
  //
  // The flag is in the URL and the thread is in component state, so the two
  // desync every time the page remounts with the flag still set. Two real
  // paths did it:
  //   - open a thread → ⋮ → View profile → back. Same route, fresh mount:
  //     `activeConvo` is null again, `?chat=1` is not.
  //   - native resume. RouteMemory records `pathname + search`, so a WKWebView
  //     jetsam-reload restores `/messages?chat=1` into a fresh app process.
  //
  // Two effects, not one, and each reads a DIFFERENT source of truth for the
  // flag. That is load-bearing, not fussiness — a single effect comparing
  // `activeConvo` against react-router's `searchParams` oscillates and closes
  // the thread the instant you open it. React Router commits its location in a
  // transition, so `searchParams` lags `activeConvo` by a render: the pair goes
  // (convo, no flag) → (convo, flag), and an effect reading the first frame as
  // "the flag was removed" nulls the thread, which then reads as "a flag with
  // no thread" and strips the URL. Measured, not theorised: opening a thread
  // pushed `/messages?chat=1` and replaced it back to `/messages` in the same
  // tick, and the thread never opened.
  //
  // STATE → URL. Fires only when the open thread itself changes, and reads
  // `window.location` — which `history.pushState` updates synchronously — so it
  // can never see a stale search string and never fights the router.
  useEffect(() => {
    const flagged = new URLSearchParams(window.location.search).has("chat");
    if (activeConvo && !flagged) {
      navigate(CHAT_OPEN_PATH, { state: THREAD_OPEN_STATE });
      return;
    }
    if (!activeConvo && flagged) {
      // The stale-flag case: a mount that inherited the flag without the
      // thread. Strip it before the user can notice the nav is missing.
      navigate(MESSAGES_LIST_PATH, { replace: true });
    }
  }, [activeConvo, navigate]);

  // URL → STATE, on the FALLING EDGE of the flag only. A flag that goes from
  // present to absent is the back gesture / hardware back popping the entry
  // `openConvo` pushed, so close the thread — otherwise the nav reappears over
  // an open conversation. Edge-triggered rather than level-triggered so the
  // (convo, flag-not-yet-committed) frame above is not mistaken for a close.
  const prevThreadFlag = useRef(threadFlagInUrl);
  useEffect(() => {
    const wasFlagged = prevThreadFlag.current;
    prevThreadFlag.current = threadFlagInUrl;
    if (wasFlagged && !threadFlagInUrl) setActiveConvo(null);
  }, [threadFlagInUrl, setActiveConvo]);

  // Leave the open thread. `openConvo` PUSHED the flagged entry, so the honest
  // close is a history pop — identical to the swipe-back / hardware back, and
  // it leaves no duplicate `/messages` entry behind to swallow the next back
  // press. A thread we did not push (a `?jobId=…&userId=…` deep link opened
  // before this component owned the history entry) has no marker, so it falls
  // back to replacing the flag away. Either way the effect above guarantees
  // the end state: no flag, thread closed, nav visible.
  const closeThread = useCallback(() => {
    if (isThreadOpenEntry(location.state)) {
      navigate(-1);
      return;
    }
    setActiveConvo(null);
    navigate(MESSAGES_LIST_PATH, { replace: true });
  }, [location.state, navigate, setActiveConvo]);

  // Chat presence
  const { isOtherOnline, isOtherTyping, broadcastTyping } = useChatPresence({
    channelName: activeConvo ? `chat-${activeConvo.jobId}-${[userId, activeConvo.otherUserId].sort().join("-")}` : "none",
    userId: userId || "",
    otherUserId: activeConvo?.otherUserId || "",
  });

  // Keep the realtime-handler mirror of `activeConvo` current. The
  // subscription effect closes over `activeConvoRef`, not `activeConvo`,
  // so it stays mounted for the page's lifetime instead of churning.
  useEffect(() => {
    activeConvoRef.current = activeConvo;
  }, [activeConvo]);

  // Seed from cache for instant render. No explicit fetch here any more —
  // the inbox is a React Query query keyed on the user id (see
  // useMessagesData), so it loads (or serves cache) the moment the id is
  // known. Kicking off a manual load from an effect is what forced a cold
  // refetch on every visit.
  useEffect(() => {
    if (cachedUser && !userId) setUserId(cachedUser.id);
  }, [cachedUser]);

  // Fallback auth check only if useCurrentUser hasn't loaded yet
  useEffect(() => {
    if (userId || cachedUser) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id);
    });
  }, [userId, cachedUser]);

  // Realtime subscription — see useMessagesRealtime. The channel's
  // server-side filters and channel-name nonce are preserved verbatim
  // there; it depends only on the stable `userId`.
  useMessagesRealtime({
    userId,
    activeConvoRef,
    setMessages,
    scrollToBottom,
    patchConversationForMessage,
  });

  // Hide a conversation from this user's inbox.
  //
  // The old "delete conversation" only deleted the user's OWN sent
  // messages (RLS forbids deleting the other person's) — so the thread
  // stayed fully visible to the other person and half-visible here. That
  // partial delete was misleading and irreversible. This instead does an
  // honest local archive: nothing is deleted, the thread is just hidden
  // from this user's list, and it resurfaces automatically if a new
  // message arrives. See `src/lib/archivedConversations.ts`.
  const archiveConversationLocal = (convo: Conversation) => {
    if (!userId) return;
    hapticHeavy();
    archiveConversation(userId, convo.jobId, convo.otherUserId);
    setConversations((prev) =>
      prev.filter(
        (c) => !(c.jobId === convo.jobId && c.otherUserId === convo.otherUserId),
      ),
    );
    hapticSuccess();
    toast.success("Conversation hidden from your inbox");
    setDeleteConvoConfirm(null);
  };

  // Batch variant of `archiveConversationLocal` — hides up to 3 selected
  // threads at once. Same honest local archive per thread (nothing is
  // deleted; each resurfaces on a new message), one combined haptic +
  // toast, then bumps the reset nonce so the list exits select mode.
  const confirmBatchArchive = () => {
    if (!batchArchiveConfirm || !userId) return;
    hapticHeavy();
    for (const convo of batchArchiveConfirm) {
      archiveConversation(userId, convo.jobId, convo.otherUserId);
    }
    const keys = new Set(
      batchArchiveConfirm.map((c) => `${c.jobId}_${c.otherUserId}`),
    );
    setConversations((prev) =>
      prev.filter((c) => !keys.has(`${c.jobId}_${c.otherUserId}`)),
    );
    hapticSuccess();
    const n = batchArchiveConfirm.length;
    toast.success(`${n} conversation${n === 1 ? "" : "s"} hidden from your inbox`);
    setBatchArchiveConfirm(null);
    setSelectionResetNonce((x) => x + 1);
  };

  // Mute-state actions (toggle / snooze / unmute) — see
  // useThreadMuteActions. All optimistic with rollback; `patchMuteState`
  // keeps the list and the active-thread mirror coherent.
  const { handleToggleMute, handleSnoozeMute, handleUnmute } = useThreadMuteActions({
    userId,
    activeConvoRef,
    setConversations,
    setActiveConvo,
  });

  const deleteMessage = async (messageId: string) => {
    hapticHeavy();
    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      hapticError();
      toast.error("Couldn't delete that one — give it another try?");
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      hapticSuccess();
      toast.success("Message deleted");
    }
    setDeleteMessageConfirm(null);
  };

  // The two panes, built once and reused by both the mobile screen-swap
  // and the desktop side-by-side split. `embedded={isWebDesktop}` strips
  // each component's own full-viewport shell on desktop so they compose
  // inside the single PageScaffold below; on mobile they keep their
  // standalone shells exactly as before.
  const listEl = (
    <ConversationList
      conversations={conversations}
      loading={loading}
      loadError={loadError}
      userId={userId}
      loadConversations={loadConversations}
      openConvo={openConvo}
      setReportTarget={setReportTarget}
      setBlockTarget={setBlockTarget}
      setDeleteConvoConfirm={setDeleteConvoConfirm}
      onToggleMute={handleToggleMute}
      onSnoozeMute={handleSnoozeMute}
      onUnmute={handleUnmute}
      onBatchArchive={(convos) => setBatchArchiveConfirm(convos)}
      resetSelectionNonce={selectionResetNonce}
      embedded={isWebDesktop}
      activeKey={
        activeConvo
          ? `${activeConvo.jobId}_${activeConvo.otherUserId}`
          : null
      }
    />
  );

  const chatEl = activeConvo ? (
    <ChatView
      activeConvo={activeConvo}
      onCloseThread={closeThread}
      keyboardInset={keyboardInset}
      isOtherOnline={isOtherOnline}
      isOtherTyping={isOtherTyping}
      broadcastTyping={broadcastTyping}
      messages={messages}
      userId={userId}
      chatLoadError={chatLoadError}
      chatLoading={chatLoading}
      onRetryLoad={() => openConvo(activeConvo)}
      hasMoreMessages={hasMoreMessages}
      loadingMore={loadingMore}
      loadOlderMessages={loadOlderMessages}
      onRefreshThread={refreshActiveThread}
      sendMessage={sendMessage}
      retryMessage={retryMessage}
      chatContainerRef={chatContainerRef}
      bottomRef={bottomRef}
      setReportTarget={setReportTarget}
      setBlockTarget={setBlockTarget}
      setDeleteMessageConfirm={setDeleteMessageConfirm}
      onToggleMute={handleToggleMute}
      onSnoozeMute={handleSnoozeMute}
      onUnmute={handleUnmute}
      jobSystemEvents={jobSystemEvents}
      embedded={isWebDesktop}
    />
  ) : null;

  return (
    <>
      {isWebDesktop ? (
        <PageScaffold
          titleCard={
            <MessagesTitleCard conversations={conversations} loading={loading} />
          }
        >
          <div className="flex-1 min-h-0 flex">
            {/* Left pane — the inbox list. Fixed width so the thread pane
                gets the remaining space; right border separates the two. */}
            <div
              className="w-[340px] shrink-0 min-h-0 flex flex-col"
              style={{ borderRight: "1px solid hsl(var(--olivewood) / 0.12)" }}
            >
              <div className="flex-1 min-h-0">
                <SectionBoundary label="conversations">{listEl}</SectionBoundary>
              </div>
              {/* Bottom-anchored discovery hint — the thread list can be
                  short on desktop (a few conversations) leaving a wide
                  empty band. This footer hint fills that space with a
                  quiet on-brand editorial line explaining how to start a
                  new conversation, so the rail never reads as dead space. */}
              <div
                aria-hidden
                className="shrink-0 px-4 py-3 border-t text-ds-11 font-serif italic leading-snug"
                style={{
                  borderColor: "hsl(var(--olivewood) / 0.1)",
                  color: "hsl(var(--olivewood) / 0.65)",
                  background: "hsl(var(--olivewood) / 0.02)",
                }}
              >
                Threads open when someone applies to your job — or when
                you message a Helpr from their profile.
              </div>
            </div>
            {/* Right pane — the open thread, or a resting empty state when
                nothing is selected yet. */}
            <div className="flex-1 min-h-0 flex flex-col">
              {chatEl ? (
                <SectionBoundary label="chat">{chatEl}</SectionBoundary>
              ) : (
                <MessagesEmptyThread />
              )}
            </div>
          </div>
        </PageScaffold>
      ) : !activeConvo ? (
        <SectionBoundary label="conversations">{listEl}</SectionBoundary>
      ) : (
        <SectionBoundary label="chat">{chatEl}</SectionBoundary>
      )}

      {reportTarget && (
        <ReportDialog
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          reportedType={reportTarget.type}
          reportedId={reportTarget.id}
        />
      )}

      {blockTarget && (
        <BlockUserDialog
          open={!!blockTarget}
          onClose={() => setBlockTarget(null)}
          blockedUserId={blockTarget.id}
          blockedUserName={blockTarget.name}
          onBlocked={() => {
            // Drop the conversation locally and exit chat view
            setConversations((prev) => prev.filter((c) => c.otherUserId !== blockTarget.id));
            // Same single exit as the back button — never hand-roll the
            // close, or the `?chat=1` flag outlives the thread again.
            if (activeConvo?.otherUserId === blockTarget.id) closeThread();
          }}
          // Block-and-report combo: after the block succeeds, open the
          // multi-step Report dialog so the trust team gets a flag in
          // the same gesture. Captures the user id before clearing
          // `blockTarget` so the report target stays stable.
          onReportAndBlock={() => {
            const id = blockTarget.id;
            setBlockTarget(null);
            setReportTarget({ type: "user", id });
          }}
        />
      )}

      {/* Hide conversation confirmation — an honest local archive, not a
          partial delete. Nothing is removed; the thread is just hidden
          from this inbox and comes back if a new message arrives. */}
      <BrandConfirmDialog
        open={!!deleteConvoConfirm}
        onOpenChange={(o) => { if (!o) setDeleteConvoConfirm(null); }}
        title="Hide this conversation?"
        description={`This removes the conversation with ${deleteConvoConfirm?.otherUserName ?? "this person"} from your inbox. No messages are deleted, and it'll come back if they send you a new message.`}
        primaryLabel="Hide"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => deleteConvoConfirm && archiveConversationLocal(deleteConvoConfirm)}
        secondaryLabel="Cancel"
      />

      {/* Batch "hide conversations" confirmation — the multi-select
          variant of the single-row hide above. Same honest local archive
          (nothing deleted; each thread returns on a new message), one
          combined confirm for all selected threads. */}
      <BrandConfirmDialog
        open={!!batchArchiveConfirm}
        onOpenChange={(o) => { if (!o) setBatchArchiveConfirm(null); }}
        title={`Hide ${batchArchiveConfirm?.length ?? 0} conversation${(batchArchiveConfirm?.length ?? 0) === 1 ? "" : "s"}?`}
        description="This removes the selected conversations from your inbox. No messages are deleted, and a thread comes back if that person sends you a new message."
        primaryLabel="Hide"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={confirmBatchArchive}
        secondaryLabel="Cancel"
      />

      {/* Delete message confirmation */}
      <BrandConfirmDialog
        open={!!deleteMessageConfirm}
        onOpenChange={(o) => { if (!o) setDeleteMessageConfirm(null); }}
        title="Delete message?"
        description="This message will be permanently deleted. This can't be undone."
        primaryLabel="Delete"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => deleteMessageConfirm && deleteMessage(deleteMessageConfirm)}
        secondaryLabel="Cancel"
      />
    </>
  );
};

export default Messages;
