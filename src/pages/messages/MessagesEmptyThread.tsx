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
 * `hasConversations` splits them. Nothing to pick gets a line that says so and
 * points at the only thing that can start a conversation — applying to a job.
 */
export const MessagesEmptyThread = ({
  hasConversations = true,
}: {
  hasConversations?: boolean;
}) => (
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
    {/* With no conversations, the LIST pane's empty card owns the headline and
        the Browse Jobs CTA — this pane repeating "No messages yet" beside it
        was two stacks telling the same story in different words (V6). The
        empty-list branch defers: no duplicate title, one quiet line. */}
    {hasConversations && (
      <p
        className="font-display italic font-bold text-ds-18"
        style={{
          color: "hsl(var(--ink-deep))",
          letterSpacing: "-0.015em",
        }}
      >
        Your conversations
      </p>
    )}
    <p
      className="font-serif italic text-ds-14 max-w-[280px]"
      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
    >
      {hasConversations
        ? "Pick a thread on the left to read and reply here."
        : "Conversations appear here once they start."}
    </p>
  </div>
);
