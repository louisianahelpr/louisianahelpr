import type { Conversation } from "@/components/messages/types";

/**
 * Desktop title bar for the Messages PageScaffold. Spans both panes, so it
 * left-aligns the page title over the list column and parks an at-a-glance
 * unread summary on the right — otherwise the wide bar reads as dead space
 * beside the thread pane. The pill counts only genuinely unread inbound
 * messages (sum of per-thread `unread`).
 */
export const MessagesTitleCard = ({
  conversations,
  loading,
}: {
  conversations: Conversation[];
  loading: boolean;
}) => (
  // Constrained to the list-rail width (340px, matching Messages.tsx's
  // left column) so the thread count + unread pill sit over the list
  // column instead of floating out across the empty thread pane. Bar
  // itself still spans both panes for background/border continuity.
  <div className="flex items-center justify-between gap-3 w-[340px]">
    <div className="flex flex-col leading-none min-w-0">
      {/* Section name lives in the top bar now (Instagram/Facebook pattern);
          this desktop bar keeps only the thread count on the left and the
          unread pill on the right so the wide bar isn't dead space. */}
      {!loading && conversations.length > 0 ? (
        <p
          className="truncate font-sans font-semibold uppercase leading-none"
          style={{
            fontSize: "0.62rem",
            letterSpacing: "0.16em",
            color: "hsl(var(--olivewood) / 0.8)",
          }}
        >
          {conversations.length}{" "}
          {conversations.length === 1 ? "thread" : "threads"}
        </p>
      ) : null}
    </div>
    {(() => {
      const totalUnread = conversations.reduce(
        (sum, c) => sum + (c.unread || 0),
        0,
      );
      if (loading || totalUnread === 0) return null;
      return (
        <span
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-sans font-bold uppercase"
          style={{
            fontSize: "0.62rem",
            letterSpacing: "0.12em",
            color: "hsl(var(--parchment))",
            background: "hsl(var(--burnt-sienna))",
            boxShadow: "0 1px 3px hsl(var(--burnt-sienna) / 0.35)",
          }}
        >
          {totalUnread} unread
        </span>
      );
    })()}
  </div>
);
