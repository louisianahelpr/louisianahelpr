import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ChatPresenceProps {
  channelName: string;
  userId: string;
  otherUserId: string;
}

export function useChatPresence({ channelName, userId, otherUserId }: ChatPresenceProps) {
  const [isOtherOnline, setIsOtherOnline] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [channelName, userId, otherUserId]);

  const broadcastTyping = () => {
    supabase.channel(`presence-${channelName}`).send({
      type: "broadcast",
      event: "typing",
      payload: { userId },
    });
  };

  return { isOtherOnline, isOtherTyping, broadcastTyping };
}
