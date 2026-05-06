import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

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

    const channel = supabase.channel(`presence-${channelName}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
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
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          channelRef.current = channel;
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);
      channelRef.current = null;
      supabase.removeChannel(channel);
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
