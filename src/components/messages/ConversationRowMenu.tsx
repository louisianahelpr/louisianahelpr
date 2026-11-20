import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";
import { Archive, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Conversation } from "./types";

/**
 * The desktop row's ⋯ menu (owner-approved polish 2026-11-20): Archive or
 * Delete for me, the same two actions a phone reaches by swiping the row
 * left. Rides ConversationRow's `trailing` slot, in flow (Q1465), so the text
 * column shrinks around it instead of being covered. Both entries only open
 * the page's confirm dialogs; nothing is written from here.
 */
export function ConversationRowMenu({
  convo,
  onArchive,
  onDeleteForMe,
}: {
  convo: Conversation;
  onArchive: (convo: Conversation) => void;
  onDeleteForMe?: (convo: Conversation) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="iconCompact"
          data-testid="conversation-row-menu"
          aria-label={t("msg.rowOptions", { name: convo.otherUserName })}
          // The row's open-thread button sits under it: a press here must not also open the thread.
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
        >
          <MoreHorizontal className="w-4 h-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onArchive(convo)}>
          <Archive className="w-4 h-4 mr-2" aria-hidden />
          {t("msg.archive")}
        </DropdownMenuItem>
        {onDeleteForMe && (
          <DropdownMenuItem onClick={() => onDeleteForMe(convo)} className="text-destructive-ink focus:text-destructive-ink">
            <Trash2 className="w-4 h-4 mr-2" aria-hidden />
            {t("msg.deleteForMe")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
