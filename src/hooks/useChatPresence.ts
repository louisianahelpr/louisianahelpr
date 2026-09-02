import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";

interface ChatPresenceProps {
  channelName: string;
  userId: string;
  otherUserId: string;
}

const TYPING_HIDE_AFTER_MS = 3_000;
const TYPING_BROADCAST_THROTTLE_MS = 2_000;

// Realtime presence + typing for a 1:1 chat thread.
// broadcastTyping() can be called freely (e.g. on every keystroke); it's
// throttled to one broadcast per 2 seconds.
//
// Bug fix: previously the hook created a fresh `supabase.channel(name)` on
// every broadcastTyping() call, producing a new unsubscribed channel object
// each time so broadcasts didn't reliably reach other subscribers. Now we
// hold the subscribed channel in a ref and reuse it for sends.
export function useChatPresence({ channelName, userId, otherUserId }: ChatPresenceProps) {
  const [isOtherOnline, setIsOtherOnline] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingHideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastBroadcastAtRef = useRef(0);

  useEffect(() => {
    if (!userId || !otherUserId) return;

    const sub = subscribeWithRecovery(
      (name) => {
        // `ch` is captured rather than read back off the subscription, because
        // presenceState() is called from inside this channel's own handler —
        // at which point the subscription object does not exist yet.
        const ch = supabase.channel(name, {
          config: { presence: { key: userId } },
        });
        return ch
          .on("presence", { event: "sync" }, () => {
            const state = ch.presenceState();
            setIsOtherOnline(!!state[otherUserId]);
          })
          .on("broadcast", { event: "typing" }, (payload) => {
            if (payload.payload?.userId === otherUserId) {
              setIsOtherTyping(true);
              if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);
              typingHideTimerRef.current = setTimeout(
                () => setIsOtherTyping(false),
                TYPING_HIDE_AFTER_MS,
              );
            }
          });
      },
      {
        name: `presence-${channelName}`,
        // Presence is a RENDEZVOUS: both people must open the same channel
        // name or they are in different rooms and neither ever sees the other.
        // This is the one channel in the app that must not carry a nonce.
        stableName: true,
        onStatus: (status, _err, ch) => {
          if (status === "SUBSCRIBED") {
            channelRef.current = ch;
            // Re-announce on every (re)subscribe: the server drops our presence
            // entry when the socket goes, so a reconnect that skipped this
            // would leave us subscribed and invisible to the other side.
            void ch.track({ online_at: new Date().toISOString() });
            return;
          }
          // The ref used to be cleared only on unmount, so after a drop
          // broadcastTyping() kept sending into a dead channel and returning
          // as if it had worked.
          channelRef.current = null;
        },
      },
    );

    return () => {
      if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);
      channelRef.current = null;
      sub.close();
    };
  }, [channelName, userId, otherUserId]);

  const broadcastTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return; // not yet subscribed

    const now = Date.now();
    if (now - lastBroadcastAtRef.current < TYPING_BROADCAST_THROTTLE_MS) return;
    lastBroadcastAtRef.current = now;

    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId },
    });
  }, [userId]);

  return { isOtherOnline, isOtherTyping, broadcastTyping };
}
