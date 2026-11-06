import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import { unarchiveConversation } from "@/lib/archivedConversations";
import type { Conversation } from "./types";

/**
 * Recently Deleted's "un-hide" control. Swiping isn't available in that view
 * (it's the archive gesture itself, and re-archiving an already-archived
 * thread is a dead end), so restore needs its own button. The list hands it
 * to ConversationRow's `trailing` slot, in flow (Q1465: absolutely positioned
 * over the row it covered the end of a long job line at 375).
 */
export function RestoreConversationButton({ convo: c, userId }: { convo: Conversation; userId: string }) {
  return (
    // The shared Button (outline, sm; Q2709 11-05), in the row's trailing slot, in flow.
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        unarchiveConversation(userId, c.jobId, c.otherUserId);
        // Archive has an explicit confirm dialog ("Hide 1 conversation?"); Restore was the
        // only one-tap action here with no feedback beyond the row silently vanishing from
        // THIS list — a toast closes that gap without adding a confirm step Restore doesn't
        // need (it's the non-destructive direction).
        hapticLight();
        toast(`Restored conversation with ${c.otherUserName ?? "this person"}`);
      }}
      aria-label={`Restore conversation with ${c.otherUserName ?? "this person"}`}
      className="gap-1 px-3 text-ds-13 text-[hsl(var(--bark))] [&_svg]:size-3"
    >
      <RotateCcw className="w-3 h-3" />
      Restore
    </Button>
  );
}
