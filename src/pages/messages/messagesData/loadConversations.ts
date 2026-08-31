import type { MutableRefObject } from "react";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { getMessageAttachmentSignedUrls, isImageMime } from "@/lib/messageAttachments";
import { getMutedThreadMap, threadMuteKey } from "@/lib/threadMutes";
import type { Conversation, Message } from "@/components/messages/types";

/**
 * One person, resolved once.
 *
 * The inbox used to build the name and the avatar into two parallel `Map`s.
 * They happened to be filled from the same RPC result, but nothing tied them
 * together — a row could be added to one and missed by the other, and the
 * screen would then show one person's name over another person's face. On a
 * messaging surface that is not a cosmetic bug: the avatar is how you decide
 * who you are talking to. Both fields now come out of a single record, so the
 * two cannot drift apart by construction.
 */
type ResolvedProfile = {
  /** Display name, already run through `formatName` ("Marie H."). */
  name: string;
  /** Photo URL, or null for the initials/gradient fallback. */
  avatarUrl: string | null;
};

/** The house label for someone we genuinely could not resolve. */
const UNRESOLVED_PERSON = formatName(null);

/**
 * Index the `get_safe_profiles` result by BOTH of a person's ids.
 *
 * `profiles.id` (a standalone PK) and `profiles.user_id` (the auth id) are
 * different uuids for the same human. A message's `sender_id` / `receiver_id`
 * is supposed to be the auth id, but those columns carry no foreign key
 * (verified against prod: only `job_id` and `reply_to_id` are constrained), so
 * profile ids do occur in the wild — prod has a seeded thread keyed that way.
 * Looking up such a thread by auth id alone found nothing, and the row fell
 * through to a literal "User" with no avatar.
 *
 * Keying the map by both ids resolves the thread whichever id it holds, and —
 * because both keys point at the SAME `ResolvedProfile` — the name and the
 * avatar still come from one row.
 *
 * `profile_id` is a newer column on the RPC. During the window between a merge
 * and the migration finishing its deploy the field is simply absent, which the
 * guard below treats as "no second key" rather than crashing.
 */
function indexProfiles(
  rows: Array<{
    user_id?: string | null;
    profile_id?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null,
): Map<string, ResolvedProfile> {
  // TWO PASSES, deliberately. A single shared map with unconditional
  // `.set(user_id, …)` then `.set(profile_id, …)` calls is order-dependent:
  // if row A's user_id equals row B's profile_id (the exact collision F-1
  // found — Audit Helper's auth id IS Eli Thibodeaux's profiles.id), whichever
  // `.set()` ran last silently overwrote the other, keyed on RPC row order,
  // not on which key is the real answer. That is how this same bug reached
  // Messages: this thread's counterpart resolved to Eli instead of Audit
  // Helper. `user_id` is always the authoritative key for `otherUserId`
  // lookups; `profile_id` is a fallback for rows that only exist to serve
  // legacy profile-id-as-sender_id threads (see the comment above), so it
  // must never be allowed to clobber a real user_id entry.
  const byId = new Map<string, ResolvedProfile>();
  for (const p of rows ?? []) {
    if (!p.user_id) continue;
    byId.set(p.user_id, { name: formatName(p.full_name), avatarUrl: p.avatar_url ?? null });
  }
  for (const p of rows ?? []) {
    if (!p.profile_id || byId.has(p.profile_id)) continue;
    byId.set(p.profile_id, { name: formatName(p.full_name), avatarUrl: p.avatar_url ?? null });
  }
  return byId;
}

/**
 * The inbox loader for the Messages page. It owns the 200-row `messages`
 * fetch, the batched profile / job / mute / last-active / signed-URL RPCs, and
 * the conversation de-duplication. Every Supabase query, its error handling,
 * and every "why" comment are preserved from the original hook body.
 *
 * This is a PURE fetcher — it takes a uid and returns rows. It is the
 * `queryFn` behind `queryKeys.messages.conversations(uid)` (see
 * `useMessagesData`), which is what lets the inbox paint from cache the
 * instant the user re-enters the tab instead of blanking to a skeleton and
 * refetching from scratch on every visit.
 *
 * Two consequences of being a queryFn rather than a setState-driven loader:
 *
 *  - The primary `messages` read goes through `unwrap()`. A failure throws,
 *    React Query flips the query to its error state, and the page renders its
 *    recoverable ErrorState — instead of the old `setLoadError(true)` path
 *    (and never the misleading "No messages yet" empty state).
 *  - The local-archive filter is NOT applied here. This returns the full
 *    conversation list; `useMessagesData` derives the visible inbox from it.
 *    Deep links must be resolvable against threads the user has archived
 *    locally, which the pre-cache code did by matching against this same
 *    unfiltered list.
 */
export async function fetchConversations(
  uid: string,
  thumbWarningShown: MutableRefObject<boolean>,
): Promise<Conversation[]> {
  // The blocked-user set is only used to FILTER the fetched rows (below) —
  // it is never needed to issue the messages query, whose only argument is
  // `uid`. Awaiting it first (as this used to) put the dynamic import's
  // chunk fetch AND a full network round in front of the inbox's own query,
  // for no reason. Both now fly together: one round instead of two
  // (~215ms measured RTT), a third off the inbox's time-to-first-paint.
  const blockedPromise = import("@/lib/userBlocks").then(({ getBlockedUserIds }) =>
    getBlockedUserIds(uid),
  );

  // unwrap: a failed inbox fetch must surface as the query's error state
  // (→ recoverable ErrorState), never fall through to "No messages yet".
  const msgsRes = await supabase
    .from("messages")
    .select("*")
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order("created_at", { ascending: false })
    .limit(200);

  const blockedSet = await blockedPromise;
  const msgs = unwrap(msgsRes);

  if (!msgs || msgs.length === 0) return [];

  const filteredMsgs = msgs.filter((m: any) => {
    // System messages (sender_id IS NULL) never drive the conversation
    // list — they belong inside the thread view only. Skip them here so
    // they don't inflate unread counts or appear as the "last message"
    // preview in the inbox.
    if (m.is_system) return false;
    // Messages the server hid (scan_message_content sets flagged_hidden when
    // it detects off-platform contact info) must not surface HERE either. The
    // three thread-level queries in useMessagesData.ts all filter this; the
    // inbox query did not, so a message the server had already hidden still
    // rendered in full — phone number and all — as the conversation's preview
    // line. That made the off-platform-contact defence bypassable by anyone
    // POSTing straight to the API: flagged on the server, delivered anyway.
    // Matches the thread queries' `sender_id.eq.<me>,flagged_hidden.eq.false`
    // semantics exactly: the SENDER still sees what they wrote (so a blocked
    // message doesn't just vanish on them), the RECIPIENT does not.
    if (m.flagged_hidden && m.sender_id !== uid) return false;
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
    supabase.from("jobs").select("id, title, status, customer_id, helper_id, offered_to_helper_id").in("id", jobIds),
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

  // unwrap: identity is not enrichment. `profilesRes.data?.map(...) || []` used
  // to swallow a failed RPC into an inbox where every thread was named "User" —
  // a screen that looks loaded but tells you nothing about who you are talking
  // to, and the exact mechanism that hid this whole class of bug. A failure now
  // flips the query to its error state and the page offers a retry.
  const profileMap = indexProfiles(unwrap(profilesRes));
  // Job titles ARE enrichment — a thread with a "Job" placeholder title is
  // still usable, so a failed jobs read degrades rather than blanking the
  // inbox. But it is reported, never silently dropped.
  if (jobsRes.error) {
    report(jobsRes.error, {
      severity: "warning",
      tags: { source: "loadConversations.jobs" },
    });
  }
  const jobMap = new Map(jobsRes.data?.map((j) => [j.id, { title: j.title, status: j.status, customer_id: j.customer_id, helper_id: j.helper_id, offered_to_helper_id: j.offered_to_helper_id }]) || []);

  const convos: Conversation[] = [...convoMap.entries()].map(([, v]) => {
    const last = v.messages[0];
    const lastIsImage = !!last.attachment_url && isImageMime(last.attachment_mime);
    // ONE lookup backs both the name and the face. The old code read two
    // separate maps here, which is how a row could show one person's name
    // beside another person's avatar.
    const other = profileMap.get(v.otherUserId);
    return {
    otherUserId: v.otherUserId,
    // Only genuinely unresolvable people (deleted, banned, never approved)
    // reach the fallback now, and they get the house label rather than the
    // bare word "User".
    otherUserName: other?.name || UNRESOLVED_PERSON,
    otherUserAvatarUrl: other?.avatarUrl ?? null,
    jobTitle: jobMap.get(v.jobId)?.title || "a task",
    jobId: v.jobId,
    jobStatus: jobMap.get(v.jobId)?.status ?? null,
    // Track whether the current user is the poster on this job so the
    // chat can render poster-specific quick replies (vs helper-specific).
    viewerIsPoster: jobMap.get(v.jobId)?.customer_id === uid,
    // Mirrors case 2 of the `can_message_in_job` RLS check: the helper this
    // job is assigned to, or offered to, is NOT an applicant and must keep a
    // working composer. Without this the poster-first lock outlived
    // acceptance and muted the hired helper mid-job.
    viewerIsAssignedHelper:
      !!uid &&
      (jobMap.get(v.jobId)?.helper_id === uid ||
        jobMap.get(v.jobId)?.offered_to_helper_id === uid),
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
  return convos;
}

/**
 * Build the placeholder thread for a `?jobId=&userId=` deep link that has no
 * existing conversation, so the user can start messaging. Extracted verbatim
 * from the tail of the old `loadConversations`; returns `null` (after a toast)
 * when the link resolves to a dead thread, which is the caller's cue to leave
 * the inbox untouched.
 */
export async function buildDeepLinkPlaceholder(
  uid: string,
  deepLinkJobId: string,
  deepLinkUserId: string,
): Promise<Conversation | null> {
  // No existing conversation — fetch profile + job to build a
  // placeholder thread so the user can start messaging.
  const [profileRes, jobRes] = await Promise.all([
    supabase.rpc("get_safe_profiles", { user_ids: [deepLinkUserId] }),
    supabase.from("jobs").select("id, title, status, customer_id, helper_id, offered_to_helper_id").eq("id", deepLinkJobId).maybeSingle(),
  ]);

  // A FAILED read is not the same fact as an ABSENT row, and the dead-thread
  // guard below cannot tell them apart from `data` alone — two errored reads
  // look exactly like a deleted user plus a deleted job. Surface the error so
  // a transient outage is never reported to the user as "this link is gone".
  const lookupError = profileRes.error ?? jobRes.error;
  if (lookupError) {
    report(lookupError, {
      severity: "warning",
      tags: { source: "buildDeepLinkPlaceholder" },
    });
    toast.error("Couldn't open that conversation — please try again.");
    return null;
  }

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
    return null;
  }

  // Same one-record rule as the inbox: the placeholder's name and avatar come
  // out of a single resolved profile, keyed by either of the person's two ids
  // (the deep link may carry a `profiles.id`). The old code passed the literal
  // string "User" through `formatName`, which returned it verbatim — that is
  // where the bare "User" in a thread title came from.
  const resolved = indexProfiles(profileRes.data).get(deepLinkUserId);
  return {
    otherUserId: deepLinkUserId,
    otherUserName: resolved?.name || UNRESOLVED_PERSON,
    otherUserAvatarUrl: resolved?.avatarUrl ?? null,
    jobTitle: jobRes.data?.title || "a task",
    jobId: deepLinkJobId,
    jobStatus: jobRes.data?.status ?? null,
    viewerIsPoster: jobRes.data?.customer_id === uid,
    // Same rule as the list path above — see the comment there.
    viewerIsAssignedHelper:
      !!uid &&
      (jobRes.data?.helper_id === uid ||
        jobRes.data?.offered_to_helper_id === uid),
    lastMessage: "",
    lastAt: new Date().toISOString(),
    unread: 0,
    lastMessageSenderId: null,
    lastMessageAttachmentPath: null,
    lastMessageAttachmentMime: null,
  };
}
