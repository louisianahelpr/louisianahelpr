export { useChatPresence } from "@/hooks/useChatPresence";

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
