import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { isArchived } from "@/lib/archivedConversations";
import {
  deriveJobSystemEvents,
  type JobSystemEvent,
  type JobTimestamps,
} from "@/lib/jobSystemEvents";
import type { Conversation, Message } from "@/components/messages/types";
import { CHAT_PAGE_SIZE } from "./constants";
import {
  buildDeepLinkPlaceholder,
  fetchConversations,
} from "./messagesData/loadConversations";
import { createSendHandlers } from "./messagesData/sendHandlers";

/** Stable empty list so a cold cache doesn't hand consumers a new array
    identity on every render (which would defeat the memoized rows). */
const NO_CONVERSATIONS: Conversation[] = [];

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
 * State the hook fully owns (activeConvo, messages, pagination flags) is
 * returned so the page can wire it into the render and into the realtime /
 * mute hooks.
 *
 * The INBOX is React Query, not `useState`. It used to be the one main screen
 * still holding its list in local state with `loading` initialised to `true`,
 * so every navigation to /messages remounted the hook, blanked the list, and
 * refetched 200 rows + five RPCs from scratch — the visible "jumps/loads every
 * time I go on it". Now `queryKeys.messages.conversations(uid)` backs it:
 * re-entering the tab paints the cached inbox on the first frame and
 * revalidates behind it, matching Dashboard / My Jobs / Activity.
 *
 * `setConversations` is kept as a `useState`-shaped setter so every existing
 * caller (archive, batch-archive, block, mute toggles, the optimistic
 * mark-as-read, the realtime single-row patch) is unchanged — it just writes
 * through `queryClient.setQueryData` instead of component state, which is what
 * makes those optimistic edits survive the navigation too.
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
  cachedUser:
    | { id?: string; user_metadata?: { full_name?: string } }
    | null
    | undefined;
  deepLinkJobId: string | null;
  deepLinkUserId: string | null;
  navigate: NavigateFunction;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  activeConvoRef: MutableRefObject<Conversation | null>;
  chatContainerRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const queryClient = useQueryClient();
  // The page seeds its own `userId` from an effect, so it is null on the very
  // first render. Falling back to the already-cached auth user means the query
  // key is correct on frame ONE of a revisit — waiting a tick for the effect
  // would key the query to `null`, miss the warm cache, and reintroduce the
  // one-frame blank this change exists to remove.
  const resolvedUserId = userId ?? cachedUser?.id ?? null;
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  // Status-transition events derived from the active job's
  // timestamps — rendered as styled centered <div>s interleaved with
  // the real messages so both participants see what happened on the
  // job ("Helper marked on the way", "Poster confirmed complete") in
  // the same scroll as the conversation. Cleared when the user goes
  // back to the inbox so a stale set never bleeds across threads.
  const [jobSystemEvents, setJobSystemEvents] = useState<JobSystemEvent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  // Tracks a failed message-thread fetch so the chat surfaces a
  // recoverable error instead of the misleading "Say hello." empty state.
  const [chatLoadError, setChatLoadError] = useState(false);
  // True while a newly-opened conversation's messages are in flight. Lets
  // the chat pane show a skeleton instead of a blank window between
  // selecting a conversation and its first paint of real content.
  const [chatLoading, setChatLoading] = useState(false);
  const [warningShown, setWarningShown] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guards the "couldn't load previews" warning to once per mount, so the
  // inbox poll loop doesn't re-toast on every refresh while previews fail.
  const thumbWarningShown = useRef(false);
  const deepLinkHandled = useRef(false);

  // The inbox. Cached per user, so re-entering /messages renders the last
  // known list immediately and revalidates behind it. `meta.persist: false`
  // keeps message previews and short-lived signed attachment URLs out of the
  // 24h IndexedDB persister — the in-memory cache is what the fix relies on.
  //
  // Holds the FULL list (archived threads included); the visible inbox is
  // derived below. Deep links have to resolve against locally-archived
  // threads, which is what the pre-cache loader did by matching before the
  // archive filter ran.
  const {
    data: allConversations,
    isPending: conversationsPending,
    isError: loadError,
  } = useQuery({
    queryKey: queryKeys.messages.conversations(resolvedUserId),
    queryFn: () => fetchConversations(resolvedUserId!, thumbWarningShown),
    enabled: !!resolvedUserId,
    // Same SWR window as the Activity feed: a quick tab round-trip serves
    // pure cache with no request at all; anything longer repaints from cache
    // and refetches in the background.
    staleTime: 60 * 1000,
    meta: { persist: false },
  });

  // Drop locally-archived threads from the inbox. A thread auto-resurfaces
  // once a message newer than the archive moment arrives, so `isArchived`
  // is checked against each conversation's latest-message timestamp.
  const conversations = useMemo(() => {
    if (!allConversations) return NO_CONVERSATIONS;
    if (!resolvedUserId) return allConversations;
    return allConversations.filter(
      (c) => !isArchived(resolvedUserId, c.jobId, c.otherUserId, c.lastAt),
    );
  }, [allConversations, resolvedUserId]);

  // Only true on a genuinely cold cache — a warm cache resolves `data` on the
  // first render, so a revisit never shows the skeleton. `isPending` is also
  // true while the query is disabled (no user yet), which preserves the old
  // "skeleton until we know who you are" behavior.
  const loading = conversationsPending && !allConversations;

  // `useState`-shaped setter over the query cache, so every existing optimistic
  // caller keeps working verbatim (see the hook doc-comment).
  const setConversations = useCallback<Dispatch<SetStateAction<Conversation[]>>>(
    (update) => {
      queryClient.setQueryData<Conversation[]>(
        queryKeys.messages.conversations(resolvedUserId),
        (prev) => {
          const base = prev ?? [];
          return typeof update === "function"
            ? (update as (p: Conversation[]) => Conversation[])(base)
            : update;
        },
      );
    },
    [queryClient, resolvedUserId],
  );

  // Kept at its original `(uid) => Promise<void>` signature — the pull-to-
  // refresh in ConversationList, the inbox retry button, the post-send
  // re-sort, and the "message for a thread we've never seen" fallback all
  // call it. It now invalidates rather than re-running a setState loader, and
  // the returned promise still resolves once the refetch settles so
  // pull-to-refresh keeps its spinner honest.
  const loadConversations = useCallback(
    async (uid: string) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messages.conversations(uid),
      });
    },
    [queryClient],
  );

  // Auto-open conversation from deep link. Ran inside the old loader; now it
  // waits on the query's first successful result. The ref guard keeps it to
  // once per mount exactly as before, so a background refetch never yanks the
  // user back into a thread they navigated away from.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (!resolvedUserId || !allConversations) return;
    if (!deepLinkJobId || !deepLinkUserId) return;
    deepLinkHandled.current = true;

    const openIfMatch = (list: Conversation[]) => {
      const match = list.find(
        (c) => c.jobId === deepLinkJobId && c.otherUserId === deepLinkUserId,
      );
      if (!match) return false;
      setActiveConvo(match);
      navigate("/messages?chat=1", { replace: true });
      return true;
    };

    if (openIfMatch(allConversations)) return;

    void (async () => {
      // Not in the cached inbox — but the cache may simply predate the thread
      // this link points at (the common case: the user just applied and was
      // sent straight here). The pre-cache code always resolved deep links off
      // a fresh 200-row fetch, so confirm against the server before inventing
      // a placeholder, or a real thread would open as an empty one.
      //
      // This awaits the refetch and then reads the cache directly rather than
      // waiting for re-rendered query state: a refetch that returns
      // structurally identical rows changes neither `data`'s identity nor any
      // render-visible flag, so an effect watching those could never fire
      // again and the deep link would be dropped on the floor.
      await loadConversations(resolvedUserId);
      const refreshed = queryClient.getQueryData<Conversation[]>(
        queryKeys.messages.conversations(resolvedUserId),
      );
      if (refreshed && openIfMatch(refreshed)) return;

      const placeholder = await buildDeepLinkPlaceholder(
        resolvedUserId,
        deepLinkJobId,
        deepLinkUserId,
      );
      // null = dead thread (deleted user AND deleted job); the helper already
      // toasted, so leave the inbox untouched.
      if (!placeholder) return;
      setConversations((prev) => [placeholder, ...prev]);
      setActiveConvo(placeholder);
      navigate("/messages?chat=1", { replace: true });
    })();
  }, [
    allConversations,
    resolvedUserId,
    deepLinkJobId,
    deepLinkUserId,
    navigate,
    setConversations,
    loadConversations,
    queryClient,
  ]);

  // Stable reference so the memoized ConversationRow in the inbox list
  // skips re-rendering unchanged rows on parent state changes.
  const openConvo = useCallback(async (convo: Conversation) => {
    setActiveConvo(convo);
    setHasMoreMessages(false);
    setChatLoadError(false);
    setMessages([]);
    setJobSystemEvents([]);
    setChatLoading(true);
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
        // Defense-in-depth: mirror the RLS SELECT policy's flagged clause
        // (visible if I'm the sender OR the row isn't hidden) so a scanner-hidden
        // message never surfaces to its receiver even if that policy regresses.
        // This is an exact RLS mirror — the sender still sees their own flagged
        // message (matching current behavior), so it changes nothing today.
        .or(`sender_id.eq.${userId},flagged_hidden.eq.false`)
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
      setChatLoading(false);
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
    setChatLoading(false);
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
      // Defense-in-depth mirror of the RLS flagged clause (see openConvo).
      .or(`sender_id.eq.${userId},flagged_hidden.eq.false`)
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
      // Defense-in-depth mirror of the RLS flagged clause (see openConvo).
      .or(`sender_id.eq.${userId},flagged_hidden.eq.false`)
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
  };
}
