import { MessageSquare } from "lucide-react";

/**
 * Desktop right-pane resting state for the side-by-side split.
 *
 * It handled ONE of the two empty cases. "Pick a thread on the left to read and
 * reply here" is right when threads exist and none is selected — and wrong when
 * the list beside it is itself empty, which is exactly when it rendered next to
 * ConversationList's own "No messages yet." Two panes, side by side, one
 * telling you to pick from a list the other says is empty.
 *
 * `hasConversations` splits them. With nothing to pick, this pane renders
 * NOTHING: the list pane's empty card already owns the envelope, the headline,
 * the sentence and the Browse Jobs CTA, and a second grey icon with a second
 * sentence 577px to its right was still two empty states on one screen
 * (external QA, 2026-09-07 — an earlier pass had only trimmed the title).
 * The empty div keeps the pane's flex slot so the list column does not widen.
 */
export const MessagesEmptyThread = ({
  hasConversations = true,
}: {
  hasConversations?: boolean;
}) => {
  if (!hasConversations) {
    return <div className="flex-1 min-h-0" aria-hidden="true" />;
  }
  return (
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
        className="font-sans text-ds-14 max-w-[280px]"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Pick a thread on the left to read and reply here.
      </p>
    </div>
  );
};
