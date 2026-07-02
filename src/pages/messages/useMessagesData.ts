import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import {
  deriveJobSystemEvents,
  type JobSystemEvent,
  type JobTimestamps,
} from "@/lib/jobSystemEvents";
import type { Conversation, Message } from "@/components/messages/types";
import { CHAT_PAGE_SIZE } from "./constants";
import { createLoadConversations } from "./messagesData/loadConversations";
import { createSendHandlers } from "./messagesData/sendHandlers";

/**
 * The Messages page data layer — owns the inbox conversations, the active
 * thread, its messages + derived system events, and all the fetch / send /
 * pagination handlers. Extracted verbatim from Messages.tsx: the Supabase
 * queries (including the exact `.or()` thread filters), the optimistic-send
 * reconciliation, the deep-link placeholder logic, and every "why" comment
 * are preserved unchanged.
 *
 * The inbox loader (`loadConversations`) and the outbound-send slice
 * (`sendMessage` / `retryMessage` / `dispatchMessage` /
 * `patchConversationForMessage`) live in the co-located `messagesData/`
 * folder as factories this hook wires with the state it owns; their bodies
 * are byte-identical moves. The thread-fetch handlers (`openConvo`,
 * `refreshActiveThread`, `loadOlderMessages`) stay inline here because they
 * are woven into the hook's `useCallback` / state directly.
 *
 * The orchestrator still owns the shared primitives this hook can't create
 * for itself — `userId`, the cached auth user, the deep-link params, the
 * navigator, `scrollToBottom`, and the refs the realtime handlers read
 * (`activeConvoRef`, `chatContainerRef`, `bottomRef`) — and passes them in.
 * State the hook fully owns (conversations, activeConvo, messages, loading,
 * pagination flags) is returned so the page can wire it into the render and
 * into the realtime / mute hooks.
 */
export function useMessagesData({
  userId,
  cachedUser,
  deepLinkJobId,
  deepLinkUserId,
  navigate,
  scrollToBottom,
  activeConvoRef,
  chatContainerRef,
}: {
  userId: string | null;
  cachedUser: { user_metadata?: { full_name?: string } } | null | undefined;
  deepLinkJobId: string | null;
  deepLinkUserId: string | null;
  navigate: NavigateFunction;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  activeConvoRef: MutableRefObject<Conversation | null>;
  chatContainerRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  // Status-transition events derived from the active job's
  // timestamps — rendered as styled centered <div>s interleaved with
  // the real messages so both participants see what happened on the
  // job ("Helper marked on the way", "Poster confirmed complete") in
  // the same scroll as the conversation. Cleared when the user goes
  // back to the inbox so a stale set never bleeds across threads.
  const [jobSystemEvents, setJobSystemEvents] = useState<JobSystemEvent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Tracks a failed message-thread fetch so the chat surfaces a
  // recoverable error instead of the misleading "Say hello." empty state.
  const [chatLoadError, setChatLoadError] = useState(false);
  const [warningShown, setWarningShown] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guards the "couldn't load previews" warning to once per mount, so the
  // inbox poll loop doesn't re-toast on every refresh while previews fail.
  const thumbWarningShown = useRef(false);
  const deepLinkHandled = useRef(false);
  // Tracks whether a conversations load has completed at least once, so
  // the skeleton shows only on first load — background refreshes
  // (realtime, returning to the page) keep the existing UI in place.
  const loadedOnceRef = useRef(false);

  const loadConversations = createLoadConversations({
    deepLinkJobId,
    deepLinkUserId,
    navigate,
    setLoading,
    setLoadError,
    setConversations,
    setActiveConvo,
    loadedOnceRef,
    thumbWarningShown,
    deepLinkHandled,
  });

  // Stable reference so the memoized ConversationRow in the inbox list
  // skips re-rendering unchanged rows on parent state changes.
  const openConvo = useCallback(async (convo: Conversation) => {
    setActiveConvo(convo);
    setHasMoreMessages(false);
    setChatLoadError(false);
    setMessages([]);
    setJobSystemEvents([]);
    navigate("/messages?chat=1", { replace: true });
    // Fetch the job's transition timestamps alongside the message
    // thread so the system-event rows ("Helper marked on the way",
    // "Poster confirmed complete", …) can render in the same paint as
    // the messages. The job select is narrow — only the fields the
    // event deriver reads.
    const [messagesRes, jobRes] = await Promise.all([
      supabase
        .from("messages")
        .select("*")
        .eq("job_id", convo.jobId)
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${convo.otherUserId}),and(sender_id.eq.${convo.otherUserId},receiver_id.eq.${userId}),is_system.eq.true`)
        .order("created_at", { ascending: false })
        .limit(CHAT_PAGE_SIZE),
      supabase
        .from("jobs")
        .select(
          "cancelled_at, cancelled_by, customer_id, helper_arrived_at, helper_completed_at, helper_id, helper_on_the_way_at, poster_completed_at, revision_requested_at, disputed_at, disputed_by",
        )
        .eq("id", convo.jobId)
        .maybeSingle(),
    ]);
    const { data, error } = messagesRes;
    // Job lookup is best-effort: a failure here just means no system
    // events render. We don't surface it — the message thread still works.
    if (!jobRes.error && jobRes.data) {
      setJobSystemEvents(
        deriveJobSystemEvents(jobRes.data as JobTimestamps, convo.jobId),
      );
    }

    // Surface a failed thread fetch instead of falling through to the
    // "Say hello." empty state, which would wrongly imply 0 messages.
    if (error) {
      console.error("[Messages] openConvo failed:", error);
      report(error, { tags: { source: "Messages.openConvo" } });
      setChatLoadError(true);
      return;
    }

    if (data) {
      // Optimistic read: flip the read flag locally now so the unread
      // badge clears immediately, then persist in the background. The
      // optimistic-send flow keys off clientId/sendStatus, not `read`,
      // so toggling `read` here cannot collide with it.
      const unreadIds = data.filter((m) => m.receiver_id === userId && !m.read).map((m) => m.id);
      const sorted = [...data]
        .reverse()
        .map((m) => (unreadIds.includes(m.id) ? { ...m, read: true } : m));
      setMessages(sorted);
      setHasMoreMessages(data.length === CHAT_PAGE_SIZE);
      if (unreadIds.length > 0) {
        // Clear the conversation-list unread count optimistically too.
        setConversations((prev) =>
          prev.map((c) =>
            c.jobId === convo.jobId && c.otherUserId === convo.otherUserId
              ? { ...c, unread: 0 }
              : c,
          ),
        );
        // Persist in the background — do NOT block the UI on the round-trip.
        void supabase
          .from("messages")
          .update({ read: true })
          .in("id", unreadIds)
          .then(({ error: markError }) => {
            if (markError) {
              // Revert the optimistic read flags so the badge re-appears.
              console.error("[Messages] mark-as-read failed:", markError);
              report(markError, { severity: "warning", tags: { source: "Messages.markRead" } });
              const unreadSet = new Set(unreadIds);
              setMessages((prev) =>
                prev.map((m) => (unreadSet.has(m.id) ? { ...m, read: false } : m)),
              );
              setConversations((prev) =>
                prev.map((c) =>
                  c.jobId === convo.jobId && c.otherUserId === convo.otherUserId
                    ? { ...c, unread: unreadIds.length }
                    : c,
                ),
              );
            }
          });
      }
    }
    // Reconcile the bell badge with the messages badge. A new chat message
    // fires the notify_message_recipient trigger, which inserts a
    // type='message' notifications row (link `/messages?job=<id>`). Marking
    // the thread's messages read above clears the messages/nav badge but
    // leaves that notifications row unread — so the bell would keep counting
    // a message the user has already seen. Clear it here on thread open.
    if (userId) {
      void supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", userId)
        .eq("type", "message")
        .eq("read", false)
        .like("link", `%job=${convo.jobId}%`);
    }
    scrollToBottom();
  }, [userId, navigate, scrollToBottom]);

  // Pull-to-refresh for the open chat thread: re-fetch the most recent
  // page of messages without the navigate / clear churn that openConvo
  // does, so the thread quietly reconciles to the server's latest state.
  const refreshActiveThread = async () => {
    if (!activeConvo || !userId) return;
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("job_id", activeConvo.jobId)
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId}),and(sender_id.eq.${activeConvo.otherUserId},receiver_id.eq.${userId}),is_system.eq.true`)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    if (error) {
      console.error("[Messages] refreshActiveThread failed:", error);
      report(error, { severity: "warning", tags: { source: "Messages.refreshThread" } });
      toast.error("Couldn't refresh this conversation.");
      return;
    }

    if (data) {
      const sorted = [...data].reverse();
      setMessages((prev) => {
        // Keep any still-in-flight optimistic bubbles the refetch
        // doesn't yet know about so a pull-to-refresh never drops a
        // message the user is mid-send on.
        const pending = prev.filter(
          (m) => m.sendStatus === "sending" || m.sendStatus === "failed",
        );
        const serverIds = new Set(sorted.map((m) => m.id));
        const stillPending = pending.filter((m) => !serverIds.has(m.id));
        return [...sorted, ...stillPending];
      });
      setHasMoreMessages(data.length === CHAT_PAGE_SIZE);
    }
  };

  const loadOlderMessages = async () => {
    if (!activeConvo || !userId || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const oldestMsg = messages[0];
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("job_id", activeConvo.jobId)
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId}),and(sender_id.eq.${activeConvo.otherUserId},receiver_id.eq.${userId}),is_system.eq.true`)
      .lt("created_at", oldestMsg.created_at)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    // A failed page fetch: keep the already-loaded thread visible and
    // leave the "Load earlier" affordance so the user can retry.
    if (error) {
      console.error("[Messages] loadOlderMessages failed:", error);
      report(error, { severity: "warning", tags: { source: "Messages.loadOlder" } });
      toast.error("Couldn't load earlier messages. Tap to try again.");
      setLoadingMore(false);
      return;
    }

    if (data && data.length > 0) {
      const sorted = [...data].reverse();
      // Preserve scroll position
      const container = chatContainerRef.current;
      const scrollHeightBefore = container?.scrollHeight || 0;
      setMessages((prev) => [...sorted, ...prev]);
      setHasMoreMessages(data.length === CHAT_PAGE_SIZE);
      // Restore scroll position after DOM update
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - scrollHeightBefore;
        }
      });
    } else {
      setHasMoreMessages(false);
    }
    setLoadingMore(false);
  };

  const {
    patchConversationForMessage,
    sendMessage,
    retryMessage,
  } = createSendHandlers({
    userId,
    cachedUser,
    activeConvo,
    messages,
    warningShown,
    setWarningShown,
    setMessages,
    setConversations,
    scrollToBottom,
    activeConvoRef,
    loadConversations,
  });

  return {
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
    hasMoreMessages,
    loadingMore,
    loadConversations,
    openConvo,
    refreshActiveThread,
    loadOlderMessages,
    patchConversationForMessage,
    sendMessage,
    retryMessage,
  };
}
