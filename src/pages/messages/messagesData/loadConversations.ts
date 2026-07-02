import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getMessageAttachmentSignedUrls, isImageMime } from "@/lib/messageAttachments";
import { getMutedThreadMap, threadMuteKey } from "@/lib/threadMutes";
import { isArchived } from "@/lib/archivedConversations";
import type { Conversation, Message } from "@/components/messages/types";

/**
 * The inbox loader for the Messages page, extracted verbatim from the
 * `useMessagesData` hook. It owns the 200-row `messages` fetch, the batched
 * profile / job / mute / last-active / signed-URL RPCs, the conversation
 * de-duplication, archive filtering, and the deep-link auto-open (including
 * the placeholder-thread fallback). Every Supabase query, its error handling,
 * and every "why" comment are preserved unchanged from the original hook body.
 *
 * The hook wires this factory with the state setters + refs it can't create
 * for itself; the returned `loadConversations(uid)` keeps the exact signature
 * the page (and the realtime / auth effects) call.
 */
export function createLoadConversations({
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
}: {
  deepLinkJobId: string | null;
  deepLinkUserId: string | null;
  navigate: NavigateFunction;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadError: Dispatch<SetStateAction<boolean>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setActiveConvo: Dispatch<SetStateAction<Conversation | null>>;
  loadedOnceRef: MutableRefObject<boolean>;
  thumbWarningShown: MutableRefObject<boolean>;
  deepLinkHandled: MutableRefObject<boolean>;
}) {
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

  return loadConversations;
}
