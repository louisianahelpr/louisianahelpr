import { MessageSquare } from "lucide-react";

/**
 * Desktop right-pane resting state, shown when no thread is selected yet
 * in the side-by-side split. Purely presentational.
 */
export const MessagesEmptyThread = () => (
  <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-8 gap-3">
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center"
      style={{
        backgroundColor: "hsl(var(--ivory-sand) / 0.55)",
        border: "1px solid hsl(var(--olivewood) / 0.10)",
      }}
    >
      <MessageSquare
        className="w-7 h-7"
        style={{ color: "hsl(var(--bark))" }}
        strokeWidth={1.5}
      />
    </div>
    <p
      className="font-display italic font-bold text-ds-18"
      style={{
        color: "hsl(var(--ink-deep))",
        letterSpacing: "-0.015em",
      }}
    >
      Your conversations
    </p>
    <p
      className="font-serif italic text-ds-14 max-w-[280px]"
      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
    >
      Pick a thread on the left to read and reply here.
    </p>
  </div>
);
