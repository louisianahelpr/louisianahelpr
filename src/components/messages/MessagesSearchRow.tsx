import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { t } from "@/lib/i18n/language";

/**
 * The inbox's slim permanent search row (Q2231, owner 2026-10-19): on the phone and in the two-pane desktop list
 * (board 38), search, options and Active/All fold into this one row under the section tabs, its "more" menu at the
 * row's right edge. Moved verbatim out of ConversationList (Q806 god-component ratchet); the list keeps the query
 * state and builds the menu.
 */
export function MessagesSearchRow({ value, onChange, moreMenu }: { value: string; onChange: (v: string) => void; moreMenu: ReactNode }) {
  return (
    <div data-testid="messages-search-row" className="shrink-0 pb-1.5">
      <div role="search" className="flex h-11 items-center gap-1 rounded-full border border-border bg-card pl-3.5 pr-1">
        <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label={t("chat.search")}
          placeholder={t("chat.search")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          enterKeyHint="search"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent pl-1.5 text-ds-15 outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label={t("chat.clearSearch")}
            onClick={() => onChange("")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
        {moreMenu}
      </div>
    </div>
  );
}
