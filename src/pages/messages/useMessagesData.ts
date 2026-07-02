import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { toast } from "sonner";
import { scanMessage } from "@/lib/messageScanner";
import { requireOnline } from "@/lib/requireOnline";
import {
  getMessageAttachmentSignedUrls,
  isImageMime,
} from "@/lib/messageAttachments";
import { getMutedThreadMap, threadMuteKey } from "@/lib/threadMutes";
import { isArchived } from "@/lib/archivedConversations";
import {
  deriveJobSystemEvents,
  type JobSystemEvent,
  type JobTimestamps,
} from "@/lib/jobSystemEvents";
import type { Conversation, Message } from "@/components/messages/types";
import { CHAT_PAGE_SIZE } from "./constants";
import { logViolation } from "./logViolation";

/**
 * The Messages page data layer — owns the inbox conversations, the active
 * thread, its messages + derived system events, and all the fetch / send /
 * pagination handlers. Extracted verbatim from Messages.tsx: the Supabase
 * queries (including the exact `.or()` thread filters), the optimistic-send
 * reconciliation, the deep-link placeholder logic, and every "why" comment
 * are preserved unchanged.
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

  const loadConversations = async (uid: string) => {
    // Only show the skeleton on the very first load. Background refreshes
    // (e.g. realtime updates, returning to the page) keep the existing UI.
    if (!loadedOnceRef.current) setLoading(true);

    // Fetch blocked-user IDs first so we can hide them from the list
    const { getBlockedUserIds } = await import("@/lib/userBlocks");
    const blockedSet = await getBlockedUserIds(uid);

    const { data: msgs, error: msgsError } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(200);

    // Surface a failed fetch as a recoverable ErrorState rather than
    // letting it fall through to the "No messages yet" empty state.
    if (msgsError) { setLoadError(true); setLoading(false); return; }
    setLoadError(false);

    if (!msgs || msgs.length === 0) { loadedOnceRef.current = true; setLoading(false); return; }

    const filteredMsgs = msgs.filter((m: any) => {
      // System messages (sender_id IS NULL) never drive the conversation
      // list — they belong inside the thread view only. Skip them here so
      // they don't inflate unread counts or appear as the "last message"
      // preview in the inbox.
      if (m.is_system) return false;
      const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
      return !blockedSet.has(other);
    });

    const convoMap = new Map<string, { otherUserId: string; jobId: string; messages: Message[] }>();
    for (const m of filteredMsgs) {
      const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
      const key = `${m.job_id}_${other}`;
      if (!convoMap.has(key)) convoMap.set(key, { otherUserId: other, jobId: m.job_id, messages: [] });
      convoMap.get(key)!.messages.push(m);
    }

    const otherIds = [...new Set([...convoMap.values()].map((c) => c.otherUserId))];
    const jobIds = [...new Set([...convoMap.values()].map((c) => c.jobId))];

    // Collect the image-attachment paths up-front so we can batch the
    // signed-URL resolution into ONE `createSignedUrls` call alongside
    // the profile / job RPCs — replaces N per-row round-trips that
    // <LastMessageImageThumb> used to fire on mount (N+1 across every
    // image-last-message conversation in the inbox).
    const imageThumbPaths: string[] = [];
    for (const v of convoMap.values()) {
      const last = v.messages[0];
      if (last.attachment_url && isImageMime(last.attachment_mime)) {
        imageThumbPaths.push(last.attachment_url);
      }
    }

    // Bulk mute lookup runs alongside profile/job/thumb fetches so the
    // inbox renders muted-bell badges in one round-trip, not N. Falls
    // back to a local-storage mirror inside `getMutedThreadSet` when the
    // RPC isn't deployed yet (PGRST202) — feature degrades quietly,
    // never crashes.
    const mutePairs = [...convoMap.values()].map((v) => ({
      jobId: v.jobId,
      otherUserId: v.otherUserId,
    }));
    // Bulk last-active lookup runs alongside the other inbox RPCs so
    // every row's "Active now" / "Active 2h ago" pill is resolved in a
    // single round-trip instead of N. The RPC was shipped in
    // `20260609090000_user_last_active_rpc.sql` (handoff item #28); we
    // degrade silently when the function isn't deployed (PGRST202).
    const [profilesRes, jobsRes, thumbUrlMap, mutedMap, lastActiveRes] = await Promise.all([
      supabase.rpc("get_safe_profiles", { user_ids: otherIds }),
      supabase.from("jobs").select("id, title, status, customer_id").in("id", jobIds),
      getMessageAttachmentSignedUrls(imageThumbPaths),
      getMutedThreadMap(uid, mutePairs),
      (supabase.rpc as any)("get_user_last_active", { user_ids: otherIds }),
    ]);
    const lastActiveMap = new Map<string, string>();
    if (
      lastActiveRes &&
      !lastActiveRes.error &&
      Array.isArray(lastActiveRes.data)
    ) {
      for (const row of lastActiveRes.data as Array<{ user_id: string; last_active_at: string }>) {
        if (row?.user_id && row?.last_active_at) {
          lastActiveMap.set(row.user_id, row.last_active_at);
        }
      }
    }

    // If we asked for image thumbs but some paths didn't resolve, the
    // inbox degrades to text-only for those rows. Surface a one-time,
    // non-blocking warning rather than leaving silent blank thumbnails.
    const uniqueThumbPaths = new Set(imageThumbPaths.filter(Boolean));
    if (uniqueThumbPaths.size > 0 && !thumbWarningShown.current) {
      const anyResolved = [...uniqueThumbPaths].some((p) => thumbUrlMap[p]);
      if (!anyResolved) {
        thumbWarningShown.current = true;
        toast.warning("Couldn't load image previews — your messages are intact.");
      }
    }

    const profileMap = new Map(profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
    const avatarMap = new Map<string, string | null>(profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || []);
    const jobMap = new Map(jobsRes.data?.map((j) => [j.id, { title: j.title, status: j.status, customer_id: j.customer_id }]) || []);

    const convos: Conversation[] = [...convoMap.entries()].map(([, v]) => {
      const last = v.messages[0];
      const lastIsImage = !!last.attachment_url && isImageMime(last.attachment_mime);
      return {
      otherUserId: v.otherUserId,
      otherUserName: profileMap.get(v.otherUserId) || "User",
      otherUserAvatarUrl: avatarMap.get(v.otherUserId) ?? null,
      jobTitle: jobMap.get(v.jobId)?.title || "Job",
      jobId: v.jobId,
      jobStatus: jobMap.get(v.jobId)?.status ?? null,
      // Track whether the current user is the poster on this job so the
      // chat can render poster-specific quick replies (vs helper-specific).
      viewerIsPoster: jobMap.get(v.jobId)?.customer_id === uid,
      lastMessage: last.content,
      lastAt: last.created_at,
      unread: v.messages.filter((m) => m.receiver_id === uid && !m.read).length,
      // Rich-preview metadata for the inbox row: who sent the last
      // message (drives the "You: " prefix) and whether it carried an
      // attachment (drives the image-thumbnail preview).
      lastMessageSenderId: last.sender_id,
      lastMessageAttachmentPath: last.attachment_url,
      lastMessageAttachmentMime: last.attachment_mime,
      // Pre-resolved by the batched createSignedUrls call above so each
      // ConversationRow can render its thumb without its own request.
      // `null` for non-image attachments (row will skip the thumb branch).
      lastMessageAttachmentSignedUrl:
        lastIsImage && last.attachment_url
          ? thumbUrlMap[last.attachment_url] ?? null
          : null,
      // Mute state — resolved from the bulk RPC above. Used by the row
      // (bell-slash icon) and the chat header (Muted pill + toggle copy).
      // `muteUntil` carries the snooze TTL (or null for forever-mute) so
      // the chat header can render "Muted for 8h" without a follow-up read.
      isMuted: mutedMap.has(threadMuteKey(v.jobId, v.otherUserId)),
      muteUntil:
        mutedMap.get(threadMuteKey(v.jobId, v.otherUserId))?.until ?? null,
      // Pre-resolved last-active ISO timestamp from the batched RPC
      // above. The row renders "Active now" / "Active 2h ago" / hides
      // beyond 7d so a stale signal never masquerades as live presence.
      otherUserLastActiveAt: lastActiveMap.get(v.otherUserId) ?? null,
    };
    });

    convos.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    // Drop locally-archived threads from the inbox. A thread auto-resurfaces
    // once a message newer than the archive moment arrives, so `isArchived`
    // is checked against each conversation's latest-message timestamp.
    const visibleConvos = convos.filter(
      (c) => !isArchived(uid, c.jobId, c.otherUserId, c.lastAt),
    );
    setConversations(visibleConvos);
    loadedOnceRef.current = true;
    setLoading(false);

    // Auto-open conversation from deep link
    if (deepLinkJobId && deepLinkUserId && !deepLinkHandled.current) {
      deepLinkHandled.current = true;
      const match = convos.find(c => c.jobId === deepLinkJobId && c.otherUserId === deepLinkUserId);
      if (match) {
        setActiveConvo(match);
        navigate("/messages?chat=1", { replace: true });
      } else {
        // No existing conversation — fetch profile + job to build a
        // placeholder thread so the user can start messaging.
        const [profileRes, jobRes] = await Promise.all([
          supabase.rpc("get_safe_profiles", { user_ids: [deepLinkUserId] }),
          supabase.from("jobs").select("id, title, status, customer_id").eq("id", deepLinkJobId).maybeSingle(),
        ]);

        // Guard: if neither the user profile nor the job record resolved,
        // the deep-link target is a "dead" thread (deleted user + deleted
        // job). Opening it would show "User / Job" placeholders and any
        // send attempt would fail with a FK error — surface a clear error
        // now instead of a silent broken thread.
        const profileFound = !!(profileRes.data?.[0]);
        const jobFound = !!(jobRes.data);
        if (!profileFound && !jobFound) {
          console.warn("[Messages] deep-link resolved to a dead thread — no profile and no job found", { deepLinkUserId, deepLinkJobId });
          toast.error("This conversation link is no longer available.");
          return;
        }

        const name = profileRes.data?.[0]?.full_name || "User";
        const placeholder: Conversation = {
          otherUserId: deepLinkUserId,
          otherUserName: formatName(name),
          otherUserAvatarUrl: profileRes.data?.[0]?.avatar_url ?? null,
          jobTitle: jobRes.data?.title || "Job",
          jobId: deepLinkJobId,
          jobStatus: jobRes.data?.status ?? null,
          viewerIsPoster: jobRes.data?.customer_id === uid,
          lastMessage: "",
          lastAt: new Date().toISOString(),
          unread: 0,
          lastMessageSenderId: null,
          lastMessageAttachmentPath: null,
          lastMessageAttachmentMime: null,
        };
        setConversations(prev => [placeholder, ...prev]);
        setActiveConvo(placeholder);
        navigate("/messages?chat=1", { replace: true });
      }
    }
  };

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

  // Patch a single conversation in local state for one inbound/outbound
  // message — instead of re-running the whole 200-row + RPC
  // `loadConversations`. Updates the affected thread's last-message,
  // unread count, and timestamp, then re-sorts. If the message belongs
  // to a thread not yet in the list (rare — a brand-new conversation),
  // fall back to a full refetch so the new row's profile/job metadata
  // gets resolved.
  const patchConversationForMessage = (msg: Message) => {
    if (!userId) return;
    // System messages have no human sender — they're status notifications
    // that don't update the inbox preview or unread count.
    if (msg.is_system) return;
    const other = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    let matched = false;
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.jobId !== msg.job_id || c.otherUserId !== other) return c;
        matched = true;
        // An inbound message to a thread that is NOT currently open
        // increments the unread badge; outbound messages and messages
        // in the open thread do not.
        const active = activeConvoRef.current;
        const isInboundUnseen =
          msg.receiver_id === userId &&
          !(active &&
            active.jobId === msg.job_id &&
            active.otherUserId === other);
        return {
          ...c,
          lastMessage: msg.content,
          lastAt: msg.created_at,
          unread: isInboundUnseen ? c.unread + 1 : c.unread,
          // Keep the rich-preview metadata in lockstep with the latest
          // message so "You: " prefix and image-thumb previews update
          // live on realtime inserts (and on the sender's own echo).
          lastMessageSenderId: msg.sender_id,
          lastMessageAttachmentPath: msg.attachment_url,
          lastMessageAttachmentMime: msg.attachment_mime,
        };
      });
      if (!matched) return prev;
      // Re-sort so the freshly-touched thread floats to the top.
      next.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
      return next;
    });
    // New conversation we've never seen — only then pay for a full
    // refetch (needs profile + job RPCs to render the row).
    if (!matched) loadConversations(userId);
  };

  // Performs the actual insert for one optimistic message and reconciles
  // its bubble with the server row (or marks it failed). Shared by the
  // first-attempt send path and the retry path so both stay in sync.
  const dispatchMessage = async (optimistic: Message) => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        job_id: optimistic.job_id,
        sender_id: optimistic.sender_id,
        receiver_id: optimistic.receiver_id,
        content: optimistic.content,
        attachment_url: optimistic.attachment_url,
        attachment_mime: optimistic.attachment_mime,
        attachment_size: optimistic.attachment_size,
        // attachment_duration may be null pre-migration — Supabase ignores unknown
        // columns gracefully until the migration is pushed; if the column exists
        // it is stored, if not the row still inserts (no column → ignored by Postgres).
        ...(optimistic.attachment_duration != null
          ? { attachment_duration: optimistic.attachment_duration }
          : {}),
      })
      .select("*")
      .single();

    if (error || !data) {
      // Keep the text on screen and let the user retry it.
      hapticError();
      toast.error("Message didn't go through — tap it to try again.");
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === optimistic.clientId ? { ...m, sendStatus: "failed" } : m,
        ),
      );
      return;
    }

    // Reconcile: swap the optimistic bubble for the confirmed server row.
    // If the realtime echo raced ahead and already appended the real row,
    // drop the optimistic placeholder instead of leaving a duplicate.
    setMessages((prev) => {
      const realAlreadyPresent = prev.some(
        (m) => m.id === data.id && m.clientId === undefined,
      );
      if (realAlreadyPresent) {
        return prev.filter((m) => m.clientId !== optimistic.clientId);
      }
      return prev.map((m) =>
        m.clientId === optimistic.clientId ? { ...data, clientId: optimistic.clientId } : m,
      );
    });
    // Refresh the conversation list so the sender's own thread re-sorts.
    loadConversations(userId!);
  };

  // Returns `true` when the message was accepted for delivery, `false`
  // when it was blocked by the content scan (or there was nothing to
  // send). The caller (ChatView) keys off this to decide whether to
  // clear the composer — a blocked message keeps the user's typed text
  // so they don't silently lose what they wrote.
  const sendMessage = async (
    content: string,
    attachment?: { path: string; mime: string; size: number; duration?: number },
  ): Promise<boolean> => {
    if (!requireOnline()) return false;
    if (!activeConvo || !userId) return false;
    if (!content.trim() && !attachment) return false;

    // Skip scanning for system-generated messages (location shares, attachments)
    const isSystemMessage = content.startsWith("📍 Location:") || !!attachment;

    if (!isSystemMessage) {
      const violations = scanMessage(content);
      if (violations.length > 0) {
        const violationDesc = violations.map((v) => v.label).join(", ");
        if (!warningShown) {
          setWarningShown(true);
          toast.error(
            "⚠️ Warning: Sharing contact info or taking business off-platform is not allowed. This is your first warning — a second offense will result in a permanent ban.",
            { duration: 8000 }
          );
        }
        await logViolation(userId, cachedUser, violationDesc, content);
        // Blocked — report back so the composer keeps the typed text
        // rather than silently discarding it.
        return false;
      }
    }

    // Render the bubble instantly in a "sending" state. The clientId is a
    // stable nonce: it survives reconciliation and lets the realtime echo
    // of our own INSERT be matched back to this bubble (dedupe), while the
    // temporary `id` keeps React keys unique until the server row arrives.
    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: `optimistic-${clientId}`,
      job_id: activeConvo.jobId,
      sender_id: userId,
      receiver_id: activeConvo.otherUserId,
      content: content.trim(),
      read: false,
      created_at: new Date().toISOString(),
      attachment_url: attachment?.path ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size: attachment?.size ?? null,
      attachment_duration: attachment?.duration ?? null,
      clientId,
      sendStatus: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();

    await dispatchMessage(optimistic);
    return true;
  };

  // Retry a previously failed send: flip the bubble back to "sending" and
  // re-dispatch the same content rather than dropping the user's text.
  const retryMessage = async (clientId: string) => {
    const failed = messages.find((m) => m.clientId === clientId && m.sendStatus === "failed");
    if (!failed) return;
    setMessages((prev) =>
      prev.map((m) => (m.clientId === clientId ? { ...m, sendStatus: "sending" } : m)),
    );
    await dispatchMessage({ ...failed, sendStatus: "sending" });
  };

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
