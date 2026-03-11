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

export const OnlineIndicator = ({ isOnline }: { isOnline: boolean }) => (
  <span
    className={`inline-block w-2 h-2 rounded-full ${
      isOnline ? "bg-green-500" : "bg-muted-foreground/30"
    }`}
    title={isOnline ? "Online" : "Offline"}
  />
);

export const TypingIndicator = () => (
  <div className="flex items-center gap-1 text-xs text-muted-foreground px-4 py-1">
    <span className="flex gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
    typing…
  </div>
);

export const ReadReceipt = ({ read, sentByMe }: { read: boolean; sentByMe: boolean }) => {
  if (!sentByMe) return null;
  return (
    <span className="text-[10px] ml-1">
      {read ? "✓✓" : "✓"}
    </span>
  );
};
