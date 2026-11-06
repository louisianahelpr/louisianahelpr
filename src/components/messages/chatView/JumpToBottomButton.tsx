import type { MutableRefObject } from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      {/* The shared primary Button, sm (Q2709 11-05): the olive pill, its press and focus ring. */}
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="pointer-events-auto gap-1 px-3 text-ds-13 [&_svg]:size-3"
        aria-label={
          firstUnreadOffscreen
            ? `Jump to ${initialUnreadCountRef.current} new message${initialUnreadCountRef.current === 1 ? "" : "s"}`
            // Holds the visible "Jump to latest" (WCAG 2.5.3, axe 4.14 label-content-name-mismatch): "Jump to newest
            // message" did not, and the open-thread axe check went red whenever the chip showed (webkit, 11-06).
            : "Jump to latest message"
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
        {/* The unread anchor is only ever "offscreen" ABOVE the viewport
            (useChatScroll: nodeRect.bottom < containerRect.top), so the chip
            that jumps to it must point up. It pointed down — the same glyph
            as "Jump to latest" — while scrolling the other way; seen with
            one unread sitting above a screenful of newer messages. */}
        {firstUnreadOffscreen ? <ChevronsUp className="w-3 h-3" /> : <ChevronsDown className="w-3 h-3" />}
        {firstUnreadOffscreen
          ? `${initialUnreadCountRef.current} New Message${initialUnreadCountRef.current === 1 ? "" : "s"}`
          : "Jump to latest"}
      </Button>
    </div>
  );
}
