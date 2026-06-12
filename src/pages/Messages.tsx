import { useCallback, useEffect, useState, useRef } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { scanMessage } from "@/lib/messageScanner";
import { useChatPresence } from "@/hooks/useChatPresence";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

import { channelNonce } from "@/lib/realtimeChannel";
import { archiveConversation, isArchived } from "@/lib/archivedConversations";
import { requireOnline } from "@/lib/requireOnline";
import { getMessageAttachmentSignedUrls, isImageMime } from "@/lib/messageAttachments";
import {
  getMutedThreadMap,
  snoozeThread,
  threadMuteKey,
  toggleThreadMute,
  unmuteThread,
} from "@/lib/threadMutes";
import { deriveJobSystemEvents, type JobSystemEvent, type JobTimestamps } from "@/lib/jobSystemEvents";

import type { Conversation, Message } from "@/components/messages/types";
import { ChatView } from "@/components/messages/ChatView";
import { ConversationList } from "@/components/messages/ConversationList";

const CHAT_PAGE_SIZE = 50;

const Messages = () => {
  usePageTitle("Messages — Helpr");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkJobId = searchParams.get("jobId");
  const deepLinkUserId = searchParams.get("userId");
  const { user: cachedUser } = useCurrentUser();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  // Mirror of `activeConvo` for the realtime handlers to read. Keeping it
  // in a ref (kept current by the effect below) lets the subscription
  // effect depend only on the stable `userId` — so opening or switching a
  // conversation no longer tears down and re-subscribes the whole
  // 3-listener channel (a websocket handshake + a window where inbound
  // messages can be missed on every thread switch).
  const activeConvoRef = useRef<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Status-transition events derived from the active job's
  // timestamps — rendered as styled centered <div>s interleaved with
  // the real messages so both participants see what happened on the
  // job ("Helper marked on the way", "Poster confirmed complete") in
  // the same scroll as the conversation. Cleared when the user goes
  // back to the inbox so a stale set never bleeds across threads.
  const [jobSystemEvents, setJobSystemEvents] = useState<JobSystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Tracks a failed message-thread fetch so the chat surfaces a
  // recoverable error instead of the misleading "Say hello." empty state.
  const [chatLoadError, setChatLoadError] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: "message" | "user"; id: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [warningShown, setWarningShown] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteConvoConfirm, setDeleteConvoConfirm] = useState<Conversation | null>(null);
  const [deleteMessageConfirm, setDeleteMessageConfirm] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // Guards the "couldn't load previews" warning to once per mount, so the
  // inbox poll loop doesn't re-toast on every refresh while previews fail.
  const thumbWarningShown = useRef(false);
  const deepLinkHandled = useRef(false);
  // Tracks whether a conversations load has completed at least once, so
  // the skeleton shows only on first load — background refreshes
  // (realtime, returning to the page) keep the existing UI in place.
  const loadedOnceRef = useRef(false);
  const keyboardInset = useKeyboardInset();

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

  // Seed from cache for instant render
  useEffect(() => {
    if (cachedUser && !userId) {
      setUserId(cachedUser.id);
      loadConversations(cachedUser.id);
    }
  }, [cachedUser]);

  // Fallback auth check only if useCurrentUser hasn't loaded yet
  useEffect(() => {
    if (userId || cachedUser) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        loadConversations(session.user.id);
      }
    });
  }, [userId, cachedUser]);

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
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${convo.otherUserId}),and(sender_id.eq.${convo.otherUserId},receiver_id.eq.${userId})`)
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
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId}),and(sender_id.eq.${activeConvo.otherUserId},receiver_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    if (error) {
      console.error("[Messages] refreshActiveThread failed:", error);
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
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId}),and(sender_id.eq.${activeConvo.otherUserId},receiver_id.eq.${userId})`)
      .lt("created_at", oldestMsg.created_at)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    // A failed page fetch: keep the already-loaded thread visible and
    // leave the "Load earlier" affordance so the user can retry.
    if (error) {
      console.error("[Messages] loadOlderMessages failed:", error);
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

  // Realtime subscription. Two channels — one for messages I receive
  // (any thread, drives the conversation-list patch), one for messages
  // I send (so the active thread sees my echo immediately). Server-side
  // filter so we don't receive every INSERT in public.messages — at
  // scale that broadcast firehose would dwarf actual relevant traffic.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`messages-realtime-${userId}-${channelNonce()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          const active = activeConvoRef.current;
          if (active && msg.job_id === active.jobId) {
            setMessages((prev) => [...prev, msg]);
            supabase.from("messages").update({ read: true }).eq("id", msg.id);
            scrollToBottom();
          }
          // Patch just the affected conversation row instead of
          // re-running the whole 200-row + RPC `loadConversations` on
          // every inbound message — that full refetch is a visible lag
          // spike in an active chat.
          patchConversationForMessage(msg);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          // Only echo into the active thread — sender's own conversation
          // list refresh happens in the optimistic sendMessage flow.
          const active = activeConvoRef.current;
          if (active && msg.job_id === active.jobId) {
            setMessages((prev) => {
              // Already reconciled (insert resolved first) — skip.
              if (prev.some((m) => m.id === msg.id)) return prev;
              // The echo may beat the insert's own response. If a pending
              // optimistic bubble matches this row, reconcile it in place
              // instead of appending a duplicate — keep the clientId so the
              // still-in-flight dispatchMessage's reconcile is a no-op.
              const pendingIdx = prev.findIndex(
                (m) =>
                  m.sendStatus === "sending" &&
                  m.sender_id === msg.sender_id &&
                  m.receiver_id === msg.receiver_id &&
                  m.content === msg.content &&
                  m.attachment_url === msg.attachment_url,
              );
              if (pendingIdx !== -1) {
                const next = [...prev];
                next[pendingIdx] = { ...msg, clientId: prev[pendingIdx].clientId };
                return next;
              }
              return [...prev, msg];
            });
            scrollToBottom();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // Depends only on the stable `userId`: the channel is created once and
    // stays subscribed for the page's lifetime. The handlers read the live
    // `activeConvo` via `activeConvoRef` rather than a closed-over value,
    // so switching threads no longer churns the websocket subscription.
  }, [userId]);

  const logViolation = async (violationDescription: string, blockedContent: string) => {
    if (!userId) return;
    const senderName = cachedUser?.user_metadata?.full_name || "A user";

    const { data: existing, error: existingError } = await supabase
      .from("user_violations")
      .select("id")
      .eq("user_id", userId)
      .eq("violation_type", "off_platform");
    // A failed prior-count read previously fell through to priorCount=0,
    // silently downgrading a repeat offence to a first warning. Surface it.
    if (existingError) report(existingError, { severity: "warning", tags: { source: "Messages.logViolation.priorCount" } });

    const priorCount = existing?.length || 0;

    if (priorCount >= 1) {
      await supabase.from("user_bans").insert({
        user_id: userId, ban_type: "permanent",
        reason: "Repeated off-platform activity: " + violationDescription, banned_by: userId,
      });
      await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", userId);
      await supabase.from("user_violations").insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "permanent_ban",
      });
      const { data: adminRoles, error: adminRolesError } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRolesError) report(adminRolesError, { severity: "warning", tags: { source: "Messages.logViolation.adminNotify" } });
      if (adminRoles?.length) {
        await supabase.from("notifications").insert(
          adminRoles.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            title: "⛔ User permanently banned",
            message: `${senderName} was auto-banned for repeated off-platform activity. They tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning",
            link: `/admin?view=reports`,
            read: false,
          })),
        );
      }
      toast.error("Your account is banned. Contact admin@louisianahelpr.com if you think this was a mistake.");
    } else {
      await supabase.from("user_violations").insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "warning",
      });
      await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", userId);
      const { data: adminRoles, error: adminRolesError } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRolesError) report(adminRolesError, { severity: "warning", tags: { source: "Messages.logViolation.adminNotify" } });
      if (adminRoles?.length) {
        await supabase.from("notifications").insert(
          adminRoles.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            title: "⚠️ Off-platform attempt detected",
            message: `${senderName} tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning",
            link: `/admin?view=reports`,
            read: false,
          })),
        );
      }
    }
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
        await logViolation(violationDesc, content);
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

  // Patch a conversation's mute state across both the list and the
  // active-thread mirror in one go. Used by every code path that flips
  // the mute (toggle, snooze, unmute) so they all stay coherent.
  const patchMuteState = useCallback(
    (jobId: string, otherUserId: string, muted: boolean, muteUntil: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.jobId === jobId && c.otherUserId === otherUserId
            ? { ...c, isMuted: muted, muteUntil }
            : c,
        ),
      );
      if (
        activeConvoRef.current &&
        activeConvoRef.current.jobId === jobId &&
        activeConvoRef.current.otherUserId === otherUserId
      ) {
        setActiveConvo((cur) =>
          cur ? { ...cur, isMuted: muted, muteUntil } : cur,
        );
      }
    },
    [],
  );

  // Toggle the muted state of the active thread (or any conversation by
  // jobId+otherUserId). Optimistic: flip the local flag immediately and
  // reconcile against the RPC's authoritative return value. On error,
  // revert and surface a toast so the bell-slash never silently lies.
  //
  // This is the "binary" toggle — for the picker-driven snooze flow,
  // callers use `handleSnoozeMute` below.
  const handleToggleMute = useCallback(
    async (convo: Conversation) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      hapticHeavy();
      patchMuteState(convo.jobId, convo.otherUserId, !prevMuted, null);
      try {
        const newMuted = await toggleThreadMute(
          userId,
          convo.jobId,
          convo.otherUserId,
        );
        patchMuteState(convo.jobId, convo.otherUserId, newMuted, null);
        hapticSuccess();
        toast.success(newMuted ? "Notifications muted" : "Notifications on");
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleToggleMute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

  // Snooze a thread until a caller-supplied moment. `null` mutes forever
  // (same end-state as `handleToggleMute` when going off→on); a past
  // timestamp explicitly clears the mute. Optimistic with rollback,
  // mirrors `handleToggleMute`'s recovery model.
  const handleSnoozeMute = useCallback(
    async (convo: Conversation, until: Date | null) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      const targetIso = until ? until.toISOString() : null;
      const targetMuted = until ? until.getTime() > Date.now() : true;
      hapticHeavy();
      patchMuteState(
        convo.jobId,
        convo.otherUserId,
        targetMuted,
        targetMuted ? targetIso : null,
      );
      try {
        const serverUntil = await snoozeThread(
          userId,
          convo.jobId,
          convo.otherUserId,
          until,
        );
        const finalMuted = serverUntil
          ? Date.parse(serverUntil) > Date.now()
          : until === null;
        patchMuteState(
          convo.jobId,
          convo.otherUserId,
          finalMuted,
          finalMuted ? serverUntil : null,
        );
        hapticSuccess();
        if (until === null) toast.success("Notifications muted");
        else if (until.getTime() <= Date.now()) toast.success("Notifications on");
        else toast.success(`Muted until ${until.toLocaleString([], { hour: "numeric", minute: "2-digit", hour12: true })}`);
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleSnoozeMute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

  // Explicit unmute (clears any forever or snoozed mute). Used by the
  // mute picker's "Turn notifications back on" action.
  const handleUnmute = useCallback(
    async (convo: Conversation) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      hapticHeavy();
      patchMuteState(convo.jobId, convo.otherUserId, false, null);
      try {
        await unmuteThread(userId, convo.jobId, convo.otherUserId);
        hapticSuccess();
        toast.success("Notifications on");
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleUnmute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

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

  return (
    <>
      {!activeConvo ? (
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
        />
      ) : (
        <ChatView
          activeConvo={activeConvo}
          setActiveConvo={setActiveConvo}
          keyboardInset={keyboardInset}
          isOtherOnline={isOtherOnline}
          isOtherTyping={isOtherTyping}
          broadcastTyping={broadcastTyping}
          messages={messages}
          userId={userId}
          chatLoadError={chatLoadError}
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
        />
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
            if (activeConvo?.otherUserId === blockTarget.id) {
              setActiveConvo(null);
              navigate("/messages", { replace: true });
            }
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
