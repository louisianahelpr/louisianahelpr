import { threadCountSummary } from "@/components/messages/threadCountLabel";
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
}) => {
  // Only the unread total — the "N threads" count was dropped app-wide as
  // redundant (the thread list right below IS the count, same reasoning as
  // Activity, /jobs, and the browse toolbar). Unread is genuinely different:
  // you can't get it by glancing at the list.
  const { unreadLabel } = threadCountSummary(conversations, loading);
  return (
    // Constrained to the list-rail width (340px, matching Messages.tsx's
    // left column) so the unread pill sits over the list column instead of
    // floating out across the empty thread pane. Bar itself still spans both
    // panes for background/border continuity.
    <div className="flex items-center justify-end gap-3 w-[340px]">
      {unreadLabel ? (
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
          {unreadLabel}
        </span>
      ) : null}
    </div>
  );
};
