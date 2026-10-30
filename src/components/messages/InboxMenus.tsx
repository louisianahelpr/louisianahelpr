import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens";
import { Check, CheckSquare, ListFilter, Menu, Pin, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { INBOX_TAB_LABEL, INBOX_TAB_ORDER, type InboxTab, type InboxView } from "@/lib/inboxDefault";

/* The inbox's menus, out of ConversationList so it stays under its size
   baseline (src/test/componentSizeRatchet.test.ts). ConversationList owns
   every piece of state; these only render it. */

export interface InboxViewItemsProps {
  /** Select messages shows only when there are threads to select. */
  canSelect: boolean;
  onSelect: () => void;
  onPinned: () => void;
  /** Also refetches: allConversations is capped to the 200 most recent messages
      across every thread (fetchConversations), so a thread archived long ago (or
      before this device's cache was populated) needs a fresh fetch to resolve.
      Still not a guarantee for very old archives. */
  onRecentlyDeleted: () => void;
}

/* Both views are wired to real data: Pinned reads the existing swipe-to-pin
   state (getPinnedSet/pinnedKey); Recently deleted reads the existing archive
   state (archivedConversations.ts, already backing the swipe-to-archive
   action) via allConversations, the pre-archive-filter list useMessagesData
   already keeps around for deep links. The status-filter stubs (Needs You /
   Scheduled / Waiting / Done) were removed — they had no data behind them and
   no owner-approved design for what "status" means for a two-party thread
   (unlike Activity's single-sided job status), so a toast-only entry was pure
   dead-end UI. Re-add if/when that's designed. */
function InboxViewItems({ canSelect, onSelect, onPinned, onRecentlyDeleted }: InboxViewItemsProps) {
  return (
    <>
      {canSelect && (
        <DropdownMenuItem onClick={onSelect}>
          <CheckSquare className="w-4 h-4 mr-2" />
          Select messages
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onPinned}>
        <Pin className="w-4 h-4 mr-2" />
        Pinned
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onRecentlyDeleted}>
        <Trash2 className="w-4 h-4 mr-2" />
        Recently deleted
      </DropdownMenuItem>
    </>
  );
}

/* Hamburger — the OVERFLOW MENU, not the disclosure. It opens Select
   messages / Pinned / Recently Deleted: one bulk action and two views onto
   data the three tabs do not cover. It stays exactly as it was — the chevron
   beside it is an addition, not a replacement — because Recently deleted is
   the only route back to a thread you have hidden.

   Deliberately NOT gated on hasThreads: Pinned/Recently Deleted look at
   DIFFERENT data than what is currently showing, so an empty "All" must not
   strand the user unable to reach either. (Concretely: archive the one thread
   you have and the inbox goes empty — hiding this would make restoring that
   thread permanently unreachable through the UI.) */
export function InboxOptionsMenu({
  triggerClassName,
  iconClassName,
  ...items
}: InboxViewItemsProps & { triggerClassName: string; iconClassName: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={t("chat.listOptions")} className={triggerClassName}>
          <Menu className={iconClassName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <InboxViewItems {...items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Q2231 (owner, 2026-10-19): the phone search row's ONE "more" menu —
   Active / All, then the same views as the hamburger. Guard:
   src/test/messagesTopBarGlobalRule.test.tsx. */
export function MessagesMoreMenu({
  isDefaultFilter,
  showTabs,
  inboxTab,
  onTab,
  ...items
}: InboxViewItemsProps & {
  /** On a non-default filter the trigger wears the bark tint. */
  isDefaultFilter: boolean;
  /** No Active / All on a section with no threads (as before Q2231). */
  showTabs: boolean;
  inboxTab: InboxView;
  onTab: (key: InboxTab) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Owner 2026-10-21: a bare "…" read as nothing. A filter icon, a name that says what the menu holds
          // (Active / All, pinned, archived, recently deleted, select), and the same words as a tooltip.
          aria-label={t("chat.inboxOptions")}
          title={t("chat.inboxOptions")}
          data-testid="messages-more"
          className={`btn-press relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isDefaultFilter ? "text-muted-foreground" : "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]"}`}
        >
          <ListFilter className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* A radio pair, so a screen reader hears which one is on (the check is visual only). */}
        {showTabs && INBOX_TAB_ORDER.map((key) => (
          <DropdownMenuItem key={key} role="menuitemradio" aria-checked={inboxTab === key} onClick={() => onTab(key)}>
            <Check className={`w-4 h-4 mr-2 ${inboxTab === key ? "" : "invisible"}`} aria-hidden />
            {INBOX_TAB_LABEL[key]}
          </DropdownMenuItem>
        ))}
        {showTabs && <DropdownMenuSeparator />}
        <InboxViewItems {...items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
