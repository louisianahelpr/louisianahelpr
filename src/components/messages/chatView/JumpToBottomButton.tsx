import type { MutableRefObject } from "react";
import { ChevronsDown } from "lucide-react";

/**
 * Jump-to-new-messages / jump-to-newest button.
 * When the user is scrolled above the first unread inbound
 * message, the chip targets that message and counts the
 * unread tail ("3 new messages"). Otherwise — once they've
 * scrolled past the unread anchor — it falls back to the
 * "newest message" jump so they can get back to the bottom
 * without scrolling manually. Hidden on empty threads.
 * Extracted verbatim from ChatView — markup unchanged.
 */
export function JumpToBottomButton({
  firstUnreadOffscreen,
  showJumpToBottom,
  hasMessages,
  scrollContainerRef,
  initialFirstUnreadIdRef,
  initialUnreadCountRef,
}: {
  firstUnreadOffscreen: boolean;
  showJumpToBottom: boolean;
  hasMessages: boolean;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  initialFirstUnreadIdRef: MutableRefObject<string | null>;
  initialUnreadCountRef: MutableRefObject<number>;
}) {
  if (!((firstUnreadOffscreen || showJumpToBottom) && hasMessages)) return null;
  return (
    <div className="flex justify-center -mt-1 mb-1 pointer-events-none">
      <button
        type="button"
        className="pointer-events-auto flex items-center gap-1 px-3 py-1 rounded-full text-ds-11 font-medium shadow-md transition-all active:scale-95"
        style={{
          background: "hsl(var(--bark))",
          color: "hsl(var(--parchment))",
          boxShadow:
            "0 2px 8px hsl(var(--bark) / 0.28), " +
            "inset 0 1px 0 0 rgba(255,255,255,0.12)",
        }}
        aria-label={
          firstUnreadOffscreen
            ? `Jump to ${initialUnreadCountRef.current} new message${initialUnreadCountRef.current === 1 ? "" : "s"}`
            : "Jump to newest message"
        }
        onClick={() => {
          const el = scrollContainerRef.current;
          if (!el) return;
          const firstUnreadId = initialFirstUnreadIdRef.current;
          if (firstUnreadOffscreen && firstUnreadId) {
            const node = el.querySelector<HTMLDivElement>(
              `[data-msg-id="${firstUnreadId}"]`,
            );
            if (node) {
              node.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              return;
            }
          }
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }}
      >
        <ChevronsDown className="w-3 h-3" />
        {firstUnreadOffscreen
          ? `${initialUnreadCountRef.current} New Message${initialUnreadCountRef.current === 1 ? "" : "s"}`
          : "New Messages"}
      </button>
    </div>
  );
}
