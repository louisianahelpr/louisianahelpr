import { report } from "@/lib/errorLogger";
import { useEffect, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import type { Conversation, Message } from "@/components/messages/types";

/**
 * Realtime subscription. Messages I receive (any thread, drives the
 * conversation-list patch) arrive on the shared per-user bus; messages I
 * send (so the active thread sees my echo immediately) and deletes on this
 * page's own channel. Server-side
 * filter so we don't receive every INSERT in public.messages — at
 * scale that broadcast firehose would dwarf actual relevant traffic.
 *
 * Extracted verbatim from Messages.tsx: the channel-name nonce
 * (now minted per attempt by subscribeWithRecovery), the per-listener server-side `filter`, and the
 * userId-only dependency are all preserved exactly. The handlers read the
 * live `activeConvo` via `activeConvoRef` and call back into the page's
 * state setters so the channel stays mounted for the page's lifetime.
 */
/** How long both channels get to come back before the one catch-up re-read. */
export const RECOVERY_SETTLE_MS = 750;

export function useMessagesRealtime({
  userId,
  activeConvoRef,
  setMessages,
  scrollToBottom,
  patchConversationForMessage,
  onJobStatusAnnouncement,
  onRecovered,
}: {
  userId: string | null;
  activeConvoRef: MutableRefObject<Conversation | null>;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  patchConversationForMessage: (msg: Message) => void;
  /**
   * Fold a `messages` row flagged `is_system` — the job-status announcement
   * the DB trigger writes in the same transaction as the transition — back
   * into the thread's status and closing instant.
   *
   * REQUIRED, not optional, and wired into BOTH message listeners below. The
   * trigger writes the announcement with the poster as `sender_id` and the
   * other participant as `receiver_id`, so exactly one of the two listeners
   * sees it for each party: hooking only one closes the thread in place for
   * the helpr and leaves the poster on the fail-on-tap path (or the reverse).
   * An optional prop is a hole a future caller reopens by omission — the same
   * reasoning as `onRecovered` below.
   */
  onJobStatusAnnouncement: (msg: Message) => void;
  /**
   * Re-read the inbox and the open thread after the channel comes back.
   *
   * REQUIRED, not optional. This channel is the ONLY delivery path for an
   * inbound message — there is no poll behind it — so every message written
   * during an outage is invisible until something refetches, and a reconnect
   * on its own only restores messages sent from that second onward. A silent
   * hole in a conversation is the worst version of this bug in the app, and an
   * optional prop is a hole a future caller can reopen by omission.
   */
  onRecovered: () => void;
}) {
  useEffect(() => {
    if (!userId) return;
    const onInboundInsert = (payload: { new: unknown }) => {
      const msg = payload.new as Message;
      const active = activeConvoRef.current;
      // A status announcement closes (or re-dates) the thread BEFORE the
      // user touches anything. Unconditional on the active thread: the
      // inbox row's chip has to move too, and this is the only delivery
      // path that says the job changed.
      if (msg.is_system) onJobStatusAnnouncement(msg);
      // Same-job is not enough: a poster can have several applicant
      // threads on ONE job, and a message from applicant B must not be
      // appended into (or marked read by) applicant A's open thread.
      // System rows have no human counterparty and always belong.
      if (
        active &&
        msg.job_id === active.jobId &&
        (msg.is_system || msg.sender_id === active.otherUserId)
      ) {
        setMessages((prev) => [...prev, msg]);
        // A bare builder never fires — PostgrestBuilder issues its fetch
        // inside then(). This read-receipt was never sent, so messages the
        // user was actively reading stayed unread forever.
        // `read` ONLY. This wrote `{ read, read_at }` and every call was a
        // 403: 20260824180000 (R11) locked the table to column-level
        // `GRANT UPDATE (read)` so a recipient cannot rewrite a sender's
        // message, and 20260830233932 added `read_at` six days later
        // without extending the grant. Postgres refuses the whole
        // statement when any named column is unprivileged, so from
        // 2026-08-30 no client could mark a message read through this
        // path — reproduced live 2026-09-07 as the poster: PATCH
        // {read,read_at} → 42501, PATCH {read} → 200. The optimistic flag
        // then reverted and the unread badge came straight back.
        // `read_at` belongs to the database (a trigger stamping it when
        // `read` flips, or the grant widened); the client never needs to
        // send it.
        void supabase
          .from("messages")
          .update({ read: true })
          .eq("id", msg.id)
          .then(({ error }) => {
            if (error) report(error, { tags: { source: "useMessagesRealtime.markRead" } });
          });
        // The insert also spawned a type='message' notifications row via
        // trigger; the user is looking at this thread, so clear it now to
        // keep the bell from counting a message they're actively reading.
        // Same dead-`void` pattern: without a .then() the request is
        // never issued, so the bell kept counting a message the user was
        // looking at.
        // The link (`/messages?jobId=<id>`) carries no sender, so scope
        // the clear by time: the trigger inserts the notification in the
        // same transaction as the message (identical created_at), and we
        // only get here for messages from the open thread's counterparty
        // — so rows newer than this message (other threads' later
        // traffic) are left alone.
        void supabase
          .from("notifications")
          .update({ read: true })
          .eq("user_id", userId)
          .eq("type", "message")
          .eq("read", false)
          .like("link", `%jobId=${msg.job_id}%`)
          .lte("created_at", msg.created_at)
          .then(({ error }) => {
            if (error) report(error, { tags: { source: "useMessagesRealtime.clearMessageNotif" } });
          });
        scrollToBottom();
      }
      // Patch just the affected conversation row instead of
      // re-running the whole 200-row + RPC `loadConversations` on
      // every inbound message — that full refetch is a visible lag
      // spike in an active chat.
      patchConversationForMessage(msg);
    };
    // Mirrors the sender-side UPDATE listener below, but for messages
    // *received* by this user — otherwise a sender's edit (see
    // supabase/migrations/20260831003117_add_message_editing.sql) never
    // reaches the other participant's open thread until they leave and
    // reopen it.
    const onInboundUpdate = (payload: { new: unknown }) => {
      const updated = payload.new as Message;
      setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
    };
    // Both drop together on a socket loss; re-read once, not once per channel.
    // TRAILING, not leading: the re-read must run after the LAST channel is back.
    // A leading throttle re-read when the first came back and ignored the second,
    // so a message received between the two was on neither (Q105 review).
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const recover = () => {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(onRecovered, RECOVERY_SETTLE_MS);
    };
    // Messages I RECEIVE ride the shared per-user channel
    // (src/lib/userRealtimeBus.ts, topic `messages:inbound`, one
    // `messages *` receiver_id binding) that the nav unread badge already
    // holds open on every signed-in page, instead of a second copy of the
    // same subscription here (Q105). Split by event type.
    const unsubscribeInbound = subscribeUserRealtime(
      userId,
      "messages:inbound",
      (payload) => {
        if (payload.eventType === "INSERT") onInboundInsert(payload);
        else if (payload.eventType === "UPDATE") onInboundUpdate(payload);
      },
      { onRecovered: recover },
    );
    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
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
          // The POSTER's copy of a status announcement lands here, not on the
          // receiver listener above: the trigger stamps `sender_id` with
          // `NEW.customer_id` (migration 20260720130000). Same call, so the
          // thread closes in place for whichever side of it you are on.
          if (msg.is_system) onJobStatusAnnouncement(msg);
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
      .on(
        "postgres_changes",
        // No server-side filter here, deliberately: a DELETE payload carries
        // only the old row's primary key (REPLICA IDENTITY default), so a
        // receiver_id filter can never match and would silently drop every
        // event. The payload is just an id and the handler only prunes local
        // state, so the unfiltered stream costs a few bytes per delete.
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const deletedId = (payload.old as { id?: string } | null)?.id;
          if (!deletedId) return;
          // A message deleted by the other participant disappears from the
          // open thread instead of lingering until the next refetch.
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        },
      ),
      { name: `messages-realtime-${userId}`, onRecovered: recover },
    );

    return () => {
      clearTimeout(recoveryTimer);
      unsubscribeInbound();
      sub.close();
    };
    // Depends only on the stable `userId`: the channel is created once and
    // stays subscribed for the page's lifetime. The handlers read the live
    // `activeConvo` via `activeConvoRef` rather than a closed-over value,
    // so switching threads no longer churns the websocket subscription.
  }, [userId]);
}
