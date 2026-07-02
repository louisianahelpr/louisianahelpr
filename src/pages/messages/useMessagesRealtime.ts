import { useEffect, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import type { Conversation, Message } from "@/components/messages/types";

/**
 * Realtime subscription. Two channels — one for messages I receive
 * (any thread, drives the conversation-list patch), one for messages
 * I send (so the active thread sees my echo immediately). Server-side
 * filter so we don't receive every INSERT in public.messages — at
 * scale that broadcast firehose would dwarf actual relevant traffic.
 *
 * Extracted verbatim from Messages.tsx: the channel-name nonce
 * (`channelNonce()`), the per-listener server-side `filter`, and the
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
}: {
  userId: string | null;
  activeConvoRef: MutableRefObject<Conversation | null>;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  patchConversationForMessage: (msg: Message) => void;
}) {
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
            // The insert also spawned a type='message' notifications row via
            // trigger; the user is looking at this thread, so clear it now to
            // keep the bell from counting a message they're actively reading.
            void supabase
              .from("notifications")
              .update({ read: true })
              .eq("user_id", userId)
              .eq("type", "message")
              .eq("read", false)
              .like("link", `%job=${msg.job_id}%`);
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
}
