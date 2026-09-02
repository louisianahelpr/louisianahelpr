import { report } from "@/lib/errorLogger";
import { useEffect, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import type { Conversation, Message } from "@/components/messages/types";

/**
 * Realtime subscription. Two channels — one for messages I receive
 * (any thread, drives the conversation-list patch), one for messages
 * I send (so the active thread sees my echo immediately). Server-side
 * filter so we don't receive every INSERT in public.messages — at
 * scale that broadcast firehose would dwarf actual relevant traffic.
 *
 * Extracted verbatim from Messages.tsx: the channel-name nonce
 * (now minted per attempt by subscribeWithRecovery), the per-listener server-side `filter`, and the
 * userId-only dependency are all preserved exactly. The handlers read the
 * live `activeConvo` via `activeConvoRef` and call back into the page's
 * state setters so the channel stays mounted for the page's lifetime.
 */
export function useMessagesRealtime({
  userId,
  activeConvoRef,
  setMessages,
  scrollToBottom,
  patchConversationForMessage,
  onRecovered,
}: {
  userId: string | null;
  activeConvoRef: MutableRefObject<Conversation | null>;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  patchConversationForMessage: (msg: Message) => void;
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
    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
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
            // `read_at` isn't in the generated types yet (migration lag —
            // see supabase/migrations/20260830233932_add_messages_read_at.sql),
            // same `as any` pattern used elsewhere in this file for
            // brand-new columns.
            void supabase
              .from("messages")
              .update({ read: true, read_at: new Date().toISOString() } as any)
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
      .on(
        "postgres_changes",
        // Mirrors the sender-side UPDATE listener above, but for messages
        // *received* by this user — otherwise a sender's edit (see
        // supabase/migrations/20260831003117_add_message_editing.sql) never
        // reaches the other participant's open thread until they leave and
        // reopen it.
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${userId}`,
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
      { name: `messages-realtime-${userId}`, onRecovered },
    );

    return () => { sub.close(); };
    // Depends only on the stable `userId`: the channel is created once and
    // stays subscribed for the page's lifetime. The handlers read the live
    // `activeConvo` via `activeConvoRef` rather than a closed-over value,
    // so switching threads no longer churns the websocket subscription.
  }, [userId]);
}
