import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";
import type { Dispatch, SetStateAction } from "react";
import { Pin, Trash2, X } from "lucide-react";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { Button } from "@/components/ui/button";
import { INBOX_TAB_LABEL, INBOX_TAB_ORDER, type InboxView } from "@/lib/inboxDefault";
import type { Conversation } from "./types";

/**
 * ConversationList's header pieces (Q806 god-component split, 11-05): the Active / All filter tabs and the
 * hamburger-view chip. ConversationList owns the state and passes it down; these only render.
 */

/** The Active / All filter strip. Moved verbatim out of ConversationList (Q806). */
export function InboxFilterTabs({ isWebDesktop, activeThreads, allTabConversations, inboxTab, setInboxFilter }: { isWebDesktop: boolean; activeThreads: number; allTabConversations: Conversation[]; inboxTab: InboxView; setInboxFilter: Dispatch<SetStateAction<string | null>> }) {
  return (
    <UnderlineTabs
      /* Dense ONLY inline in the desktop header row, which is already 44px
         tall for its icon buttons. On phone the strip has its own line and
         the non-dense `py-[13px]` is what carries the 44px touch target —
         see UnderlineTabs' own note. */
      dense={isWebDesktop}
      ariaLabel={t("msg.filterConvos")}
      /* TWO tabs, Active then All (owner, 2026-09-19, confirmed twice).
         Narrow to wide, and the tab the inbox lands on comes first — "here,
         or everything", rather than the old strip's "All, and some filters".

         THE UNREAD TAB IS DELIBERATELY GONE, and it is redundant three times
         over: Active is the default so the landing view is already filtered
         to live conversations; unread is marked on the ROW itself (the dot +
         bold treatment in ConversationRow); and the list already SCROLLS to
         the first unread thread on entry (028fe3837, the effect just above).
         A filter that duplicates what the list already shows is chrome.

         This reverses the owner's own earlier ask the same afternoon ("in the
         top bar it should say all unread and active", 9b0eb1fc8). The other
         half of that commit — inline on desktop, disclosure on phone — is
         untouched and must stay. Only the third entry went.

         All's count is `allTabConversations`, NOT `conversations`: the age
         rule trims that tab (threadAgeOut.ts), and a tab whose number does
         not match the list under it is a worse lie than no number. */
      /* The ORDER and the WORDS come from lib/inboxDefault.ts, which already
         owns which tabs exist and which one the inbox lands on; only the
         counts are computed here, because only here knows them. They used to
         be two object literals typed out in this JSX, which meant the guard
         that asserts the strip is on the screen had to keep its own copy of
         the answer — a list checked against itself. */
      tabs={INBOX_TAB_ORDER.map((key) => ({
        key,
        label: INBOX_TAB_LABEL[key],
        count: key === "active" ? activeThreads : allTabConversations.length,
      }))}
      value={inboxTab}
      onChange={setInboxFilter}
    />
  );
}

/** "Showing pinned only" / "Showing recently deleted": the way back from a hamburger-only view. Moved verbatim out of ConversationList (Q806). */
export function PinnedFilterChip({ inboxTab, setInboxFilter }: { inboxTab: InboxView; setInboxFilter: Dispatch<SetStateAction<string | null>> }) {
  return (inboxTab === "pinned" || inboxTab === "recentlyDeleted") && (
    <div className="shrink-0">
      {/* The shared Button (ghost, sm; Q2709 11-05): the way back to All, bark ink. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setInboxFilter("all")}
        className="gap-1.5 text-ds-13 font-semibold text-[hsl(var(--bark))] [&_svg]:size-3"
      >
        {inboxTab === "pinned" ? <Pin className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
        {inboxTab === "pinned" ? t("msg.showingPinned") : t("msg.showingDeleted")}
        <X className="w-3 h-3" />
      </Button>
      {/* Two honesty notes, since "Recently Deleted" as a name implies both
          "temporary" and "complete" and this view is neither: hiding a
          thread never expires it on its own (it stays hidden until you
          restore it, not just for N days), and very old archives can fall
          outside the 200-message fetch window (see the onClick refresh
          above) and simply not be resolvable here yet. */}
      {/* THE HIDDEN-THREADS NOTE IS 0.7, was 0.6 (3.70:1 against a 4.5:1 AA
          floor). 0.7 is the lowest alpha on this token that clears AA (4.90:1)
          and is the same ink the aged-out notice further down this file already
          uses, so the inbox's two explanatory notes now match instead of
          differing by an alpha nobody chose. */}
      {inboxTab === "recentlyDeleted" && (
        <p className="px-4 pb-1 text-ds-10 font-sans" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          {t("msg.hiddenNote")}
        </p>
      )}
    </div>
  );
}
